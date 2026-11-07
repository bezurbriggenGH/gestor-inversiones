import type { Currency, PricePoint } from '../api';
import { date, money, pct, tone } from '../format';

function minusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Cierre del último día con precio en o antes de `iso`. */
function closeAt(series: PricePoint[], iso: string): PricePoint | null {
  let found: PricePoint | null = null;
  for (const p of series) {
    if (p.date > iso) break;
    found = p;
  }
  return found;
}

export function computeStats(series: PricePoint[]) {
  const last = series[series.length - 1];
  const yearAgo = minusDays(last.date, 365);
  const year = series.filter((p) => p.date >= yearAgo);

  // Máximo y mínimo de las últimas 52 semanas (por cierre)
  let high = year[0];
  let low = year[0];
  for (const p of year) {
    if (p.close > high.close) high = p;
    if (p.close < low.close) low = p;
  }

  const periods = [
    { label: '1 mes', from: minusDays(last.date, 30) },
    { label: '3 meses', from: minusDays(last.date, 91) },
    { label: 'En el año', from: `${Number(last.date.slice(0, 4)) - 1}-12-31` },
    { label: '1 año', from: yearAgo },
    { label: '5 años', from: minusDays(last.date, 1826) },
  ].map((p) => {
    const base = p.from >= series[0].date ? closeAt(series, p.from) : null;
    return { label: p.label, value: base ? last.close / base.close - 1 : null };
  });

  // Cuánto se mueve en un día normal (desvío de las variaciones diarias del último año)
  const changes: number[] = [];
  for (let i = 1; i < year.length; i++) changes.push(year[i].close / year[i - 1].close - 1);
  const mean = changes.reduce((s, c) => s + c, 0) / (changes.length || 1);
  const dailyMove = Math.sqrt(changes.reduce((s, c) => s + (c - mean) ** 2, 0) / (changes.length || 1));

  // Peor caída del último año: de un pico al punto más bajo posterior
  let peak = year[0];
  let drawdown = { value: 0, from: year[0].date, to: year[0].date };
  for (const p of year) {
    if (p.close > peak.close) peak = p;
    const dd = p.close / peak.close - 1;
    if (dd < drawdown.value) drawdown = { value: dd, from: peak.date, to: p.date };
  }

  return { last, high, low, periods, dailyMove, drawdown, enoughData: year.length > 20 };
}

function moveLabel(daily: number) {
  if (daily < 0.015) return { text: 'Se mueve poco', cls: 'text-up' };
  if (daily < 0.028) return { text: 'Se mueve moderado', cls: 'text-[#c9ab6a]' };
  return { text: 'Se mueve mucho', cls: 'text-down' };
}

/** Datos clave de la acción, explicados en palabras simples. */
export function AssetStats({ series, currency, avgCost }: { series: PricePoint[]; currency: Currency; avgCost: number }) {
  if (series.length < 2) return null;
  const s = computeStats(series);
  if (!s.enoughData) return null;

  const range = s.high.close - s.low.close;
  const position = range > 0 ? (s.last.close - s.low.close) / range : 0.5;
  const fromHigh = s.last.close / s.high.close - 1;
  const move = moveLabel(s.dailyMove);
  const breakEven = avgCost > 0 && s.last.close < avgCost ? avgCost / s.last.close - 1 : null;

  return (
    <section className="flex flex-col gap-5 rounded-xl bg-panel p-5">
      <h2 className="font-medium">Datos de la acción</h2>

      {breakEven != null && (
        <p className="rounded-lg border border-down/30 bg-down/10 px-4 py-3 text-sm">
          Para volver a tu precio promedio ({money(avgCost, currency)}) necesita subir{' '}
          <span className="tabular font-semibold">{pct(breakEven).replace('+', '')}</span>.{' '}
          <span className="text-muted">
            Ojo: después de una caída hace falta subir más de lo que se bajó (si cae 50%, tiene que subir 100% para recuperarse).
          </span>
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Rango del último año</p>
          <div className="relative mt-1 h-2 rounded-sm bg-card">
            <div
              className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-text"
              style={{ left: `${Math.min(100, Math.max(0, position * 100))}%` }}
              title={`Hoy: ${money(s.last.close, currency)}`}
            />
            {avgCost > 0 && range > 0 && avgCost >= s.low.close && avgCost <= s.high.close && (
              <div
                className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-accent"
                style={{ left: `${((avgCost - s.low.close) / range) * 100}%` }}
                title={`Tu promedio: ${money(avgCost, currency)}`}
              />
            )}
          </div>
          <div className="tabular flex justify-between text-xs text-muted">
            <span>
              Mín {money(s.low.close, currency)} <span className="opacity-70">({date(s.low.date)})</span>
            </span>
            <span>
              Máx {money(s.high.close, currency)} <span className="opacity-70">({date(s.high.date)})</span>
            </span>
          </div>
          <p className="text-sm">
            {fromHigh > -0.005 ? (
              'Está en su máximo del año.'
            ) : (
              <>
                Está <span className="tabular font-medium">{pct(fromHigh).replace('-', '')}</span> por debajo de su máximo del año.
              </>
            )}
            {avgCost > 0 && <span className="text-muted"> La marca violeta es tu precio promedio.</span>}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Cuánto subió o bajó</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {s.periods.map((p) => (
              <div key={p.label} className="flex flex-col gap-0.5 rounded-lg bg-card px-2 py-2 text-center">
                <span className="text-[11px] text-muted">{p.label}</span>
                <span className={`tabular text-sm font-medium ${p.value == null ? 'text-muted' : tone(p.value)}`}>
                  {p.value == null ? '—' : pct(p.value)}
                </span>
              </div>
            ))}
          </div>
          {currency === 'ARS' && (
            <p className="text-xs text-muted">En pesos, una parte de la suba es solo inflación. Pasá a dólares para ver cuánto ganó de verdad.</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">Riesgo: cuánto se mueve</p>
          <p className={`mt-1 font-medium ${move.cls}`}>{move.text}</p>
          <p className="tabular mt-0.5 text-xs text-muted">En un día normal sube o baja alrededor de {pct(s.dailyMove).replace('+', '')}.</p>
        </div>
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">Peor caída del último año</p>
          <p className={`tabular mt-1 font-medium ${tone(s.drawdown.value)}`}>{s.drawdown.value < 0 ? pct(s.drawdown.value) : 'Sin caídas'}</p>
          {s.drawdown.value < 0 && (
            <p className="tabular mt-0.5 text-xs text-muted">
              Del {date(s.drawdown.from)} al {date(s.drawdown.to)}. Es lo máximo que perdió alguien que compró en el peor momento.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
