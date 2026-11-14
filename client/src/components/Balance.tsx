// Balance de tus decisiones: ¿operar te sumó o te restó?, cuánto pagaste en comisiones,
// qué pasó con lo que vendiste y dónde acertás más. Se usan en la Comparativa, el Diario y el Informe.
import { useState } from 'react';
import type { Costs, HoldComparison, Journal, JournalStats } from '../api';
import { useCosts, useHold } from '../hooks';
import { date, money, pct, todayIso, tone } from '../format';
import { ErrorBox, Loading } from './ui';

const share = (v: number) => pct(v).replace('+', '');

function isoMinus(months: number): string {
  const d = new Date(`${todayIso()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Desde cuándo se congela la cartera. */
export const HOLD_PERIODS = [
  { key: 'anio', label: 'Este año', since: () => `${todayIso().slice(0, 4)}-01-01` },
  { key: '3m', label: '3 meses', since: () => isoMinus(3) },
  { key: '6m', label: '6 meses', since: () => isoMinus(6) },
  { key: '12m', label: '1 año', since: () => isoMinus(12) },
] as const;

export function HoldResult({ data }: { data: HoldComparison }) {
  const c = data.currency;
  if (data.trades === 0) {
    return <p className="text-sm text-muted">Desde el {date(data.since)} no compraste ni vendiste nada: no hay nada que comparar.</p>;
  }
  if (data.frozenValue === 0) {
    return <p className="text-sm text-muted">El {date(data.since)} todavía no tenías nada invertido: elegí un período más corto.</p>;
  }
  const better = data.diff >= 0;
  const best = data.rows.filter((r) => r.diff > 0).slice(0, 3);
  const worst = data.rows.filter((r) => r.diff < 0).slice(-3).reverse();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg">
        Operar te {better ? 'sumó' : 'restó'} <span className={`tabular font-semibold ${tone(data.diff)}`}>{money(Math.abs(data.diff), c)}</span>{' '}
        <span className="text-sm text-muted">
          ({data.trades} compras y ventas desde el {date(data.since)})
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">Si no hubieras tocado nada</p>
          <p className="tabular mt-1 text-xl font-semibold">{money(data.frozenValue, c)}</p>
          <p className="text-xs text-muted">Lo que valdría hoy lo que tenías ese día</p>
        </div>
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">Con lo que hiciste</p>
          <p className="tabular mt-1 text-xl font-semibold">{money(data.result, c)}</p>
          <p className="tabular text-xs text-muted">
            {money(data.actualValue, c)} en cartera {data.cash >= 0 ? '+' : '−'} {money(Math.abs(data.cash), c)}{' '}
            {data.cash >= 0 ? 'que sacaste' : 'que pusiste de más'}
          </p>
        </div>
      </div>
      {(best.length > 0 || worst.length > 0) && (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Movers title="Lo que más te sumó" rows={best} currency={c} />
          <Movers title="Lo que más te restó" rows={worst} currency={c} />
        </div>
      )}
      <p className="text-xs text-muted">
        Se compara lo que tenías el {date(data.since)}, a precios de hoy, contra lo que tenés hoy más la plata que sacaste (o menos la que
        pusiste) comprando y vendiendo desde entonces. Los dividendos no se cuentan en ninguno de los dos lados.
      </p>
    </div>
  );
}

function Movers({ title, rows, currency }: { title: string; rows: HoldComparison['rows']; currency: HoldComparison['currency'] }) {
  if (rows.length === 0) return <div />;
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{title}</p>
      <ul className="tabular flex flex-col gap-0.5">
        {rows.map((r) => (
          <li key={r.ticker} className="flex justify-between gap-4">
            <span>{r.ticker}</span>
            <span className={tone(r.diff)}>{money(r.diff, currency, true)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "¿Y si no hubieras tocado nada?", con selector de período. */
export function HoldSection() {
  const [period, setPeriod] = useState<(typeof HOLD_PERIODS)[number]['key']>('anio');
  const since = HOLD_PERIODS.find((p) => p.key === period)!.since();
  const { data, isLoading, error } = useHold(since);
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">¿Y si no hubieras tocado nada?</h2>
        <div className="flex gap-1 rounded-lg bg-bg p-1 print:hidden">
          {HOLD_PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={`rounded-md px-3 py-1 text-xs transition ${period === p.key ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {isLoading ? <Loading label="Calculando…" /> : error || !data ? <ErrorBox error={error} /> : <HoldResult data={data} />}
    </section>
  );
}

export function CostsResult({ data }: { data: Costs }) {
  const c = data.currency;
  if (data.operations === 0) return <p className="text-sm text-muted">Todavía no hay compras ni ventas cargadas.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg">
        Pagaste <span className="tabular font-semibold">{money(data.fees, c)}</span> en comisiones
        {data.pctOfGain != null && (
          <>
            : el <span className="tabular font-semibold">{share(data.pctOfGain)}</span> de lo que hubieras ganado sin pagarlas
          </>
        )}
        .
      </p>
      <table className="tabular w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 font-normal">Año</th>
            <th className="py-2 text-right font-normal">Operaciones</th>
            <th className="py-2 text-right font-normal">Monto operado</th>
            <th className="py-2 text-right font-normal">Comisiones</th>
            <th className="py-2 text-right font-normal">% del monto</th>
          </tr>
        </thead>
        <tbody>
          {data.byYear.map((y) => (
            <tr key={y.year} className="border-b border-line/50">
              <td className="py-2">{y.year}</td>
              <td className="py-2 text-right">{y.operations}</td>
              <td className="py-2 text-right">{money(y.traded, c, false, true)}</td>
              <td className="py-2 text-right">{money(y.fees, c)}</td>
              <td className="py-2 text-right">{share(y.pctOfTraded)}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-2">Total</td>
            <td className="py-2 text-right">{data.operations}</td>
            <td className="py-2 text-right">{money(data.traded, c, false, true)}</td>
            <td className="py-2 text-right">{money(data.fees, c)}</td>
            <td className="py-2 text-right">{share(data.pctOfTraded)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted">
        Comisiones, derechos de mercado e IVA de cada compra y venta, tal como se cargaron.
        {data.withoutFees > 0 && ` ${data.withoutFees} ${data.withoutFees === 1 ? 'operación no tiene' : 'operaciones no tienen'} comisión cargada.`}
        {data.withheld > 0 && ` Aparte, de los dividendos te descontaron ${money(data.withheld, c)} en retenciones y gastos.`}
      </p>
    </div>
  );
}

export function CostsSection() {
  const { data, isLoading, error } = useCosts();
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-panel p-5">
      <h2 className="font-medium">Cuánto te costó operar</h2>
      {isLoading ? <Loading label="Calculando…" /> : error || !data ? <ErrorBox error={error} /> : <CostsResult data={data} />}
    </section>
  );
}

/** Qué pasó, en plata, con lo que vendiste: una frase y los dos totales. */
export function SoldSummary({ journal }: { journal: Journal }) {
  const s = journal.sold;
  const c = journal.currency;
  if (s.count === 0) return null;
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-panel p-5">
      <h2 className="font-medium">Qué pasó con lo que vendiste</h2>
      <p className="text-lg">
        {s.net >= 0 ? 'En conjunto, vender te convino: hoy tendrías ' : 'En conjunto, vender no te convino: hoy tendrías '}
        <span className={`tabular font-semibold ${tone(s.net)}`}>{money(Math.abs(s.net), c)}</span> {s.net >= 0 ? 'menos' : 'más'} si te hubieras
        quedado con todo.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">Después de vender, el precio subió</p>
          <p className="tabular mt-1 text-xl font-semibold text-down">{money(s.missed, c)}</p>
          <p className="text-xs text-muted">que dejaste de ganar en {s.missedCount} {s.missedCount === 1 ? "venta" : "ventas"}</p>
        </div>
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">Después de vender, el precio bajó</p>
          <p className="tabular mt-1 text-xl font-semibold text-up">{money(s.saved, c)}</p>
          <p className="text-xs text-muted">que te ahorraste de perder en {s.savedCount} {s.savedCount === 1 ? "venta" : "ventas"}</p>
        </div>
      </div>
      <p className="text-xs text-muted">
        Compara el precio al que vendiste con el de hoy, en dólares{c === 'ARS' ? ' y pasado a pesos de hoy' : ''}: así la inflación no hace que toda
        venta parezca plata perdida. No cuenta lo que hiciste después con esa plata.
      </p>
    </section>
  );
}

/** Frases que comparan dos grupos de operaciones. Solo si hay suficientes de cada lado. */
export function journalPatterns(stats: Journal['stats']): string[] {
  const MIN = 5; // con menos operaciones evaluadas, la diferencia puede ser casualidad
  const out: string[] = [];
  const compare = (a: JournalStats, b: JournalStats, same: string, more: (winner: 'a' | 'b', points: number, hi: string, lo: string) => string) => {
    if (a.judged < MIN || b.judged < MIN || a.hitRate == null || b.hitRate == null) return;
    const d = a.hitRate - b.hitRate;
    if (Math.abs(d) < 0.05) out.push(same);
    else out.push(more(d > 0 ? 'a' : 'b', Math.round(Math.abs(d) * 100), share(Math.max(a.hitRate, b.hitRate)), share(Math.min(a.hitRate, b.hitRate))));
  };
  compare(stats.buys, stats.sells, 'Acertás más o menos igual comprando que vendiendo.', (w, p, hi, lo) =>
    w === 'a'
      ? `Elegís mejor cuándo comprar (${hi} de aciertos) que cuándo vender (${lo}): ${p} puntos de diferencia.`
      : `Elegís mejor cuándo vender (${hi} de aciertos) que cuándo comprar (${lo}): ${p} puntos de diferencia.`,
  );
  compare(stats.acciones, stats.cedears, 'Acertás más o menos igual en acciones argentinas que en CEDEARs.', (w, p, hi, lo) =>
    w === 'a'
      ? `Te va mejor con acciones argentinas (${hi}) que con CEDEARs (${lo}): ${p} puntos de diferencia.`
      : `Te va mejor con CEDEARs (${hi}) que con acciones argentinas (${lo}): ${p} puntos de diferencia.`,
  );
  compare(stats.withNote, stats.withoutNote, 'Acertás más o menos igual con o sin justificación.', (w, p, hi, lo) =>
    w === 'a'
      ? `Cuando escribís por qué operás acertás más (${hi} contra ${lo}): ${p} puntos de diferencia. Seguí justificando tus decisiones.`
      : `Curiosamente, acertás menos en las operaciones que justificaste (${lo} contra ${hi}).`,
  );
  if (stats.withNote.judged < MIN && stats.withoutNote.judged >= MIN) {
    out.push('Casi no escribiste por qué hacías cada operación. Si empezás a justificarlas, acá vas a ver si eso te ayuda a acertar más.');
  }
  return out;
}

export function Patterns({ journal }: { journal: Journal }) {
  const lines = journalPatterns(journal.stats);
  if (lines.length === 0) return null;
  return (
    <section className="rounded-xl bg-panel p-5">
      <h2 className="mb-3 font-medium">Dónde acertás más</h2>
      <ul className="flex flex-col gap-2.5">
        {lines.map((text) => (
          <li key={text} className="flex gap-3 text-sm leading-relaxed">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-accent" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
