// Ratios de conversión de CEDEARs: cuántos CEDEARs equivalen a 1 acción en EE.UU.
// Ejemplo: AAPL 20 → 20 CEDEARs de Apple = 1 acción de Apple en Nasdaq.
//
// Verificados en noviembre de 2026 comparando el precio en BYMA, el precio en EE.UU.
// y el CCL de cada día. Si un ratio cambia (por un split), la app lo detecta sola
// y deja de mostrar la brecha hasta que se actualice esta tabla.
//
// Disney (DISN) no está: su precio en Yahoo es demasiado irregular para un cálculo confiable.

export const CEDEAR_RATIOS: Record<string, number> = {
  AAPL: 20, ABBV: 10, ABNB: 15, ADBE: 44, AMD: 10, AMZN: 144, ARKK: 10, AVGO: 39, AXP: 15,
  BA: 24, BABA: 9, BAC: 4, BBD: 1, BIDU: 11, BRKB: 22, C: 3, CAT: 20, COIN: 27, COST: 48,
  CRM: 18, CSCO: 5, CVX: 16, DIA: 20, EEM: 5, EWZ: 2, F: 1, GE: 8, GLD: 50, GLOB: 18, GM: 6,
  GOOGL: 58, GS: 13, HD: 32, HMY: 1, IBM: 15, INTC: 5, ITUB: 1, IWM: 10, JNJ: 15, JPM: 15,
  KO: 5, LLY: 56, MA: 33, MCD: 24, MELI: 120, META: 24, MMM: 10, MSFT: 30, MSTR: 20, MU: 5,
  NFLX: 48, NKE: 12, NU: 2, NVDA: 24, ORCL: 3, PBR: 1, PEP: 18, PFE: 4, PG: 15, PYPL: 8,
  QCOM: 11, QQQ: 20, RIO: 8, SATL: 1, SBUX: 12, SHOP: 107, SLV: 6, SPOT: 28, SPY: 60, T: 3,
  TGT: 24, TSLA: 15, TSM: 9, UBER: 2, UNH: 33, V: 18, VALE: 2, VZ: 4, WMT: 18, XLE: 2,
  XLF: 2, XOM: 10,
};

// Tickers de BYMA que en EE.UU. cotizan con otro símbolo
const US_SYMBOL: Record<string, string> = { BRKB: 'BRK-B', DISN: 'DIS' };

export function usSymbolOf(ticker: string): string | null {
  return ticker in CEDEAR_RATIOS ? (US_SYMBOL[ticker] ?? ticker) : null;
}
