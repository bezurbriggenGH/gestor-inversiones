// Lector mínimo de Excel (.xlsx) sin librerías externas.
//
// Un .xlsx es un zip con archivos XML adentro. Se descomprime con la API nativa del
// navegador (DecompressionStream), se lee la primera hoja y se convierte a texto
// separado por ";" para usar el mismo importador que los CSV.

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Devuelve los archivos del zip como texto, por nombre. */
async function unzip(buf: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // Fin del directorio central: firma 0x06054b50, buscando desde el final
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo no parece un Excel (.xlsx) válido');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder('utf-8');

  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (!name.endsWith('.xml')) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(start, start + compSize);
    const raw = method === 0 ? data : method === 8 ? await inflate(data) : null;
    if (raw) files.set(name, decoder.decode(raw));
  }
  return files;
}

/** "AB" → 27 (columna base 0) */
function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Los números se escriben con 8 decimales (1.5 → "1.50000000") para que el importador
 * no los confunda con separadores de miles ("1.500" podría ser mil quinientos).
 */
function formatNumber(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(8) : v;
}

export async function xlsxToCsv(buf: ArrayBuffer): Promise<string> {
  const files = await unzip(buf);
  const parser = new DOMParser();
  const xml = (name: string) => {
    const text = files.get(name);
    return text ? parser.parseFromString(text, 'application/xml') : null;
  };

  const shared = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [])].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
  );

  const sheetName = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const sheet = sheetName ? xml(sheetName) : null;
  if (!sheet) throw new Error('El Excel no tiene hojas con datos');

  const lines: string[] = [];
  for (const row of [...sheet.getElementsByTagName('row')]) {
    const cells: string[] = [];
    for (const c of [...row.getElementsByTagName('c')]) {
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
      else if (type === 'str' || type === 'b' || type === 'e') value = v;
      else value = v === '' ? '' : formatNumber(v);
      const i = colIndex(c.getAttribute('r') ?? '');
      while (cells.length < i) cells.push('');
      cells[i >= 0 ? i : cells.length] = value;
    }
    if (cells.some((x) => x.trim())) {
      lines.push(cells.map((x) => (/[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(';'));
    }
  }
  return lines.join('\n');
}
