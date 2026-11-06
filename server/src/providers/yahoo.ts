// Precios diarios desde Yahoo Finance (API no oficial, sin clave).
// Los instrumentos de BYMA usan el sufijo .BA: GGAL.BA, YPFD.BA, MELI.BA (CEDEAR), etc.

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

export interface YahooChart {
  symbol: string;
  name: string;
  currency: string;
  bars: Bar[];
  dividends: Dividend[];
}

export class YahooNotFound extends Error {}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';

export async function fetchChart(
  symbol: string,
  opts: { from?: Date; range?: string } = {},
): Promise<YahooChart> {
  const params = new URLSearchParams({ interval: '1d', events: 'div,split' });
  if (opts.from) {
    params.set('period1', String(Math.floor(opts.from.getTime() / 1000)));
    params.set('period2', String(Math.floor(Date.now() / 1000) + 86_400));
  } else {
    params.set('range', opts.range ?? '10y');
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) throw new YahooNotFound(symbol);
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

  return {
    symbol,
    name: meta.longName ?? meta.shortName ?? symbol,
    currency: meta.currency ?? 'ARS',
    bars: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    dividends,
  };
}
