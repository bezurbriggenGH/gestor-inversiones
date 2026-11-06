// Cálculos de la cartera.
//
// Criterios contables:
// - Costo por Precio Promedio Ponderado (PPP): cada compra suma al costo total
//   (precio × cantidad + comisiones). Al vender, sale costo a precio promedio.
// - Resultado realizado: lo que ganaste/perdiste en ventas ya hechas
//   (lo cobrado neto de comisiones − costo promedio de lo vendido).
// - Resultado no realizado: valor de mercado de lo que tenés − su costo.
// - En dólares, cada monto se convierte con el dólar DEL DÍA en que ocurrió.
//   Así se ve si le ganaste al dólar, no solo a los pesos.
import { all, get } from '../db.ts';
import type { FxKind } from '../providers/dolar.ts';
import { FX_KINDS } from '../providers/dolar.ts';
import { HttpError } from '../util.ts';

export type Currency = 'ARS' | 'USD';

export interface AssetRow {
  ticker: string;
  symbol: string;
  name: string;
  type: 'ACCION' | 'CEDEAR';
  created_at: string;
  last_sync: number | null;
}

export interface OperationRow {
  id: number;
  ticker: string;
  type: 'COMPRA' | 'VENTA';
  date: string;
  quantity: number;
  price: number;
  fees: number;
  note_title: string | null;
  note_body: string | null;
  note_link: string | null;
  created_at: string;
}

interface PriceRow {
  date: string;
  close: number;
  volume: number | null;
}

export function parseCurrency(v: unknown): Currency {
  return v === 'USD' ? 'USD' : 'ARS';
}

export function parseFxKind(v: unknown): FxKind {
  return FX_KINDS.includes(v as FxKind) ? (v as FxKind) : 'bolsa';
}

/** Tabla de cotizaciones. Para días sin cotización (feriados) usa la última anterior. */
export class FxTable {
  private dates: string[];
  private rates: number[];

  constructor(rows: { date: string; sell: number }[]) {
    this.dates = rows.map((r) => r.date);
    this.rates = rows.map((r) => r.sell);
  }

  get empty(): boolean {
    return this.dates.length === 0;
  }

  at(date: string): number {
    if (this.empty) throw new HttpError(503, 'Todavía no hay cotizaciones del dólar guardadas');
    let lo = 0;
    let hi = this.dates.length - 1;
    if (date < this.dates[0]) return this.rates[0];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.dates[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    return this.rates[lo];
  }

  latest(): { date: string; rate: number } | null {
    if (this.empty) return null;
    const i = this.dates.length - 1;
    return { date: this.dates[i], rate: this.rates[i] };
  }
}

export function loadFx(kind: FxKind): FxTable {
  return new FxTable(all<{ date: string; sell: number }>('SELECT date, sell FROM fx_rates WHERE kind = ? ORDER BY date', kind));
}

type Converter = (ars: number, date: string) => number;

function makeConverter(currency: Currency, fx: FxTable): Converter {
  return currency === 'ARS' ? (ars) => ars : (ars, date) => ars / fx.at(date);
}

export function sortOps(ops: OperationRow[]): OperationRow[] {
  // Mismo día: primero compras, después ventas, y por orden de carga
  return [...ops].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'COMPRA' ? -1 : 1) || a.id - b.id,
  );
}

/** Verifica que nunca se venda más de lo que se tenía en ese momento. */
export function assertNoShortSelling(ops: OperationRow[]): void {
  let qty = 0;
  for (const op of sortOps(ops)) {
    if (op.type === 'COMPRA') qty += op.quantity;
    else {
      if (op.quantity > qty + 1e-9) {
        throw new HttpError(
          409,
          `El ${op.date.split('-').reverse().join('/')} se venderían ${op.quantity} unidades, pero en ese momento había ${qty}.`,
        );
      }
      qty -= op.quantity;
    }
  }
}

export interface Position {
  quantity: number;
  avgCost: number; // PPP por unidad
  costBasis: number; // costo de lo que todavía tenés
  invested: number; // total puesto en compras (histórico)
  price: number;
  priceDate: string | null;
  marketValue: number;
  unrealized: number;
  unrealizedPct: number;
  realized: number;
  totalGain: number;
  totalGainPct: number;
  dayChange: number;
  dayChangePct: number; // variación del precio del activo en el día
}

function computePosition(ops: OperationRow[], last: PriceRow | undefined, prev: PriceRow | undefined, conv: Converter) {
  let quantity = 0;
  let costBasis = 0;
  let invested = 0;
  let realized = 0;
  const realizedByOp = new Map<number, number>();

  for (const op of sortOps(ops)) {
    const px = conv(op.price, op.date);
    const fees = conv(op.fees, op.date);
    if (op.type === 'COMPRA') {
      quantity += op.quantity;
      costBasis += op.quantity * px + fees;
      invested += op.quantity * px + fees;
    } else {
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
    }
  }

  const price = last ? conv(last.close, last.date) : 0;
  const prevPrice = prev ? conv(prev.close, prev.date) : price;
  const marketValue = quantity * price;
  const unrealized = quantity > 0 ? marketValue - costBasis : 0;
  const totalGain = realized + unrealized;

  const position: Position = {
    quantity,
    avgCost: quantity > 0 ? costBasis / quantity : 0,
    costBasis,
    invested,
    price,
    priceDate: last?.date ?? null,
    marketValue,
    unrealized,
    unrealizedPct: costBasis > 0 ? unrealized / costBasis : 0,
    realized,
    totalGain,
    totalGainPct: invested > 0 ? totalGain / invested : 0,
    dayChange: quantity * (price - prevPrice),
    dayChangePct: prevPrice > 0 ? price / prevPrice - 1 : 0,
  };
  return { position, realizedByOp };
}

function getAsset(ticker: string): AssetRow {
  const asset = get<AssetRow>('SELECT * FROM assets WHERE ticker = ?', ticker);
  if (!asset) throw new HttpError(404, `${ticker} no está en tu cartera`);
  return asset;
}

export function getOperations(ticker: string): OperationRow[] {
  return all<OperationRow>('SELECT * FROM operations WHERE ticker = ?', ticker);
}

function lastTwoPrices(ticker: string): [PriceRow | undefined, PriceRow | undefined] {
  const rows = all<PriceRow>('SELECT date, close, volume FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 2', ticker);
  return [rows[0], rows[1]];
}

function positionFor(ticker: string, conv: Converter) {
  const [last, prev] = lastTwoPrices(ticker);
  return computePosition(getOperations(ticker), last, prev, conv);
}

function convertOp(op: OperationRow, conv: Converter, fx: FxTable, realizedByOp: Map<number, number>) {
  const gross = op.quantity * op.price;
  const total = op.type === 'COMPRA' ? gross + op.fees : gross - op.fees;
  return {
    ...op,
    fxRate: fx.empty ? null : fx.at(op.date),
    priceConv: conv(op.price, op.date),
    feesConv: conv(op.fees, op.date),
    totalConv: conv(total, op.date),
    realized: realizedByOp.get(op.id) ?? null,
  };
}

export function buildPortfolio(currency: Currency, kind: FxKind) {
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  const assets = all<AssetRow>('SELECT * FROM assets ORDER BY created_at, ticker');

  const positions = assets.map((a) => ({
    ticker: a.ticker,
    name: a.name,
    type: a.type,
    ...positionFor(a.ticker, conv).position,
  }));

  const sum = (k: keyof Position) => positions.reduce((acc, p) => acc + (p[k] as number), 0);
  const marketValue = sum('marketValue');
  const costBasis = sum('costBasis');
  const unrealized = sum('unrealized');
  const realized = sum('realized');
  const invested = sum('invested');
  const dayChange = sum('dayChange');
  const yesterdayValue = marketValue - dayChange;

  return {
    currency,
    fxKind: kind,
    fx: fx.latest(),
    summary: {
      marketValue,
      costBasis,
      invested,
      unrealized,
      unrealizedPct: costBasis > 0 ? unrealized / costBasis : 0,
      realized,
      totalGain: realized + unrealized,
      totalGainPct: invested > 0 ? (realized + unrealized) / invested : 0,
      dayChange,
      dayChangePct: yesterdayValue > 0 ? dayChange / yesterdayValue : 0,
    },
    positions: positions.map((p) => ({ ...p, weight: marketValue > 0 ? p.marketValue / marketValue : 0 })),
    lastSync: assets.reduce<number | null>((m, a) => (a.last_sync && (!m || a.last_sync > m) ? a.last_sync : m), null),
  };
}

export function buildAssetDetail(ticker: string, currency: Currency, kind: FxKind) {
  const asset = getAsset(ticker);
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  const { position, realizedByOp } = positionFor(ticker, conv);

  const series = all<PriceRow>('SELECT date, close, volume FROM prices WHERE ticker = ? ORDER BY date', ticker).map(
    (p) => ({ date: p.date, close: conv(p.close, p.date), volume: p.volume }),
  );

  const operations = sortOps(getOperations(ticker))
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
  };
}

export function buildOperationDetail(id: number, currency: Currency, kind: FxKind) {
  const op = get<OperationRow>('SELECT * FROM operations WHERE id = ?', id);
  if (!op) throw new HttpError(404, 'Operación no encontrada');
  const asset = getAsset(op.ticker);
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  const { realizedByOp } = positionFor(op.ticker, conv);
  return {
    currency,
    fxKind: kind,
    asset: { ticker: asset.ticker, name: asset.name, type: asset.type },
    operation: convertOp(op, conv, fx, realizedByOp),
  };
}
