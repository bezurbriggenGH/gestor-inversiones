import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SimAlternative, type Simulation } from '../api';
import { useSettings } from '../settings';
import { date, money, num, pct, todayIso, tone } from '../format';
import { Button, ErrorBox, Field, Loading, inputCls } from '../components/ui';
import { LineChart, type ChartLine } from '../components/LineChart';

const COLORS: Record<SimAlternative, string> = {
  activo: '#7c6bb0',
  dolar: '#4f9d69',
  plazofijo: '#c49a4a',
  inflacion: '#c25450',
  colchon: '#8a8a8f',
};

const PRESETS = [
  { label: 'Hace 1 año', years: 1 },
  { label: '3 años', years: 3 },
  { label: '5 años', years: 5 },
];
// Cómo se nombra cada alternativa dentro de una frase
const BEAT: Record<SimAlternative, string> = { activo: '', dolar: 'al dólar', plazofijo: 'al plazo fijo', inflacion: 'a la inflación', colchon: 'a guardar los pesos' };
const LOST: Record<SimAlternative, string> = { activo: '', dolar: 'el dólar', plazofijo: 'el plazo fijo', inflacion: 'la inflación', colchon: 'guardar los pesos' };

const EXAMPLES = ['GGAL', 'YPFD', 'MELI', 'SPY', 'AAPL', 'KO'];

function yearsAgo(n: number) {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function Result({ sim }: { sim: Simulation }) {
  const { currency } = useSettings();
  const ok = sim.results.filter((r) => r.available);
  const asset = ok.find((r) => r.key === 'activo')!;
  const others = ok.filter((r) => r.key !== 'activo');
  const beat = others.filter((r) => asset.value > r.value).map((r) => BEAT[r.key]);
  const lost = others.filter((r) => asset.value <= r.value).map((r) => LOST[r.key]);
  const ranking = [...ok].sort((a, b) => b.value - a.value);
  const max = ranking[0].value;

  const lines = useMemo<ChartLine[]>(
    () =>
      ok.map((r) => ({
        key: r.key,
        label: r.key === 'activo' ? sim.ticker : r.label,
        color: COLORS[r.key],
        area: r.key === 'activo',
        dashed: r.key === 'colchon' || r.key === 'inflacion',
        data: sim.points.filter((p) => p[r.key] != null).map((p) => ({ date: p.date, value: p[r.key]! })),
      })),
    [sim, ok],
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-panel p-6">
        <p className="text-lg leading-relaxed">
          Si el {date(sim.startDate)} hubieras puesto {money(sim.invested, currency)} en <span className="font-semibold">{sim.ticker}</span>, hoy
          tendrías <span className={`tabular font-semibold ${tone(asset.gain)}`}>{money(asset.value, currency)}</span>{' '}
          <span className={`tabular ${tone(asset.return)}`}>({pct(asset.return)})</span>.
        </p>
        <p className="mt-2 text-sm text-muted">
          {beat.length > 0 && <>Le ganó a {joinNames(beat)}. </>}
          {lost.length > 0 && <>{beat.length > 0 ? 'Pero convenía más' : 'Convenía más'} {joinNames(lost)}. </>}
          {asset.annual != null && (
            <>
              Equivale a {pct(asset.annual)} por año durante {num(Math.round(sim.years * 10) / 10)} años.
            </>
          )}
        </p>
      </section>

      <section className="rounded-xl bg-panel p-5">
        <h2 className="mb-4 font-medium">¿Qué convenía?</h2>
        <div className="flex flex-col gap-3">
          {ranking.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1.5rem_8rem_1fr] items-center gap-3 text-sm sm:grid-cols-[1.5rem_10rem_1fr_9rem]">
              <span className="tabular text-muted">{i + 1}°</span>
              <span className={r.key === 'activo' ? 'font-semibold' : ''}>{r.key === 'activo' ? sim.ticker : r.label}</span>
              <div className="h-5 rounded-sm bg-card">
                <div className="h-full rounded-sm" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: COLORS[r.key] }} />
              </div>
              <span className="tabular col-span-2 col-start-2 text-xs sm:col-span-1 sm:col-start-auto sm:text-right sm:text-sm">
                {money(r.value, currency)} <span className={tone(r.return)}>{pct(r.return)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-panel p-5">
        <h2 className="mb-4 font-medium">Cómo fue el camino</h2>
        <LineChart lines={lines} currency={currency} height="h-72" />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-panel px-4 py-3">
          <p className="text-xs text-muted">Habrías comprado</p>
          <p className="tabular mt-1 font-medium">
            {num(Math.round(sim.units * 100) / 100)} {sim.type === 'CEDEAR' ? 'CEDEARs' : 'acciones'}
          </p>
          <p className="tabular text-xs text-muted">a {money(sim.startPrice, 'ARS')} cada una</p>
        </div>
        <div className="rounded-lg bg-panel px-4 py-3">
          <p className="text-xs text-muted">El peor momento</p>
          <p className={`tabular mt-1 font-medium ${tone(sim.worst.return)}`}>{sim.worst.return < 0 ? pct(sim.worst.return) : 'Nunca perdiste'}</p>
          <p className="text-xs text-muted">
            {sim.worst.return < 0 ? `El ${date(sim.worst.date)} ibas perdiendo eso. Había que aguantar.` : 'Siempre estuvo por encima de lo invertido.'}
          </p>
        </div>
        <div className="rounded-lg bg-panel px-4 py-3">
          <p className="text-xs text-muted">Dividendos cobrados</p>
          <p className="tabular mt-1 font-medium">{sim.dividendsCash > 0 ? money(sim.dividendsCash, currency) : 'No pagó'}</p>
          <p className="text-xs text-muted">{sim.dividendsCash > 0 ? 'Ya incluidos en el resultado, antes de impuestos.' : 'En este período no hubo dividendos.'}</p>
        </div>
      </section>

      <p className="text-xs text-muted">
        Simulación con precios de cierre reales, sin comisiones. "Inflación" es la plata ajustada por el índice UVA (mantener el poder de
        compra); "plazo fijo", a 30 días renovado con la tasa promedio de cada mes. Lo que pasó antes no garantiza lo que va a pasar.
      </p>
    </div>
  );
}

/** "¿Y si hubiera invertido…?": compara una inversión pasada contra dólar, plazo fijo, inflación y colchón. */
export function SimulatorPage() {
  const { currency, fxKind } = useSettings();
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('100000');
  const [from, setFrom] = useState(yearsAgo(1));
  const [params, setParams] = useState<{ ticker: string; amount: number; date: string } | null>(null);

  const query = useDebounced(ticker.trim(), 150);
  const suggestions = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: query.length > 0,
  });

  const sim = useQuery({
    queryKey: ['simulate', params, currency, fxKind],
    queryFn: () => api.simulate(params!.ticker, params!.amount, params!.date, currency, fxKind),
    enabled: params != null,
    retry: false,
    placeholderData: (prev) => prev,
  });

  const run = (t = ticker) => {
    const clean = t.trim().toUpperCase();
    const n = Number(amount);
    if (clean && n > 0 && from) setParams({ ticker: clean, amount: n, date: from });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">¿Y si hubiera invertido…?</h1>
        <p className="mt-1 text-sm text-muted">
          Elegí una acción o CEDEAR, un monto y una fecha: te mostramos cuánto tendrías hoy y si convenía más el dólar, un plazo fijo o
          nada.
        </p>
      </div>

      <form
        className="grid gap-4 rounded-xl bg-panel p-5 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Field label="Activo">
          <input
            className={inputCls}
            list="sim-tickers"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="GGAL, MELI, SPY…"
            autoComplete="off"
          />
          <datalist id="sim-tickers">
            {(suggestions.data ?? []).map((s) => (
              <option key={s.ticker} value={s.ticker}>
                {s.name}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Monto en pesos">
          <input className={inputCls} type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Fecha">
          <input className={inputCls} type="date" max={todayIso()} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!ticker.trim() || sim.isFetching} className="min-w-32">
          {sim.isFetching ? 'Calculando…' : 'Simular'}
        </Button>

        <div className="flex flex-wrap items-center gap-2 text-xs md:col-span-4">
          <span className="text-muted">Fecha:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setFrom(yearsAgo(p.years))}
              className={`rounded-sm px-2.5 py-1 transition ${from === yearsAgo(p.years) ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
            >
              {p.label}
            </button>
          ))}
          <span className="ml-2 text-muted">Probá con:</span>
          {EXAMPLES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTicker(t);
                run(t);
              }}
              className="rounded-sm px-2 py-1 text-muted transition hover:bg-card hover:text-text"
            >
              {t}
            </button>
          ))}
        </div>
      </form>

      <ErrorBox error={sim.error} />
      {sim.isLoading && <Loading label="Buscando precios…" />}
      {sim.data && <Result sim={sim.data} />}
    </div>
  );
}
