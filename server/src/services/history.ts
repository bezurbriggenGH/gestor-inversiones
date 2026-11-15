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
  inflacion: {
    label: 'Inflación',
    description: 'Mantener el poder de compra (IPC del INDEC; el mes que todavía no se publicó se estima con el último dato)',
  },
  dolar: { label: 'Dólar MEP', description: 'Haber comprado dólares MEP' },
  plazofijo: { label: 'Plazo fijo', description: 'Plazo fijo a 30 días renovado' },
  merval: { label: 'Merval', description: 'Índice de las principales acciones argentinas (solo precio, sin dividendos)' },
  spy: { label: 'S&P 500', description: 'Las 500 mayores empresas de EE.UU. (CEDEAR SPY, solo precio, sin dividendos)' },
} as const;
export type BenchmarkKey = keyof typeof BENCHMARKS;

/** Índices que cotizan todos los días hábiles: si no tienen datos hace más de STALE_DAYS, quedaron congelados. */
const DAILY_INDICES: BenchmarkKey[] = ['merval', 'spy'];
const STALE_DAYS = 7;

interface Flow {
  date: string;
  amount: number; // pesos que ENTRAN a la inversión (+ compra, − venta o dividendo)
}

export function loadIndex(series: string): DateSeries {
  return new DateSeries(all('SELECT date, value FROM index_values WHERE series = ? ORDER BY date', series));
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/**
 * Índice diario de inflación, armado con el IPC mensual del INDEC (el mismo de Sueldo y gastos).
 * La inflación de cada mes se reparte pareja entre sus días: con 10% en un mes de 31 días, cada día
 * suma 1,1^(1/31) − 1 ≈ 0,31%. El valor de un día incluye la inflación de ese día.
 *
 * Antes se usaba el índice UVA, que sigue al IPC con unos dos meses de atraso: a quien empezó a invertir
 * en febrero de 2024 le "cobraba" la inflación de diciembre de 2023 y enero de 2024 (25,5% y 20,6%),
 * cuando esa plata todavía no estaba invertida. De febrero a diciembre de 2024 el UVA subió 134% y el
 * IPC, 80,5%: con el UVA, una cartera que le ganó a la inflación parecía perder contra ella.
 *
 * El IPC de un mes se publica a mediados del siguiente: los días todavía sin publicar se estiman con
 * la inflación del último mes publicado.
 */
export function inflationSeries(today: string = arDate()): DateSeries {
  const months = all<{ date: string; value: number }>(
    "SELECT date, value FROM index_values WHERE series = 'ipc' AND date >= '2010-01-01' ORDER BY date",
  );
  if (months.length === 0) return new DateSeries([]);
  const rate = new Map(months.map((m) => [m.date.slice(0, 7), m.value / 100]));
  const lastMonth = months[months.length - 1].date.slice(0, 7);
  const rows: { date: string; value: number }[] = [];
  let value = 1;
  for (let d = `${months[0].date.slice(0, 7)}-01`; d <= today; d = addDaysIso(d, 1)) {
    const month = d.slice(0, 7);
    const r = rate.get(month) ?? (month > lastMonth ? rate.get(lastMonth)! : 0);
    value *= Math.pow(1 + r, 1 / daysInMonth(month));
    rows.push({ date: d, value });
  }
  return new DateSeries(rows);
}

/** Índice acumulado de un plazo fijo a 30 días renovado, a partir de la TNA diaria. */
export function plazoFijoIndex(start: string, end: string): DateSeries {
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

/**
 * Lo mínimo que tiene que durar la inversión para expresar su rendimiento por año.
 * Anualizar un período corto da números sin sentido: ganar 20% en dos meses se leería como
 * casi +200% por año (1,2 elevado a 6). Las normas internacionales de rendimiento (GIPS)
 * piden no anualizar períodos de menos de un año.
 */
export const MIN_IRR_YEARS = 1;

/** TIR anual por bisección. flows: negativos = plata que pusiste, positivos = la que recibís. */
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  const t0 = Date.parse(flows[0].date);
  const years = flows.map((f) => (Date.parse(f.date) - t0) / (365 * 86_400_000));
  if (years[years.length - 1] < MIN_IRR_YEARS) return null;
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
  const empty = { currency, points: [], benchmarks: [], portfolio: null, realReturn: null, monthly: [], unpriced: [] };
  if (ops.length === 0) return empty;

  const start = ops[0].date;
  const today = arDate();
  const tickers = userAssets(userId).map((a) => a.ticker);

  // Precios de cada activo del usuario desde la primera operación
  const prices = new Map<string, DateSeries>();
  const dateSet = new Set<string>();
  for (const t of tickers) {
    const rows = all<{ date: string; value: number }>(
      // Desde el último precio anterior a la primera operación, para tener precio el primer día
      `SELECT date, close AS value FROM prices WHERE ticker = ?1
         AND date >= COALESCE((SELECT MAX(date) FROM prices WHERE ticker = ?1 AND date <= ?2), ?2) ORDER BY date`,
      t,
      start,
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
    inflacion: inflationSeries(today),
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
  // Precio de la última compra o venta de cada activo. Se usa para valuarlo los días en que todavía
  // no hay precios guardados (Yahoo no tiene historial de algunos CEDEARs). Usar el primer precio que
  // exista, que es posterior, inventa ganancias: 135 a $2.910 valuados ese mismo día a $5.850.
  const lastTradePrice = new Map<string, number>();
  // Qué activos se valuaron así y entre qué fechas. La pantalla lo avisa: cuando aparece el primer precio
  // real, toda la suba o baja de esos días cae de golpe en ese único día (y en ese mes del calendario).
  const unpriced = new Map<string, { ticker: string; from: string; until: string | null }>();
  const valueOn = (date: string) => {
    let value = 0;
    for (const [t, qty] of holdings) {
      if (qty <= 1e-9) continue;
      const s = prices.get(t);
      const covered = s?.covers(date) ?? false;
      const price = covered ? s!.at(date) : lastTradePrice.get(t);
      if (!covered && price != null && !unpriced.has(t)) unpriced.set(t, { ticker: t, from: date, until: s && !s.empty ? s.dates[0] : null });
      if (price != null) value += qty * price;
    }
    return value;
  };
  let lastValueArs = 0;

  const points: { date: string; value: number; netInvested: number; benchmarks: Record<string, number | null> }[] = [];

  for (const date of dates) {
    while (opIdx < ops.length && ops[opIdx].date <= date) {
      const op: OperationRow = ops[opIdx];
      const flow = flows[opIdx];
      if (op.type === 'COMPRA') holdings.set(op.ticker, (holdings.get(op.ticker) ?? 0) + op.quantity);
      if (op.type === 'VENTA') holdings.set(op.ticker, (holdings.get(op.ticker) ?? 0) - op.quantity);
      if (op.type !== 'DIVIDENDO') lastTradePrice.set(op.ticker, op.price);
      netInvested += toCur(flow.amount, flow.date);
      for (const [k, idx] of Object.entries(indices)) {
        if (!idx.empty) units[k] += flow.amount / idx.at(flow.date);
      }
      opIdx++;
    }

    const valueArs = valueOn(date);
    lastValueArs = valueArs;

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
    // Un índice que cotiza todos los días y no tiene datos hace más de una semana quedó congelado
    // (Yahoo dejó de publicar el Merval el 16/10/2026). Compararlo contra tu cartera de hoy daría
    // una diferencia falsa: no se muestra hasta que vuelva a haber datos, y vuelve solo.
    const lastData = lastDataDate(k);
    const frozen = DAILY_INDICES.includes(k) && lastData != null && addDaysIso(lastData, STALE_DAYS) < last.date;
    const value = frozen ? null : last.benchmarks[k];
    // La alternativa "dólar" usa el mismo dólar que elegiste para ver la cartera (MEP o CCL)
    const info =
      k === 'dolar' && kind === 'contadoconliqui'
        ? { label: 'Dólar CCL', description: 'Haber comprado dólares contado con liquidación' }
        : BENCHMARKS[k];
    return {
      key: k,
      ...info,
      available: value != null,
      value,
      diff: value != null ? last.value - value : null,
      diffPct: value != null && value > 0 ? last.value / value - 1 : null,
      irr: value != null ? irrWithFinal(value) : null,
      lastDataDate: lastData,
      frozen,
    };
  });

  // Ganancia real: contra inflación, siempre en pesos de hoy
  const inflIdx = indices.inflacion;
  let realReturn: { gain: number; pct: number | null; irr: number | null } | null = null;
  if (!inflIdx.empty) {
    let inflUnits = 0;
    for (const f of flows) inflUnits += f.amount / inflIdx.at(f.date);
    const inflValueArs = inflUnits * inflIdx.at(last.date);
    const valueArs = lastValueArs;
    // Rendimiento real POR AÑO: la TIR con cada peso llevado a pesos de hoy. Así se puede poner al
    // lado de la TIR nominal. Ejemplo: ganar 39% en un año con 35% de inflación es 1,39 / 1,35 − 1 ≈ 3% real.
    const realFlows = flows.map((f) => ({ date: f.date, amount: -f.amount / inflIdx.at(f.date) }));
    const irr = xirr([...realFlows, { date: last.date, amount: valueArs / inflIdx.at(last.date) }]);
    // Si sacaste más de lo que esa plata habría valido con inflación (vendiste muy por encima de lo que
    // pusiste), lo que "tendrías" es negativo y no hay porcentaje posible: la diferencia se informa
    // solo en plata. Antes daba 0%, como si hubieras empatado con la inflación.
    realReturn = { gain: valueArs - inflValueArs, pct: inflValueArs > 0 ? valueArs / inflValueArs - 1 : null, irr };
  }

  return {
    currency,
    points,
    benchmarks,
    portfolio: { value: last.value, netInvested: last.netInvested, gain: last.value - last.netInvested, irr: irrWithFinal(last.value) },
    realReturn,
    // En pesos, cada mes también descontada la inflación de ese mes (en dólares no hace falta)
    monthly: monthlyReturns(points, currency === 'ARS' && !inflIdx.empty ? inflIdx : undefined),
    // Activos que hubo que valuar a su último precio de compra o venta porque no había precios guardados
    unpriced: [...unpriced.values()],
  };
}

/**
 * Rendimiento de cada mes, sin que las compras y ventas lo distorsionen
 * (rendimiento ponderado por tiempo): se encadena el rendimiento de cada día,
 * descontando la plata que entró o salió ese día.
 */
export function monthlyReturns(points: { date: string; value: number; netInvested: number }[], inflation?: DateSeries) {
  const months: { month: string; return: number; gain: number; inflation: number | null; real: number | null }[] = [];
  let factor = 1;
  let gain = 0;
  let current = '';
  let from = ''; // desde cuándo se mide el mes: el último día del mes anterior con dato
  // Con la inflación de los mismos días: real = (1 + rendimiento) ÷ (1 + inflación) − 1.
  // Ejemplo: +6% en pesos en un mes con 4% de inflación → 1,06 ÷ 1,04 − 1 = +1,9% real.
  const close = (to: string) => {
    const infl = inflation ? inflation.at(to) / inflation.at(from) - 1 : null;
    months.push({ month: current, return: factor - 1, gain, inflation: infl, real: infl == null ? null : factor / (1 + infl) - 1 });
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const month = p.date.slice(0, 7);
    if (month !== current) {
      if (current) close(prev.date);
      current = month;
      factor = 1;
      gain = 0;
      from = prev?.date ?? p.date;
    }
    const prevValue = prev?.value ?? 0;
    const flow = p.netInvested - (prev?.netInvested ?? 0);
    // Las compras se hacen durante el día y ya trabajan hasta el cierre: la plata que
    // entró suma a la base. Las ventas y dividendos se cuentan al final del día.
    // (Si solo se dividiera por el valor de ayer, una compra grande sobre una cartera
    // chica haría que una baja menor pareciera una caída enorme.)
    const base = prevValue + Math.max(flow, 0);
    let r = 0;
    if (base > 1e-6) r = (p.value - Math.min(flow, 0)) / base - 1;
    factor *= 1 + r;
    gain += p.value - prevValue - flow;
  }
  if (current) close(points[points.length - 1].date);
  return months;
}
