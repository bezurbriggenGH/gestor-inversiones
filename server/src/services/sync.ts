// Mantiene la base de datos al día. Nunca se pierden días: cada actualización pide
// desde la última fecha guardada hasta hoy, así que si nadie abre la app por una
// semana, la próxima vez se completan los días que faltan en una sola consulta.
import { db, all, get, run, tx } from '../db.ts';
import { fetchChart, type Bar, type Dividend, type Split } from '../providers/yahoo.ts';
import { FX_KINDS, fetchFxHistory, fetchFxToday, type FxPoint, type FxKind } from '../providers/dolar.ts';
import { fetchDepositRate, fetchUva, fetchYahooSeries, type IndexPoint } from '../providers/indices.ts';
import { checkAlerts } from './alerts.ts';
import { cleanHistory } from './clean.ts';
import { addDays, lastMarketTime } from '../util.ts';
import { usSymbolOf } from '../cedears.ts';

const PRICE_TTL_MS = 15 * 60_000; // precios: con el mercado abierto, como mucho cada 15 minutos
const FX_TTL_MS = 60 * 60_000; // dólar: como mucho cada hora
const INDEX_TTL_MS = 6 * 60 * 60_000; // índices de referencia: cada 6 horas
const DAILY_TTL_MS = 24 * 60 * 60_000; // historiales completos que la fuente no da por partes

// Si llegan dos pedidos a la vez para lo mismo, comparten la misma consulta
const inflight = new Map<string, Promise<void>>();
function once(key: string, fn: () => Promise<void>): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function stale(key: string, ttl: number): boolean {
  const last = get<{ value: number }>('SELECT value FROM sync_state WHERE key = ?', key)?.value;
  return !last || Date.now() - last > ttl;
}

/**
 * ¿Pudo cambiar el precio desde la última consulta?
 * - Mercado abierto: sí, si pasaron más de 15 minutos.
 * - Mercado cerrado: solo si la última consulta fue antes del cierre (falta el precio final).
 *   Así, de noche y los fines de semana no se le pide nada a Yahoo.
 */
export function pricesStale(lastSync: number | null | undefined, now: number = Date.now()): boolean {
  if (!lastSync) return true;
  const marketTime = lastMarketTime(now);
  if (marketTime < now) return lastSync < marketTime;
  return now - lastSync > PRICE_TTL_MS;
}

function markSynced(key: string) {
  run('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, Date.now());
}

export function saveBars(ticker: string, bars: Bar[], dividends: Dividend[] = [], splits: Split[] = []): void {
  const priceStmt = db.prepare(`
    INSERT INTO prices (ticker, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (ticker, date) DO UPDATE SET
      open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume
  `);
  const divStmt = db.prepare(
    'INSERT INTO dividend_events (ticker, date, amount) VALUES (?, ?, ?) ON CONFLICT (ticker, date) DO UPDATE SET amount = excluded.amount',
  );
  const splitStmt = db.prepare(
    'INSERT INTO split_events (ticker, date, factor) VALUES (?, ?, ?) ON CONFLICT (ticker, date) DO UPDATE SET factor = excluded.factor',
  );
  tx(() => {
    for (const b of bars) priceStmt.run(ticker, b.date, b.open, b.high, b.low, b.close, b.volume);
    for (const d of dividends) divStmt.run(ticker, d.date, d.amount);
    for (const s of splits) splitStmt.run(ticker, s.date, s.factor);
  });
  // Cambios de ratio que Yahoo no informó y dividendos imposibles
  cleanHistory(ticker);
}

function saveFx(kind: FxKind, points: FxPoint[]): void {
  const stmt = db.prepare(`
    INSERT INTO fx_rates (kind, date, buy, sell) VALUES (?, ?, ?, ?)
    ON CONFLICT (kind, date) DO UPDATE SET buy = excluded.buy, sell = excluded.sell
  `);
  tx(() => {
    for (const p of points) stmt.run(kind, p.date, p.buy, p.sell);
  });
}

function saveIndex(series: string, points: IndexPoint[]): void {
  const stmt = db.prepare(
    'INSERT INTO index_values (series, date, value) VALUES (?, ?, ?) ON CONFLICT (series, date) DO UPDATE SET value = excluded.value',
  );
  tx(() => {
    for (const p of points) stmt.run(series, p.date, p.value);
  });
}

export function syncAsset(ticker: string, force = false): Promise<void> {
  return once(`asset:${ticker}`, async () => {
    const asset = get<{ symbol: string; last_sync: number | null }>(
      'SELECT symbol, last_sync FROM assets WHERE ticker = ?',
      ticker,
    );
    if (!asset) return;
    if (!force && !pricesStale(asset.last_sync)) return;

    const last = get<{ d: string | null }>('SELECT MAX(date) AS d FROM prices WHERE ticker = ?', ticker)?.d;
    // Los activos guardados antes de registrar splits se descargan completos una vez
    const splitsKey = `splits:${ticker}`;
    let full = !last || !get('SELECT 1 FROM sync_state WHERE key = ?', splitsKey);
    // Pedimos una semana de margen para corregir cierres que Yahoo haya ajustado
    let chart = await fetchChart(asset.symbol, full ? { range: '10y' } : { from: addDays(last!, -7) });
    const isNew = (s: Split) => !get('SELECT 1 FROM split_events WHERE ticker = ? AND date = ?', ticker, s.date);
    if (!full && chart.splits.some(isNew)) {
      // Split nuevo: Yahoo ajustó todo el historial, así que se vuelve a bajar completo
      chart = await fetchChart(asset.symbol, { range: '10y' });
      full = true;
    }
    const stored = get<{ n: number }>('SELECT COUNT(*) AS n FROM prices WHERE ticker = ?', ticker)?.n ?? 0;
    // Solo se reemplaza el historial si Yahoo devolvió uno completo (a veces devuelve solo el día de hoy)
    if (full && chart.bars.length >= stored * 0.9) run('DELETE FROM prices WHERE ticker = ?', ticker);
    saveBars(ticker, chart.bars, chart.dividends, chart.splits);
    if (!full || chart.bars.length >= stored * 0.9) markSynced(splitsKey);
    run('UPDATE assets SET last_sync = ? WHERE ticker = ?', Date.now(), ticker);
    checkAlerts(ticker);
    await syncUnderlying(ticker);
  });
}

/** Para CEDEARs: precio de la acción original en EE.UU. (para el CCL implícito). */
async function syncUnderlying(ticker: string): Promise<void> {
  const symbol = usSymbolOf(ticker);
  if (!symbol) return;
  const series = `us:${symbol}`;
  try {
    const last = get<{ d: string | null }>('SELECT MAX(date) AS d FROM index_values WHERE series = ?', series)?.d;
    const chart = await fetchChart(symbol, last ? { from: addDays(last, -7) } : { range: '2y' });
    saveIndex(series, chart.bars.map((b) => ({ date: b.date, value: b.close })));
  } catch (e) {
    // Es un dato extra: si falla, el resto del activo sigue funcionando
    console.warn(`[sync] ${symbol} en EE.UU.:`, (e as Error).message);
  }
}

export function syncFx(force = false): Promise<void> {
  return once('fx', async () => {
    if (!force && !stale('fx', FX_TTL_MS)) return;
    // ArgentinaDatos solo entrega el historial completo (años de datos), así que se baja
    // una vez por día. Cada hora alcanza con el valor del momento de DolarApi.
    const fullHistory = force || stale('fx-history', DAILY_TTL_MS);
    for (const kind of FX_KINDS) {
      if (fullHistory) saveFx(kind, await fetchFxHistory(kind));
      try {
        saveFx(kind, [await fetchFxToday(kind)]);
      } catch {
        // Sin el valor del momento, se completa con el historial (si no se bajó recién)
        if (fullHistory) continue;
        saveFx(kind, await fetchFxHistory(kind));
      }
    }
    if (fullHistory) markSynced('fx-history');
    markSynced('fx');
  });
}

export function syncIndices(force = false): Promise<void> {
  return once('indices', async () => {
    if (!force && !stale('indices', INDEX_TTL_MS)) return;
    // Merval y SPY: solo los días que faltan (con 7 de margen), como los precios
    const since = (series: string) => {
      const last = get<{ d: string | null }>('SELECT MAX(date) AS d FROM index_values WHERE series = ?', series)?.d;
      return last ? addDays(last, -7) : undefined;
    };
    const jobs: [string, () => Promise<IndexPoint[]>][] = [
      ['merval', () => fetchYahooSeries('^MERV', since('merval'))],
      ['spy', () => fetchYahooSeries('SPY.BA', since('spy'))],
    ];
    // UVA y plazo fijo se publican una vez por día y la fuente solo da el historial completo
    for (const [name, fn] of [['uva', fetchUva], ['plazofijo', fetchDepositRate]] as const) {
      if (force || stale(`index-full:${name}`, DAILY_TTL_MS)) jobs.push([name, fn]);
    }
    const results = await Promise.allSettled(
      jobs.map(async ([name, fn]) => {
        saveIndex(name, await fn());
        markSynced(`index-full:${name}`);
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === jobs.length) throw new Error('No se pudo actualizar ningún índice de referencia');
    markSynced('indices');
  });
}

/** Actualiza todo. Si alguna fuente falla, se sigue usando lo guardado y se devuelve el error. */
export async function syncAll(): Promise<string[]> {
  const tickers = all<{ ticker: string }>('SELECT DISTINCT ticker FROM user_assets');
  const results = await Promise.allSettled([syncFx(), syncIndices(), ...tickers.map((t) => syncAsset(t.ticker))]);
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason?.message ?? r.reason));
  if (errors.length) console.warn('[sync]', errors);
  return errors;
}

/** Da de alta un instrumento en el catálogo global con todo su historial. */
export async function ensureAsset(ticker: string, symbol: string, type: 'ACCION' | 'CEDEAR') {
  if (get('SELECT 1 FROM assets WHERE ticker = ?', ticker)) {
    // Activos guardados antes de registrar splits (y que nadie siguió desde entonces):
    // se completan ahora, porque las operaciones se ajustan con esos splits
    if (!get('SELECT 1 FROM sync_state WHERE key = ?', `splits:${ticker}`)) {
      await syncAsset(ticker, true).catch((e) => console.warn(`[sync] splits de ${ticker}:`, (e as Error).message));
    }
    return;
  }
  const chart = await fetchChart(symbol, { range: '10y' });
  if (chart.bars.length === 0) throw new Error(`${ticker} no tiene precios`);
  run('INSERT INTO assets (ticker, symbol, name, type, last_sync) VALUES (?, ?, ?, ?, ?)', ticker, symbol, chart.name, type, Date.now());
  saveBars(ticker, chart.bars, chart.dividends, chart.splits);
  markSynced(`splits:${ticker}`);
  if (type === 'CEDEAR') await syncUnderlying(ticker);
}
