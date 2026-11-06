import { CATALOG } from './catalog.ts';

// Acciones argentinas conocidas. Todo lo que no esté en esta lista se trata como CEDEAR.
const ARGENTINE_STOCKS = new Set(CATALOG.filter((c) => c.type === 'ACCION').map((c) => c.ticker));

// Nombres con los que la gente suele buscar y que en BYMA tienen otro ticker
const ALIASES: Record<string, string> = {
  YPF: 'YPFD',
  TGS: 'TGSU2',
  TEO: 'TECO2',
  TECO: 'TECO2',
  PAM: 'PAMP',
  GALICIA: 'GGAL',
  GOOG: 'GOOGL',
  DIS: 'DISN',
  'BRK.B': 'BRKB',
};

export function normalizeTicker(input: string): string {
  const t = input.trim().toUpperCase().replace(/\.BA$/, '');
  return ALIASES[t] ?? t;
}

export function classify(ticker: string): 'ACCION' | 'CEDEAR' {
  return ARGENTINE_STOCKS.has(ticker) ? 'ACCION' : 'CEDEAR';
}
