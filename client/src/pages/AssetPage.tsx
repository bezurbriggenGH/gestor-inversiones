import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { OperationType, PendingDividend } from '../api';
import { useAsset } from '../hooks';
import { useSettings } from '../settings';
import { date, money, num, pct, tone } from '../format';
import { PriceChart } from '../components/PriceChart';
import { OperationForm, type OperationPrefill } from '../components/OperationForm';
import { AlertForm } from '../components/AlertForm';
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

const DOT: Record<OperationType, string> = { COMPRA: 'bg-up', VENTA: 'bg-down', DIVIDENDO: 'bg-link' };
const LABEL: Record<OperationType, string> = { COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo' };

function PendingDividends({ items, onRegister }: { items: PendingDividend[]; onRegister: (d: PendingDividend) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(-3);
  return (
    <section className="rounded-xl border border-link/30 bg-link/5 p-5">
      <p className="text-sm">
        <span className="font-medium text-link">Encontramos {items.length} dividendo{items.length > 1 ? 's' : ''} sin registrar</span>{' '}
        <span className="text-muted">que este activo pagó mientras lo tenías. Revisá el monto real en tu broker antes de confirmarlo.</span>
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {shown
          .slice()
          .reverse()
          .map((d) => (
            <li key={d.date} className="tabular flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-bg px-4 py-2 text-sm">
              <span className="text-muted">{date(d.date)}</span>
              <span>
                {num(d.quantity)} × {money(d.amountPerShare, 'ARS')}
              </span>
              <span className="text-muted">
                ≈ {money(d.gross - d.withholding, 'ARS')} neto ({Math.round(d.withholdingRate * 100)}% retención)
              </span>
              <button onClick={() => onRegister(d)} className="ml-auto text-xs text-link hover:underline">
                Registrar
              </button>
            </li>
          ))}
      </ul>
      {items.length > 3 && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-2 text-xs text-muted hover:text-text">
          {expanded ? 'Ver menos' : `Ver los ${items.length}`}
        </button>
      )}
    </section>
  );
}

export function AssetPage() {
  const { ticker = '' } = useParams();
  const { currency } = useSettings();
  const { data, isLoading, error } = useAsset(ticker);
  const [form, setForm] = useState<{ type: OperationType; prefill?: OperationPrefill } | null>(null);
  const [alerting, setAlerting] = useState(false);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const { asset, position: p, operations } = data;
  const tradeOps = operations.filter((o) => o.type !== 'DIVIDENDO');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-2xl text-muted hover:text-text" aria-label="Volver">
          ←
        </Link>
        <h1 className="flex-1 text-xl font-semibold">{asset.name}</h1>
        <Button onClick={() => setAlerting(true)} className="text-xs">
          🔔 Crear alerta
        </Button>
      </div>

      <PriceChart series={data.series} operations={tradeOps} currency={currency} />

      <PendingDividends
        items={data.pendingDividends}
        onRegister={(d) =>
          setForm({ type: 'DIVIDENDO', prefill: { date: d.date, quantity: d.quantity, price: d.amountPerShare, fees: d.withholding } })
        }
      />

      <section className="grid gap-4 rounded-xl bg-panel p-5 sm:grid-cols-[auto_1fr]">
        <div className="flex min-w-40 flex-col items-center justify-center rounded-lg bg-card px-6 py-4 text-center">
          <span className="text-2xl font-medium">{asset.ticker}</span>
          <span className="text-xs text-muted">{asset.type === 'ACCION' ? 'Acción argentina' : 'CEDEAR'}</span>
          <span className="mt-2 text-sm">Cant. {num(p.quantity)}</span>
          <span className="tabular text-sm">{money(p.price, currency)}</span>
        </div>

        <div className="flex flex-col justify-center gap-3 sm:max-w-56">
          <Button onClick={() => setForm({ type: 'COMPRA' })} className="min-w-44">
            Registrar compra
          </Button>
          <Button onClick={() => setForm({ type: 'VENTA' })} disabled={p.quantity <= 0} className="min-w-44">
            Registrar venta
          </Button>
          <button onClick={() => setForm({ type: 'DIVIDENDO' })} className="text-xs text-muted hover:text-text">
            + Registrar dividendo
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:col-span-2 md:grid-cols-4">
          <StatBox label="Gan/Per diaria" value={money(p.dayChange, currency, true)} sub={pct(p.dayChangePct)} cls={tone(p.dayChange)} />
          <StatBox label="Gan/Per no realizada" value={money(p.unrealized, currency, true)} sub={pct(p.unrealizedPct)} cls={tone(p.unrealized)} />
          <StatBox label="Gan/Per histórica" value={money(p.totalGain, currency, true)} sub={pct(p.totalGainPct)} cls={tone(p.totalGain)} />
          <StatBox label="Valor de la tenencia" value={money(p.marketValue, currency)} />
          <StatBox label="Precio promedio de compra" value={money(p.avgCost, currency)} sub="incluye comisiones" />
          <StatBox label="Ganancia realizada" value={money(p.realized, currency, true)} cls={tone(p.realized)} />
          <StatBox label="Dividendos cobrados" value={money(p.dividends, currency, true)} cls={tone(p.dividends)} />
          <StatBox label="Total invertido" value={money(p.invested, currency)} sub="suma de todas las compras" />
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
            <span className={`h-3.5 w-3.5 rounded-full ${DOT[op.type]}`} />
            <span>{LABEL[op.type]}</span>
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

      {form && (
        <OperationForm ticker={asset.ticker} type={form.type} holding={p.quantity} prefill={form.prefill} onClose={() => setForm(null)} />
      )}
      {alerting && <AlertForm ticker={asset.ticker} onClose={() => setAlerting(false)} />}
    </div>
  );
}
