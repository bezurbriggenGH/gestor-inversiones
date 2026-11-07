import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type OperationType } from '../api';
import { DATA_KEYS, useJournal, useOperation } from '../hooks';
import { useSettings } from '../settings';
import { FX_LABEL, date, money, num, tone } from '../format';
import { Button, ErrorBox, Loading } from '../components/ui';
import { HorizonList, VerdictBadge, explainVerdict } from '../components/Verdict';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 sm:block sm:border-0 sm:py-0">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <div className="tabular text-base sm:mt-1">{children}</div>
    </div>
  );
}

const TYPE_STYLE: Record<OperationType, string> = { COMPRA: 'text-up', VENTA: 'text-down', DIVIDENDO: 'text-link' };

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
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-2xl text-muted hover:text-text" aria-label="Volver">
          ←
        </button>
        <h1 className="flex-1 rounded-md bg-card py-1.5 text-center text-sm">Historial · {data.asset.ticker}</h1>
      </div>

      <section className="grid gap-6 px-1 sm:grid-cols-2 lg:grid-cols-4">
        <Row label="Fecha">{date(op.date)}</Row>
        <Row label="Tipo de operación">
          <span className={TYPE_STYLE[op.type]}>{{ COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo' }[op.type]}</span>
        </Row>
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
            <span className={tone(op.realized)}>{money(op.realized, currency, true)}</span>
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
            <VerdictBadge verdict={entry.verdict} days={entry.verdictDays} />
          </div>
          <p className="text-sm text-muted">{explainVerdict(entry)}</p>
          <HorizonList entry={entry} />
        </section>
      )}

      {!isDividend && (
        <>
          <hr className="border-line" />
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">{op.note_title ?? 'Sin justificación'}</h2>
            {op.note_body ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-text/85">{op.note_body}</p>
            ) : (
              !op.note_title && <p className="text-sm text-muted">No dejaste notas sobre esta operación.</p>
            )}
            {op.note_link && (
              <a href={op.note_link} target="_blank" rel="noreferrer" className="break-all text-sm text-link hover:underline">
                {op.note_link}
              </a>
            )}
          </section>
        </>
      )}

      <ErrorBox error={remove.error} />
      <div>
        <Button variant="danger" disabled={remove.isPending} onClick={() => window.confirm('¿Borrar esta operación?') && remove.mutate()}>
          Borrar operación
        </Button>
      </div>
    </div>
  );
}
