// Cálculos de la cartera.
//
// Criterios contables:
// - Costo por Precio Promedio Ponderado (PPP): cada compra suma al costo total
//   (precio × cantidad + comisiones). Al vender, sale costo a precio promedio.
// - Resultado realizado: lo que ganaste/perdiste en ventas ya hechas
//   (lo cobrado neto de comisiones − costo promedio de lo vendido).
// - Dividendos: ingreso aparte, neto de retenciones. No cambian el costo.
// - Resultado no realizado: valor de mercado de lo que tenés − su costo.
// - En dólares, cada monto se convierte con el dólar DEL DÍA en que ocurrió.
import { all, get } from '../db.ts';
import type { FxKind } from '../providers/dolar.ts';
import { FX_KINDS } from '../providers/dolar.ts';
import { HttpError, addDays } from '../util.ts';
import { buildCedearInfo, cedearGap } from './cedear.ts';
import { CEDEAR_RATIOS, usSymbolOf } from '../cedears.ts';
import { classifyAsset, groupBy } from './exposure.ts';
import { assetQuality, reliableFrom } from './quality.ts';

export type Currency = 'ARS' | 'USD';
export type OpType = 'COMPRA' | 'VENTA' | 'DIVIDENDO';

export interface AssetRow {
  ticker: string;
  symbol: string;
  name: string;
  type: 'ACCION' | 'CEDEAR';
  last_sync: number | null;
  /** Solo para activos que no están en el catálogo: el sector que informó Yahoo. */
  sector: string | null;
}

export interface OperationRow {
  id: number;
  user_id: number;
  ticker: string;
  type: OpType;
  date: string;
  quantity: number;
  price: number;
  fees: number;
  note_title: string | null;
  note_body: string | null;
  note_link: string | null;
  created_at: string;
  /** Si hubo un split después de la operación: por cuánto se multiplicó la cantidad (1 = sin cambios). */
  splitFactor?: number;
  /** Operación que no cargó el usuario: la fracción de acción que deja un split, cobrada en efectivo. */
  auto?: 'fraccion';
}

interface PriceRow {
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number;
  volume: number | null;
}

export function parseCurrency(v: unknown): Currency {
  return v === 'USD' ? 'USD' : 'ARS';
}

export function parseFxKind(v: unknown): FxKind {
  return FX_KINDS.includes(v as FxKind) ? (v as FxKind) : 'bolsa';
}

/** Serie de valores por fecha. Para días sin dato (feriados) usa el último anterior. */
export class DateSeries {
  readonly dates: string[];
  readonly values: number[];

  constructor(rows: { date: string; value: number }[]) {
    this.dates = rows.map((r) => r.date);
    this.values = rows.map((r) => r.value);
  }

  get empty(): boolean {
    return this.dates.length === 0;
  }

  /** ¿Hay un dato real para esa fecha (de ese día o anterior)? Antes del primer dato, `at` devuelve uno posterior. */
  covers(date: string): boolean {
    return !this.empty && date >= this.dates[0];
  }

  at(date: string): number {
    if (this.empty) throw new HttpError(503, 'Todavía no hay datos guardados para convertir');
    if (date < this.dates[0]) return this.values[0];
    let lo = 0;
    let hi = this.dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.dates[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    return this.values[lo];
  }

  latest(): { date: string; rate: number } | null {
    if (this.empty) return null;
    const i = this.dates.length - 1;
    return { date: this.dates[i], rate: this.values[i] };
  }
}

export function loadFx(kind: FxKind): DateSeries {
  return new DateSeries(all('SELECT date, sell AS value FROM fx_rates WHERE kind = ? ORDER BY date', kind));
}

export type Converter = (ars: number, date: string) => number;

export function makeConverter(currency: Currency, fx: DateSeries): Converter {
  return currency === 'ARS' ? (ars) => ars : (ars, date) => ars / fx.at(date);
}

const TYPE_ORDER: Record<OpType, number> = { COMPRA: 0, DIVIDENDO: 1, VENTA: 2 };

export function sortOps(ops: OperationRow[]): OperationRow[] {
  // Mismo día: compras, después dividendos, después ventas; y por orden de carga
  return [...ops].sort((a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.id - b.id);
}

/** Verifica que nunca se venda más de lo que se tenía en ese momento. */
export function assertNoShortSelling(ops: OperationRow[], ticker = ''): void {
  let qty = 0;
  for (const op of sortOps(ops)) {
    if (op.type === 'COMPRA') qty += op.quantity;
    else if (op.type === 'VENTA') {
      if (op.quantity > qty + 1e-9) {
        if (qty < 1e-9) {
          throw new HttpError(
            409,
            `${ticker ? ticker + ': h' : 'H'}ay una venta el ${op.date.split('-').reverse().join('/')} pero no hay compras anteriores cargadas. Cargá primero la compra.`,
          );
        }
        throw new HttpError(
          409,
          `${ticker ? ticker + ': e' : 'E'}l ${op.date.split('-').reverse().join('/')} se venderían ${op.quantity} unidades, pero en ese momento había ${qty}.`,
        );
      }
      qty -= op.quantity;
    }
  }
}

/** Cantidad que se tenía al cierre del día anterior a `date` (para dividendos). */
export function holdingBefore(ops: OperationRow[], date: string): number {
  let qty = 0;
  for (const op of sortOps(ops)) {
    if (op.date >= date) break;
    if (op.type === 'COMPRA') qty += op.quantity;
    else if (op.type === 'VENTA') qty -= op.quantity;
  }
  return Math.max(0, qty);
}

/** Lo máximo que se tuvo entre dos fechas (incluidas). Para controlar que un dividendo sea posible. */
export function maxHoldingBetween(ops: OperationRow[], from: string, to: string): number {
  let qty = holdingBefore(ops, from);
  let max = qty;
  for (const op of sortOps(ops)) {
    if (op.date < from) continue;
    if (op.date > to) break;
    if (op.type === 'COMPRA') qty += op.quantity;
    else if (op.type === 'VENTA') qty -= op.quantity;
    max = Math.max(max, qty);
  }
  return max;
}

export function opTotal(op: Pick<OperationRow, 'type' | 'quantity' | 'price' | 'fees'>): number {
  const gross = op.quantity * op.price;
  return op.type === 'COMPRA' ? gross + op.fees : gross - op.fees;
}

/**
 * Lo máximo que llegaste a tener puesto de tu bolsillo: compras menos lo que ya
 * recuperaste con ventas y dividendos, en su punto más alto.
 * Es la base del % de ganancia total. Sumar todas las compras históricas no sirve:
 * si comprás y vendés varias veces, la misma plata se contaría muchas veces.
 * Se mira al cierre de cada día: si un día vendés por $2 M y con esa plata comprás otra cosa, no pusiste
 * $2 M más de tu bolsillo. Antes se sumaban las compras del día antes de restar las ventas, y eso armaba
 * un pico que nunca existió (el 16/10/2026: $4,82 M + $2,08 M = $6,90 M, en vez de $4,85 M).
 */
export function peakCapital(ops: OperationRow[], conv: Converter): number {
  let net = 0;
  let peak = 0;
  const sorted = sortOps(ops);
  sorted.forEach((op, i) => {
    const total = conv(opTotal(op), op.date);
    net += op.type === 'COMPRA' ? total : -total;
    // Último movimiento del día: recién ahí se sabe cuánto quedó puesto
    if (sorted[i + 1]?.date !== op.date) peak = Math.max(peak, net);
  });
  return peak;
}

export interface Position {
  quantity: number;
  avgCost: number; // PPP por unidad
  costBasis: number; // costo de lo que todavía tenés
  invested: number; // total puesto en compras (histórico)
  peakCapital: number; // lo máximo que llegaste a tener puesto (base del % total)
  price: number;
  priceDate: string | null;
  marketValue: number;
  unrealized: number;
  unrealizedPct: number;
  realized: number;
  dividends: number;
  totalGain: number;
  totalGainPct: number;
  dayChange: number;
  dayChangePct: number; // variación del precio del activo en el día
  // ¿Se sabe cuánto varió en el día? No, si falta el precio anterior o el de la última rueda: ahí
  // dayChange y dayChangePct valen 0 para no sumar nada al total, pero la pantalla muestra "sin dato"
  dayKnown: boolean;
  prevMarketValue: number; // lo que valía ayer lo que ya tenías ayer
}

// Sin saber qué días operó BYMA, se supone que entre una rueda y la siguiente pasan como mucho 5 días
// corridos. Es solo el plan B: con la base completa se usa `previousSession`, que conoce los feriados.
const MAX_DAYS_BETWEEN_SESSIONS = 5;

/**
 * La rueda de BYMA anterior a una fecha: el último día anterior con precio de algún activo.
 * Así se saben los feriados sin una lista: en Semana Santa de 2024, la rueda anterior al 03/04 fue el
 * 27/03 (7 días antes), y un activo con precio de ese día sí tiene variación del día. En cambio, si
 * otros activos tienen precio del 12/11 y este recién del 06/11, no operó el día anterior.
 */
export function previousSession(date: string): string | null {
  return get<{ d: string | null }>('SELECT MAX(date) AS d FROM prices WHERE date < ?', date)?.d ?? null;
}

/**
 * `prevSession`: la rueda anterior a la del último precio (ver previousSession). Si no se pasa, se usa
 * el plan B de los 5 días corridos.
 */
export function computePosition(
  ops: OperationRow[],
  last: PriceRow | undefined,
  prev: PriceRow | undefined,
  conv: Converter,
  prevSession?: string | null,
) {
  // Sin el precio de la rueda anterior no se puede saber cuánto varió en el día: no se suma nada (0)
  // y se marca dayKnown = false, en vez de dar la variación de toda una semana como si fuera la de hoy
  if (last && prev) {
    const missing =
      prevSession !== undefined
        ? prevSession != null && prev.date < prevSession
        : Date.parse(last.date) - Date.parse(prev.date) > MAX_DAYS_BETWEEN_SESSIONS * 86_400_000;
    if (missing) prev = undefined;
  }
  let quantity = 0;
  let costBasis = 0;
  let invested = 0;
  let realized = 0;
  let dividends = 0;
  const realizedByOp = new Map<number, number>();

  for (const op of sortOps(ops)) {
    const px = conv(op.price, op.date);
    const fees = conv(op.fees, op.date);
    if (op.type === 'COMPRA') {
      quantity += op.quantity;
      costBasis += op.quantity * px + fees;
      invested += op.quantity * px + fees;
    } else if (op.type === 'VENTA') {
      const avg = quantity > 0 ? costBasis / quantity : 0;
      const result = op.quantity * px - fees - op.quantity * avg;
      realized += result;
      realizedByOp.set(op.id, result);
      costBasis -= op.quantity * avg;
      quantity -= op.quantity;
      if (quantity < 1e-9) {
        quantity = 0;
        costBasis = 0;
      }
    } else {
      const net = op.quantity * px - fees;
      dividends += net;
      realizedByOp.set(op.id, net);
    }
  }

  const price = last ? conv(last.close, last.date) : 0;
  const prevPrice = prev ? conv(prev.close, prev.date) : price;
  const marketValue = quantity * price;
  const unrealized = quantity > 0 ? marketValue - costBasis : 0;
  const totalGain = realized + unrealized + dividends;
  const peak = peakCapital(ops, conv);

  // Variación del día: valor de hoy − valor de ayer − plata que pusiste hoy.
  // Lo comprado hoy se mide contra lo que pagaste, no contra el cierre de ayer:
  // tenías 10 a $100, hoy vale $110 y compraste 5 a $105 → 10 × $10 + 5 × $5 = $125 (no 15 × $10).
  let heldYesterday = quantity;
  let cashToday = 0;
  if (last && prev) {
    for (const op of ops) {
      if (op.date <= prev.date || op.date > last.date) continue;
      const total = conv(opTotal(op), op.date);
      if (op.type === 'COMPRA') {
        heldYesterday -= op.quantity;
        cashToday += total;
      } else if (op.type === 'VENTA') {
        heldYesterday += op.quantity;
        cashToday -= total;
      }
    }
  }
  const prevMarketValue = Math.max(0, heldYesterday) * prevPrice;
  const dayChange = marketValue - prevMarketValue - cashToday;

  const position: Position = {
    quantity,
    avgCost: quantity > 0 ? costBasis / quantity : 0,
    costBasis,
    invested,
    peakCapital: peak,
    price,
    priceDate: last?.date ?? null,
    marketValue,
    unrealized,
    unrealizedPct: costBasis > 0 ? unrealized / costBasis : 0,
    realized,
    dividends,
    totalGain,
    totalGainPct: peak > 0 ? totalGain / peak : 0,
    dayChange,
    dayChangePct: prevPrice > 0 ? price / prevPrice - 1 : 0,
    dayKnown: Boolean(last && prev),
    prevMarketValue,
  };
  return { position, realizedByOp };
}

/** Todo lo que el usuario agregó, se pueda seguir o no. */
function allUserAssets(userId: number): AssetRow[] {
  return all<AssetRow>(
    `SELECT a.ticker, a.symbol, a.name, a.type, a.last_sync, a.sector FROM user_assets ua
     JOIN assets a ON a.ticker = ua.ticker WHERE ua.user_id = ? ORDER BY ua.added_at, a.ticker`,
    userId,
  );
}

/**
 * Por qué la app no puede seguir un activo de este usuario, o null si lo sigue.
 * Los datos tienen que pasar el control de calidad (quality.ts) y cubrir todas sus operaciones: con una
 * compra anterior a los precios que sirven no se sabe cuánto valía la tenencia en el medio.
 */
export function exclusionReason(userId: number, ticker: string): string | null {
  const quality = assetQuality(ticker);
  if (!quality.ok) return quality.reason;
  const first = reliableFrom(ticker);
  const firstOp = get<{ d: string | null }>('SELECT MIN(date) AS d FROM operations WHERE user_id = ? AND ticker = ?', userId, ticker)?.d;
  if (first && firstOp && firstOp < first) {
    const dmy = (iso: string) => iso.split('-').reverse().join('/');
    return `tiene operaciones desde el ${dmy(firstOp)} y la fuente tiene precios confiables recién desde el ${dmy(first)}`;
  }
  return null;
}

/** Los activos del usuario que la app sigue: solo esos entran en la cartera y en todos los cálculos. */
export function userAssets(userId: number): AssetRow[] {
  return allUserAssets(userId).filter((a) => exclusionReason(userId, a.ticker) === null);
}

/** Los que quedaron afuera, con el motivo. Sus operaciones siguen guardadas. */
export function excludedAssets(userId: number) {
  return allUserAssets(userId).flatMap((a) => {
    const reason = exclusionReason(userId, a.ticker);
    if (reason === null) return [];
    const operations = get<{ n: number }>('SELECT COUNT(*) AS n FROM operations WHERE user_id = ? AND ticker = ?', userId, a.ticker)!.n;
    return [{ ticker: a.ticker, name: a.name, type: a.type, reason, operations }];
  });
}

export function requireUserAsset(userId: number, ticker: string): AssetRow {
  const asset = get<AssetRow>(
    `SELECT a.ticker, a.symbol, a.name, a.type, a.last_sync, a.sector FROM user_assets ua
     JOIN assets a ON a.ticker = ua.ticker WHERE ua.user_id = ? AND ua.ticker = ?`,
    userId,
    ticker,
  );
  if (!asset) throw new HttpError(404, `${ticker} no está en tu cartera`);
  return asset;
}

/** Operaciones tal como se cargaron (sin ajustar por splits). */
export function getRawOperations(userId: number, ticker?: string): OperationRow[] {
  return ticker
    ? all<OperationRow>('SELECT * FROM operations WHERE user_id = ? AND ticker = ?', userId, ticker)
    : all<OperationRow>('SELECT * FROM operations WHERE user_id = ?', userId);
}

/**
 * Ajusta operaciones anteriores a un split o cambio de ratio.
 * Los precios históricos de Yahoo vienen ajustados, así que las operaciones también:
 * si SPY pasó de ratio 20 a 60 (3:1), 10 CEDEARs a $47.010 pasan a ser 30 a $15.670.
 * El monto total no cambia, y el resultado tampoco.
 */
/**
 * Cuánto se multiplicó la cantidad por los splits posteriores a una fecha (1 si no hubo).
 * Los precios guardados ya están en la escala de hoy: para volver a la escala de esa fecha, el precio
 * se multiplica por este factor y la cantidad se divide. Ejemplo: AAPL tuvo un ×2 el 24/01/2024; el
 * cierre guardado del 01/12/2023 es $8.663,75, pero ese día un CEDEAR valía $8.663,75 × 2 = $17.327,50.
 */
export function splitFactorAfter(ticker: string, date: string): number {
  return all<{ factor: number }>('SELECT factor FROM split_events WHERE ticker = ? AND date > ?', ticker, date).reduce((f, s) => f * s.factor, 1);
}

export function adjustForSplits<T extends Pick<OperationRow, 'ticker' | 'date' | 'quantity' | 'price'>>(ops: T[]): (T & { splitFactor: number })[] {
  const splits = new Map<string, { date: string; factor: number }[]>();
  for (const t of new Set(ops.map((o) => o.ticker))) {
    splits.set(t, all<{ date: string; factor: number }>('SELECT date, factor FROM split_events WHERE ticker = ?', t));
  }
  return ops.map((op) => {
    // El split rige desde su fecha: lo operado antes queda en la escala vieja
    const factor = (splits.get(op.ticker) ?? []).filter((s) => op.date < s.date).reduce((f, s) => f * s.factor, 1);
    return factor === 1 ? { ...op, splitFactor: 1 } : { ...op, quantity: op.quantity * factor, price: op.price / factor, splitFactor: factor };
  });
}

// Un cobro cargado hasta 15 días después del split, por un monto que difiere menos de 30% del valor de la
// fracción, se toma como el pago de esa fracción
const FRACTION_PAYMENT_DAYS = 15;
const FRACTION_MATCH = 0.3;

/**
 * Fracciones que deja un split o un dividendo en acciones.
 * El broker solo acredita acciones enteras y la fracción la paga en efectivo: con 10 acciones y un
 * reparto de ×2,25 quedan 22,5 → se acreditan 22 y la media acción se cobra. Acá se agrega esa
 * venta automática (al precio de ese día), así la tenencia coincide con la del broker.
 * Recibe operaciones ya ajustadas por splits (todas en la escala de hoy).
 */
export function withSplitFractions(ops: OperationRow[]): OperationRow[] {
  const out = [...ops];
  let nextId = -1;
  for (const ticker of new Set(ops.map((o) => o.ticker))) {
    const splits = all<{ date: string; factor: number }>('SELECT date, factor FROM split_events WHERE ticker = ? ORDER BY date', ticker);
    if (splits.length === 0) continue;
    const mine = sortOps(ops.filter((o) => o.ticker === ticker));
    let held = 0; // en la escala de hoy
    let i = 0;
    for (const [k, split] of splits.entries()) {
      for (; i < mine.length && mine[i].date < split.date; i++) {
        if (mine[i].type === 'COMPRA') held += mine[i].quantity;
        else if (mine[i].type === 'VENTA') held -= mine[i].quantity;
      }
      if (held < 1e-9) continue;
      // Cuántas unidades reales había justo después del split
      const later = splits.slice(k + 1).reduce((f, s) => f * s.factor, 1);
      const units = held / later;
      const fraction = units - Math.floor(units + 1e-6);
      if (fraction < 1e-6) continue;
      // Precio de ese día (o el primero que haya, si el activo no cotizó justo ese día)
      const price = get<{ close: number | null }>(
        `SELECT COALESCE(
           (SELECT close FROM prices WHERE ticker = ?1 AND date <= ?2 ORDER BY date DESC LIMIT 1),
           (SELECT close FROM prices WHERE ticker = ?1 AND date > ?2 ORDER BY date LIMIT 1)) AS close`,
        ticker,
        split.date,
      );
      const quantity = fraction * later;
      held -= quantity;
      const value = quantity * (price?.close ?? 0);
      // Si el broker ya acreditó esa fracción y la cargaste (o la importaste) como un cobro de esos días,
      // la plata ya está contada ahí: la fracción sale de la tenencia sin cobrar nada de nuevo. Si no, la
      // misma plata entraba dos veces. Ejemplo: COME, 13/08/2025, 0,8158 acciones × $60,90 = $49,68; el
      // 14/08 hay un cobro de $49,74.
      const paid = mine.find(
        (o) =>
          o.type === 'DIVIDENDO' &&
          o.date >= split.date &&
          o.date <= addDays(split.date, FRACTION_PAYMENT_DAYS).toISOString().slice(0, 10) &&
          value > 0 &&
          Math.abs((o.quantity * o.price) / value - 1) <= FRACTION_MATCH,
      );
      out.push({
        id: nextId--,
        user_id: mine[0].user_id,
        ticker,
        type: 'VENTA',
        date: split.date,
        quantity,
        price: paid ? 0 : (price?.close ?? 0),
        fees: 0,
        note_title: paid ? `Cobrada aparte: el ${paid.date.split('-').reverse().join('/')}` : null,
        note_body: null,
        note_link: null,
        created_at: '',
        splitFactor: 1,
        auto: 'fraccion',
      });
    }
  }
  return out;
}

/** Operaciones en la escala de hoy: ajustadas por splits y con las fracciones cobradas en efectivo. */
export function adjustOperations(raw: OperationRow[]): OperationRow[] {
  return withSplitFractions(adjustForSplits(raw));
}

/** Sin `ticker`: las operaciones de todos los activos que la app sigue (ver userAssets). */
export function getOperations(userId: number, ticker?: string): OperationRow[] {
  if (ticker) return adjustOperations(getRawOperations(userId, ticker));
  const followed = new Set(userAssets(userId).map((a) => a.ticker));
  return adjustOperations(getRawOperations(userId).filter((o) => followed.has(o.ticker)));
}

function lastTwoPrices(ticker: string): [PriceRow | undefined, PriceRow | undefined] {
  const rows = all<PriceRow>('SELECT date, close, volume FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 2', ticker);
  return [rows[0], rows[1]];
}

function positionFor(userId: number, ticker: string, conv: Converter) {
  const [last, prev] = lastTwoPrices(ticker);
  return computePosition(getOperations(userId, ticker), last, prev, conv, last ? previousSession(last.date) : null);
}

export function convertOp(op: OperationRow, conv: Converter, fx: DateSeries, realizedByOp: Map<number, number>) {
  const totalConv = conv(opTotal(op), op.date);
  const realized = realizedByOp.get(op.id) ?? null;
  // En una venta: resultado sobre lo que habían costado las acciones vendidas
  // (lo cobrado neto − el resultado = el costo de lo vendido, a precio promedio)
  const soldCost = op.type === 'VENTA' && realized != null ? totalConv - realized : 0;
  return {
    ...op,
    fxRate: fx.empty ? null : fx.at(op.date),
    priceConv: conv(op.price, op.date),
    feesConv: conv(op.fees, op.date),
    totalConv,
    realized,
    realizedPct: soldCost > 0 ? realized! / soldCost : null,
  };
}

/** Retención habitual sobre dividendos: 30% en EE.UU. para CEDEARs, 7% para acciones locales. */
export const DEFAULT_WITHHOLDING = { CEDEAR: 0.3, ACCION: 0.07 } as const;

/**
 * Dividendo bruto en pesos por unidad (en la escala de hoy), en cada fecha en que se pagó.
 * - Acciones locales: lo que informa Yahoo, que ya viene en pesos.
 * - CEDEARs: Yahoo los informa mal (pasados a pesos con el dólar de HOY: un dividendo de KO de 2019
 *   figura 22 veces más grande). Se calcula como lo paga el broker: dividendo en dólares de la acción
 *   en EE.UU. ÷ ratio × dólar MEP de ese día. Ejemplo: KO paga US$0,40, ratio 5, MEP $69 → $5,52.
 *   Sin ratio conocido no hay forma confiable de calcularlo, y no se informa nada.
 */
export function dividendEvents(ticker: string, type: string): { date: string; amount: number }[] {
  if (type !== 'CEDEAR') return all('SELECT date, amount FROM dividend_events WHERE ticker = ? ORDER BY date', ticker);
  const symbol = usSymbolOf(ticker);
  const fx = loadFx('bolsa');
  if (!symbol || fx.empty) return [];
  // Si los precios dicen que el ratio cambió y la tabla todavía tiene el viejo, los montos saldrían mal:
  // tras un cambio de 10 a 20, la app ya duplicó tu cantidad, y dividir por 10 daría el doble de lo cobrado.
  // Mejor no sugerir nada (la página del CEDEAR avisa) que sugerir un monto equivocado.
  if (buildCedearInfo(ticker)?.status === 'RATIO_DUDOSO') return [];
  const ratio = CEDEAR_RATIOS[ticker];
  return all<{ date: string; value: number }>('SELECT date, value FROM index_values WHERE series = ? ORDER BY date', `usdiv:${symbol}`).map(
    (d) => ({ date: d.date, amount: (d.value / ratio) * fx.at(d.date) }),
  );
}

// La fuente informa la fecha de corte; el broker acredita el dividendo después. En CEDEARs puede
// tardar bastante: SPY paga unos 45 días después y PBR llegó a 89. Con 100 días entra cualquier pago
// sin llegar al dividendo siguiente de un activo que paga cada tres meses con demora normal.
const DIVIDEND_PAYMENT_DAYS = 100;

/**
 * De los dividendos que pagó el activo, cuáles no están cargados todavía.
 * Cada dividendo cargado cubre UNO solo: el último con fecha de corte anterior (o igual) que siga sin cubrir.
 * Ejemplo: cortes el 20/09 y el 20/12, y un cobro cargado el 04/11 → el de septiembre está
 * cobrado y el de diciembre sigue pendiente.
 * Recibe los dividendos pagados ordenados por fecha.
 */
export function unregisteredDividends<T extends { date: string }>(events: T[], registeredDates: string[]): T[] {
  const day = (iso: string) => Date.parse(iso) / 86_400_000;
  const covered = new Set<number>();
  for (const paid of [...registeredDates].sort()) {
    let match = -1;
    events.forEach((e, i) => {
      const lag = day(paid) - day(e.date);
      if (!covered.has(i) && lag >= 0 && lag <= DIVIDEND_PAYMENT_DAYS) match = i;
    });
    if (match >= 0) covered.add(match);
  }
  return events.filter((_, i) => !covered.has(i));
}

/** Dividendos que pagó el activo en fechas en que lo tenías y que no registraste. */
function pendingDividends(userId: number, asset: AssetRow) {
  const ops = getOperations(userId, asset.ticker);
  const registered = ops.filter((o) => o.type === 'DIVIDENDO').map((o) => o.date);
  // Si ese mismo día hubo un reparto de acciones, la fracción que dejó ya se cobró en efectivo y no cobra
  // dividendo: se descuenta. Sin esto se sugería un dividendo por 37,82 acciones (37 × 1,022), y al guardarlo
  // la app lo rechazaba: la cantidad tiene que ser entera.
  const fractionOn = (date: string) => ops.filter((o) => o.auto && o.date === date).reduce((acc, o) => acc + o.quantity, 0);
  const events = dividendEvents(asset.ticker, asset.type)
    .map((e) => ({ ...e, quantity: holdingBefore(ops, e.date) - fractionOn(e.date) }))
    .filter((e) => e.quantity > 0);
  const rate = DEFAULT_WITHHOLDING[asset.type];
  return unregisteredDividends(events, registered)
    .map((e) => {
      const gross = e.quantity * e.amount;
      // Se sugiere en la escala de esa fecha, como lo cargarías a mano (y como lo informó el broker): al
      // guardarlo, la app lo ajusta por los splits posteriores. En la escala de hoy quedaría ajustado dos veces.
      const f = splitFactorAfter(asset.ticker, e.date);
      // La cantidad en la escala de esa fecha es entera; la división puede dejar 36,99999999
      const quantity = Math.abs(e.quantity / f - Math.round(e.quantity / f)) < 1e-6 ? Math.round(e.quantity / f) : e.quantity / f;
      return { date: e.date, amountPerShare: e.amount * f, quantity, gross, withholding: gross * rate, withholdingRate: rate };
    });
}

export function buildPortfolio(userId: number, currency: Currency, kind: FxKind) {
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  const assets = userAssets(userId);

  const positions = assets.map((a) => ({
    ticker: a.ticker,
    name: a.name,
    type: a.type,
    ...positionFor(userId, a.ticker, conv).position,
    cedearGap: a.type === 'CEDEAR' ? cedearGap(a.ticker) : null,
    ...classifyAsset(a.ticker, a.type, a.sector),
    // La fecha de la última rueda si este activo no tiene precio de ese día (si no, null)
    missingDay: null as string | null,
  }));

  // La variación del día es la de la última rueda (la fecha de precio más nueva de lo que tenés).
  // Un activo sin precio de ese día (no operó, o Yahoo todavía no lo publicó) no suma ni resta al
  // total del día: no se le cuenta la suba o baja de su última rueda vieja. Y no se muestra como 0%,
  // que sería un dato inventado: se marca `missingDay` y la pantalla dice "sin precio".
  const lastSession = positions
    .filter((p) => p.quantity > 0)
    .reduce<string | null>((m, p) => (p.priceDate && (!m || p.priceDate > m) ? p.priceDate : m), null);
  for (const p of positions) {
    if (!p.priceDate || !lastSession || p.priceDate >= lastSession) continue;
    p.dayChange = 0;
    p.dayChangePct = 0;
    p.prevMarketValue = p.marketValue;
    p.dayKnown = false;
    if (p.quantity > 0) p.missingDay = lastSession;
  }

  const sum = (k: keyof Position) => positions.reduce((acc, p) => acc + (p[k] as number), 0);
  const marketValue = sum('marketValue');
  // El mismo valor en la otra moneda, con el dólar del día de cada precio: el mismo que usa la vista en
  // dólares. Antes se usaba el dólar de hoy, y un domingo la vista en pesos decía ≈ US$ 5.665 y la de
  // dólares US$ 5.691 (el MEP del viernes contra el de hoy).
  const otherValue = fx.empty
    ? null
    : positions.reduce((acc, p) => {
        if (!p.priceDate || p.marketValue === 0) return acc;
        const rate = fx.at(p.priceDate);
        return acc + (currency === 'ARS' ? p.marketValue / rate : p.marketValue * rate);
      }, 0);
  const costBasis = sum('costBasis');
  const unrealized = sum('unrealized');
  const realized = sum('realized');
  const dividends = sum('dividends');
  const invested = sum('invested');
  const dayChange = sum('dayChange');
  // Lo que valía ayer lo que ya tenías (lo comprado hoy no cuenta en la base del %). Solo de los activos
  // con dato del día: si un activo no suma a la variación, tampoco tiene que agrandar la base y achicar el %.
  // Ejemplo: $1.000 que subieron $100 y $600 sin dato → +10%, no +6,25%.
  const yesterdayValue = positions.filter((p) => p.dayKnown).reduce((acc, p) => acc + p.prevMarketValue, 0);
  const totalGain = realized + unrealized + dividends;
  // El pico se calcula sobre todas las operaciones juntas, en orden: no es la suma de los picos de cada activo
  const peak = peakCapital(getOperations(userId), conv);

  return {
    currency,
    fxKind: kind,
    fx: fx.latest(),
    summary: {
      marketValue,
      costBasis,
      invested,
      peakCapital: peak,
      unrealized,
      unrealizedPct: costBasis > 0 ? unrealized / costBasis : 0,
      realized,
      dividends,
      totalGain,
      totalGainPct: peak > 0 ? totalGain / peak : 0,
      dayChange,
      dayChangePct: yesterdayValue > 0 ? dayChange / yesterdayValue : 0,
      otherValue,
    },
    positions: positions.map((p) => ({ ...p, weight: marketValue > 0 ? p.marketValue / marketValue : 0 })),
    // En qué sectores y países está puesta la plata
    exposure: { sectors: groupBy(positions, 'sector'), countries: groupBy(positions, 'country') },
    lastSync: assets.reduce<number | null>((m, a) => (a.last_sync && (!m || a.last_sync > m) ? a.last_sync : m), null),
  };
}

export function buildAssetDetail(userId: number, ticker: string, currency: Currency, kind: FxKind) {
  const asset = requireUserAsset(userId, ticker);
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  const { position, realizedByOp } = positionFor(userId, ticker, conv);

  // En dólares, solo desde que hay cotización de ese dólar: antes se usaría la primera que hay, de años
  // después. GGAL del 10/01/2017 ($48,80) figuraba a US$ 1,32 con el MEP de octubre de 2018 ($36,97), cuando
  // con el dólar de ese día ($16) valía US$ 3,05: el gráfico mostraba una suba donde hubo una caída.
  const series = all<PriceRow>('SELECT date, open, high, low, close, volume FROM prices WHERE ticker = ? ORDER BY date', ticker)
    .filter((p) => currency === 'ARS' || fx.covers(p.date))
    .map((p) => {
      // Si Yahoo no trae apertura/máximo/mínimo, la vela se dibuja plana en el cierre
      const c = conv(p.close, p.date);
      const o = p.open ? conv(p.open, p.date) : c;
      return {
        date: p.date,
        open: o,
        high: Math.max(p.high ? conv(p.high, p.date) : c, o, c),
        low: Math.min(p.low ? conv(p.low, p.date) : c, o, c),
        close: c,
        volume: p.volume,
      };
    });

  const operations = sortOps(getOperations(userId, ticker))
    .reverse()
    .map((op) => convertOp(op, conv, fx, realizedByOp));

  return {
    currency,
    fxKind: kind,
    fx: fx.latest(),
    asset: { ticker: asset.ticker, name: asset.name, type: asset.type, symbol: asset.symbol },
    position,
    operations,
    series,
    pendingDividends: pendingDividends(userId, asset),
    cedear: asset.type === 'CEDEAR' ? buildCedearInfo(ticker) : null,
  };
}

export function buildOperationDetail(userId: number, id: number, currency: Currency, kind: FxKind) {
  const raw = get<OperationRow>('SELECT * FROM operations WHERE id = ? AND user_id = ?', id, userId);
  if (!raw) throw new HttpError(404, 'Operación no encontrada');
  const op = adjustForSplits([raw])[0];
  const asset = requireUserAsset(userId, op.ticker);
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  const { realizedByOp } = positionFor(userId, op.ticker, conv);
  return {
    currency,
    fxKind: kind,
    asset: { ticker: asset.ticker, name: asset.name, type: asset.type },
    operation: convertOp(op, conv, fx, realizedByOp),
    // Tal como se cargó (en pesos y antes de ajustar por splits): es lo que se corrige al editarla
    loaded: { date: raw.date, quantity: raw.quantity, price: raw.price, fees: raw.fees },
  };
}
