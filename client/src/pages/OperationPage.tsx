import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Operation, type OperationType } from '../api';
import { DATA_KEYS, useJournal, useOperation } from '../hooks';
import { useSettings } from '../settings';
import { FX_LABEL, date, money, num, pct, tone } from '../format';
import { Button, ErrorBox, Field, Loading, inputCls } from '../components/ui';
import { HorizonList, VerdictBadge, explainVerdict, lacksPrices } from '../components/Verdict';
import { OperationPhotos } from '../components/OperationPhotos';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 sm:block sm:border-0 sm:py-0">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <div className="tabular text-base sm:mt-1">{children}</div>
    </div>
  );
}

const TYPE_STYLE: Record<OperationType, string> = { COMPRA: 'text-up', VENTA: 'text-down', DIVIDENDO: 'text-link' };

/** Justificación de la operación: se puede agregar o cambiar en cualquier momento (también en las importadas). */
function Note({ op }: { op: Operation }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(op.note_title ?? '');
  const [body, setBody] = useState(op.note_body ?? '');
  const [link, setLink] = useState(op.note_link ?? '');
  const hasNote = Boolean(op.note_title || op.note_body || op.note_link);

  const save = useMutation({
    mutationFn: () => api.updateNote(op.id, { note_title: title, note_body: body, note_link: link }),
    onSuccess: () => {
      setEditing(false);
      DATA_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    },
  });

  if (editing) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 className="text-lg font-medium">Justificación</h2>
        <Field label="Título" hint="Por ejemplo: «Compro porque bajó después de los resultados»">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} maxLength={120} autoFocus />
        </Field>
        <Field label="Por qué la hiciste">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className={`${inputCls} min-h-28`} maxLength={5000} />
        </Field>
        <Field label="Link (noticia, análisis…)">
          <input value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} placeholder="https://" maxLength={500} />
        </Field>
        <ErrorBox error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button type="button" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-medium">{op.note_title ?? (hasNote ? 'Justificación' : 'Sin justificación')}</h2>
        <Button onClick={() => setEditing(true)} className="shrink-0 text-xs">
          {hasNote ? 'Editar' : 'Agregar justificación'}
        </Button>
      </div>
      {op.note_body ? (
        <p className="whitespace-pre-line text-sm leading-relaxed text-text/85">{op.note_body}</p>
      ) : (
        !hasNote && (
          <p className="text-sm text-muted">
            Anotá por qué hiciste esta operación. Con el tiempo, el Diario de decisiones te muestra si tus motivos funcionaron.
          </p>
        )
      )}
      {op.note_link && (
        <a href={op.note_link} target="_blank" rel="noreferrer" className="break-all text-sm text-link hover:underline">
          {op.note_link}
        </a>
      )}
    </section>
  );
}

export function OperationPage() {
  const { id = '' } = useParams();
  const { currency, fxKind } = useSettings();
  const { data, isLoading, error } = useOperation(Number(id));
  const journal = useJournal();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.deleteOperation(Number(id)),
    onSuccess: () => {
      DATA_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      navigate(`/activo/${data?.asset.ticker}`, { replace: true });
    },
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const op = data.operation;
  const isDividend = op.type === 'DIVIDENDO';
  const entry = journal.data?.entries.find((e) => e.id === op.id);

  return (
    <div className="flex flex-col gap-8">
      {/* El título dice qué operación es: "Venta de AAPL", y de qué día */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-2xl text-muted hover:text-text" aria-label="Volver">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            <span className={TYPE_STYLE[op.type]}>{{ COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo' }[op.type]}</span>{' '}
            de{' '}
            <Link to={`/activo/${data.asset.ticker}`} className="hover:underline">
              {data.asset.ticker}
            </Link>
          </h1>
          <p className="truncate text-sm text-muted">
            {date(op.date)} · {data.asset.name}
          </p>
        </div>
      </div>

      <section className="grid gap-6 px-1 sm:grid-cols-2 lg:grid-cols-4">
        <Row label={isDividend ? 'Acciones' : 'Cantidad'}>{num(op.quantity)}</Row>
        <Row label={isDividend ? 'Dividendo por acción' : 'Precio unitario'}>
          {money(op.priceConv, currency)}
        </Row>
        <Row label={isDividend ? 'Retenciones' : 'Comisiones'}>{money(op.feesConv, currency)}</Row>
        <Row label={op.type === 'COMPRA' ? 'Monto total pagado' : 'Monto cobrado (neto)'}>
          <span className="font-semibold">{money(op.totalConv, currency)}</span>
        </Row>
        {op.type === 'VENTA' && op.realized != null && (
          <Row label="Resultado de la venta">
            <span className={tone(op.realized)}>
              {money(op.realized, currency, true)}
              {op.realizedPct != null && <span className="ml-1.5 text-sm">({pct(op.realizedPct)})</span>}
            </span>
          </Row>
        )}
        {op.fxRate != null && <Row label={`Dólar ${FX_LABEL[fxKind]} ese día`}>{money(op.fxRate, 'ARS')}</Row>}
        {currency === 'USD' && <Row label="Precio cargado (ARS)">{money(op.price, 'ARS')}</Row>}
      </section>

      {op.splitFactor && op.splitFactor !== 1 && (
        <p className="rounded-lg bg-panel px-4 py-3 text-sm text-muted">
          Ajustada por un cambio de ratio posterior (×{op.splitFactor}): la cargaste como {num(op.quantity / op.splitFactor)} a{' '}
          {money(op.price * op.splitFactor, 'ARS')}. El monto total no cambia.
        </p>
      )}

      {entry && (
        <section className="flex flex-col gap-2 rounded-xl bg-panel p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">¿Acertaste?</h2>
            <VerdictBadge verdict={entry.verdict} days={entry.verdictDays} noData={lacksPrices(entry)} />
          </div>
          <p className="text-sm text-muted">{explainVerdict(entry)}</p>
          <HorizonList entry={entry} />
        </section>
      )}

      {!isDividend && (
        <>
          <hr className="border-line" />
          <Note key={op.id} op={op} />
        </>
      )}

      <hr className="border-line" />
      <OperationPhotos operationId={op.id} images={data.images} />

      <ErrorBox error={remove.error} />
      <div>
        <Button variant="danger" disabled={remove.isPending} onClick={() => window.confirm('¿Borrar esta operación?') && remove.mutate()}>
          Borrar operación
        </Button>
      </div>
    </div>
  );
}
