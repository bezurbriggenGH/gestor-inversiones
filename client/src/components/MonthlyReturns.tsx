import type { History } from '../api';
import { useSettings } from '../settings';
import { money, pct } from '../format';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const FULL_SCALE = 0.15; // a partir de ±15% el color llega a su máxima intensidad

function cellStyle(r: number) {
  const alpha = 0.12 + 0.68 * Math.min(1, Math.abs(r) / FULL_SCALE);
  return { background: r >= 0 ? `rgba(79,157,105,${alpha})` : `rgba(194,84,80,${alpha})` };
}

const short = (r: number) => `${r > 0 ? '+' : ''}${(r * 100).toFixed(1).replace('.', ',')}%`;

/** Calendario de rendimientos: un casillero por mes, verde si ganaste y rojo si perdiste. */
export function MonthlyReturns({ months }: { months: History['monthly'] }) {
  const { currency } = useSettings();
  const byYear = new Map<string, Map<number, History['monthly'][number]>>();
  for (const m of months) {
    const [y, mm] = m.month.split('-');
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(Number(mm) - 1, m);
  }
  const years = [...byYear.keys()].sort().reverse();

  const best = months.reduce((a, b) => (b.return > a.return ? b : a));
  const worst = months.reduce((a, b) => (b.return < a.return ? b : a));
  const positive = months.filter((m) => m.return > 0).length;
  const label = (month: string) => {
    const [y, mm] = month.split('-');
    return `${MONTHS[Number(mm) - 1]} ${y}`;
  };

  return (
    <section className="rounded-xl bg-panel p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Rendimiento mes a mes</h2>
        <p className="tabular text-sm text-muted">
          {positive} de {months.length} meses en positivo · mejor {label(best.month)} <span className="text-up">{short(best.return)}</span> · peor{' '}
          {label(worst.month)} <span className="text-down">{short(worst.return)}</span>
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[42rem] border-separate border-spacing-1 text-center text-xs">
          <thead>
            <tr className="text-muted">
              <th className="w-12 text-left font-normal" />
              {MONTHS.map((m) => (
                <th key={m} className="font-normal">
                  {m}
                </th>
              ))}
              <th className="font-normal">Año</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const row = byYear.get(y)!;
              const yearReturn = [...row.values()].reduce((f, m) => f * (1 + m.return), 1) - 1;
              return (
                <tr key={y}>
                  <td className="text-left text-muted">{y}</td>
                  {MONTHS.map((_, i) => {
                    const m = row.get(i);
                    return m ? (
                      <td
                        key={i}
                        className="rounded-md py-2"
                        style={cellStyle(m.return)}
                        title={`${label(m.month)}: ${pct(m.return)} · ${money(m.gain, currency, true)}`}
                      >
                        {short(m.return)}
                      </td>
                    ) : (
                      <td key={i} className="rounded-md bg-card/40 py-2 text-muted/40">
                        ·
                      </td>
                    );
                  })}
                  <td className="rounded-md bg-card py-2 font-semibold" title={`${y}: ${pct(yearReturn)}`}>
                    <span className={yearReturn >= 0 ? 'text-up' : 'text-down'}>{short(yearReturn)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-muted">
        Rendimiento de la cartera en cada mes, en {currency === 'ARS' ? 'pesos' : 'dólares'}, sin contar la plata que agregaste o sacaste (así
        un mes con muchas compras no parece un mes de ganancias). Pasá el mouse por un mes para ver el monto.
      </p>
    </section>
  );
}
