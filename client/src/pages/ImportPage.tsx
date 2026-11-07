import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ImportResult } from '../api';
import { DATA_KEYS } from '../hooks';
import { date, money, num } from '../format';
import { Button, ErrorBox } from '../components/ui';
import { xlsxToCsv } from '../xlsx';

/** Lee el archivo como UTF-8; si trae caracteres rotos (Excel en Windows), prueba Windows-1252. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

const STATUS = {
  ok: { label: 'Se importa', cls: 'text-up' },
  duplicada: { label: 'Ya estaba cargada', cls: 'text-muted' },
  error: { label: 'Con error', cls: 'text-down' },
  ignorada: { label: 'Se ignora', cls: 'text-muted' },
};

export function ImportPage() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const check = useMutation({
    mutationFn: (text: string) => api.importCsv(text, false),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: () => api.importCsv(csv, true),
    onSuccess: () => {
      DATA_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      navigate('/');
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = /\.xlsx$/i.test(file.name) ? await xlsxToCsv(await file.arrayBuffer()) : await readText(file);
    } catch (err) {
      check.reset();
      setPreview(null);
      setFileName(file.name);
      window.alert(err instanceof Error ? err.message : 'No se pudo leer el archivo');
      return;
    }
    setFileName(file.name);
    setCsv(text);
    setPreview(null);
    check.mutate(text);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Importar operaciones</h1>
        <p className="mt-1 text-sm text-muted">
          Subí el Excel (.xlsx) o CSV que exporta tu broker. Bull Market: descargá la <b>Cuenta Corriente</b> y subila tal cual. Reconocemos columnas como <b>Fecha</b>, <b>Tipo/Operación</b>,{' '}
          <b>Ticker/Especie</b>, <b>Cantidad</b>, <b>Precio</b> y <b>Comisión</b>, con números en formato argentino (1.234,56) o con punto.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-panel p-5 sm:flex-row sm:items-center">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
          className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line px-4 py-8 text-center transition hover:border-muted">
          <span className="text-sm">{fileName || 'Elegí un archivo .xlsx o .csv'}</span>
          <span className="text-xs text-muted">o arrastralo acá</span>
          <input type="file" accept=".xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div className="flex flex-col gap-2 text-sm">
          <a href="/api/import/template" className="text-link hover:underline">
            Descargar plantilla de ejemplo
          </a>
          <p className="max-w-64 text-xs text-muted">
            En Excel: completá la plantilla y guardala como "CSV (delimitado por comas)". Desde tu broker, buscá "Exportar movimientos".
          </p>
        </div>
      </section>

      <ErrorBox error={check.error ?? commit.error} />
      {check.isPending && <p className="animate-pulse text-sm text-muted">Revisando el archivo y buscando cada ticker en BYMA…</p>}

      {preview && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <b className="text-up">{preview.summary.ok}</b> para importar
            </span>
            <span>
              <b className="text-muted">{preview.summary.duplicates}</b> repetidas
            </span>
            <span>
              <b className="text-down">{preview.summary.errors}</b> con errores
            </span>
            {preview.summary.ignored > 0 && (
              <span title="Depósitos, retiros y otros movimientos que no son compras ni ventas">
                <b className="text-muted">{preview.summary.ignored}</b> movimientos de plata
              </span>
            )}
            <Button variant="primary" className="ml-auto" disabled={!preview.summary.ok || commit.isPending} onClick={() => commit.mutate()}>
              {commit.isPending ? 'Importando…' : `Importar ${preview.summary.ok} operaciones`}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl bg-panel">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  {['Línea', 'Fecha', 'Tipo', 'Ticker', 'Cantidad', 'Precio', 'Comisión', 'Estado'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-b border-line/40 last:border-0">
                    <td className="px-4 py-2 text-muted">{r.line}</td>
                    <td className="px-4 py-2">{r.date ? date(r.date) : '—'}</td>
                    <td className="px-4 py-2">{r.type ?? '—'}</td>
                    <td className="px-4 py-2 font-medium">{r.ticker ?? '—'}</td>
                    <td className="px-4 py-2">{r.quantity != null ? num(r.quantity) : '—'}</td>
                    <td className="px-4 py-2">{r.price != null ? money(r.price, 'ARS') : '—'}</td>
                    <td className="px-4 py-2">{money(r.fees, 'ARS')}</td>
                    <td className={`px-4 py-2 ${STATUS[r.status].cls}`}>
                      {STATUS[r.status].label}
                      {r.errors.length > 0 && <span className="block text-xs">{r.errors.join(' · ')}</span>}
                      {r.ignored && <span className="block text-xs">{r.ignored}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
