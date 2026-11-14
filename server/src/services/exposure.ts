// Exposición real de la cartera: en qué sectores y en qué países está puesta la plata.
// Tener 10 activos distintos no es estar diversificado si 8 son tecnológicas de Estados Unidos.
//
// De dónde sale el dato de cada activo:
// 1. Del catálogo de la app (catalog.ts), que tiene el sector y el país de los que conoce.
// 2. Si no está en el catálogo, el sector se le pregunta una vez a Yahoo y queda guardado.
//    El país no lo informa ninguna fuente gratuita: una acción argentina es de Argentina,
//    y un CEDEAR desconocido queda "Sin clasificar".
import { CATALOG } from '../catalog.ts';

export const UNCLASSIFIED = 'Sin clasificar';

const BY_TICKER = new Map(CATALOG.map((c) => [c.ticker, c]));

/** ¿La app ya sabe de qué sector es? (Si no, se le pregunta a Yahoo.) */
export const inCatalog = (ticker: string) => BY_TICKER.has(ticker);

// Yahoo informa el sector en inglés y con su propia clasificación
const YAHOO_SECTORS: Record<string, string> = {
  Technology: 'Tecnología',
  'Financial Services': 'Finanzas',
  'Consumer Cyclical': 'Consumo',
  'Consumer Defensive': 'Consumo',
  Healthcare: 'Salud',
  Industrials: 'Industria',
  Energy: 'Energía',
  'Basic Materials': 'Materiales',
  'Communication Services': 'Telecomunicaciones',
  Utilities: 'Servicios públicos',
  'Real Estate': 'Real estate',
};

/** "Financial Services" → "Finanzas". Un fondo (ETF) no tiene sector: va como "ETF". */
export function translateSector(yahooSector: string | undefined, quoteType: string | undefined): string | null {
  if (quoteType === 'ETF') return 'ETF';
  return yahooSector ? (YAHOO_SECTORS[yahooSector] ?? yahooSector) : null;
}

export function classifyAsset(ticker: string, type: 'ACCION' | 'CEDEAR', storedSector: string | null): { sector: string | null; country: string | null } {
  const known = BY_TICKER.get(ticker);
  if (known) return { sector: known.sector ?? null, country: known.country ?? null };
  return { sector: storedSector, country: type === 'ACCION' ? 'Argentina' : null };
}

export interface ExposureGroup {
  name: string;
  value: number;
  weight: number;
  tickers: string[];
}

/** Suma lo que valen las tenencias por grupo, de mayor a menor. "Sin clasificar" va siempre al final. */
export function groupBy(
  positions: { ticker: string; marketValue: number; sector: string | null; country: string | null }[],
  key: 'sector' | 'country',
): ExposureGroup[] {
  const held = positions.filter((p) => p.marketValue > 0);
  const total = held.reduce((acc, p) => acc + p.marketValue, 0);
  const groups = new Map<string, ExposureGroup>();
  for (const p of [...held].sort((a, b) => b.marketValue - a.marketValue)) {
    const name = p[key] ?? UNCLASSIFIED;
    const g = groups.get(name) ?? { name, value: 0, weight: 0, tickers: [] };
    g.value += p.marketValue;
    g.tickers.push(p.ticker);
    groups.set(name, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, weight: total > 0 ? g.value / total : 0 }))
    .sort((a, b) => Number(a.name === UNCLASSIFIED) - Number(b.name === UNCLASSIFIED) || b.value - a.value);
}
