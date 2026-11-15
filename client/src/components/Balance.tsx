// Balance de tus decisiones: ¿operar te sumó o te restó?, cuánto pagaste en comisiones,
// qué pasó con lo que vendiste y dónde acertás más. Se usan en la Comparativa, el Diario y el Informe.
import { useState } from 'react';
import type { Costs, Currency, HoldComparison, Journal, JournalStats } from '../api';
import { useCosts, useHold } from '../hooks';
import { date, money, num, pct, todayIso, tone } from '../format';
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
        {c === 'ARS' &&
          ' La plata de cada compra y venta se pasa a pesos de hoy con la inflación (IPC): $600 de hace unos meses no valen lo mismo que $600 de hoy.'}
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
      {/* En pesos, la cuenta de arriba mezcla pesos de distintos años: lo que importa es contra la inflación */}
      {data.real && (
        <p className="text-sm">
          Descontada la inflación, son <span className="tabular font-semibold">{money(data.real.fees, 'ARS')}</span> de hoy
          {data.real.pctOfGain != null ? (
            <>
              : se llevaron el <span className="tabular font-semibold">{share(data.real.pctOfGain)}</span> de lo que le habrías ganado a la
              inflación sin pagarlas.
            </>
          ) : (
            '.'
          )}{' '}
          <span className="text-xs text-muted">
            Cada comisión se pasa a pesos de hoy con el IPC y se compara contra lo que le ganaste a la inflación (lo que muestra la portada).
          </span>
        </p>
      )}
      <table className="tabular w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="py-2 font-normal">Año</th>
            <th className="hidden py-2 text-right font-normal sm:table-cell">Operaciones</th>
            <th className="py-2 text-right font-normal">Monto operado</th>
            <th className="py-2 text-right font-normal">Comisiones</th>
            <th className="py-2 text-right font-normal">% del monto</th>
          </tr>
        </thead>
        <tbody>
          {data.byYear.map((y) => (
            <tr key={y.year} className="border-b border-line/50">
              <td className="py-2">{y.year}</td>
              <td className="hidden py-2 text-right sm:table-cell">{y.operations}</td>
              <td className="py-2 text-right">{money(y.traded, c, false, true)}</td>
              <td className="py-2 text-right">{money(y.fees, c)}</td>
              <td className="py-2 text-right">{share(y.pctOfTraded)}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-2">Total</td>
            <td className="hidden py-2 text-right sm:table-cell">{data.operations}</td>
            <td className="py-2 text-right">{money(data.traded, c, false, true)}</td>
            <td className="py-2 text-right">{money(data.fees, c)}</td>
            <td className="py-2 text-right">{share(data.pctOfTraded)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-muted">
        Comisiones, derechos de mercado e IVA de cada compra y venta, tal como se cargaron.
        {data.withoutFees > 0 && ` ${data.withoutFees} ${data.withoutFees === 1 ? 'operación no tiene' : 'operaciones no tienen'} comisión cargada.`}
        {data.withheld > 0 &&
          ` Aparte, de los dividendos te descontaron ${money(data.withheld, c)} en retenciones y gastos (lo que figura en cada dividendo cargado). En los de CEDEARs, el broker suele acreditarlos ya descontada la retención de EE.UU. (en general 30%): esa parte no está en este número.`}
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

/**
 * En una compra: qué vendiste dentro del plazo en que se la juzga. El veredicto mira el momento
 * (qué hizo el precio después); esto dice si, de todos modos, saliste ganando.
 */
export function soldWithinText(
  e: { type: string; verdict: string | null; soldWithin: { quantity: number; realized: number } | null },
  currency: Currency,
): string | null {
  const s = e.soldWithin;
  if (e.type !== 'COMPRA' || !s) return null;
  const result = `${s.realized >= 0 ? 'ganaste' : 'perdiste'} ${money(Math.abs(s.realized), currency)}`;
  if (!e.verdict) return `Desde entonces vendiste ${num(s.quantity)} y ${result} con esas ventas.`;
  // El caso que más confunde: el precio bajó después, pero ya habías vendido ganando (o al revés)
  const but = (e.verdict === 'ERROR' && s.realized > 0) || (e.verdict === 'ACIERTO' && s.realized < 0) ? 'Pero dentro' : 'Dentro';
  return `${but} de ese plazo vendiste ${num(s.quantity)} y ${result} con esas ventas.`;
}

/** Ventas con ganancia: en cuántas ganaste plata, y cuánto. */
export function WinsSummary({ journal }: { journal: Journal }) {
  const w = journal.closed;
  const c = w.currency; // en dólares, aunque estés viendo la app en pesos
  if (w.count === 0) return null;
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-panel p-5">
      <h2 className="font-medium">Ventas con ganancia</h2>
      <p className="text-lg">
        Ganaste plata en <span className="tabular font-semibold">{w.wins}</span> de tus <span className="tabular font-semibold">{w.wins + w.losses}</span>{' '}
        ventas{w.winRate != null && <span className="tabular text-muted"> ({share(w.winRate)})</span>}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">En las que ganaste</p>
          <p className="tabular mt-1 text-xl font-semibold text-up">{money(w.gained, c, true)}</p>
          <p className="tabular text-xs text-muted">{w.wins > 0 ? `${money(w.gained / w.wins, c)} por venta, en promedio` : 'ninguna'}</p>
        </div>
        <div className="rounded-lg bg-card px-4 py-3">
          <p className="text-xs text-muted">En las que perdiste</p>
          <p className="tabular mt-1 text-xl font-semibold text-down">{money(-w.lost, c, true)}</p>
          <p className="tabular text-xs text-muted">{w.losses > 0 ? `${money(w.lost / w.losses, c)} por venta, en promedio` : 'ninguna'}</p>
        </div>
      </div>
      <p className="text-xs text-muted">
        Es otra cosa que los aciertos de arriba: acá no importa qué hizo el precio después, sino si cobraste más de lo que te habían costado
        esas acciones (a tu precio promedio, comisiones incluidas). Mirá el porcentaje junto con los montos: se puede ganar en casi todas las
        ventas y perder plata si la única mala fue grande. Las ventas del mismo activo en el mismo día cuentan como una.
        {c === 'USD' &&
          ' Se mide en dólares, como el resto del Diario: en pesos, la inflación hace que con el tiempo casi cualquier venta dé ganancia.'}
      </p>
    </section>
  );
}

/**
 * Frases que comparan dos grupos de decisiones. Una diferencia solo se afirma si es real (el servidor
 * hace la prueba estadística): si puede ser casualidad, se dice eso, en vez de presentarla como un hecho.
 */
export function journalPatterns(journal: Pick<Journal, 'stats' | 'differences'>): string[] {
  const { stats, differences } = journal;
  const MIN = 10; // el mismo mínimo que usa el servidor: con menos, un porcentaje dice muy poco
  const out: string[] = [];
  const compare = (
    a: JournalStats,
    b: JournalStats,
    real: boolean,
    names: [string, string],
    more: (winner: 'a' | 'b', points: number, hi: string, lo: string) => string,
  ) => {
    if (a.judged < MIN || b.judged < MIN || a.hitRate == null || b.hitRate == null) return;
    const d = a.hitRate - b.hitRate;
    if (!real) {
      // Ejemplo: "Comprando acertás 44% (de 198) y vendiendo, 51% (de 76). Esa diferencia no alcanza…"
      out.push(
        `${names[0]} acertás ${share(a.hitRate)} (de ${a.judged}) y ${names[1]}, ${share(b.hitRate)} (de ${b.judged}). ` +
          'Esa diferencia no alcanza para afirmar nada: puede ser casualidad, o depender de uno o dos activos.',
      );
    } else {
      out.push(more(d > 0 ? 'a' : 'b', Math.round(Math.abs(d) * 100), share(Math.max(a.hitRate, b.hitRate)), share(Math.min(a.hitRate, b.hitRate))));
    }
  };
  compare(stats.buys, stats.sells, differences.buysSells, ['Comprando', 'vendiendo'], (w, p, hi, lo) =>
    w === 'a'
      ? `Elegís mejor cuándo comprar (${hi} de aciertos) que cuándo vender (${lo}): ${p} puntos de diferencia, demasiados para ser casualidad (y no depende de un solo activo).`
      : `Elegís mejor cuándo vender (${hi} de aciertos) que cuándo comprar (${lo}): ${p} puntos de diferencia, demasiados para ser casualidad (y no depende de un solo activo).`,
  );
  compare(stats.acciones, stats.cedears, differences.accionesCedears, ['En acciones argentinas', 'en CEDEARs'], (w, p, hi, lo) =>
    w === 'a'
      ? `Te va mejor con acciones argentinas (${hi}) que con CEDEARs (${lo}): ${p} puntos de diferencia, demasiados para ser casualidad (y no depende de un solo activo).`
      : `Te va mejor con CEDEARs (${hi}) que con acciones argentinas (${lo}): ${p} puntos de diferencia, demasiados para ser casualidad (y no depende de un solo activo).`,
  );
  compare(stats.withNote, stats.withoutNote, differences.note, ['Con justificación', 'sin ella'], (w, p, hi, lo) =>
    w === 'a'
      ? `Cuando escribís por qué operás acertás más (${hi} contra ${lo}): ${p} puntos de diferencia. Seguí justificando tus decisiones.`
      : `Curiosamente, acertás menos en las operaciones que justificaste (${lo} contra ${hi}).`,
  );
  if (stats.withNote.judged < MIN && stats.withoutNote.judged >= MIN) {
    out.push(
      `Justificaste muy pocas decisiones (${stats.withNote.judged} ya evaluadas) para saber si escribir por qué operás te ayuda. ` +
        `Con al menos ${MIN} se puede empezar a comparar.`,
    );
  }
  return out;
}

export function Patterns({ journal }: { journal: Journal }) {
  const lines = journalPatterns(journal);
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
      <p className="mt-3 text-xs text-muted">
        Una diferencia se afirma solo si pasa una prueba estadística: tiene que ser demasiado grande para salir de la suerte, también al
        sacar cualquier activo de a uno (31 compras de la misma acción son casi una sola apuesta, no 31). Como se hacen tres comparaciones a
        la vez, a cada una se le pide más que a una sola.
      </p>
    </section>
  );
}
