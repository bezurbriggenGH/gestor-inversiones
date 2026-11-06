// Importación de operaciones desde un archivo CSV (exportado de un broker o de Excel).
//
// Reconoce columnas por nombre aunque varíen entre brokers: "Fecha", "Fecha Concertación",
// "Especie", "Símbolo", "Ticker", "Cantidad", "Nominales", "Precio", "Comisión", "Arancel"…
// Acepta números con formato argentino (1.234,56) o internacional (1234.56)
// y fechas dd/mm/aaaa o aaaa-mm-dd.
import type { OpType } from './portfolio.ts';

export interface ParsedRow {
  line: number;
  date: string | null;
  type: OpType | null;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  fees: number;
  note: string | null;
  errors: string[];
}

const COLUMNS: Record<string, string[]> = {
  date: ['fecha', 'fecha concertacion', 'fecha operacion', 'fecha liquidacion', 'date'],
  type: ['tipo', 'operacion', 'tipo operacion', 'tipo de operacion', 'movimiento', 'type', 'side'],
  ticker: ['ticker', 'especie', 'simbolo', 'activo', 'instrumento', 'symbol', 'codigo'],
  quantity: ['cantidad', 'nominales', 'cant', 'cantidad nominal', 'quantity', 'qty'],
  price: ['precio', 'precio unitario', 'cotizacion', 'precio promedio', 'price'],
  fees: ['comision', 'comisiones', 'arancel', 'aranceles', 'gastos', 'derechos', 'fees', 'iva comision'],
  note: ['nota', 'notas', 'justificacion', 'comentario', 'observaciones', 'note'],
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "1.234,56" → 1234.56 · "1234.56" → 1234.56 · "12.000" → 12000 · "$ 3,5" → 3.5 */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().slice(0, 10);
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function parseType(raw: string | undefined): OpType | null {
  const s = normalize(raw ?? '');
  if (s.includes('divid') || s.includes('renta') || s === 'div') return 'DIVIDENDO';
  if (s.includes('compra') || ['c', 'buy', 'b'].includes(s) || s.startsWith('suscrip')) return 'COMPRA';
  if (s.includes('venta') || ['v', 'sell', 's'].includes(s) || s.startsWith('rescate')) return 'VENTA';
  return null;
}

export function parseCsv(text: string): { rows: ParsedRow[]; columns: Record<string, string | null>; error?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], columns: {}, error: 'El archivo está vacío o solo tiene encabezados' };

  const header = lines[0];
  const sep = [';', ',', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const headers = splitLine(header, sep).map(normalize);

  const index: Record<string, number> = {};
  const columns: Record<string, string | null> = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    const i = headers.findIndex((h) => names.includes(h));
    const j = i >= 0 ? i : headers.findIndex((h) => names.some((n) => h.startsWith(n)));
    index[key] = j;
    columns[key] = j >= 0 ? splitLine(header, sep)[j] : null;
  }
  const missing = ['date', 'type', 'ticker', 'quantity', 'price'].filter((k) => index[k] < 0);
  if (missing.length) {
    const names = { date: 'Fecha', type: 'Tipo', ticker: 'Ticker', quantity: 'Cantidad', price: 'Precio' } as Record<string, string>;
    return { rows: [], columns, error: `No encontramos las columnas: ${missing.map((m) => names[m]).join(', ')}` };
  }

  const rows = lines.slice(1).map((line, i): ParsedRow => {
    const cells = splitLine(line, sep);
    const cell = (k: string) => (index[k] >= 0 ? cells[index[k]] : undefined);
    const errors: string[] = [];

    const date = parseDate(cell('date'));
    if (!date) errors.push('fecha inválida');
    const type = parseType(cell('type'));
    if (!type) errors.push('tipo desconocido (usá Compra, Venta o Dividendo)');
    const tickerRaw = (cell('ticker') ?? '').toUpperCase().replace(/\.BA$/, '').trim();
    const ticker = /^[A-Z0-9]{1,10}$/.test(tickerRaw) ? tickerRaw : null;
    if (!ticker) errors.push('ticker inválido');
    const q = parseNumber(cell('quantity'));
    const quantity = q != null ? Math.abs(q) : null;
    if (!quantity) errors.push('cantidad inválida');
    const p = parseNumber(cell('price'));
    const price = p != null ? Math.abs(p) : null;
    if (!price) errors.push('precio inválido');
    const fees = Math.abs(parseNumber(cell('fees')) ?? 0);

    return { line: i + 2, date, type, ticker, quantity, price, fees, note: cell('note')?.trim() || null, errors };
  });

  return { rows, columns };
}

export const CSV_TEMPLATE = `Fecha;Tipo;Ticker;Cantidad;Precio;Comision;Nota
20/05/2026;Compra;MELI;7;20.000,00;500;Resultados trimestrales
14/07/2026;Venta;MELI;3;24.000,00;0;Despidos masivos
10/02/2026;Compra;GGAL;15;7.745;0;
`;
