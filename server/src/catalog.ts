// Catálogo de instrumentos de BYMA para el buscador.
// Cualquier ticker que no esté acá se puede agregar igual escribiéndolo completo.

export interface CatalogItem {
  ticker: string;
  name: string;
  type: 'ACCION' | 'CEDEAR';
  sector?: string;
  country?: string;
}

const ACCIONES: [string, string, string][] = [
  ['AGRO', 'Agrometal', 'Industria'],
  ['ALUA', 'Aluar Aluminio Argentino', 'Materiales'],
  ['AUSO', 'Autopistas del Sol', 'Infraestructura'],
  ['BBAR', 'Banco BBVA Argentina', 'Bancos'],
  ['BHIP', 'Banco Hipotecario', 'Bancos'],
  ['BMA', 'Banco Macro', 'Bancos'],
  ['BOLT', 'Boldt', 'Entretenimiento'],
  ['BPAT', 'Banco Patagonia', 'Bancos'],
  ['BYMA', 'Bolsas y Mercados Argentinos', 'Finanzas'],
  ['CADO', 'Carlos Casado', 'Agro'],
  ['CAPX', 'Capex', 'Energía'],
  ['CARC', 'Carboclor', 'Química'],
  ['CECO2', 'Central Costanera', 'Energía'],
  ['CELU', 'Celulosa Argentina', 'Materiales'],
  ['CEPU', 'Central Puerto', 'Energía'],
  ['CGPA2', 'Camuzzi Gas Pampeana', 'Gas'],
  ['COME', 'Sociedad Comercial del Plata', 'Holding'],
  ['CRES', 'Cresud', 'Agro'],
  ['CTIO', 'Consultatio', 'Real estate'],
  ['CVH', 'Cablevisión Holding', 'Telecomunicaciones'],
  ['DGCU2', 'Distribuidora de Gas Cuyana', 'Gas'],
  ['DOME', 'Domec', 'Industria'],
  ['EDN', 'Edenor', 'Energía'],
  ['FERR', 'Ferrum', 'Industria'],
  ['FIPL', 'Fiplasto', 'Industria'],
  ['GAMI', 'Boldt Gaming', 'Entretenimiento'],
  ['GARO', 'Garovaglio y Zorraquín', 'Holding'],
  ['GBAN', 'Gas Natural Ban', 'Gas'],
  ['GCDI', 'GCDI (ex TGLT)', 'Construcción'],
  ['GCLA', 'Grupo Clarín', 'Medios'],
  ['GGAL', 'Grupo Financiero Galicia', 'Bancos'],
  ['GRIM', 'Grimoldi', 'Consumo'],
  ['HARG', 'Holcim Argentina', 'Materiales'],
  ['HAVA', 'Havanna', 'Consumo'],
  ['INTR', 'Compañía Introductora de Buenos Aires', 'Consumo'],
  ['INVJ', 'Inversora Juramento', 'Agro'],
  ['IRSA', 'IRSA Inversiones y Representaciones', 'Real estate'],
  ['LEDE', 'Ledesma', 'Agro'],
  ['LOMA', 'Loma Negra', 'Materiales'],
  ['LONG', 'Longvie', 'Consumo'],
  ['METR', 'MetroGAS', 'Gas'],
  ['MIRG', 'Mirgor', 'Industria'],
  ['MOLA', 'Molinos Agro', 'Agro'],
  ['MOLI', 'Molinos Río de la Plata', 'Consumo'],
  ['MORI', 'Morixe Hermanos', 'Consumo'],
  ['OEST', 'Grupo Concesionario del Oeste', 'Infraestructura'],
  ['PAMP', 'Pampa Energía', 'Energía'],
  ['PATA', 'Importadora y Exportadora de la Patagonia', 'Consumo'],
  ['POLL', 'Polledo', 'Construcción'],
  ['RICH', 'Laboratorios Richmond', 'Salud'],
  ['RIGO', 'Rigolleau', 'Industria'],
  ['ROSE', 'Instituto Rosenbusch', 'Salud'],
  ['SAMI', 'San Miguel', 'Agro'],
  ['SEMI', 'Molinos Juan Semino', 'Consumo'],
  ['SUPV', 'Grupo Supervielle', 'Bancos'],
  ['TECO2', 'Telecom Argentina', 'Telecomunicaciones'],
  ['TGNO4', 'Transportadora de Gas del Norte', 'Gas'],
  ['TGSU2', 'Transportadora de Gas del Sur', 'Gas'],
  ['TRAN', 'Transener', 'Energía'],
  ['TXAR', 'Ternium Argentina', 'Materiales'],
  ['VALO', 'Grupo Financiero Valores', 'Finanzas'],
  ['YPFD', 'YPF', 'Energía'],
];

const CEDEARS: [string, string, string][] = [
  ['AAPL', 'Apple', 'Tecnología'],
  ['ABBV', 'AbbVie', 'Salud'],
  ['ABNB', 'Airbnb', 'Consumo'],
  ['ADBE', 'Adobe', 'Tecnología'],
  ['AMD', 'Advanced Micro Devices', 'Tecnología'],
  ['AMZN', 'Amazon', 'Consumo'],
  ['ARKK', 'ARK Innovation ETF', 'ETF'],
  ['AVGO', 'Broadcom', 'Tecnología'],
  ['AXP', 'American Express', 'Finanzas'],
  ['BA', 'Boeing', 'Industria'],
  ['BABA', 'Alibaba', 'Consumo'],
  ['BAC', 'Bank of America', 'Bancos'],
  ['BBD', 'Banco Bradesco', 'Bancos'],
  ['BIDU', 'Baidu', 'Tecnología'],
  ['BIOX', 'Bioceres Crop Solutions', 'Agro'],
  ['BRKB', 'Berkshire Hathaway', 'Holding'],
  ['C', 'Citigroup', 'Bancos'],
  ['CAT', 'Caterpillar', 'Industria'],
  ['COIN', 'Coinbase', 'Finanzas'],
  ['COST', 'Costco', 'Consumo'],
  ['CRM', 'Salesforce', 'Tecnología'],
  ['CSCO', 'Cisco', 'Tecnología'],
  ['CVX', 'Chevron', 'Energía'],
  ['DIA', 'SPDR Dow Jones ETF', 'ETF'],
  ['DISN', 'Walt Disney', 'Medios'],
  ['EEM', 'iShares Mercados Emergentes ETF', 'ETF'],
  ['EWZ', 'iShares Brasil ETF', 'ETF'],
  ['F', 'Ford', 'Automotriz'],
  ['GE', 'General Electric', 'Industria'],
  ['GLD', 'SPDR Gold ETF (oro)', 'ETF'],
  ['GLOB', 'Globant', 'Tecnología'],
  ['GM', 'General Motors', 'Automotriz'],
  ['GOOGL', 'Alphabet (Google)', 'Tecnología'],
  ['GS', 'Goldman Sachs', 'Finanzas'],
  ['HD', 'Home Depot', 'Consumo'],
  ['HMY', 'Harmony Gold', 'Minería'],
  ['IBM', 'IBM', 'Tecnología'],
  ['INTC', 'Intel', 'Tecnología'],
  ['ITUB', 'Itaú Unibanco', 'Bancos'],
  ['IWM', 'iShares Russell 2000 ETF', 'ETF'],
  ['JNJ', 'Johnson & Johnson', 'Salud'],
  ['JPM', 'JPMorgan Chase', 'Bancos'],
  ['KO', 'Coca-Cola', 'Consumo'],
  ['LLY', 'Eli Lilly', 'Salud'],
  ['MA', 'Mastercard', 'Finanzas'],
  ['MCD', "McDonald's", 'Consumo'],
  ['MELI', 'MercadoLibre', 'Tecnología'],
  ['META', 'Meta Platforms (Facebook)', 'Tecnología'],
  ['MMM', '3M', 'Industria'],
  ['MSFT', 'Microsoft', 'Tecnología'],
  ['MSTR', 'MicroStrategy', 'Tecnología'],
  ['MU', 'Micron Technology', 'Tecnología'],
  ['NFLX', 'Netflix', 'Medios'],
  ['NKE', 'Nike', 'Consumo'],
  ['NU', 'Nu Holdings (Nubank)', 'Bancos'],
  ['NVDA', 'NVIDIA', 'Tecnología'],
  ['ORCL', 'Oracle', 'Tecnología'],
  ['PAGS', 'PagSeguro', 'Finanzas'],
  ['PBR', 'Petrobras', 'Energía'],
  ['PEP', 'PepsiCo', 'Consumo'],
  ['PFE', 'Pfizer', 'Salud'],
  ['PG', 'Procter & Gamble', 'Consumo'],
  ['PYPL', 'PayPal', 'Finanzas'],
  ['QCOM', 'Qualcomm', 'Tecnología'],
  ['QQQ', 'Invesco Nasdaq 100 ETF', 'ETF'],
  ['RIO', 'Rio Tinto', 'Minería'],
  ['SATL', 'Satellogic', 'Tecnología'],
  ['SBUX', 'Starbucks', 'Consumo'],
  ['SHOP', 'Shopify', 'Tecnología'],
  ['SLV', 'iShares Silver ETF (plata)', 'ETF'],
  ['SPOT', 'Spotify', 'Medios'],
  ['SPY', 'SPDR S&P 500 ETF', 'ETF'],
  ['T', 'AT&T', 'Telecomunicaciones'],
  ['TGT', 'Target', 'Consumo'],
  ['TSLA', 'Tesla', 'Automotriz'],
  ['TSM', 'Taiwan Semiconductor', 'Tecnología'],
  ['UBER', 'Uber', 'Tecnología'],
  ['UNH', 'UnitedHealth', 'Salud'],
  ['V', 'Visa', 'Finanzas'],
  ['VALE', 'Vale', 'Minería'],
  ['VIST', 'Vista Energy', 'Energía'],
  ['VZ', 'Verizon', 'Telecomunicaciones'],
  ['WMT', 'Walmart', 'Consumo'],
  ['XLE', 'Energy Select Sector ETF', 'ETF'],
  ['XLF', 'Financial Select Sector ETF', 'ETF'],
  ['XOM', 'ExxonMobil', 'Energía'],
];

// Más CEDEARs (se agregan acá cuando aparece uno que la app no conocía)
const MAS_CEDEARS: [string, string, string][] = [
  ['AAP', 'Advance Auto Parts', 'Consumo'],
  ['ACN', 'Accenture', 'Tecnología'],
  ['ADGO', 'Adecoagro', 'Agro'],
  ['AI', 'C3.ai', 'Tecnología'],
  ['ALAB', 'Astera Labs', 'Tecnología'],
  ['ANF', 'Abercrombie & Fitch', 'Consumo'],
  ['ARM', 'Arm Holdings', 'Tecnología'],
  ['ASTS', 'AST SpaceMobile', 'Telecomunicaciones'],
  ['AZN', 'AstraZeneca', 'Salud'],
  ['B', 'Barrick Mining', 'Minería'],
  ['CRWV', 'CoreWeave', 'Tecnología'],
  ['DOCU', 'DocuSign', 'Tecnología'],
  ['FSLR', 'First Solar', 'Energía'],
  ['HIMS', 'Hims & Hers Health', 'Salud'],
  ['HL', 'Hecla Mining', 'Minería'],
  ['HUT', 'Hut 8', 'Finanzas'],
  ['MO', 'Altria', 'Consumo'],
  ['PAAS', 'Pan American Silver', 'Minería'],
  ['PATH', 'UiPath', 'Tecnología'],
  ['PLTR', 'Palantir', 'Tecnología'],
  ['RBLX', 'Roblox', 'Tecnología'],
  ['SCCO', 'Southern Copper', 'Minería'],
  ['SDA', 'SunCar Technology', 'Consumo'],
  ['SNDK', 'Sandisk', 'Tecnología'],
  ['SPCX', 'SpaceX', 'Industria'],
  ['XP', 'XP Inc.', 'Finanzas'],
];

// País de la empresa detrás de cada CEDEAR. Casi todos son de Estados Unidos: acá van las excepciones.
// (País donde está el negocio, no donde cotiza: MercadoLibre cotiza en Nueva York pero es argentina.)
const OTHER_COUNTRIES: Record<string, string> = {
  ADGO: 'Argentina', BIOX: 'Argentina', GLOB: 'Argentina', MELI: 'Argentina', SATL: 'Argentina', VIST: 'Argentina',
  BBD: 'Brasil', EWZ: 'Brasil', ITUB: 'Brasil', NU: 'Brasil', PAGS: 'Brasil', PBR: 'Brasil', VALE: 'Brasil', XP: 'Brasil',
  BABA: 'China', BIDU: 'China', SDA: 'China',
  ARM: 'Reino Unido', AZN: 'Reino Unido', RIO: 'Reino Unido',
  B: 'Canadá', PAAS: 'Canadá', SHOP: 'Canadá',
  ACN: 'Irlanda', HMY: 'Sudáfrica', SPOT: 'Suecia', TSM: 'Taiwán',
  // Fondos que no son de un solo país: mercados emergentes, oro y plata
  EEM: 'Varios países', GLD: 'Varios países', SLV: 'Varios países',
};

export const CATALOG: CatalogItem[] = [
  ...ACCIONES.map(([ticker, name, sector]) => ({ ticker, name, sector, type: 'ACCION' as const, country: 'Argentina' })),
  ...[...CEDEARS, ...MAS_CEDEARS].map(([ticker, name, sector]) => ({
    ticker,
    name,
    sector,
    type: 'CEDEAR' as const,
    country: OTHER_COUNTRIES[ticker] ?? 'Estados Unidos',
  })),
];

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function searchCatalog(query: string, limit = 10): CatalogItem[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored = CATALOG.map((item) => {
    const t = item.ticker.toLowerCase();
    const n = fold(item.name);
    let score = -1;
    if (t === q) score = 0;
    else if (t.startsWith(q)) score = 1;
    else if (n.startsWith(q)) score = 2;
    else if (n.split(/\s+/).some((w) => w.startsWith(q))) score = 3;
    else if (n.includes(q) || t.includes(q)) score = 4;
    return { item, score };
  }).filter((s) => s.score >= 0);
  scored.sort((a, b) => a.score - b.score || a.item.ticker.localeCompare(b.item.ticker));
  return scored.slice(0, limit).map((s) => s.item);
}
