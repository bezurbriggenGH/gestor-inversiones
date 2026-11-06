import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { money, pct } from '../format';
import { ErrorBox, Loading } from '../components/ui';

const COLORS = ['#8b5cf6', '#22d3ee', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6', '#a3e635', '#f97316', '#14b8a6', '#e879f9'];
const CONCENTRATION_LIMIT = 0.35;

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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Composición</h1>

      <section className="grid gap-6 rounded-xl bg-panel p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="relative h-72">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={rows} dataKey="marketValue" nameKey="ticker" innerRadius="62%" outerRadius="95%" paddingAngle={2} stroke="none">
                {rows.map((r, i) => (
                  <Cell key={r.ticker} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => money(Number(v), currency)}
                contentStyle={{ background: '#1a1a1a', border: '1px solid #3a3a3a', borderRadius: 8 }}
                itemStyle={{ color: '#f2f2f2' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs text-muted">Total</p>
              <p className="tabular font-semibold">{money(total, currency)}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={r.ticker} className="grid grid-cols-[auto_4rem_1fr_auto] items-center gap-3 text-sm">
              <span className="h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="font-medium">{r.ticker}</span>
              <div className="h-2 overflow-hidden rounded-full bg-card">
                <div className="h-full rounded-full" style={{ width: `${r.weight * 100}%`, background: COLORS[i % COLORS.length] }} />
              </div>
              <span className="tabular w-36 text-right">
                {pct(r.weight).replace('+', '')} <span className="text-muted">· {money(r.marketValue, currency)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {byType.map((t) => (
          <div key={t.type} className="rounded-xl bg-panel p-5">
            <p className="text-sm text-muted">{t.type === 'ACCION' ? 'Acciones argentinas' : 'CEDEARs'}</p>
            <p className="tabular mt-1 text-xl font-semibold">{pct(t.weight).replace('+', '')}</p>
            <p className="tabular text-sm text-muted">{money(t.value, currency)}</p>
            <p className="mt-2 text-xs text-muted">
              {t.type === 'ACCION'
                ? 'Riesgo ligado a la economía argentina.'
                : 'Siguen a empresas del exterior y al dólar CCL: protegen frente a una devaluación.'}
            </p>
          </div>
        ))}
      </section>

      {concentrated.length > 0 && (
        <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          Concentración alta: {concentrated.map((c) => `${c.ticker} (${pct(c.weight).replace('+', '')})`).join(', ')} supera el{' '}
          {CONCENTRATION_LIMIT * 100}% de la cartera. Si a esa empresa le va mal, afecta mucho al total.
        </p>
      )}
    </div>
  );
}
