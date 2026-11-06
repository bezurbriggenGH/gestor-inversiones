import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { OperationType } from '../api';
import { useAsset } from '../hooks';
import { useSettings } from '../settings';
import { date, money, num, pct, tone } from '../format';
import { PriceChart } from '../components/PriceChart';
import { OperationForm } from '../components/OperationForm';
import { Button, ErrorBox, Loading } from '../components/ui';

function StatBox({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-card px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={`tabular whitespace-nowrap font-semibold ${cls}`}>{value}</span>
      {sub && <span className={`tabular text-xs ${cls}`}>{sub}</span>}
    </div>
  );
}

export function AssetPage() {
  const { ticker = '' } = useParams();
  const { currency } = useSettings();
  const { data, isLoading, error } = useAsset(ticker);
  const [form, setForm] = useState<OperationType | null>(null);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const { asset, position: p, operations } = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-2xl text-muted hover:text-text" aria-label="Volver">
          ←
        </Link>
        <h1 className="text-xl font-semibold">{asset.name}</h1>
      </div>

      <PriceChart series={data.series} operations={operations} currency={currency} />

      <section className="grid gap-4 rounded-xl bg-panel p-5 sm:grid-cols-[auto_1fr]">
        <div className="flex min-w-40 flex-col items-center justify-center rounded-lg bg-card px-6 py-4 text-center">
          <span className="text-2xl font-medium">{asset.ticker}</span>
          <span className="text-xs text-muted">{asset.type === 'ACCION' ? 'Acción argentina' : 'CEDEAR'}</span>
          <span className="mt-2 text-sm">Cant. {num(p.quantity)}</span>
          <span className="tabular text-sm">{money(p.price, currency)}</span>
        </div>

        <div className="flex flex-col justify-center gap-3 sm:max-w-56">
          <Button onClick={() => setForm('COMPRA')} className="min-w-44">
            Registrar compra
          </Button>
          <Button onClick={() => setForm('VENTA')} disabled={p.quantity <= 0} className="min-w-44">
            Registrar venta
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:col-span-2 md:grid-cols-3 xl:grid-cols-6">
          <StatBox label="Gan/Per diaria" value={money(p.dayChange, currency, true)} sub={pct(p.dayChangePct)} cls={tone(p.dayChange)} />
          <StatBox
            label="Gan/Per no realizada"
            value={money(p.unrealized, currency, true)}
            sub={pct(p.unrealizedPct)}
            cls={tone(p.unrealized)}
          />
          <StatBox label="Gan/Per histórica" value={money(p.totalGain, currency, true)} sub={pct(p.totalGainPct)} cls={tone(p.totalGain)} />
          <StatBox label="Valor de la tenencia" value={money(p.marketValue, currency)} />
          <StatBox label="Precio promedio de compra" value={money(p.avgCost, currency)} sub="incluye comisiones" />
          <StatBox label="Ganancia realizada" value={money(p.realized, currency, true)} cls={tone(p.realized)} />
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl bg-panel p-5">
        <h2 className="mb-1 rounded-md bg-card py-1.5 text-center text-sm">Historial</h2>
        {operations.length === 0 && <p className="py-4 text-center text-sm text-muted">Todavía no registraste operaciones.</p>}
        {operations.map((op) => (
          <Link
            key={op.id}
            to={`/operacion/${op.id}`}
            className="tabular grid grid-cols-[auto_1fr_1fr] items-center gap-x-4 gap-y-1 rounded-lg bg-card px-4 py-2.5 text-sm transition hover:bg-card-hover sm:grid-cols-[auto_6rem_8rem_6rem_1fr_1fr]"
          >
            <span className={`h-3.5 w-3.5 rounded-full ${op.type === 'COMPRA' ? 'bg-up' : 'bg-down'}`} />
            <span>{op.type === 'COMPRA' ? 'Compra' : 'Venta'}</span>
            <span className="text-muted">{date(op.date)}</span>
            <span>cant: {num(op.quantity)}</span>
            <span>{money(op.priceConv, currency)}</span>
            <span className="flex min-w-0 justify-between gap-2">
              <span>{money(op.totalConv, currency)}</span>
              {op.note_title && <span className="truncate text-xs text-muted">{op.note_title}</span>}
            </span>
          </Link>
        ))}
      </section>

      {form && <OperationForm ticker={asset.ticker} type={form} holding={p.quantity} onClose={() => setForm(null)} />}
    </div>
  );
}
