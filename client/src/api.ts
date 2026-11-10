export type Currency = 'ARS' | 'USD';
export type FxKind = 'bolsa' | 'contadoconliqui';
export type AssetType = 'ACCION' | 'CEDEAR';
export type OperationType = 'COMPRA' | 'VENTA' | 'DIVIDENDO';

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Position {
  quantity: number;
  avgCost: number;
  costBasis: number;
  invested: number;
  /** Lo máximo que llegaste a tener puesto de tu bolsillo (base del % de ganancia total) */
  peakCapital: number;
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
  dayChangePct: number;
}

export interface PortfolioPosition extends Position {
  ticker: string;
  name: string;
  type: AssetType;
  weight: number;
  cedearGap: number | null;
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
    peakCapital: number;
    unrealized: number;
    unrealizedPct: number;
    realized: number;
    dividends: number;
    totalGain: number;
    totalGainPct: number;
    dayChange: number;
    dayChangePct: number;
  };
  realReturn: { gain: number; pct: number } | null;
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
  /** Si hubo un split después: por cuánto se multiplicó la cantidad (1 = sin cambios). */
  splitFactor?: number;
}

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface PendingDividend {
  date: string;
  amountPerShare: number;
  quantity: number;
  gross: number;
  withholding: number;
  withholdingRate: number;
}

export interface AssetDetail {
  currency: Currency;
  fxKind: FxKind;
  fx: FxLatest | null;
  asset: { ticker: string; name: string; type: AssetType; symbol: string };
  position: Position;
  operations: Operation[];
  series: PricePoint[];
  pendingDividends: PendingDividend[];
  cedear: CedearInfo | null;
}

export type CedearInfo =
  | { status: 'SIN_DATOS'; ratio: number; usSymbol: string }
  | {
      status: 'OK' | 'RATIO_DUDOSO';
      ratio: number;
      usSymbol: string;
      observedRatio: number;
      date: string;
      arsPrice: number;
      usPrice: number;
      ccl: number;
      impliedCcl: number;
      gap: number;
      gapAvg: number;
      history: { date: string; impliedCcl: number; ccl: number; gap: number }[];
    };

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

export type BenchmarkKey = 'inflacion' | 'dolar' | 'plazofijo' | 'merval' | 'spy';

export interface History {
  currency: Currency;
  points: { date: string; value: number; netInvested: number; benchmarks: Record<BenchmarkKey, number | null> }[];
  benchmarks: {
    key: BenchmarkKey;
    label: string;
    description: string;
    available: boolean;
    value: number | null;
    diff: number | null;
    diffPct: number | null;
    irr: number | null;
    lastDataDate: string | null;
  }[];
  portfolio: { value: number; netInvested: number; gain: number; irr: number | null } | null;
  realReturn: { gain: number; pct: number } | null;
  monthly: { month: string; return: number; gain: number }[];
}

export type Verdict = 'ACIERTO' | 'ERROR' | 'NEUTRAL';

export interface JournalEntry {
  id: number;
  ticker: string;
  type: 'COMPRA' | 'VENTA';
  date: string;
  quantity: number;
  price: number;
  note_title: string | null;
  note_body: string | null;
  hasNote: boolean;
  horizons: ({ days: number; available: false } | { days: number; available: true; price: number; change: number; verdict: Verdict })[];
  sinceChange: number | null;
  verdict: Verdict | null;
  verdictDays: number | null;
}

export interface JournalStats {
  total: number;
  judged: number;
  hits: number;
  misses: number;
  neutral: number;
  pending: number;
  hitRate: number | null;
}

export interface Journal {
  currency: Currency;
  entries: JournalEntry[];
  stats: Record<'all' | 'buys' | 'sells' | 'withNote' | 'withoutNote', JournalStats>;
}

export interface SearchResult {
  ticker: string;
  name: string;
  type: AssetType;
  sector?: string;
  owned: boolean;
}

export interface Alert {
  id: number;
  ticker: string;
  direction: 'ARRIBA' | 'ABAJO';
  price: number;
  created_at: string;
  triggered_at: string | null;
  trigger_price: number | null;
  seen: number;
  current: number | null;
}

export interface ImportResult {
  committed: boolean;
  columns: Record<string, string | null>;
  rows: {
    line: number;
    date: string | null;
    type: OperationType | null;
    ticker: string | null;
    quantity: number | null;
    price: number | null;
    fees: number;
    note: string | null;
    errors: string[];
    ignored: string | null;
    status: 'ok' | 'error' | 'duplicada' | 'ignorada';
  }[];
  summary: { total: number; ok: number; errors: number; duplicates: number; ignored: number };
}

export type SimAlternative = 'activo' | 'dolar' | 'plazofijo' | 'inflacion' | 'colchon';

export interface Simulation {
  ticker: string;
  name: string;
  type: AssetType;
  currency: Currency;
  amount: number;
  invested: number;
  startDate: string;
  startPrice: number;
  units: number;
  endDate: string;
  years: number;
  dividendsCash: number;
  results: (
    | { key: SimAlternative; label: string; available: false }
    | { key: SimAlternative; label: string; available: true; value: number; gain: number; return: number; annual: number | null }
  )[];
  worst: { date: string; return: number };
  best: { date: string; return: number };
  points: ({ date: string } & Record<SimAlternative, number | null>)[];
}

export class AuthError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(body.error ?? 'Sin sesión');
  if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
const del = (path: string) => request<void>(path, { method: 'DELETE' });
const q = (c: Currency, k: FxKind) => `currency=${c}&fx=${k}`;

export const api = {
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) => post<User>('/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => post<User>('/auth/register', { name, email, password }),
  logout: () => post<void>('/auth/logout'),
  changePassword: (current: string, next: string) => post<void>('/auth/password', { current, next }),

  portfolio: (c: Currency, k: FxKind) => request<Portfolio>(`/portfolio?${q(c, k)}`),
  history: (c: Currency, k: FxKind) => request<History>(`/history?${q(c, k)}`),
  journal: (c: Currency, k: FxKind) => request<Journal>(`/journal?${q(c, k)}`),
  search: (text: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(text)}`),

  asset: (t: string, c: Currency, k: FxKind) => request<AssetDetail>(`/assets/${t}?${q(c, k)}`),
  addAsset: (ticker: string) => post<{ ticker: string; name: string; type: AssetType }>('/assets', { ticker }),
  deleteAsset: (t: string) => del(`/assets/${t}`),
  priceAt: (t: string, date: string) => request<{ date: string; close: number }>(`/assets/${t}/price?date=${date}`),

  addOperation: (t: string, op: NewOperation) => post<{ id: number }>(`/assets/${t}/operations`, op),
  operation: (id: number, c: Currency, k: FxKind) => request<OperationDetail>(`/operations/${id}?${q(c, k)}`),
  deleteOperation: (id: number) => del(`/operations/${id}`),

  simulate: (ticker: string, amount: number, date: string, c: Currency, k: FxKind) =>
    request<Simulation>(`/simulate?ticker=${encodeURIComponent(ticker)}&amount=${amount}&date=${date}&${q(c, k)}`),
  alerts: () => request<Alert[]>('/alerts'),
  addAlert: (ticker: string, direction: 'ARRIBA' | 'ABAJO', price: number) => post<{ id: number }>('/alerts', { ticker, direction, price }),
  deleteAlert: (id: number) => del(`/alerts/${id}`),
  markAlertsSeen: () => post<void>('/alerts/seen'),

  importCsv: (csv: string, commit: boolean) => post<ImportResult>('/import', { csv, commit }),
};
