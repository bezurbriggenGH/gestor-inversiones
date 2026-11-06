import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useOperation } from '../hooks';
import { useSettings } from '../settings';
import { FX_LABEL, date, money, num, tone } from '../format';
import { Button, ErrorBox, Loading } from '../components/ui';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 sm:block sm:border-0 sm:py-0">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <div className="tabular text-base sm:mt-1">{children}</div>
    </div>
  );
}

export function OperationPage() {
  const { id = '' } = useParams();
  const { currency, fxKind } = useSettings();
  const { data, isLoading, error } = useOperation(Number(id));
  const navigate = useNavigate();
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.deleteOperation(Number(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      navigate(`/activo/${data?.asset.ticker}`, { replace: true });
    },
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const op = data.operation;
  const isSell = op.type === 'VENTA';

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-2xl text-muted hover:text-text" aria-label="Volver">
          ←
        </button>
        <h1 className="flex-1 rounded-md bg-card py-1.5 text-center text-sm">
          Historial · {data.asset.ticker}
        </h1>
      </div>

      <section className="grid gap-6 px-1 sm:grid-cols-2 lg:grid-cols-4">
        <Row label="ID">{op.id}</Row>
        <Row label="Fecha">{date(op.date)}</Row>
        <Row label="Tipo de operación">
          <span className={isSell ? 'text-down' : 'text-up'}>{isSell ? 'VENTA' : 'COMPRA'}</span>
        </Row>
        <Row label="Cantidad">{num(op.quantity)}</Row>
        <Row label="Precio unitario">
          <span className="text-up">{money(op.priceConv, currency)}</span>
        </Row>
        <Row label="Comisiones">{money(op.feesConv, currency)}</Row>
        <Row label={isSell ? 'Monto cobrado (neto)' : 'Monto total pagado'}>
          <span className="text-up">{money(op.totalConv, currency)}</span>
        </Row>
        {isSell && op.realized != null && (
          <Row label="Resultado de la venta">
            <span className={tone(op.realized)}>{money(op.realized, currency, true)}</span>
          </Row>
        )}
        {op.fxRate != null && (
          <Row label={`Dólar ${FX_LABEL[fxKind]} ese día`}>{money(op.fxRate, 'ARS')}</Row>
        )}
        {currency === 'USD' && (
          <Row label="Precio cargado (ARS)">{money(op.price, 'ARS')}</Row>
        )}
      </section>

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

      <ErrorBox error={remove.error} />
      <div>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => window.confirm('¿Borrar esta operación?') && remove.mutate()}
        >
          Borrar operación
        </Button>
      </div>
    </div>
  );
}
