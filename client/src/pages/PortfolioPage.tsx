import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type History, type PortfolioPosition } from '../api';
import { DATA_KEYS, useHistory, usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { capitalize, dayLabel, latestPriceDate, money, num, pct, tone } from '../format';
import { Button, ErrorBox, Loading, Triangle } from '../components/ui';
import { AddAssetDialog } from '../components/AddAssetDialog';
import { LineChart, type ChartLine } from '../components/LineChart';
import { MonthlyReturns } from '../components/MonthlyReturns';
import { Insights, PortfolioSummary } from '../components/PortfolioSummary';

function Evolution({ history }: { history: History }) {
  const { currency } = useSettings();
  const lines = useMemo<ChartLine[]>(
    () => [
      { key: 'value', label: 'Valor de la cartera', color: '#7c6bb0', area: true, data: history.points.map((p) => ({ date: p.date, value: p.value })) },
      { key: 'invested', label: 'Plata puesta (neta)', color: '#8a8a8f', dashed: true, data: history.points.map((p) => ({ date: p.date, value: p.netInvested })) },
    ],
    [history],
  );
  if (history.points.length < 2) return null;
  const p = history.portfolio!;
  return (
    <section className="rounded-xl bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Evolución de tu cartera</h2>
        <p className="text-sm text-muted">
          Ganancia total <span className={`tabular font-medium ${tone(p.gain)}`}>{money(p.gain, currency, true)}</span>
          {p.irr != null && (
            <>
              {' · '}TIR anual <span className={`tabular font-medium ${tone(p.irr)}`}>{pct(p.irr)}</span>
            </>
          )}
        </p>
      </div>
      <LineChart lines={lines} currency={currency} height="h-64" />
      <p className="mt-2 text-xs text-muted">
        "Plata puesta" es lo que invertiste menos lo que retiraste por ventas y dividendos. La TIR es tu rendimiento anual considerando
        cuándo entró y salió cada peso.
      </p>
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
            <span className="text-muted">{dayLabel(p.priceDate)}</span>
            <span className={tone(p.dayChangePct)}>{pct(p.dayChangePct)}</span>
            <Triangle value={p.dayChangePct} />
          </div>
          {p.cedearGap != null && (
            <p className="tabular mt-0.5 text-[11px] text-muted" title="Diferencia entre el dólar implícito del CEDEAR y el CCL">
              brecha CCL <span className={tone(-p.cedearGap)}>{pct(p.cedearGap)}</span>
            </p>
          )}
        </div>
        <div className="tabular flex items-center justify-between text-sm">
          <span className="text-muted">{hasPosition ? money(p.marketValue, currency) : 'Ya no tenés'}</span>
          {hasPosition ? (
            <span className={`flex items-center gap-1 font-medium ${tone(p.unrealizedPct)}`} title="Ganancia en lo que tenés hoy">
              {pct(p.unrealizedPct)} <Triangle value={p.unrealizedPct} />
            </span>
          ) : (
            // Lo que ganaste o perdiste con todas las operaciones de este activo
            p.totalGain !== 0 && (
              <span className={`font-medium ${tone(p.totalGain)}`} title="Resultado final de todas tus operaciones">
                resultado {money(p.totalGain, currency, true)}
              </span>
            )
          )}
        </div>
      </Link>
      {deleting && <DeleteButton ticker={p.ticker} onClick={onDelete} className="absolute -right-2 -top-2" />}
    </div>
  );
}

function DeleteButton({ ticker, onClick, className = '' }: { ticker: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-full bg-down text-sm font-bold text-white shadow-lg hover:scale-105 ${className}`}
      aria-label={`Eliminar ${ticker}`}
    >
      ✕
    </button>
  );
}

/** Vista compacta: una fila por activo, pensada para carteras con muchos activos. */
function AssetTable({ positions, deleting, onDelete }: { positions: PortfolioPosition[]; deleting: boolean; onDelete: (p: PortfolioPosition) => void }) {
  const { currency } = useSettings();
  const navigate = useNavigate();
  const th = 'px-2 py-2.5 font-normal sm:px-3';
  return (
    <section className="overflow-x-auto rounded-xl bg-panel">
      <table className="w-full text-xs sm:text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className={th}>Activo</th>
            <th className={`${th} hidden text-right sm:table-cell`}>{capitalize(dayLabel(latestPriceDate(positions)))}</th>
            <th className={`${th} hidden text-right md:table-cell`}>Cantidad</th>
            <th className={`${th} hidden text-right lg:table-cell`}>Precio</th>
            <th className={`${th} text-right`}>Valor</th>
            <th className={`${th} hidden text-right sm:table-cell`}>Peso</th>
            <th className={`${th} text-right`} title="Lo que vas ganando o perdiendo con lo que tenés hoy (lo mismo que muestra el broker)">
              Ganancia en lo que tenés
            </th>
            <th className={`${th} hidden text-right md:table-cell`} title="Incluye también las ventas ya hechas y los dividendos">
              Resultado total
            </th>
            {deleting && <th className={th}><span className="sr-only">Eliminar</span></th>}
          </tr>
        </thead>
        <tbody className="tabular">
          {positions.map((p) => {
            const hasPosition = p.quantity > 0;
            return (
              <tr
                key={p.ticker}
                onClick={() => !deleting && navigate(`/activo/${p.ticker}`)}
                className={`border-b border-line/60 last:border-0 ${deleting ? '' : 'cursor-pointer hover:bg-card'}`}
              >
                <td className="px-2 py-2.5 sm:px-3">
                  <Link to={`/activo/${p.ticker}`} onClick={(e) => e.stopPropagation()} className="flex items-baseline gap-2">
                    <span className="font-medium">{p.ticker}</span>
                    <span className="hidden rounded bg-bg px-1.5 py-0.5 text-[10px] text-muted sm:inline">{p.type === 'ACCION' ? 'Acción' : 'CEDEAR'}</span>
                  </Link>
                  <span className="block max-w-28 truncate text-xs text-muted sm:max-w-48">{p.name}</span>
                </td>
                <td className={`hidden px-2 py-2.5 sm:px-3 text-right sm:table-cell ${tone(p.dayChangePct)}`}>{pct(p.dayChangePct)}</td>
                <td className="hidden px-2 py-2.5 sm:px-3 text-right md:table-cell">{hasPosition ? num(p.quantity) : '—'}</td>
                <td className="hidden px-2 py-2.5 sm:px-3 text-right lg:table-cell">{money(p.price, currency)}</td>
                <td className="px-2 py-2.5 sm:px-3 text-right">{hasPosition ? money(p.marketValue, currency) : <span className="text-muted">Ya no tenés</span>}</td>
                <td className="hidden px-2 py-2.5 sm:px-3 text-right text-muted sm:table-cell">{hasPosition ? pct(p.weight).replace('+', '') : '—'}</td>
                <td className="px-2 py-2.5 sm:px-3 text-right">
                  {hasPosition ? (
                    <>
                      <span className={`font-medium ${tone(p.unrealizedPct)}`}>{pct(p.unrealizedPct)}</span>
                      <span className={`block text-xs ${tone(p.unrealized)}`}>{money(p.unrealized, currency, true)}</span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className={`hidden px-2 py-2.5 sm:px-3 text-right md:table-cell ${tone(p.totalGain)}`}>
                  {p.totalGain !== 0 ? money(p.totalGain, currency, true) : <span className="text-muted">—</span>}
                </td>
                {deleting && (
                  <td className="px-2 py-2.5 sm:px-3 text-right">
                    <DeleteButton ticker={p.ticker} onClick={() => onDelete(p)} className="ml-auto h-7 w-7" />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

type View = 'tarjetas' | 'lista';
type Sort = 'valor' | 'ganancia' | 'resultado' | 'hoy' | 'ticker';

const SORTS: Record<Sort, { label: string; compare: (a: PortfolioPosition, b: PortfolioPosition) => number }> = {
  valor: { label: 'Mayor tenencia', compare: (a, b) => b.marketValue - a.marketValue },
  ganancia: { label: 'Mayor ganancia % (lo que tenés)', compare: (a, b) => b.unrealizedPct - a.unrealizedPct },
  resultado: { label: 'Mayor resultado total', compare: (a, b) => b.totalGain - a.totalGain },
  hoy: { label: 'Mayor suba del día', compare: (a, b) => b.dayChangePct - a.dayChangePct },
  ticker: { label: 'Ticker (A-Z)', compare: (a, b) => a.ticker.localeCompare(b.ticker) },
};

// Preferencias de esta vista: se recuerdan en el navegador
function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, allowed, fallback));
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // sin almacenamiento: dura hasta recargar
    }
  };
  return [value, set];
}

export function PortfolioPage() {
  const { data, isLoading, error } = usePortfolio();
  const history = useHistory();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = usePref<View>('cartera.vista', ['tarjetas', 'lista'], 'tarjetas');
  const [sort, setSort] = usePref<Sort>('cartera.orden', ['valor', 'ganancia', 'resultado', 'hoy', 'ticker'], 'valor');
  const [showEmpty, setShowEmpty] = usePref<'si' | 'no'>('cartera.sinTenencia', ['si', 'no'], 'no');
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: api.deleteAsset,
    onSuccess: () => DATA_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey })),
  });

  function confirmDelete(p: PortfolioPosition) {
    const msg = `¿Eliminar ${p.ticker}? Se borran también todas sus operaciones registradas.`;
    if (window.confirm(msg)) remove.mutate(p.ticker);
  }

  const all = data?.positions ?? [];
  const emptyCount = all.filter((p) => p.quantity <= 0).length;
  // Si no hay ningún activo con tenencia, se muestran todos (si no, la pantalla quedaría vacía)
  const hideEmpty = showEmpty === 'no' && emptyCount < all.length;
  const positions = useMemo(
    () => all.filter((p) => !hideEmpty || p.quantity > 0).sort((a, b) => SORTS[sort].compare(a, b) || a.ticker.localeCompare(b.ticker)),
    [all, hideEmpty, sort],
  );

  if (isLoading) return <Loading label="Actualizando precios…" />;
  if (error || !data) return <ErrorBox error={error} />;

  return (
    <div className="flex flex-col gap-8">
      <PortfolioSummary data={data} history={history.data} />
      <Insights data={data} history={history.data} />

      {data.errors.length > 0 && (
        <p className="rounded-lg border border-[#b8964f]/30 bg-[#b8964f]/10 px-3 py-2 text-xs text-[#c9ab6a]">
          Alguna fuente de datos no respondió; se muestran los últimos precios guardados.
        </p>
      )}
      <ErrorBox error={remove.error} />

      {data.positions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center">
          <p className="text-lg">Todavía no tenés activos</p>
          <p className="mt-1 text-sm text-muted">
            Agregá una acción argentina (GGAL, YPFD…) o un CEDEAR (MELI, AAPL…), o{' '}
            <Link to="/importar" className="text-text underline underline-offset-4">
              importá tus operaciones
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
            <div className="flex rounded-lg bg-panel p-1" role="group" aria-label="Forma de ver los activos">
              {(['tarjetas', 'lista'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-md px-3 py-1.5 transition ${view === v ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
                >
                  {v === 'tarjetas' ? 'Tarjetas' : 'Lista'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-muted">
              Ordenar por
              <select
                id="cartera-orden"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-lg border border-line bg-bg px-2 py-1.5 text-text outline-none focus:border-muted"
              >
                {Object.entries(SORTS).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {emptyCount > 0 && emptyCount < all.length && (
              <label className="flex cursor-pointer items-center gap-2 text-muted">
                <input id="cartera-sin-tenencia" type="checkbox" checked={showEmpty === 'si'} onChange={(e) => setShowEmpty(e.target.checked ? 'si' : 'no')} />
                Mostrar sin tenencia ({emptyCount})
              </label>
            )}
          </div>

          {view === 'lista' ? (
            <AssetTable positions={positions} deleting={deleting} onDelete={confirmDelete} />
          ) : (
            <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {positions.map((p) => (
                <AssetCard key={p.ticker} p={p} deleting={deleting} onDelete={() => confirmDelete(p)} />
              ))}
            </section>
          )}
        </div>
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

      {history.data && <Evolution history={history.data} />}
      {history.data && history.data.monthly.length > 0 && <MonthlyReturns months={history.data.monthly} />}

      {adding && <AddAssetDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
