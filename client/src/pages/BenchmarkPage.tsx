import { useMemo, useState } from 'react';
import type { BenchmarkKey } from '../api';
import { useHistory } from '../hooks';
import { useSettings } from '../settings';
import { date, money, pct, tone } from '../format';
import { ErrorBox, Loading } from '../components/ui';
import { LineChart, type ChartLine } from '../components/LineChart';

const COLORS: Record<BenchmarkKey, string> = {
  inflacion: '#c49a4a',
  dolar: '#4f9d69',
  plazofijo: '#5a9bb0',
  merval: '#b0607f',
  spy: '#5b7fb8',
};

export function BenchmarkPage() {
  const { currency } = useSettings();
  const { data, isLoading, error } = useHistory();
  const [hidden, setHidden] = useState<Set<BenchmarkKey>>(new Set(['merval', 'spy']));

  const lines = useMemo<ChartLine[]>(() => {
    if (!data) return [];
    const out: ChartLine[] = [
      { key: 'cartera', label: 'Tu cartera', color: '#7c6bb0', area: true, data: data.points.map((p) => ({ date: p.date, value: p.value })) },
    ];
    for (const b of data.benchmarks) {
      if (!b.available || hidden.has(b.key)) continue;
      out.push({
        key: b.key,
        label: b.label,
        color: COLORS[b.key],
        data: data.points.filter((p) => p.benchmarks[b.key] != null).map((p) => ({ date: p.date, value: p.benchmarks[b.key] as number })),
      });
    }
    return out;
  }, [data, hidden]);

  if (isLoading) return <Loading label="Calculando…" />;
  if (error || !data) return <ErrorBox error={error} />;

  if (!data.portfolio || data.points.length < 2) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Comparativa</h1>
        <p className="text-muted">Registrá al menos una compra para comparar tu cartera contra la inflación, el dólar y el plazo fijo.</p>
      </div>
    );
  }

  const p = data.portfolio;
  const beaten = data.benchmarks.filter((b) => b.available && (b.diff ?? 0) > 0);

  const toggle = (k: BenchmarkKey) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Comparativa</h1>
        <p className="mt-1 text-sm text-muted">
          Simulamos que la misma plata, en las mismas fechas en que compraste y vendiste, se hubiera ido a cada alternativa.
        </p>
      </div>

      <section className="rounded-xl bg-panel p-5">
        <p className="mb-4 text-lg">
          Tu cartera vale <span className="tabular font-semibold">{money(p.value, currency)}</span> y le ganó a{' '}
          <span className="font-semibold">
            {beaten.length} de {data.benchmarks.filter((b) => b.available).length}
          </span>{' '}
          alternativas.
        </p>
        <LineChart lines={lines} currency={currency} />
        <div className="mt-4 flex flex-wrap gap-2">
          {data.benchmarks
            .filter((b) => b.available)
            .map((b) => (
              <button
                key={b.key}
                onClick={() => toggle(b.key)}
                className={`flex items-center gap-2 rounded-sm border px-3 py-1 text-xs transition ${
                  hidden.has(b.key) ? 'border-line text-muted' : 'border-transparent bg-card text-text'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: COLORS[b.key] }} />
                {b.label}
              </button>
            ))}
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl bg-panel">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-5 py-3 font-normal">Alternativa</th>
              <th className="px-5 py-3 text-right font-normal">Hoy tendrías</th>
              <th className="px-5 py-3 text-right font-normal">Tu cartera vs. esto</th>
              <th className="px-5 py-3 text-right font-normal">TIR anual</th>
            </tr>
          </thead>
          <tbody className="tabular">
            <tr className="border-b border-line/50 bg-accent/5">
              <td className="px-5 py-3">
                <p className="font-medium">Tu cartera</p>
                <p className="text-xs text-muted">Lo que realmente hiciste</p>
              </td>
              <td className="px-5 py-3 text-right font-medium">{money(p.value, currency)}</td>
              <td className="px-5 py-3 text-right text-muted">—</td>
              <td className={`px-5 py-3 text-right font-medium ${tone(p.irr ?? 0)}`}>{p.irr != null ? pct(p.irr) : '—'}</td>
            </tr>
            {data.benchmarks.map((b) => (
              <tr key={b.key} className="border-b border-line/50 last:border-0">
                <td className="px-5 py-3">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[b.key] }} />
                    {b.label}
                  </p>
                  <p className="text-xs text-muted">
                    {b.description}
                    {!b.frozen && b.lastDataDate && b.lastDataDate < (data.points.at(-1)?.date ?? '') && ` · último dato ${date(b.lastDataDate)}`}
                  </p>
                </td>
                {b.available ? (
                  <>
                    <td className="px-5 py-3 text-right">{money(b.value!, currency)}</td>
                    <td className={`px-5 py-3 text-right font-medium ${tone(b.diff!)}`}>
                      {money(b.diff!, currency, true)}
                      <span className="ml-1 text-xs">({pct(b.diffPct!)})</span>
                    </td>
                    <td className="px-5 py-3 text-right text-muted">{b.irr != null ? pct(b.irr) : '—'}</td>
                  </>
                ) : (
                  <td colSpan={3} className="px-5 py-3 text-right text-muted">
                    {b.frozen && b.lastDataDate
                      ? `Yahoo no lo publica desde el ${date(b.lastDataDate)}: vuelve solo cuando haya datos nuevos`
                      : 'Sin datos todavía'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-muted">
        Lo que sacaste con ventas y dividendos se descuenta igual en todas las alternativas, así que "Hoy tendrías" compara solo
        lo que sigue invertido. Inflación: índice UVA (sigue al CER). Plazo fijo: tasa promedio de depósitos a 30 días, renovado cada mes. Merval y S&amp;P 500: precio del
        índice y del CEDEAR SPY. Fuentes: ArgentinaDatos y Yahoo Finance. {currency === 'USD' && 'En dólares, cada valor se convierte con el dólar de su fecha.'}
      </p>
    </div>
  );
}
