import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { OperationType, PendingDividend } from '../api';
import { useAsset } from '../hooks';
import { useSettings } from '../settings';
import { capitalize, date, dayLabel, money, num, pct, tone } from '../format';
import { PriceChart } from '../components/PriceChart';
import { CedearPanel } from '../components/CedearPanel';
import { AssetStats } from '../components/AssetStats';
import { OperationForm, type OperationPrefill } from '../components/OperationForm';
import { AlertForm } from '../components/AlertForm';
import { OperationHistory } from '../components/OperationHistory';
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
  // Qué compone el resultado total, solo las partes que existen
  const totalDetail = [
    p.realized ? `ventas ${money(p.realized, currency, true)}` : '',
    p.dividends ? `dividendos ${money(p.dividends, currency, true)}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || undefined;

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

      <PriceChart series={data.series} operations={tradeOps} currency={currency} avgCost={p.quantity > 0 ? p.avgCost : 0} />

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
          {p.quantity > 0 && <span className="tabular text-xs text-muted">promedio {money(p.avgCost, currency)}</span>}
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

        {p.quantity > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 md:grid-cols-4">
            <StatBox label={capitalize(dayLabel(p.priceDate))} value={money(p.dayChange, currency, true)} sub={pct(p.dayChangePct)} cls={tone(p.dayChange)} />
            <StatBox label="Valor de lo que tenés" value={money(p.marketValue, currency)} sub={`${num(p.quantity)} × ${money(p.price, currency)}`} />
            <StatBox
              label="Ganancia en lo que tenés"
              value={money(p.unrealized, currency, true)}
              sub={`${pct(p.unrealizedPct)} · te costó ${money(p.costBasis, currency)}`}
              cls={tone(p.unrealized)}
            />
            <StatBox
              label="Resultado total"
              value={money(p.totalGain, currency, true)}
              sub={totalDetail}
              cls={tone(p.totalGain)}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-card px-4 py-3 text-sm sm:col-span-2">
            {operations.length === 0 ? (
              <span className="text-muted">Todavía no registraste operaciones. Cargá tu primera compra para seguir tu resultado.</span>
            ) : (
              <>
                Ya no tenés {asset.ticker}. Resultado final de todas tus operaciones:{' '}
                <span className={`tabular font-semibold ${tone(p.totalGain)}`}>{money(p.totalGain, currency, true)}</span>
                {totalDetail && <span className="text-muted"> ({totalDetail})</span>}
              </>
            )}
          </p>
        )}
      </section>

      <AssetStats series={data.series} currency={currency} avgCost={p.quantity > 0 ? p.avgCost : 0} type={asset.type} />

      {data.cedear && <CedearPanel ticker={asset.ticker} info={data.cedear} />}

      <OperationHistory operations={operations} currency={currency} />

      {form && (
        <OperationForm ticker={asset.ticker} type={form.type} holding={p.quantity} prefill={form.prefill} onClose={() => setForm(null)} />
      )}
      {alerting && <AlertForm ticker={asset.ticker} onClose={() => setAlerting(false)} />}
    </div>
  );
}
