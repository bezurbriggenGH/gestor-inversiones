// Acciones argentinas que cotizan en BYMA. Todo lo que no esté acá lo tratamos como CEDEAR.
const ARGENTINE_STOCKS = new Set([
  'AGRO', 'ALUA', 'AUSO', 'BBAR', 'BHIP', 'BMA', 'BOLT', 'BPAT', 'BYMA', 'CADO', 'CAPX', 'CARC',
  'CECO2', 'CELU', 'CEPU', 'CGPA2', 'COME', 'CRES', 'CTIO', 'CVH', 'DGCU2', 'DOME', 'EDN', 'FERR',
  'FIPL', 'GAMI', 'GARO', 'GBAN', 'GCDI', 'GCLA', 'GGAL', 'GRIM', 'HARG', 'HAVA', 'INTR', 'INVJ',
  'IRCP', 'IRSA', 'LEDE', 'LOMA', 'LONG', 'METR', 'MIRG', 'MOLA', 'MOLI', 'MORI', 'OEST', 'PAMP',
  'PATA', 'POLL', 'RICH', 'RIGO', 'ROSE', 'SAMI', 'SEMI', 'SUPV', 'TECO2', 'TGNO4', 'TGSU2',
  'TRAN', 'TXAR', 'VALO', 'YPFD',
]);

// Nombres con los que la gente suele buscar y que en BYMA tienen otro ticker
const ALIASES: Record<string, string> = {
  YPF: 'YPFD',
  TGS: 'TGSU2',
  TEO: 'TECO2',
  TECO: 'TECO2',
  PAM: 'PAMP',
  CEPUA: 'CEPU',
  GALICIA: 'GGAL',
};

export function normalizeTicker(input: string): string {
  const t = input.trim().toUpperCase().replace(/\.BA$/, '');
  return ALIASES[t] ?? t;
}

export function classify(ticker: string): 'ACCION' | 'CEDEAR' {
  return ARGENTINE_STOCKS.has(ticker) ? 'ACCION' : 'CEDEAR';
}
