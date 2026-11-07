import type { ReactNode } from 'react';
import type { History, Portfolio } from '../api';
import { useSettings } from '../settings';
import { FX_LABEL, date, money, pct, tone } from '../format';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CONCENTRATION_LIMIT = 0.35;

function Line({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`tabular ${cls}`}>{value}</span>
    </div>
  );
}

/** Lo más importante arriba: cuánto vale, cuánto ganaste en total y si le ganaste a la inflación. */
export function PortfolioSummary({ data, history }: { data: Portfolio; history?: History }) {
  const { currency } = useSettings();
  const s = data.summary;
  const real = data.realReturn;
  const irr = history?.portfolio?.irr ?? null;

  return (
    <section className="grid gap-6 rounded-xl bg-panel p-6 lg:grid-cols-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">Tu cartera vale</span>
        <span className="tabular text-3xl font-semibold">{money(s.marketValue, currency)}</span>
        <span className={`tabular text-sm ${tone(s.dayChange)}`}>
          {money(s.dayChange, currency, true)} ({pct(s.dayChangePct)}) hoy
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">Ganaste en total</span>
        <span className={`tabular text-3xl font-semibold ${tone(s.totalGain)}`}>{money(s.totalGain, currency, true)}</span>
        <div className="mt-1 flex flex-col gap-0.5">
          <Line label="En lo que tenés hoy" value={money(s.unrealized, currency, true)} cls={tone(s.unrealized)} />
          {s.realized !== 0 && <Line label="En ventas ya hechas" value={money(s.realized, currency, true)} cls={tone(s.realized)} />}
          {s.dividends !== 0 && <Line label="En dividendos" value={money(s.dividends, currency, true)} cls={tone(s.dividends)} />}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted" title="Rendimiento anual considerando cuándo entró y salió cada peso">
          Rendimiento por año
        </span>
        <span className={`tabular text-3xl font-semibold ${irr != null ? tone(irr) : 'text-muted'}`}>{irr != null ? pct(irr) : '—'}</span>
        {real ? (
          <span className="text-sm">
            <span className={`tabular ${tone(real.pct)}`}>{pct(real.pct)}</span>{' '}
            <span className="text-muted">{real.pct >= 0 ? 'por encima' : 'por debajo'} de la inflación</span>
          </span>
        ) : (
          <span className="text-sm text-muted">Necesitás al menos un mes de operaciones</span>
        )}
      </div>

      {data.fx && (
        <p className="text-xs text-muted lg:col-span-3">
          Dólar {FX_LABEL[data.fxKind]}: {money(data.fx.rate, 'ARS')} ({date(data.fx.date)})
          {currency === 'USD' && ' · cada operación se convierte con el dólar del día en que se hizo'}
        </p>
      )}
    </section>
  );
}

/** Lo que pasó con tu cartera, contado en frases cortas. */
export function Insights({ data, history }: { data: Portfolio; history?: History }) {
  const { currency } = useSettings();
  const held = data.positions.filter((p) => p.quantity > 0);
  if (held.length === 0) return null;
  const items: { tone: 'up' | 'down' | 'info'; text: ReactNode }[] = [];
  const b = (t: string, cls = '') => <span className={`tabular font-medium ${cls}`}>{t}</span>;

  // Hoy: qué movió más la cartera, en plata
  const mover = [...held].sort((a, c) => Math.abs(c.dayChange) - Math.abs(a.dayChange))[0];
  if (mover && Math.abs(data.summary.dayChange) > 0) {
    items.push({
      tone: data.summary.dayChange >= 0 ? 'up' : 'down',
      text: (
        <>
          Hoy tu cartera {data.summary.dayChange >= 0 ? 'ganó' : 'perdió'} {b(money(Math.abs(data.summary.dayChange), currency))}. Lo que más
          pesó fue {b(mover.ticker)} ({b(money(mover.dayChange, currency, true), tone(mover.dayChange))}).
        </>
      ),
    });
  }

  // Este mes
  const month = history?.monthly[history.monthly.length - 1];
  if (month) {
    const name = MONTHS[Number(month.month.slice(5, 7)) - 1];
    items.push({
      tone: month.return >= 0 ? 'up' : 'down',
      text: (
        <>
          En lo que va de {name} tu cartera {month.return >= 0 ? 'rinde' : 'pierde'} {b(pct(Math.abs(month.return)).replace('+', ''), tone(month.return))}.
        </>
      ),
    });
  }

  // Contra el dólar: lo que más le importa al ahorrista argentino
  const dolar = history?.benchmarks.find((x) => x.key === 'dolar');
  if (dolar?.available && dolar.diff != null && dolar.diffPct != null) {
    items.push({
      tone: dolar.diff >= 0 ? 'up' : 'down',
      text: (
        <>
          Si con la misma plata hubieras comprado dólares, hoy tendrías {b(money(Math.abs(dolar.diff), currency))}{' '}
          {dolar.diff >= 0 ? 'menos' : 'más'}. {dolar.diff >= 0 ? 'Le estás ganando al dólar.' : 'Por ahora el dólar te viene ganando.'}
        </>
      ),
    });
  }

  // Mejor y peor
  if (held.length > 1) {
    const sorted = [...held].sort((a, c) => c.unrealizedPct - a.unrealizedPct);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    items.push({
      tone: 'info',
      text: (
        <>
          Tu mejor inversión es {b(best.ticker)} ({b(pct(best.unrealizedPct), tone(best.unrealizedPct))}) y la peor {b(worst.ticker)} (
          {b(pct(worst.unrealizedPct), tone(worst.unrealizedPct))}).
          {worst.unrealizedPct < 0 && (
            <>
              {' '}
              Para volver a su precio de compra, {worst.ticker} tiene que subir {b(pct(1 / (1 + worst.unrealizedPct) - 1).replace('+', ''))}.
            </>
          )}
        </>
      ),
    });
  }

  // Concentración
  const top = held.reduce((a, c) => (c.weight > a.weight ? c : a));
  if (top.weight > CONCENTRATION_LIMIT && held.length > 1) {
    items.push({
      tone: 'down',
      text: (
        <>
          {b(top.ticker)} es el {b(pct(top.weight).replace('+', ''))} de tu cartera: si a esa empresa le va mal, te afecta mucho. Diversificar
          reduce ese riesgo.
        </>
      ),
    });
  }

  const dot = { up: 'bg-up', down: 'bg-down', info: 'bg-accent' };
  return (
    <section className="rounded-xl bg-panel p-5">
      <h2 className="mb-3 font-medium">Resumen</h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-sm ${dot[it.tone]}`} />
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
