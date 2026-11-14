import { Link } from 'react-router';
import type { Currency, ExposureGroup } from '../api';
import { usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { money, share } from '../format';
import { ErrorBox, Loading } from '../components/ui';
import { PortfolioTreemap } from '../components/PortfolioTreemap';

// Un color por tipo de activo (no uno por activo: con muchos activos los colores se repetían)
const TYPE_COLOR = { ACCION: '#5a9bb0', CEDEAR: '#7c6bb0' } as const;
const CONCENTRATION_LIMIT = 0.35;
const UNCLASSIFIED = 'Sin clasificar';

/** Barras de cuánto pesa cada sector o país, con los activos de cada uno. */
function Exposure({ title, groups, currency }: { title: string; groups: ExposureGroup[]; currency: Currency }) {
  const max = Math.max(...groups.map((g) => g.weight));
  const unknown = groups.find((g) => g.name === UNCLASSIFIED);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-panel p-5">
      <h2 className="font-medium">{title}</h2>
      {groups.map((g) => (
        <div key={g.name} className="flex flex-col gap-1">
          <div className="tabular flex items-baseline justify-between gap-3 text-sm">
            <span className={g.name === UNCLASSIFIED ? 'text-muted' : ''}>{g.name}</span>
            <span>
              <span className="mr-3 text-muted">{money(g.value, currency, false, true)}</span>
              {share(g.weight)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-card">
            <div className={`h-full rounded-full ${g.name === UNCLASSIFIED ? 'bg-muted' : 'bg-accent'}`} style={{ width: `${(g.weight / max) * 100}%` }} />
          </div>
          <p className="text-xs text-muted">{g.tickers.join(' · ')}</p>
        </div>
      ))}
      {unknown && (
        <p className="text-xs text-muted">
          "Sin clasificar": activos que la app todavía no tiene en su lista y de los que la fuente de precios no informa el dato.
        </p>
      )}
    </div>
  );
}

export function CompositionPage() {
  const { currency } = useSettings();
  const { data, isLoading, error } = usePortfolio();

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const rows = data.positions.filter((p) => p.marketValue > 0).sort((a, b) => b.marketValue - a.marketValue);
  if (rows.length === 0) return <p className="text-muted">Cuando tengas tenencias vas a ver acá cómo se reparte tu cartera.</p>;

  const total = data.summary.marketValue;
  const byType = (['ACCION', 'CEDEAR'] as const).map((t) => {
    const value = rows.filter((r) => r.type === t).reduce((a, r) => a + r.marketValue, 0);
    return { type: t, value, weight: total > 0 ? value / total : 0 };
  });
  const concentrated = rows.filter((r) => r.weight > CONCENTRATION_LIMIT);
  // El sector que más pesa (sin contar lo que no se pudo clasificar ni los fondos, que ya son variados)
  const topSector = data.exposure.sectors.find((g) => g.name !== UNCLASSIFIED && g.name !== 'ETF');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Composición</h1>

      <PortfolioTreemap positions={rows} />

      {/* Cuánto pesa cada activo. El color dice el tipo (el mismo de los recuadros de abajo). */}
      <section className="flex flex-col gap-2 rounded-xl bg-panel p-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Cuánto pesa cada activo</h2>
          <p className="tabular text-sm text-muted">
            {rows.length} activos · {money(total, currency, false, true)}
          </p>
        </div>
        {rows.map((r) => (
          <Link
            key={r.ticker}
            to={`/activo/${r.ticker}`}
            className="tabular grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-card sm:grid-cols-[4.5rem_1fr_9rem_3.5rem]"
          >
            <span className="font-medium">{r.ticker}</span>
            <div className="h-2 overflow-hidden rounded-full bg-card">
              <div className="h-full rounded-full" style={{ width: `${(r.weight / rows[0].weight) * 100}%`, background: TYPE_COLOR[r.type] }} />
            </div>
            <span className="hidden text-right text-muted sm:block">{money(r.marketValue, currency, false, true)}</span>
            <span className="text-right">{share(r.weight)}</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {byType.map((t) => (
          <div key={t.type} className="rounded-xl bg-panel p-5">
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR[t.type] }} />
              {t.type === 'ACCION' ? 'Acciones argentinas' : 'CEDEARs'}
            </p>
            <p className="tabular mt-1 text-xl font-semibold">{share(t.weight)}</p>
            <p className="tabular text-sm text-muted">{money(t.value, currency)}</p>
            <p className="mt-2 text-xs text-muted">
              {t.type === 'ACCION'
                ? 'Riesgo ligado a la economía argentina.'
                : 'Siguen a empresas del exterior y al dólar CCL: protegen frente a una devaluación.'}
            </p>
          </div>
        ))}
      </section>

      {/* Exposición real: diez activos distintos pueden ser casi todos del mismo sector o país */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Exposure title="Por sector" groups={data.exposure.sectors} currency={currency} />
        <Exposure title="Por país de la empresa" groups={data.exposure.countries} currency={currency} />
      </section>
      {topSector && topSector.weight > CONCENTRATION_LIMIT && topSector.tickers.length > 1 && (
        <p className="rounded-lg border border-[#b8964f]/30 bg-[#b8964f]/10 px-4 py-3 text-sm text-[#c9ab6a]">
          El {share(topSector.weight)} de tu cartera está en {topSector.name} ({topSector.tickers.join(', ')}). Son activos distintos, pero
          suelen subir y bajar juntos: si a ese sector le va mal, te afecta en todos a la vez.
        </p>
      )}

      {concentrated.length > 0 && (
        <p className="rounded-lg border border-[#b8964f]/30 bg-[#b8964f]/10 px-4 py-3 text-sm text-[#c9ab6a]">
          Concentración alta: {concentrated.map((c) => `${c.ticker} (${share(c.weight)})`).join(', ')} supera el{' '}
          {CONCENTRATION_LIMIT * 100}% de la cartera. Si a esa empresa le va mal, afecta mucho al total.
        </p>
      )}
    </div>
  );
}
