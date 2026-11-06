export type Currency = 'ARS' | 'USD';
export type FxKind = 'bolsa' | 'contadoconliqui';
export type AssetType = 'ACCION' | 'CEDEAR';
export type OperationType = 'COMPRA' | 'VENTA';

export interface Position {
  quantity: number;
  avgCost: number;
  costBasis: number;
  invested: number;
  price: number;
  priceDate: string | null;
  marketValue: number;
  unrealized: number;
  unrealizedPct: number;
  realized: number;
  totalGain: number;
  totalGainPct: number;
  dayChange: number;
  dayChangePct: number;
}

export interface PortfolioPosition extends Position {
  ticker: string;
  name: string;
  type: AssetType;
  weight: number;
}

export interface FxLatest {
  date: string;
  rate: number;
}

export interface Portfolio {
  currency: Currency;
  fxKind: FxKind;
  fx: FxLatest | null;
  summary: {
    marketValue: number;
    costBasis: number;
    invested: number;
    unrealized: number;
    unrealizedPct: number;
    realized: number;
    totalGain: number;
    totalGainPct: number;
    dayChange: number;
    dayChangePct: number;
  };
  positions: PortfolioPosition[];
  lastSync: number | null;
  errors: string[];
}

export interface Operation {
  id: number;
  ticker: string;
  type: OperationType;
  date: string;
  quantity: number;
  price: number; // en pesos, como se cargó
  fees: number;
  note_title: string | null;
  note_body: string | null;
  note_link: string | null;
  created_at: string;
  fxRate: number | null;
  priceConv: number;
  feesConv: number;
  totalConv: number;
  realized: number | null;
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number | null;
}

export interface AssetDetail {
  currency: Currency;
  fxKind: FxKind;
  fx: FxLatest | null;
  asset: { ticker: string; name: string; type: AssetType; symbol: string };
  position: Position;
  operations: Operation[];
  series: PricePoint[];
}

export interface OperationDetail {
  currency: Currency;
  fxKind: FxKind;
  asset: { ticker: string; name: string; type: AssetType };
  operation: Operation;
}

export interface NewOperation {
  type: OperationType;
  date: string;
  quantity: number;
  price: number;
  fees: number;
  note_title: string;
  note_body: string;
  note_link: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body as T;
}

const q = (c: Currency, k: FxKind) => `currency=${c}&fx=${k}`;

export const api = {
  portfolio: (c: Currency, k: FxKind) => request<Portfolio>(`/portfolio?${q(c, k)}`),
  asset: (t: string, c: Currency, k: FxKind) => request<AssetDetail>(`/assets/${t}?${q(c, k)}`),
  addAsset: (ticker: string) =>
    request<{ ticker: string; name: string; type: AssetType }>('/assets', {
      method: 'POST',
      body: JSON.stringify({ ticker }),
    }),
  deleteAsset: (t: string) => request<void>(`/assets/${t}`, { method: 'DELETE' }),
  priceAt: (t: string, date: string) => request<{ date: string; close: number }>(`/assets/${t}/price?date=${date}`),
  addOperation: (t: string, op: NewOperation) =>
    request<{ id: number }>(`/assets/${t}/operations`, { method: 'POST', body: JSON.stringify(op) }),
  operation: (id: number, c: Currency, k: FxKind) => request<OperationDetail>(`/operations/${id}?${q(c, k)}`),
  deleteOperation: (id: number) => request<void>(`/operations/${id}`, { method: 'DELETE' }),
};
