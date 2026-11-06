// Evolución de la cartera y comparación contra alternativas ("benchmarks").
//
// Para comparar de forma justa se simula que la MISMA plata, en las MISMAS fechas,
// fue a cada alternativa: cada compra "compra" unidades del benchmark y cada venta o
// dividendo cobrado "vende" unidades. Así se compara lo que tenés hoy contra lo que
// tendrías si hubieras hecho otra cosa con esa plata.
//
// También se calcula la TIR (tasa interna de retorno anual), que considera cuándo
// entró y salió cada peso. Es el rendimiento anual "real" de tu dinero.
import { all } from '../db.ts';
import type { FxKind } from '../providers/dolar.ts';
import { arDate } from '../util.ts';
import {
  DateSeries,
  getOperations,
  loadFx,
  opTotal,
  sortOps,
  userAssets,
  type Currency,
  type OperationRow,
} from './portfolio.ts';

export const BENCHMARKS = {
  inflacion: { label: 'Inflación', description: 'Mantener el poder de compra (índice UVA)' },
  dolar: { label: 'Dólar MEP', description: 'Haber comprado dólares MEP' },
  plazofijo: { label: 'Plazo fijo', description: 'Plazo fijo a 30 días renovado' },
  merval: { label: 'Merval', description: 'Índice de las principales acciones argentinas' },
  spy: { label: 'S&P 500', description: 'Las 500 mayores empresas de EE.UU. (CEDEAR SPY)' },
} as const;
export type BenchmarkKey = keyof typeof BENCHMARKS;

interface Flow {
  date: string;
  amount: number; // pesos que ENTRAN a la inversión (+ compra, − venta o dividendo)
}

function loadIndex(series: string): DateSeries {
  return new DateSeries(all('SELECT date, value FROM index_values WHERE series = ? ORDER BY date', series));
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Índice acumulado de un plazo fijo a 30 días renovado, a partir de la TNA diaria. */
function plazoFijoIndex(start: string, end: string): DateSeries {
  const tna = loadIndex('plazofijo');
  if (tna.empty) return tna;
  const rows: { date: string; value: number }[] = [];
  let value = 1;
  for (let d = start; d <= end; d = addDaysIso(d, 1)) {
    rows.push({ date: d, value });
    // Tasa efectiva diaria equivalente a renovar cada 30 días
    value *= Math.pow(1 + tna.at(d) * (30 / 365), 1 / 30);
  }
  return new DateSeries(rows);
}

/** TIR anual por bisección. flows: negativos = plata que pusiste, positivos = la que recibís. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  const t0 = Date.parse(flows[0].date);
  const years = flows.map((f) => (Date.parse(f.date) - t0) / (365 * 86_400_000));
  if (years[years.length - 1] < 30 / 365) return null; // menos de un mes: no es representativo
  const npv = (r: number) => flows.reduce((acc, f, i) => acc + f.amount / Math.pow(1 + r, years[i]), 0);
  let lo = -0.9999;
  let hi = 100;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export function buildHistory(userId: number, currency: Currency, kind: FxKind) {
  const ops = sortOps(getOperations(userId));
  const fx = loadFx(kind);
  const empty = { currency, points: [], benchmarks: [], portfolio: null, realReturn: null };
  if (ops.length === 0) return empty;

  const start = ops[0].date;
  const today = arDate();
  const tickers = userAssets(userId).map((a) => a.ticker);

  // Precios de cada activo del usuario desde la primera operación
  const prices = new Map<string, DateSeries>();
  const dateSet = new Set<string>();
  for (const t of tickers) {
    const rows = all<{ date: string; value: number }>(
      'SELECT date, close AS value FROM prices WHERE ticker = ? AND date >= ? ORDER BY date',
      t,
      // un día antes, para tener precio el primer día
      addDaysIso(start, -10),
    );
    prices.set(t, new DateSeries(rows));
    for (const r of rows) if (r.date >= start) dateSet.add(r.date);
  }
  for (const op of ops) dateSet.add(op.date);
  const dates = [...dateSet].filter((d) => d <= today).sort();

  // Flujos de dinero (siempre en pesos, en su fecha)
  const flows: Flow[] = ops.map((op) => ({
    date: op.date,
    amount: op.type === 'COMPRA' ? opTotal(op) : -opTotal(op),
  }));

  const toCur = (ars: number, date: string) => (currency === 'ARS' ? ars : ars / fx.at(date));

  // Índices de cada benchmark (valor en pesos de 1 unidad)
  const indices: Record<BenchmarkKey, DateSeries> = {
    inflacion: loadIndex('uva'),
    dolar: fx,
    plazofijo: plazoFijoIndex(addDaysIso(start, -1), today),
    merval: loadIndex('merval'),
    spy: loadIndex('spy'),
  };

  // Recorrido día a día
  const holdings = new Map<string, number>();
  const units: Record<string, number> = {};
  for (const k of Object.keys(indices)) units[k] = 0;
  let opIdx = 0;
  let netInvested = 0; // en la moneda elegida, cada flujo convertido en su fecha

  const points: { date: string; value: number; netInvested: number; benchmarks: Record<string, number | null> }[] = [];

  for (const date of dates) {
    while (opIdx < ops.length && ops[opIdx].date <= date) {
      const op: OperationRow = ops[opIdx];
      const flow = flows[opIdx];
      if (op.type === 'COMPRA') holdings.set(op.ticker, (holdings.get(op.ticker) ?? 0) + op.quantity);
      if (op.type === 'VENTA') holdings.set(op.ticker, (holdings.get(op.ticker) ?? 0) - op.quantity);
      netInvested += toCur(flow.amount, flow.date);
      for (const [k, idx] of Object.entries(indices)) {
        if (!idx.empty) units[k] += flow.amount / idx.at(flow.date);
      }
      opIdx++;
    }

    let valueArs = 0;
    for (const [t, qty] of holdings) {
      const s = prices.get(t);
      if (qty > 1e-9 && s && !s.empty) valueArs += qty * s.at(date);
    }

    const bench: Record<string, number | null> = {};
    for (const [k, idx] of Object.entries(indices)) {
      bench[k] = idx.empty ? null : toCur(units[k] * idx.at(date), date);
    }
    points.push({ date, value: toCur(valueArs, date), netInvested, benchmarks: bench });
  }

  const last = points[points.length - 1];

  // TIR de la cartera y de cada alternativa (flujos en la moneda elegida)
  const curFlows = flows.map((f) => ({ date: f.date, amount: -toCur(f.amount, f.date) }));
  const irrWithFinal = (finalValue: number) => xirr([...curFlows, { date: last.date, amount: finalValue }]);

  const lastDataDate = (k: BenchmarkKey) => (indices[k].empty ? null : indices[k].dates[indices[k].dates.length - 1]);

  const benchmarks = (Object.keys(BENCHMARKS) as BenchmarkKey[]).map((k) => {
    const value = last.benchmarks[k];
    return {
      key: k,
      ...BENCHMARKS[k],
      available: value != null,
      value,
      diff: value != null ? last.value - value : null,
      diffPct: value != null && value > 0 ? last.value / value - 1 : null,
      irr: value != null ? irrWithFinal(value) : null,
      lastDataDate: lastDataDate(k),
    };
  });

  // Ganancia real: contra inflación, siempre en pesos de hoy
  const inflIdx = indices.inflacion;
  let realReturn: { gain: number; pct: number } | null = null;
  if (!inflIdx.empty) {
    let inflUnits = 0;
    for (const f of flows) inflUnits += f.amount / inflIdx.at(f.date);
    const inflValueArs = inflUnits * inflIdx.at(last.date);
    let valueArs = 0;
    for (const [t, qty] of holdings) {
      const s = prices.get(t);
      if (qty > 1e-9 && s && !s.empty) valueArs += qty * s.at(last.date);
    }
    realReturn = { gain: valueArs - inflValueArs, pct: inflValueArs > 0 ? valueArs / inflValueArs - 1 : 0 };
  }

  return {
    currency,
    points,
    benchmarks,
    portfolio: { value: last.value, netInvested: last.netInvested, gain: last.value - last.netInvested, irr: irrWithFinal(last.value) },
    realReturn,
  };
}
