import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { History, PortfolioPosition } from '../api';
import { useHistory, usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { capitalize, dayLabel, latestPriceDate, money, num, pct, share, shortDayLabel, tone } from '../format';
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

/**
 * Tarjeta de un activo: solo lo esencial para comparar de un vistazo.
 * El detalle completo (cantidad, promedio, resultado total, brecha CCL…) está en la página del activo.
 */
function AssetCard({ p }: { p: PortfolioPosition }) {
  const { currency } = useSettings();
  const hasPosition = p.quantity > 0;
  return (
    <div>
      <Link
        to={`/activo/${p.ticker}`}
        className={`tabular flex flex-col gap-3 rounded-xl p-5 transition ${hasPosition ? 'bg-card hover:bg-card-hover' : 'bg-panel hover:bg-card'}`}
      >
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-lg font-medium">{p.ticker}</span>
            {hasPosition ? (
              <span className="text-xs text-muted" title="Peso en tu cartera">
                {share(p.weight)}
              </span>
            ) : (
              <span className="text-xs text-muted">vendido</span>
            )}
          </div>
          <p className="truncate text-xs text-muted" title={p.name}>
            {p.name}
          </p>
        </div>

        {hasPosition ? (
          <>
            <span className="text-xl font-semibold">{money(p.marketValue, currency, false, true)}</span>
            <div className="flex items-center justify-between text-sm">
              <span className={`flex items-center gap-1 font-medium ${tone(p.unrealizedPct)}`} title="Ganancia en lo que tenés hoy">
                {pct(p.unrealizedPct)} <Triangle value={p.unrealizedPct} />
              </span>
              <span className="text-xs text-muted" title={`Variación del precio ${dayLabel(p.priceDate)}`}>
                {shortDayLabel(p.priceDate)} <span className={tone(p.dayChangePct)}>{pct(p.dayChangePct)}</span>
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Lo que ganaste o perdiste con todas las operaciones de este activo */}
            <span className={`text-xl font-semibold ${tone(p.totalGain)}`}>{money(p.totalGain, currency, true, true)}</span>
            <span className="text-sm text-muted">resultado final</span>
          </>
        )}
      </Link>
    </div>
  );
}

/** Vista compacta: una fila por activo, pensada para carteras con muchos activos. */
function AssetTable({ positions }: { positions: PortfolioPosition[] }) {
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
          </tr>
        </thead>
        <tbody className="tabular">
          {positions.map((p) => {
            const hasPosition = p.quantity > 0;
            return (
              <tr
                key={p.ticker}
                onClick={() => navigate(`/activo/${p.ticker}`)}
                className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-card"
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
                <td className="hidden px-2 py-2.5 sm:px-3 text-right text-muted sm:table-cell">{hasPosition ? share(p.weight) : '—'}</td>
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
  const [view, setView] = usePref<View>('cartera.vista', ['tarjetas', 'lista'], 'tarjetas');
  const [sort, setSort] = usePref<Sort>('cartera.orden', ['valor', 'ganancia', 'resultado', 'hoy', 'ticker'], 'valor');
  const [showEmpty, setShowEmpty] = usePref<'si' | 'no'>('cartera.sinTenencia', ['si', 'no'], 'no');

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
      {data.positions.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line p-10 text-center">
          <div>
            <p className="text-lg">Todavía no tenés activos</p>
            <p className="mt-1 text-sm text-muted">
              Agregá una acción argentina (GGAL, YPFD…) o un CEDEAR (MELI, AAPL…), o{' '}
              <Link to="/importar" className="text-text underline underline-offset-4">
                importá tus operaciones
              </Link>
              .
            </p>
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}>
            Agregar activo
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
            <h2 className="mr-auto text-base font-medium">Tus activos</h2>
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
                Mostrar vendidos ({emptyCount})
              </label>
            )}
            <Button onClick={() => setAdding(true)} className="text-xs">
              + Agregar activo
            </Button>
          </div>

          {view === 'lista' ? (
            <AssetTable positions={positions} />
          ) : (
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {positions.map((p) => (
                <AssetCard key={p.ticker} p={p} />
              ))}
            </section>
          )}
        </div>
      )}

      {history.data && <Evolution history={history.data} />}
      {history.data && history.data.monthly.length > 0 && <MonthlyReturns months={history.data.monthly} />}

      {adding && <AddAssetDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
