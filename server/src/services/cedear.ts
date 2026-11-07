// CCL implícito de un CEDEAR.
//
// Un CEDEAR representa una fracción de una acción de EE.UU. Con su precio en pesos,
// el precio de la acción original en dólares y el ratio, se obtiene el dólar al que
// "estás comprando":
//
//   CCL implícito = precio CEDEAR en pesos × ratio / precio en EE.UU. en dólares
//
// Si el CCL implícito es mayor al CCL del mercado, el CEDEAR está caro (pagás un
// dólar más alto); si es menor, está barato.
import { all } from '../db.ts';
import { CEDEAR_RATIOS, usSymbolOf } from '../cedears.ts';
import { loadFx } from './portfolio.ts';

const HISTORY_DAYS = 365;
const AVG_POINTS = 20; // ~1 mes de ruedas
const RATIO_TOLERANCE = 0.1; // si el ratio observado se aleja más de 10%, probablemente cambió

function minusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

export interface CedearGapPoint {
  date: string;
  impliedCcl: number;
  ccl: number;
  gap: number;
}

export function buildCedearInfo(ticker: string) {
  const symbol = usSymbolOf(ticker);
  if (!symbol) return null;
  const ratio = CEDEAR_RATIOS[ticker];

  const us = new Map(
    all<{ date: string; value: number }>('SELECT date, value FROM index_values WHERE series = ? ORDER BY date', `us:${symbol}`).map(
      (r) => [r.date, r.value],
    ),
  );
  if (us.size === 0) return { ratio, usSymbol: symbol, status: 'SIN_DATOS' as const };

  const ccl = loadFx('contadoconliqui');
  if (ccl.empty) return { ratio, usSymbol: symbol, status: 'SIN_DATOS' as const };

  const ba = all<{ date: string; close: number }>('SELECT date, close FROM prices WHERE ticker = ? ORDER BY date', ticker);
  const from = ba.length ? minusDays(ba[ba.length - 1].date, HISTORY_DAYS) : '';

  // Solo días en que operaron los dos mercados
  const points: (CedearGapPoint & { ars: number; usd: number })[] = [];
  for (const b of ba) {
    if (b.date < from) continue;
    const usd = us.get(b.date);
    if (!usd) continue;
    const rate = ccl.at(b.date);
    const impliedCcl = (b.close * ratio) / usd;
    points.push({ date: b.date, ars: b.close, usd, ccl: rate, impliedCcl, gap: impliedCcl / rate - 1 });
  }
  if (points.length === 0) return { ratio, usSymbol: symbol, status: 'SIN_DATOS' as const };

  const recent = points.slice(-AVG_POINTS);
  // Control: el ratio que surge de los precios tiene que parecerse al de la tabla
  const observedRatio = median(recent.map((p) => (p.usd * p.ccl) / p.ars));
  const ratioOk = Math.abs(observedRatio / ratio - 1) <= RATIO_TOLERANCE;

  const last = points[points.length - 1];
  return {
    ratio,
    usSymbol: symbol,
    status: ratioOk ? ('OK' as const) : ('RATIO_DUDOSO' as const),
    observedRatio,
    date: last.date,
    arsPrice: last.ars,
    usPrice: last.usd,
    ccl: last.ccl,
    impliedCcl: last.impliedCcl,
    gap: last.gap,
    gapAvg: recent.reduce((s, p) => s + p.gap, 0) / recent.length,
    history: ratioOk ? points.map(({ date, impliedCcl, ccl, gap }) => ({ date, impliedCcl, ccl, gap })) : [],
  };
}

/** Solo la brecha de hoy, para las tarjetas de la cartera. */
export function cedearGap(ticker: string): number | null {
  const info = buildCedearInfo(ticker);
  return info && info.status === 'OK' ? info.gap : null;
}
