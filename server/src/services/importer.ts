// Importación de operaciones desde un archivo CSV (exportado de un broker o de Excel).
//
// Reconoce columnas por nombre aunque varíen entre brokers: "Fecha", "Fecha Concertación",
// "Especie", "Símbolo", "Ticker", "Cantidad", "Nominales", "Precio", "Comisión", "Arancel"…
// Acepta números con formato argentino (1.234,56) o internacional (1234.56)
// y fechas dd/mm/aaaa, aaaa-mm-dd o números de fecha de Excel (45973).
//
// Formato Bull Market ("Cuenta Corriente"): columnas Liquida, Operado, Comprobante,
// Cantidad (negativa en ventas), Especie, Precio (ya incluye gastos) e Importe.
// Las filas de plata (Recibo de cobro, Orden de pago) se ignoran.
//
// Formato InvertirOnline ("Movimientos históricos", un .xls que en realidad es una tabla HTML):
// el ticker viene dentro del tipo ("Compra(GGAL)"), la comisión está en tres columnas
// (Comis., Iva Com., Otros Imp.) y hay una cuenta en pesos y otra en dólares.
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
  /** Si la fila no es una operación (por ejemplo, un depósito), por qué se ignora. */
  ignored: string | null;
  /** El precio está en dólares y hay que pasarlo a pesos con el MEP de ese día. */
  priceInUsd?: boolean;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Convierte la primera tabla de una página HTML en texto separado por ";". */
export function htmlTableToCsv(html: string): string {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '';
  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  return rows
    .map((tr) =>
      (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? [])
        .map((td) => decodeEntities(td.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
        .map((cell) => (/[;"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(';'),
    )
    .filter((line) => line.replace(/;/g, '').trim())
    .join('\n');
}

// En orden de preferencia: si hay fecha de operación y de liquidación, gana la de operación
const COLUMNS: Record<string, string[]> = {
  date: ['fecha concertacion', 'concertacion', 'operado', 'fecha operado', 'fecha operacion', 'fecha', 'date', 'fecha liquidacion', 'liquida', 'liquidacion'],
  type: ['tipo', 'operacion', 'tipo operacion', 'tipo de operacion', 'comprobante', 'tipo de comprobante', 'movimiento', 'type', 'side'],
  ticker: ['ticker', 'especie', 'simbolo', 'activo', 'instrumento', 'symbol', 'codigo'],
  quantity: ['cantidad', 'nominales', 'cant', 'cantidad nominal', 'quantity', 'qty'],
  price: ['precio', 'precio unitario', 'cotizacion', 'precio promedio', 'price'],
  fees: ['comision', 'comisiones', 'arancel', 'aranceles', 'gastos', 'derechos', 'fees', 'iva comision'],
  note: ['nota', 'notas', 'justificacion', 'comentario', 'observaciones', 'note'],
  amount: ['importe', 'monto', 'importe neto', 'neto', 'total', 'amount'],
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
  const t = raw.trim();
  // Excel guarda las fechas como días desde el 30/12/1899 (45973 = 12/11/2025)
  if (/^\d{5}(\.0+)?$/.test(t)) {
    const n = Number(t);
    if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  const s = t.slice(0, 10);
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
  if (/<table/i.test(text)) text = htmlTableToCsv(text);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], columns: {}, error: 'El archivo está vacío o solo tiene encabezados' };

  const header = lines[0];
  const sep = [';', ',', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const headers = splitLine(header, sep).map(normalize);

  if (headers.includes('tipo mov') && headers.includes('tipo cuenta')) {
    const columns = Object.fromEntries(splitLine(header, sep).map((h) => [normalize(h), h]));
    return { rows: parseIol(headers, lines.slice(1), sep), columns };
  }

  const index: Record<string, number> = {};
  const columns: Record<string, string | null> = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    const exact = names.map((n) => headers.indexOf(n)).find((i) => i >= 0) ?? -1;
    const j = exact >= 0 ? exact : headers.findIndex((h) => names.some((n) => h.startsWith(n)));
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
    const base = { line: i + 2, fees: 0, note: null, errors, ignored: null };

    const type = parseType(cell('type'));
    const tickerCell = (cell('ticker') ?? '').trim();
    const amount = parseNumber(cell('amount'));

    // Movimientos de plata: no tienen especie ni son compra, venta o dividendo
    if (!type && !tickerCell) {
      const what = cell('type') || 'Movimiento';
      return { ...base, date: parseDate(cell('date')), type: null, ticker: null, quantity: null, price: null, ignored: `${what}: entrada o salida de plata, no es una operación` };
    }

    // Dividendos que el broker informa solo como un monto total
    let qCell = parseNumber(cell('quantity'));
    let pCell = parseNumber(cell('price'));
    if (type === 'DIVIDENDO' && !qCell) {
      if (!amount || amount <= 0) {
        return {
          ...base,
          date: parseDate(cell('date')),
          type,
          ticker: tickerCell.toUpperCase() || null,
          quantity: null,
          price: null,
          ignored: 'Gasto o retención cobrada sobre un dividendo',
        };
      }
      qCell = 1;
      pCell = amount;
    }

    const date = parseDate(cell('date'));
    if (!date) errors.push('fecha inválida');
    if (!type) errors.push('tipo desconocido (usá Compra, Venta o Dividendo)');
    const tickerRaw = tickerCell.toUpperCase().replace(/\.BA$/, '').trim();
    const ticker = /^[A-Z0-9]{1,10}$/.test(tickerRaw) ? tickerRaw : null;
    if (!ticker) errors.push('ticker inválido');
    const quantity = qCell != null ? Math.abs(qCell) : null;
    if (!quantity) errors.push('cantidad inválida');
    const price = pCell != null ? Math.abs(pCell) : null;
    if (!price) errors.push('precio inválido');
    const fees = Math.abs(parseNumber(cell('fees')) ?? 0);

    return { ...base, date, type, ticker, quantity, price, fees, note: cell('note')?.trim() || null };
  });

  return { rows, columns };
}

// Bonos argentinos (AL30, GD35, AE38D, TX26, TZX26, S31O5, BOPREAL BPOC7…): la app no los maneja
const BOND = /^((AL|GD|AE|AN|GE|BP|TX)\d{2}[DC]?|TZX\w+|S\d{2}[A-Z]\d[DC]?|BPO[A-Z]\d[DC]?)$/;

/** Formato InvertirOnline: ver el comentario al principio del archivo. */
function parseIol(headers: string[], lines: string[], sep: string): ParsedRow[] {
  const col = {
    type: headers.indexOf('tipo mov'),
    date: headers.indexOf('concert'),
    quantity: headers.indexOf('cant titulos'),
    price: headers.indexOf('precio'),
    fees: ['comis', 'iva com', 'otros imp'].map((h) => headers.indexOf(h)),
    amount: headers.indexOf('monto'),
    account: headers.indexOf('tipo cuenta'),
  };
  // Gastos en pesos que IOL cobra aparte por un dividendo pagado en dólares (misma fecha y ticker)
  const usdDividendFees = new Map<string, { fees: number; rows: ParsedRow[] }>();
  const usdDividends: ParsedRow[] = [];

  const rows = lines.map((line, i): ParsedRow | null => {
    const cells = splitLine(line, sep);
    const typeText = cells[col.type] ?? '';
    if (normalize(typeText) === 'tipo mov') return null; // encabezado repetido
    const m = typeText.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const kind = normalize(m ? m[1] : typeText);
    const ticker = m ? m[2].replace(/US\$/i, '').trim().toUpperCase() : null;
    const inUsd = normalize(cells[col.account] ?? '').includes('dolar');
    const date = parseDate(cells[col.date]);
    const fees = col.fees.reduce((sum, j) => sum + Math.abs(parseNumber(cells[j]) ?? 0), 0);
    const amount = parseNumber(cells[col.amount]) ?? 0;
    const base: ParsedRow = { line: i + 2, date, type: null, ticker, quantity: null, price: null, fees: 0, note: null, errors: [], ignored: null };
    const ignore = (why: string): ParsedRow => ({ ...base, ignored: why });

    if (!ticker) return ignore(`${typeText}: entrada o salida de plata, no es una operación`);
    if (kind.startsWith('transferencia')) return ignore('Transferencia de títulos entre cuentas');
    if (kind.includes('fci')) return ignore('Fondo común de inversión: la app maneja acciones y CEDEARs');
    if (BOND.test(ticker) || kind.includes('renta') || kind.includes('amortiz')) return ignore('Bono: la app maneja acciones y CEDEARs');

    if (kind.startsWith('compra') || kind.startsWith('venta')) {
      if (inUsd) return ignore('Operación en dólares: la app registra compras y ventas en pesos');
      const quantity = Math.abs(parseNumber(cells[col.quantity]) ?? 0);
      const price = Math.abs(parseNumber(cells[col.price]) ?? 0);
      const row: ParsedRow = { ...base, type: kind.startsWith('compra') ? 'COMPRA' : 'VENTA', quantity, price, fees };
      if (!date) row.errors.push('fecha inválida');
      if (!/^[A-Z0-9]{1,10}$/.test(ticker)) row.errors.push('ticker inválido');
      if (!quantity) row.errors.push('cantidad inválida');
      if (!price) row.errors.push('precio inválido');
      return row;
    }

    if (kind.includes('dividend')) {
      const key = `${date}|${ticker}`;
      if (amount <= 0) {
        // Comisión e IVA de un dividendo: se descuentan del dividendo en dólares del mismo día
        const row = ignore('Gasto o retención cobrada sobre un dividendo');
        const entry = usdDividendFees.get(key) ?? { fees: 0, rows: [] };
        entry.fees += Math.abs(amount);
        entry.rows.push(row);
        usdDividendFees.set(key, entry);
        return row;
      }
      // Monto ya es neto: el precio es el bruto y las comisiones se restan aparte
      const row: ParsedRow = { ...base, type: 'DIVIDENDO', quantity: 1, price: amount + fees, fees };
      if (inUsd) {
        row.priceInUsd = true;
        row.note = `Dividendo en dólares: US$ ${amount}`;
        usdDividends.push(row);
      }
      return row;
    }

    return { ...base, errors: [`tipo desconocido: ${typeText}`] };
  });

  for (const row of usdDividends) {
    const entry = usdDividendFees.get(`${row.date}|${row.ticker}`);
    if (!entry) continue;
    row.fees += entry.fees; // en pesos: se suman al dividendo ya convertido
    for (const r of entry.rows) r.ignored = `Gastos del dividendo en dólares de ${row.ticker}: se descuentan de ese dividendo`;
  }
  return rows.filter((r): r is ParsedRow => r !== null);
}

export const CSV_TEMPLATE =`Fecha;Tipo;Ticker;Cantidad;Precio;Comision;Nota
20/05/2026;Compra;MELI;7;20.000,00;500;Resultados trimestrales
14/07/2026;Venta;MELI;3;24.000,00;0;Despidos masivos
10/02/2026;Compra;GGAL;15;7.745;0;
`;
