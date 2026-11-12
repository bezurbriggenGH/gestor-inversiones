import type { ReactNode } from 'react';
import type { History, Portfolio } from '../api';
import { useSettings } from '../settings';
import { FX_LABEL, capitalize, date, dayLabel, latestPriceDate, money, pct, tone } from '../format';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CONCENTRATION_LIMIT = 0.35;
/** Cada dato del panel de arriba va en su propio recuadro, más oscuro que el panel */
const CARD = 'flex flex-col gap-1 rounded-lg border border-line/60 bg-bg/70 p-5';

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
  // El mismo valor en la otra moneda, con el dólar de hoy
  const other =
    data.fx && data.fx.rate > 0
      ? currency === 'ARS'
        ? money(s.marketValue / data.fx.rate, 'USD')
        : money(s.marketValue * data.fx.rate, 'ARS')
      : null;

  return (
    <section className="grid gap-3 rounded-xl bg-panel p-3 md:grid-cols-2 xl:grid-cols-3">
      <div className={CARD}>
        <span className="text-sm text-muted">Tu cartera vale</span>
        <span className="tabular text-3xl font-semibold">{money(s.marketValue, currency)}</span>
        {other && (
          <span className="tabular text-sm text-muted">
            ≈ {other} ({FX_LABEL[data.fxKind]})
          </span>
        )}
        <span className={`tabular mt-1 text-sm ${tone(s.dayChange)}`}>
          {money(s.dayChange, currency, true)} ({pct(s.dayChangePct)}) {dayLabel(latestPriceDate(data.positions))}
        </span>
      </div>

      <div className={CARD}>
        <span className="text-sm text-muted">Ganaste en total</span>
        <span className={`tabular text-3xl font-semibold ${tone(s.totalGain)}`}>{money(s.totalGain, currency, true)}</span>
        {s.peakCapital > 0 && (
          <span
            className="tabular text-sm text-muted"
            title="Lo máximo que llegaste a tener invertido de tu bolsillo: compras menos lo que ya recuperaste con ventas y dividendos"
          >
            <span className={`font-medium ${tone(s.totalGainPct)}`}>{pct(s.totalGainPct)}</span> sobre{' '}
            {money(s.peakCapital, currency)} que llegaste a tener puesto
          </span>
        )}
        <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
          <Line label="En lo que tenés hoy" value={money(s.unrealized, currency, true)} cls={tone(s.unrealized)} />
          {s.realized !== 0 && <Line label="En ventas ya hechas" value={money(s.realized, currency, true)} cls={tone(s.realized)} />}
          {s.dividends !== 0 && <Line label="En dividendos" value={money(s.dividends, currency, true)} cls={tone(s.dividends)} />}
        </div>
      </div>

      <div className={`${CARD} md:col-span-2 xl:col-span-1`}>
        <span className="text-sm text-muted" title="Rendimiento anual considerando cuándo entró y salió cada peso">
          Rendimiento por año
        </span>
        <span className={`tabular text-3xl font-semibold ${irr != null ? tone(irr) : 'text-muted'}`}>{irr != null ? pct(irr) : '—'}</span>
        {real?.irr != null ? (
          // También por año, para que se pueda comparar con el número de arriba
          <span className="text-sm" title={`En todo el período: ${pct(real.pct)} contra la inflación`}>
            <span className={`tabular ${tone(real.irr)}`}>{pct(real.irr)}</span>{' '}
            <span className="text-muted">por año {real.irr >= 0 ? 'por encima' : 'por debajo'} de la inflación</span>
          </span>
        ) : real ? (
          <span className="text-sm">
            <span className={`tabular ${tone(real.pct)}`}>{pct(real.pct)}</span>{' '}
            <span className="text-muted">{real.pct >= 0 ? 'por encima' : 'por debajo'} de la inflación en todo el período</span>
          </span>
        ) : (
          <span className="text-sm text-muted">Necesitás al menos un mes de operaciones</span>
        )}
      </div>

      {data.fx && (
        <p className="px-2 pb-1 text-xs text-muted md:col-span-2 xl:col-span-3">
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

  // Último día con precios: qué movió más la cartera, en plata
  const mover = [...held].sort((a, c) => Math.abs(c.dayChange) - Math.abs(a.dayChange))[0];
  if (mover && Math.abs(data.summary.dayChange) > 0) {
    items.push({
      tone: data.summary.dayChange >= 0 ? 'up' : 'down',
      text: (
        <>
          {capitalize(dayLabel(latestPriceDate(data.positions)))} tu cartera {data.summary.dayChange >= 0 ? 'ganó' : 'perdió'}{' '}
          {b(money(Math.abs(data.summary.dayChange), currency))}. Lo que más pesó fue {b(mover.ticker)} (
          {b(money(mover.dayChange, currency, true), tone(mover.dayChange))}).
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

  // Mejor y peor de lo que tenés hoy (como lo muestra el broker)…
  if (held.length > 1) {
    const sorted = [...held].sort((a, c) => c.unrealizedPct - a.unrealizedPct);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    items.push({
      tone: 'info',
      text: (
        <>
          De lo que tenés hoy, la que más gana es {b(best.ticker)} ({b(pct(best.unrealizedPct), tone(best.unrealizedPct))}) y la que más
          pierde, {b(worst.ticker)} ({b(pct(worst.unrealizedPct), tone(worst.unrealizedPct))}).
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

  // …y contando todo: ventas ya hechas, dividendos y también los activos que ya no tenés
  const traded = data.positions.filter((p) => p.totalGain !== 0);
  if (traded.length > 1) {
    const byTotal = [...traded].sort((a, c) => c.totalGain - a.totalGain);
    const top = byTotal[0];
    const bottom = byTotal[byTotal.length - 1];
    items.push({
      tone: 'info',
      text: (
        <>
          Contando también lo que ya vendiste, la que más plata te dio es {b(top.ticker)} ({b(money(top.totalGain, currency, true), tone(top.totalGain))})
          {bottom.totalGain < 0 && (
            <>
              {' '}
              y la que más te hizo perder, {b(bottom.ticker)} ({b(money(bottom.totalGain, currency, true), tone(bottom.totalGain))})
            </>
          )}
          .
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
