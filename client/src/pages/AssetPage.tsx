import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type OperationType, type PendingDividend, type Position } from '../api';
import { DATA_KEYS, useAsset } from '../hooks';
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

/**
 * Eliminar el activo, al final de su página (donde se ve todo lo que se pierde).
 * El aviso dice qué se pierde en cada caso: borrar un activo borra toda su historia.
 */
function DeleteAsset({ ticker, position: p }: { ticker: string; position: Position }) {
  const { currency } = useSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteAsset(ticker),
    onSuccess: () => {
      DATA_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      navigate('/', { replace: true });
    },
  });

  function confirmDelete() {
    const lines = [`¿Eliminar ${ticker}?`, ''];
    if (p.quantity > 0) {
      lines.push(
        `Todavía tenés ${num(p.quantity)} ${ticker} por ${money(p.marketValue, currency)}. Van a desaparecer de tu cartera, de su valor y de la evolución, aunque en el broker los sigas teniendo.`,
        '',
        'Si los vendiste, en vez de eliminar el activo registrá la venta.',
      );
    } else if (p.totalGain !== 0) {
      lines.push(
        `Ya no tenés ${ticker}, pero su resultado (${money(p.totalGain, currency, true)}) es parte de tu ganancia total y dejaría de contar.`,
        '',
        'Los activos que ya no tenés están ocultos en la cartera: no hace falta eliminarlos.',
      );
    }
    lines.push('', 'Se borran todas sus operaciones, fotos y alertas. No se puede deshacer.');
    if (window.confirm(lines.join('\n'))) remove.mutate();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-6">
      <ErrorBox error={remove.error} />
      <div>
        <Button variant="danger" onClick={confirmDelete} disabled={remove.isPending} className="text-xs">
          Eliminar {ticker} de mi cartera
        </Button>
      </div>
    </div>
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
  const tradeOps = operations.filter((o) => o.type !== 'DIVIDENDO' && !o.auto);
  // Qué compone el resultado total, solo las partes que existen
  const totalDetail = [
    p.realized ? `ventas ${money(p.realized, currency, true)}` : '',
    p.dividends ? `dividendos ${money(p.dividends, currency, true)}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado: qué activo es y qué se puede hacer con él */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link to="/" className="text-2xl text-muted hover:text-text" aria-label="Volver">
          ←
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="flex items-baseline gap-2 text-xl font-semibold">
            {asset.ticker}
            <span className="rounded bg-card px-1.5 py-0.5 text-[11px] font-normal text-muted">
              {asset.type === 'ACCION' ? 'Acción argentina' : 'CEDEAR'}
            </span>
          </h1>
          <p className="truncate text-sm text-muted">{asset.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setForm({ type: 'COMPRA' })} className="text-xs">
            Registrar compra
          </Button>
          {p.quantity > 0 && (
            <Button onClick={() => setForm({ type: 'VENTA' })} className="text-xs">
              Registrar venta
            </Button>
          )}
          <Button onClick={() => setForm({ type: 'DIVIDENDO' })} className="text-xs">
            Dividendo
          </Button>
          <Button onClick={() => setAlerting(true)} className="text-xs" title="Avisarme cuando el precio cruce un valor">
            🔔 Alerta
          </Button>
        </div>
      </div>

      {/* Tu posición: lo primero que se quiere saber al entrar */}
      {p.quantity > 0 ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBox
            label="Valor de lo que tenés"
            value={money(p.marketValue, currency)}
            sub={`${num(p.quantity)} × ${money(p.price, currency)} · promedio ${money(p.avgCost, currency)}`}
          />
          <StatBox
            label="Ganancia en lo que tenés"
            value={money(p.unrealized, currency, true)}
            sub={`${pct(p.unrealizedPct)} · te costó ${money(p.costBasis, currency)}`}
            cls={tone(p.unrealized)}
          />
          <StatBox label="Resultado total" value={money(p.totalGain, currency, true)} sub={totalDetail} cls={tone(p.totalGain)} />
          <StatBox label={capitalize(dayLabel(p.priceDate))} value={money(p.dayChange, currency, true)} sub={pct(p.dayChangePct)} cls={tone(p.dayChange)} />
        </section>
      ) : (
        <p className="rounded-lg bg-panel px-4 py-3 text-sm">
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

      <PriceChart series={data.series} operations={tradeOps} currency={currency} avgCost={p.quantity > 0 ? p.avgCost : 0} />

      <PendingDividends
        items={data.pendingDividends}
        onRegister={(d) =>
          setForm({ type: 'DIVIDENDO', prefill: { date: d.date, quantity: d.quantity, price: d.amountPerShare, fees: d.withholding } })
        }
      />

      <AssetStats series={data.series} currency={currency} avgCost={p.quantity > 0 ? p.avgCost : 0} type={asset.type} />

      {data.cedear && <CedearPanel ticker={asset.ticker} info={data.cedear} />}

      <OperationHistory operations={operations} currency={currency} />

      <DeleteAsset ticker={asset.ticker} position={p} />

      {form && (
        <OperationForm ticker={asset.ticker} type={form.type} holding={p.quantity} prefill={form.prefill} onClose={() => setForm(null)} />
      )}
      {alerting && <AlertForm ticker={asset.ticker} onClose={() => setAlerting(false)} />}
    </div>
  );
}
