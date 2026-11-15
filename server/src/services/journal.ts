// Diario de decisiones: ¿acertaste con cada compra y venta?
//
// Se mira qué hizo el precio 30, 90 y 180 días después de cada operación (decide el de 90):
// - Compra: acierto si después subió (> +2%), error si bajó (< −2%).
// - Venta:  acierto si después bajó (vendiste antes de una caída), error si subió.
// Entre −2% y +2% se considera neutral.
//
// El veredicto mira el MOMENTO de cada decisión, no si ganaste plata. Son dos cosas distintas:
// compro a $1.000, vendo a $2.000 a los 5 días y después cae a $100 → el momento de la compra fue
// malo (a los 30 días valía 90% menos), pero con la operación gané el doble. Y al revés: compro a
// $1.000, vendo a $900 por miedo y después sube a $3.000 → elegí bien y salí mal.
// Por eso, además del veredicto, se informa:
// - "Ventas con ganancia": en cuántas ventas ganaste plata (contra tu precio promedio) y cuánto.
// - En cada compra, si vendiste dentro del plazo en que se la juzga y con qué resultado.
//
// Los cambios de precio se miden SIEMPRE en dólares, aunque estés viendo la app en pesos:
// con inflación, casi cualquier precio en pesos sube más de 2% en 90 días, y entonces
// casi todas las compras parecerían aciertos y casi todas las ventas, errores.
//
// Contra el mercado: que el precio suba no prueba que elegiste bien si en esos mismos días subió todo.
// Por eso, junto al veredicto, se muestra qué hizo el mercado en el mismo plazo (S&P 500 para
// CEDEARs, Merval para acciones, también en dólares) y si la decisión le ganó.
// Ejemplo: compro y a los 90 días el activo subió 5%, pero el S&P 500 subió 10%. El veredicto dice
// acierto (subió), pero contra el mercado perdió: 1,05 / 1,10 − 1 = −4,5%. Con una venta es al revés:
// le ganó al mercado si, después de vender, el activo anduvo peor que el mercado.
import { all } from '../db.ts';
import { loadIndex } from './history.ts';
import type { FxKind } from '../providers/dolar.ts';
import { DateSeries, computePosition, getOperations, loadFx, makeConverter, sortOps, type Currency, type OperationRow } from './portfolio.ts';

export const HORIZONS = [30, 90, 180] as const;
const MAIN_HORIZON = 90;
const NEUTRAL_BAND = 0.02;

export type Verdict = 'ACIERTO' | 'ERROR' | 'NEUTRAL';

/** Contra qué mercado se compara cada tipo de activo. */
const MARKET = { CEDEAR: { series: 'spy', label: 'S&P 500' }, ACCION: { series: 'merval', label: 'Merval' } } as const;

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function judge(type: 'COMPRA' | 'VENTA', change: number): Verdict {
  if (Math.abs(change) <= NEUTRAL_BAND) return 'NEUTRAL';
  const priceWentUp = change > 0;
  return (type === 'COMPRA') === priceWentUp ? 'ACIERTO' : 'ERROR';
}

/** Con menos decisiones evaluadas que esto, un porcentaje dice muy poco: no se muestra como conclusión. */
export const MIN_JUDGED = 10;

/**
 * ¿La diferencia entre los porcentajes de aciertos de dos grupos es real, o puede ser casualidad?
 * Es la prueba estadística de siempre para comparar dos proporciones (prueba z, 95% de confianza):
 * la diferencia tiene que ser casi el doble de lo que varía un porcentaje por pura suerte con esas cantidades.
 * Como tirar una moneda: 3 caras en 4 tiros no prueba que esté cargada; 750 en 1.000, sí.
 * Ejemplo: 87 aciertos de 198 compras (44%) contra 39 de 76 ventas (51%). En total 126 de 274 (46%);
 * por suerte, la diferencia varía √(0,46 × 0,54 × (1/198 + 1/76)) ≈ 6,7 puntos. La diferencia es de
 * 7,4 puntos: 1,1 veces eso, menos de 1,96 → puede ser casualidad.
 */
export function realDifference(a: { hits: number; judged: number }, b: { hits: number; judged: number }): boolean {
  if (a.judged < MIN_JUDGED || b.judged < MIN_JUDGED) return false;
  const pa = a.hits / a.judged;
  const pb = b.hits / b.judged;
  const p = (a.hits + b.hits) / (a.judged + b.judged);
  const spread = Math.sqrt(p * (1 - p) * (1 / a.judged + 1 / b.judged));
  if (spread === 0) return false; // todos aciertos o todos errores en los dos grupos: no hay diferencia
  return Math.abs(pa - pb) / spread >= 1.96;
}

/**
 * ¿Le ganaste al mercado más (o menos) veces de lo que daría elegir al azar? Al azar, cada decisión tiene
 * 50% de chances, como una moneda. Misma prueba que arriba: la distancia a 50% tiene que ser al menos
 * 1,96 veces lo que varía por suerte, √(0,5 × 0,5 ÷ cantidad).
 * Ejemplo: 127 de 272 (46,7%). Por suerte varía √(0,25 ÷ 272) ≈ 3 puntos; 46,7% está a 3,3 puntos de 50%:
 * 1,1 veces → no se distingue del azar. Con 170 de 272 (62,5%) serían 12,5 puntos, 4,1 veces → sí.
 */
export function differsFromChance(beat: number, compared: number): boolean {
  if (compared < MIN_JUDGED) return false;
  return Math.abs(beat / compared - 0.5) / Math.sqrt(0.25 / compared) >= 1.96;
}

/** Con `ticker`, solo las operaciones de ese activo (para marcarlas en su gráfico). */
export function buildJournal(userId: number, currency: Currency, kind: FxKind, ticker?: string) {
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx); // para mostrar precios en la moneda elegida
  const judgeConv = makeConverter(fx.empty ? 'ARS' : 'USD', fx); // para medir si acertaste
  // Las fracciones que deja un split no son decisiones tuyas: no se juzgan
  const allOps = getOperations(userId, ticker);
  const ops = sortOps(allOps).filter((o) => o.type !== 'DIVIDENDO' && !o.auto);

  // Cuánto se ganó o perdió en cada venta, contra el precio promedio de ese momento (el mismo
  // cálculo de la cartera). Con precio promedio no existe "la compra de esta venta": las acciones
  // no se distinguen entre sí, así que el resultado es de la venta, no de una compra en particular.
  const realizedByOp = new Map<number, number>();
  const realizedJudgeByOp = new Map<number, number>(); // lo mismo, en dólares (para "Ventas con ganancia")
  const opsByTicker = new Map<string, OperationRow[]>();
  for (const op of allOps) opsByTicker.set(op.ticker, [...(opsByTicker.get(op.ticker) ?? []), op]);
  for (const list of opsByTicker.values()) {
    for (const [id, result] of computePosition(list, undefined, undefined, conv).realizedByOp) realizedByOp.set(id, result);
    for (const [id, result] of computePosition(list, undefined, undefined, judgeConv).realizedByOp) realizedJudgeByOp.set(id, result);
  }

  const assetTypes = new Map(all<{ ticker: string; type: 'ACCION' | 'CEDEAR' }>('SELECT ticker, type FROM assets').map((a) => [a.ticker, a.type]));
  const priceCache = new Map<string, DateSeries>();
  const pricesOf = (ticker: string) => {
    let s = priceCache.get(ticker);
    if (!s) {
      s = new DateSeries(all('SELECT date, close AS value FROM prices WHERE ticker = ? ORDER BY date', ticker));
      priceCache.set(ticker, s);
    }
    return s;
  };

  // Qué hizo el mercado en el mismo plazo que decide el veredicto. Sin datos del índice en las dos
  // fechas (el Merval de Yahoo está congelado desde octubre de 2026), no se compara.
  const marketOf = (assetType: 'ACCION' | 'CEDEAR', type: 'COMPRA' | 'VENTA', date: string, main: { days: number; change: number } | null) => {
    const idx = markets[assetType];
    if (!main || idx.empty) return null;
    const target = addDaysIso(date, main.days);
    if (!idx.covers(date) || target > idx.dates[idx.dates.length - 1]) return null;
    const change = judgeConv(idx.at(target), target) / judgeConv(idx.at(date), date) - 1;
    // Cuánto mejor (+) o peor (−) anduvo el activo que el mercado
    const relative = (1 + main.change) / (1 + change) - 1;
    return { label: MARKET[assetType].label, change, relative, beat: type === 'COMPRA' ? relative > 0 : relative < 0 };
  };
  const markets = { CEDEAR: loadIndex(MARKET.CEDEAR.series), ACCION: loadIndex(MARKET.ACCION.series) };

  const entries = ops
    .map((op) => {
      const assetType = assetTypes.get(op.ticker) ?? 'CEDEAR';
      const s = pricesOf(op.ticker);
      const lastDate = s.empty ? '' : s.dates[s.dates.length - 1];
      const base = conv(op.price, op.date);
      const baseUsd = judgeConv(op.price, op.date);
      const type = op.type as 'COMPRA' | 'VENTA';
      const horizons = HORIZONS.map((days) => {
        const target = addDaysIso(op.date, days);
        if (s.empty || target > lastDate) return { days, available: false as const };
        // Ya pasó el plazo, pero no hay precios guardados de esa época (Yahoo no tiene historial de
        // algunos CEDEARs). Sin precio real no se juzga: comparar con uno posterior daría cualquier cosa.
        if (!s.covers(target)) return { days, available: false as const, noData: true as const };
        const price = conv(s.at(target), target);
        const change = judgeConv(s.at(target), target) / baseUsd - 1;
        return { days, available: true as const, price, change, verdict: judge(type, change) };
      });
      // Cambio hasta hoy, para operaciones recientes
      const sinceChange = s.empty ? null : judgeConv(s.at(lastDate), lastDate) / baseUsd - 1;
      // Veredicto principal: a 90 días (o 30 si todavía no pasaron 90).
      // 180 días se muestra pero no decide: a ese plazo pesa más el mercado que la decisión.
      const main = [...horizons].reverse().find((h) => h.available && h.days <= MAIN_HORIZON);
      // En una venta: la plata que dejaste de ganar (+) o que te ahorraste de perder (−) por haber
      // vendido, mirando el precio de hoy. Se calcula en dólares, igual que el veredicto, y viendo la
      // app en pesos se muestra en pesos de hoy. Con los pesos de cada fecha, la inflación haría que
      // casi toda venta pareciera plata perdida. Ejemplo: vendí 4 a $150 con el dólar a $1.000
      // (US$ 0,15); hoy vale $200 con el dólar a $1.250 (US$ 0,16) → 4 × US$ 0,01 = US$ 0,04 = $50 de hoy.
      let missed: number | null = null;
      if (type === 'VENTA' && !s.empty && !fx.empty) {
        const usd = op.quantity * (s.at(lastDate) / fx.at(lastDate) - op.price / fx.at(op.date));
        missed = currency === 'USD' ? usd : usd * fx.at(lastDate);
      }
      // En una compra: lo que vendiste de ese activo dentro del plazo en que se la juzga (o hasta
      // hoy, si todavía no tiene veredicto) y cuánto ganaste con esas ventas. Sirve para no leer
      // "error" en una compra que cerraste ganando antes de que el precio bajara.
      let soldWithin: { quantity: number; realized: number } | null = null;
      if (type === 'COMPRA') {
        const until = main && main.available ? addDaysIso(op.date, main.days) : '9999-12-31';
        const sales = ops.filter((o) => o.ticker === op.ticker && o.type === 'VENTA' && o.date >= op.date && o.date <= until);
        if (sales.length > 0) {
          soldWithin = {
            quantity: sales.reduce((acc, o) => acc + o.quantity, 0),
            realized: sales.reduce((acc, o) => acc + (realizedByOp.get(o.id) ?? 0), 0),
          };
        }
      }
      return {
        id: op.id,
        ticker: op.ticker,
        assetType,
        market: marketOf(assetType, type, op.date, main && main.available ? main : null),
        // En una venta: lo que ganaste o perdiste con ella, contra tu precio promedio
        realized: type === 'VENTA' ? (realizedByOp.get(op.id) ?? null) : null,
        soldWithin,
        missed,
        type,
        date: op.date,
        quantity: op.quantity,
        price: base,
        note_title: op.note_title,
        note_body: op.note_body,
        hasNote: Boolean(op.note_title || op.note_body),
        horizons,
        sinceChange,
        verdict: main && main.available ? main.verdict : null,
        verdictDays: main && main.available ? main.days : null,
      };
    })
    .reverse();

  // Para los porcentajes, una decisión es un activo, un día y un tipo (compra o venta): el broker suele
  // partir una orden en varias, y contar cada pedazo como una decisión aparte inflaría la cantidad de
  // casos (y haría parecer más seguro un porcentaje que sale de pocas decisiones reales).
  // De cada grupo decide el pedazo más grande; tiene justificación si alguno la tiene.
  const decisionMap = new Map<string, (typeof entries)[number] & { hasNote: boolean }>();
  for (const e of entries) {
    const key = `${e.ticker}|${e.date}|${e.type}`;
    const prev = decisionMap.get(key);
    if (!prev) decisionMap.set(key, e);
    else decisionMap.set(key, { ...(e.quantity > prev.quantity ? e : prev), hasNote: prev.hasNote || e.hasNote });
  }
  const decisions = [...decisionMap.values()];

  const stats = (list: typeof decisions) => {
    const judged = list.filter((e) => e.verdict && e.verdict !== 'NEUTRAL');
    const hits = judged.filter((e) => e.verdict === 'ACIERTO').length;
    return {
      total: list.length,
      judged: judged.length,
      hits,
      misses: judged.length - hits,
      neutral: list.filter((e) => e.verdict === 'NEUTRAL').length,
      pending: list.filter((e) => !e.verdict).length,
      hitRate: judged.length ? hits / judged.length : null,
    };
  };

  // Qué pasó, en plata, con todo lo que vendiste
  const sales = entries.filter((e) => e.missed != null);
  const sold = {
    count: sales.length,
    // Ventas después de las cuales el precio siguió subiendo: lo que dejaste de ganar
    missedCount: sales.filter((e) => e.missed! > 0).length,
    missed: sales.reduce((acc, e) => acc + Math.max(e.missed!, 0), 0),
    // Ventas después de las cuales el precio bajó: lo que te ahorraste de perder
    savedCount: sales.filter((e) => e.missed! < 0).length,
    saved: sales.reduce((acc, e) => acc + Math.max(-e.missed!, 0), 0),
    // Positivo: en conjunto, vender te convino
    net: sales.reduce((acc, e) => acc - e.missed!, 0),
  };

  // Ventas con ganancia: el "porcentaje de aciertos" clásico, en plata y no en momento.
  // Las ventas del mismo activo en el mismo día cuentan como una sola (el broker suele partir una orden en varias).
  // Se cuentan en dólares, como el veredicto: en pesos, la inflación hace que casi cualquier venta
  // dé ganancia. Ejemplo: compro a $1.000 con el dólar a $1.000 (US$ 1) y vendo a $1.200 con el
  // dólar a $1.300 (US$ 0,92): en pesos gané $200, en dólares perdí US$ 0,08 → cuenta como pérdida.
  const byDay = new Map<string, number>();
  for (const e of entries) {
    const result = realizedJudgeByOp.get(e.id);
    if (e.type === 'VENTA' && result != null) byDay.set(`${e.ticker}|${e.date}`, (byDay.get(`${e.ticker}|${e.date}`) ?? 0) + result);
  }
  const results = [...byDay.values()];
  const wins = results.filter((r) => r > 0);
  const losses = results.filter((r) => r < 0);
  const closed = {
    currency: (fx.empty ? 'ARS' : 'USD') as Currency,
    count: results.length,
    wins: wins.length,
    losses: losses.length,
    gained: wins.reduce((a, r) => a + r, 0),
    lost: losses.reduce((a, r) => a - r, 0),
    winRate: wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) : null,
  };

  // Contra el mercado: en cuántas decisiones ya evaluadas elegiste mejor que quedarte en el índice
  const compared = decisions.filter((e) => e.market);
  const beat = compared.filter((e) => e.market!.beat).length;
  const vsMarket = { compared: compared.length, beat, differsFromChance: differsFromChance(beat, compared.length) };

  const groups = {
    all: stats(decisions),
    buys: stats(decisions.filter((e) => e.type === 'COMPRA')),
    sells: stats(decisions.filter((e) => e.type === 'VENTA')),
    withNote: stats(decisions.filter((e) => e.hasNote)),
    withoutNote: stats(decisions.filter((e) => !e.hasNote)),
    // Patrones: ¿dónde acertás más?
    acciones: stats(decisions.filter((e) => e.assetType === 'ACCION')),
    cedears: stats(decisions.filter((e) => e.assetType === 'CEDEAR')),
  };

  return {
    currency,
    entries,
    vsMarket,
    sold,
    closed,
    stats: groups,
    // ¿La diferencia entre dos grupos dice algo, o puede ser casualidad?
    differences: {
      buysSells: realDifference(groups.buys, groups.sells),
      accionesCedears: realDifference(groups.acciones, groups.cedears),
      note: realDifference(groups.withNote, groups.withoutNote),
    },
  };
}

/**
 * Lo que el gráfico de un activo necesita saber de cada operación: si fue acierto o error,
 * a cuántos días se decidió, cuánto cambió el precio (en dólares) y, en una venta, la plata
 * que se dejó de ganar o se ahorró.
 */
export function decisionOf(entry: ReturnType<typeof buildJournal>['entries'][number]) {
  const main = entry.horizons.find((h) => h.days === entry.verdictDays);
  return {
    verdict: entry.verdict,
    days: entry.verdictDays,
    change: main && main.available ? main.change : null,
    sinceChange: entry.sinceChange,
    missed: entry.missed,
    soldWithin: entry.soldWithin,
    market: entry.market,
    // Ya pasó el plazo, pero no hay precios guardados de esa época para juzgarla
    noData: !entry.verdict && entry.horizons.some((h) => !h.available && 'noData' in h),
  };
}
