// Precios diarios desde Yahoo Finance (API no oficial, sin clave).
// Los instrumentos de BYMA usan el sufijo .BA: GGAL.BA, YPFD.BA, MELI.BA (CEDEAR), etc.
import { fetchWithTimeout } from '../util.ts';

export interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface Dividend {
  date: string; // fecha ex-dividendo
  amount: number; // por acción, en la moneda del instrumento
}

export interface Split {
  date: string;
  factor: number; // 3:1 → 3 (cada unidad pasa a ser 3)
}

export interface YahooChart {
  symbol: string;
  name: string;
  currency: string;
  bars: Bar[];
  dividends: Dividend[];
  splits: Split[];
}

export class YahooNotFound extends Error {}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';

// Yahoo no tiene clave ni límite publicado: si le llegan muchos pedidos juntos puede bloquear la
// conexión por un rato (error 429). Con 62 activos salían 89 pedidos en el mismo segundo.
// Ahora van de a pocos: los demás esperan su turno.
const MAX_AT_ONCE = 5;
/** Si Yahoo responde 429, no se le pide nada más durante este tiempo. */
const PAUSE_AFTER_429_MS = 15 * 60_000;

let running = 0;
const waiting: (() => void)[] = [];
let pausedUntil = 0;

async function takeTurn<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await fn();
  } finally {
    // El lugar pasa directo al siguiente de la fila; si no hay nadie, queda libre
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export class YahooPaused extends Error {
  constructor() {
    super('Yahoo Finance pidió esperar por demasiados pedidos. Se vuelve a intentar en unos minutos.');
  }
}

export function fetchChart(symbol: string, opts: { from?: Date; range?: string } = {}): Promise<YahooChart> {
  return takeTurn(() => requestChart(symbol, opts));
}

async function requestChart(symbol: string, opts: { from?: Date; range?: string }): Promise<YahooChart> {
  if (Date.now() < pausedUntil) throw new YahooPaused();
  const params = new URLSearchParams({ interval: '1d', events: 'div,split' });
  if (opts.from) {
    params.set('period1', String(Math.floor(opts.from.getTime() / 1000)));
    params.set('period2', String(Math.floor(Date.now() / 1000) + 86_400));
  } else {
    params.set('range', opts.range ?? '10y');
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
  const res = await fetchWithTimeout(url, 'Yahoo Finance', { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) throw new YahooNotFound(symbol);
  if (res.status === 429) {
    pausedUntil = Date.now() + PAUSE_AFTER_429_MS;
    throw new YahooPaused();
  }
  if (!res.ok) throw new Error(`Yahoo Finance respondió ${res.status} para ${symbol}`);

  const json = (await res.json()) as any;
  const result = json?.chart?.result?.[0];
  if (!result) throw new YahooNotFound(symbol);

  const meta = result.meta ?? {};
  const offset: number = meta.gmtoffset ?? -10_800;
  const toDate = (t: number) => new Date((t + offset) * 1000).toISOString().slice(0, 10);
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  // Un registro por fecha (si Yahoo repite el día en curso, gana el último)
  const byDate = new Map<string, Bar>();
  timestamps.forEach((t, i) => {
    const close = q.close?.[i];
    if (close == null || !(close > 0)) return;
    const date = toDate(t);
    byDate.set(date, {
      date,
      open: q.open?.[i] ?? null,
      high: q.high?.[i] ?? null,
      low: q.low?.[i] ?? null,
      close,
      volume: q.volume?.[i] ?? null,
    });
  });

  const dividends = Object.values((result.events?.dividends ?? {}) as Record<string, { date: number; amount: number }>)
    .filter((d) => d.amount > 0)
    .map((d) => ({ date: toDate(d.date), amount: d.amount }));

  const splits = Object.values((result.events?.splits ?? {}) as Record<string, { date: number; numerator: number; denominator: number }>)
    .filter((s) => s.numerator > 0 && s.denominator > 0 && s.numerator !== s.denominator)
    .map((s) => ({ date: toDate(s.date), factor: s.numerator / s.denominator }));

  return {
    symbol,
    name: meta.longName ?? meta.shortName ?? symbol,
    currency: meta.currency ?? 'ARS',
    bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    dividends,
    splits,
  };
}
