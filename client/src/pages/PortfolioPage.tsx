import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Portfolio, type PortfolioPosition } from '../api';
import { usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { FX_LABEL, date, money, pct, tone } from '../format';
import { Button, ErrorBox, Loading, Triangle } from '../components/ui';
import { AddAssetDialog } from '../components/AddAssetDialog';

function Stat({ label, value, sub, valueClass = '' }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className={`tabular text-xl font-semibold ${valueClass}`}>{value}</span>
      {sub && <span className={`tabular text-sm ${valueClass}`}>{sub}</span>}
    </div>
  );
}

function Summary({ data }: { data: Portfolio }) {
  const { currency } = useSettings();
  const s = data.summary;
  return (
    <section className="grid grid-cols-2 gap-6 rounded-xl bg-panel p-6 lg:grid-cols-4">
      <Stat label="Valor actual" value={money(s.marketValue, currency)} sub={`Costo ${money(s.costBasis, currency)}`} />
      <Stat
        label="Ganancia no realizada"
        value={money(s.unrealized, currency, true)}
        sub={pct(s.unrealizedPct)}
        valueClass={tone(s.unrealized)}
      />
      <Stat
        label="Variación diaria"
        value={money(s.dayChange, currency, true)}
        sub={pct(s.dayChangePct)}
        valueClass={tone(s.dayChange)}
      />
      <Stat
        label="Ganancia realizada"
        value={money(s.realized, currency, true)}
        sub="por ventas ya hechas"
        valueClass={tone(s.realized)}
      />
      {data.fx && (
        <p className="col-span-full text-xs text-muted">
          Dólar {FX_LABEL[data.fxKind]}: {money(data.fx.rate, 'ARS')} ({date(data.fx.date)})
          {currency === 'USD' && ' · cada operación se convierte con el dólar del día en que se hizo'}
        </p>
      )}
    </section>
  );
}

function AssetCard({ p, deleting, onDelete }: { p: PortfolioPosition; deleting: boolean; onDelete: () => void }) {
  const { currency } = useSettings();
  const hasPosition = p.quantity > 0;
  return (
    <div className="relative">
      <Link
        to={`/activo/${p.ticker}`}
        className={`flex h-36 flex-col justify-between rounded-xl bg-card p-5 transition hover:bg-card-hover ${
          deleting ? 'pointer-events-none opacity-60' : ''
        }`}
      >
        <div className="text-center">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-2xl font-medium">{p.ticker}</span>
            <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] text-muted">{p.type === 'ACCION' ? 'Acción' : 'CEDEAR'}</span>
          </div>
          <div className="tabular mt-1 flex items-center justify-center gap-1 text-xs">
            <span className="text-muted">hoy</span>
            <span className={tone(p.dayChangePct)}>{pct(p.dayChangePct)}</span>
            <Triangle value={p.dayChangePct} />
          </div>
        </div>
        <div className="tabular flex items-center justify-between text-sm">
          <span className="text-muted">{hasPosition ? money(p.marketValue, currency) : 'Sin tenencia'}</span>
          {hasPosition && (
            <span className={`flex items-center gap-1 font-medium ${tone(p.unrealizedPct)}`}>
              {pct(p.unrealizedPct)} <Triangle value={p.unrealizedPct} />
            </span>
          )}
        </div>
      </Link>
      {deleting && (
        <button
          onClick={onDelete}
          className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-down text-sm font-bold text-white shadow-lg hover:scale-105"
          aria-label={`Eliminar ${p.ticker}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function PortfolioPage() {
  const { data, isLoading, error } = usePortfolio();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: api.deleteAsset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio'] }),
  });

  function confirmDelete(p: PortfolioPosition) {
    const msg = `¿Eliminar ${p.ticker}? Se borran también todas sus operaciones registradas.`;
    if (window.confirm(msg)) remove.mutate(p.ticker);
  }

  if (isLoading) return <Loading label="Actualizando precios…" />;
  if (error || !data) return <ErrorBox error={error} />;

  return (
    <div className="flex flex-col gap-8">
      <Summary data={data} />

      {data.errors.length > 0 && (
        <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          Alguna fuente de datos no respondió; se muestran los últimos precios guardados.
        </p>
      )}
      <ErrorBox error={remove.error} />

      {data.positions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center">
          <p className="text-lg">Todavía no tenés activos</p>
          <p className="mt-1 text-sm text-muted">Agregá una acción argentina (GGAL, YPFD…) o un CEDEAR (MELI, AAPL…).</p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.positions.map((p) => (
            <AssetCard key={p.ticker} p={p} deleting={deleting} onDelete={() => confirmDelete(p)} />
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-4">
        <Button onClick={() => setAdding(true)} className="min-w-44">
          Agregar activo
        </Button>
        {data.positions.length > 0 && (
          <Button onClick={() => setDeleting((d) => !d)} variant={deleting ? 'danger' : 'default'} className="min-w-44">
            {deleting ? 'Listo' : 'Eliminar activo'}
          </Button>
        )}
      </div>

      {adding && <AddAssetDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
