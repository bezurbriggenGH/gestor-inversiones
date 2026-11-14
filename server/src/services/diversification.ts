// "Para revisar": avisos de riesgo de la cartera y objetivo de reparto (rebalanceo).
//
// Las reglas son costumbres del mercado, no leyes:
// - Un solo activo no debería pasar del 20% de la cartera (los fondos de inversión tienen
//   límites parecidos por ley: la regla europea "5/10/40" pone 5–10% por empresa).
// - Un sector no debería pasar del 35%: las empresas de un mismo sector suelen caer juntas.
// - Activos que se movieron casi igual el último año cuentan, para el riesgo, casi como uno solo
//   (es la idea central de la teoría de carteras de Markowitz). Se mide con la correlación de sus
//   rendimientos semanales en dólares: en pesos, la devaluación hace que todo parezca moverse junto.
// Solo se avisa lo que salta: si todo está en orden, no se muestra nada.
import { all } from '../db.ts';
import { loadFx, type DateSeries } from './portfolio.ts';
import { UNCLASSIFIED, type ExposureGroup } from './exposure.ts';

export const ASSET_LIMIT = 0.2;
export const SECTOR_LIMIT = 0.35;
/** Correlación desde la que dos activos "se mueven casi igual" (1 = idénticos, 0 = nada que ver). */
export const MOVE_TOGETHER = 0.8;
/** Hacen falta al menos 26 semanas (medio año) en común para comparar dos activos. */
export const MIN_WEEKS = 26;
/** Desvío del objetivo que se tolera antes de avisar: 5 puntos (con 50% de objetivo, entre 45% y 55% está bien). */
export const TARGET_TOLERANCE = 0.05;

// ---------- Activos que se mueven juntos ----------

/** Lunes de la semana de una fecha "AAAA-MM-DD" (identifica la semana). */
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Rendimiento de cada semana: último cierre de la semana contra el de la semana anterior.
 * Una semana sin precios corta la cadena (no se compara contra una semana vieja).
 */
export function weeklyReturns(closes: { date: string; close: number }[]): Map<string, number> {
  const lastOfWeek = new Map<string, number>();
  for (const c of [...closes].sort((a, b) => a.date.localeCompare(b.date))) if (c.close > 0) lastOfWeek.set(weekOf(c.date), c.close);
  const weeks = [...lastOfWeek.keys()].sort();
  const out = new Map<string, number>();
  for (let i = 1; i < weeks.length; i++) {
    const prevWeek = new Date(`${weeks[i]}T00:00:00Z`);
    prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
    if (weeks[i - 1] !== prevWeek.toISOString().slice(0, 10)) continue;
    out.set(weeks[i], lastOfWeek.get(weeks[i])! / lastOfWeek.get(weeks[i - 1])! - 1);
  }
  return out;
}

/** Correlación de Pearson en las semanas que tienen los dos. null si hay pocas semanas o alguno no se movió. */
export function correlation(a: Map<string, number>, b: Map<string, number>, minWeeks = MIN_WEEKS): number | null {
  const pairs: [number, number][] = [];
  for (const [week, ra] of a) {
    const rb = b.get(week);
    if (rb !== undefined) pairs.push([ra, rb]);
  }
  if (pairs.length < minWeeks) return null;
  const n = pairs.length;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (const [x, y] of pairs) {
    cov += (x - ma) * (y - mb);
    va += (x - ma) ** 2;
    vb += (y - mb) ** 2;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

/**
 * Arma grupos de activos que se mueven casi igual: dentro de un grupo, TODOS los pares
 * tienen que superar el umbral (si A se parece a B y B a C, pero A no a C, no van juntos).
 * Se empieza por los pares más parecidos.
 */
export function groupsMovingTogether(tickers: string[], corr: (a: string, b: string) => number | null, threshold = MOVE_TOGETHER): string[][] {
  const pairs: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < tickers.length; i++)
    for (let j = i + 1; j < tickers.length; j++) {
      const r = corr(tickers[i], tickers[j]);
      if (r !== null && r >= threshold) pairs.push({ a: tickers[i], b: tickers[j], r });
    }
  const together = (x: string, y: string) => pairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));

  const groupOf = new Map<string, string[]>();
  for (const { a, b } of pairs.sort((x, y) => y.r - x.r)) {
    const ga = groupOf.get(a) ?? [a];
    const gb = groupOf.get(b) ?? [b];
    if (ga === gb) continue;
    if (!ga.every((x) => gb.every((y) => together(x, y)))) continue;
    const merged = [...ga, ...gb];
    for (const t of merged) groupOf.set(t, merged);
  }
  return [...new Set(groupOf.values())];
}

/** Rendimientos semanales en dólares del último año de cada activo, con los precios guardados. */
function weeklyReturnsInUsd(tickers: string[], fx: DateSeries, today: string): Map<string, Map<string, number>> {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const since = from.toISOString().slice(0, 10);
  const out = new Map<string, Map<string, number>>();
  for (const t of tickers) {
    const rows = all<{ date: string; close: number }>('SELECT date, close FROM prices WHERE ticker = ? AND date >= ? ORDER BY date', t, since);
    out.set(t, weeklyReturns(fx.empty ? rows : rows.map((r) => ({ date: r.date, close: r.close / fx.at(r.date) }))));
  }
  return out;
}

// ---------- Avisos ----------

export type ReviewItem =
  | { kind: 'activo'; tickers: string[]; weight: number }
  | { kind: 'sector'; name: string; tickers: string[]; weight: number }
  | { kind: 'juntos'; tickers: string[]; weight: number };

/**
 * Lo que conviene revisar, de lo más pesado a lo más liviano.
 * `together` son los grupos de activos que se mueven casi igual (ver groupsMovingTogether).
 */
export function reviewItems(
  positions: { ticker: string; weight: number }[],
  sectors: ExposureGroup[],
  together: string[][],
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const weightOf = new Map(positions.map((p) => [p.ticker, p.weight]));
  const held = positions.filter((p) => p.weight > 0);

  // Con un solo activo, todo es "concentración": el aviso no dice nada nuevo
  if (held.length > 1)
    for (const p of held) if (p.weight > ASSET_LIMIT) items.push({ kind: 'activo', tickers: [p.ticker], weight: p.weight });

  // Un fondo (ETF) ya viene repartido en muchas empresas: no es un sector concentrado
  const flagged = sectors.filter(
    (s) => s.name !== UNCLASSIFIED && s.name !== 'ETF' && s.weight > SECTOR_LIMIT && s.tickers.length > 1,
  );
  for (const s of flagged) items.push({ kind: 'sector', name: s.name, tickers: s.tickers, weight: s.weight });

  for (const g of together) {
    // Si son todos del mismo sector ya avisado, el aviso del sector ya lo dice
    if (flagged.some((s) => g.every((t) => s.tickers.includes(t)))) continue;
    const weight = g.reduce((acc, t) => acc + (weightOf.get(t) ?? 0), 0);
    if (weight > ASSET_LIMIT) items.push({ kind: 'juntos', tickers: [...g].sort((a, b) => (weightOf.get(b) ?? 0) - (weightOf.get(a) ?? 0)), weight });
  }
  return items.sort((a, b) => b.weight - a.weight);
}

// ---------- Objetivo y rebalanceo ----------

export type AssetKind = 'ACCION' | 'CEDEAR';

export interface Rebalance {
  /** Parte de la cartera que hoy está en CEDEARs (0 a 1) */
  current: number;
  /** Parte que querés en CEDEARs */
  target: number;
  onTarget: boolean;
  /** Qué tipo sobra y cuál falta (si no estás en el objetivo) */
  over?: AssetKind;
  under?: AssetKind;
  /** Sin plata nueva: cuánto vender de lo que sobra y comprar de lo que falta */
  move?: number;
  /** Con plata nueva: cuánto poner solo en lo que falta, sin vender nada (null si no se puede: objetivo 0% o 100%) */
  newMoney?: number | null;
}

/**
 * Cuánto mover para volver al objetivo. Ejemplo: $400.000 en acciones, $600.000 en CEDEARs y
 * objetivo 50% CEDEARs → sobran $100.000 de CEDEARs (vender 100.000 y comprar acciones), o
 * poner $200.000 nuevos en acciones: 600.000 / 1.200.000 = 50%.
 */
export function rebalance(acciones: number, cedears: number, target: number): Rebalance | null {
  const total = acciones + cedears;
  if (total <= 0) return null;
  const current = cedears / total;
  const deviation = current - target;
  if (Math.abs(deviation) <= TARGET_TOLERANCE + 1e-9) return { current, target, onTarget: true };
  const over: AssetKind = deviation > 0 ? 'CEDEAR' : 'ACCION';
  const overValue = over === 'CEDEAR' ? cedears : acciones;
  const overTarget = over === 'CEDEAR' ? target : 1 - target;
  return {
    current,
    target,
    onTarget: false,
    over,
    under: over === 'CEDEAR' ? 'ACCION' : 'CEDEAR',
    move: Math.abs(cedears - target * total),
    // lo que sobra / (total + x) = su objetivo  →  x = lo que sobra / su objetivo − total
    newMoney: overTarget > 0 ? overValue / overTarget - total : null,
  };
}

/** Todo lo de "Para revisar" para la pantalla Composición. */
export function buildReview(
  positions: { ticker: string; type: AssetKind; marketValue: number; weight: number }[],
  sectors: ExposureGroup[],
  targetCedear: number | null,
  today: string,
) {
  const held = positions.filter((p) => p.marketValue > 0);
  const returns = weeklyReturnsInUsd(
    held.map((p) => p.ticker),
    loadFx('bolsa'),
    today,
  );
  const together = groupsMovingTogether(
    held.map((p) => p.ticker),
    (a, b) => correlation(returns.get(a)!, returns.get(b)!),
  );
  const sum = (type: AssetKind) => held.filter((p) => p.type === type).reduce((acc, p) => acc + p.marketValue, 0);
  return {
    items: reviewItems(held, sectors, together),
    limits: { asset: ASSET_LIMIT, sector: SECTOR_LIMIT },
    target: targetCedear === null ? null : rebalance(sum('ACCION'), sum('CEDEAR'), targetCedear),
  };
}
