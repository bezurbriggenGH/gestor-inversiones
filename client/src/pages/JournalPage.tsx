import { useState } from 'react';
import { Link } from 'react-router';
import type { JournalStats, Verdict } from '../api';
import { useJournal } from '../hooks';
import { useSettings } from '../settings';
import { date, money, num, pct } from '../format';
import { ErrorBox, Loading } from '../components/ui';
import { HorizonList, VerdictBadge, explainVerdict, lacksPrices, MarketLine } from '../components/Verdict';
import { Patterns, SoldSummary, WinsSummary, soldWithinText } from '../components/Balance';

// Con menos decisiones evaluadas, un porcentaje dice muy poco (3 de 4 no prueba nada): no se muestra
const MIN_JUDGED = 10;

function StatCard({ label, stats, sub }: { label: string; stats: JournalStats; sub?: string }) {
  const few = stats.judged < MIN_JUDGED;
  return (
    <div className="rounded-xl bg-panel p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">{!few && stats.hitRate != null ? pct(stats.hitRate).replace('+', '') : '—'}</p>
      <p className="tabular text-xs text-muted">
        {stats.judged === 0
          ? 'sin decisiones evaluadas'
          : few
            ? `solo ${stats.judged} evaluadas: muy pocas para un porcentaje`
            : `${stats.hits} aciertos de ${stats.judged}`}
        {sub ? ` · ${sub}` : ''}
      </p>
    </div>
  );
}

type Filter = 'TODAS' | Verdict | 'PENDIENTE';

export function JournalPage() {
  const { currency } = useSettings();
  const { data, isLoading, error } = useJournal();
  const [filter, setFilter] = useState<Filter>('TODAS');

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const s = data.stats;
  const m = data.vsMarket;
  const entries = data.entries.filter((e) =>
    filter === 'TODAS' ? true : filter === 'PENDIENTE' ? !e.verdict : e.verdict === filter,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Diario de decisiones</h1>
        <p className="mt-1 text-sm text-muted">
          Qué hizo el precio 30, 90 y 180 días después de cada compra y venta, medido en dólares (así la inflación no hace que toda compra
          parezca un acierto). Mira el <span className="text-text">momento</span> de cada decisión, no si ganaste plata: eso está más abajo,
          en "Lo que pasó con tus ventas, en plata".
        </p>
      </div>

      {/* La medida principal: que un precio suba no prueba que elegiste bien si en esos días subió todo */}
      <section className="rounded-xl bg-panel p-5">
        <h2 className="text-sm text-muted">Contra el mercado</h2>
        {m.compared > 0 ? (
          <>
            <p className="tabular mt-1 text-3xl font-semibold">{pct(m.beat / m.compared).replace('+', '')}</p>
            <p className="text-sm">
              En <span className="tabular font-medium">{m.beat} de {m.compared}</span> decisiones elegiste mejor que el mercado en el mismo plazo.
              {m.compared < MIN_JUDGED ? (
                <span className="text-muted"> Son muy pocas todavía para sacar conclusiones.</span>
              ) : m.differsFromChance ? (
                <span className="text-muted">
                  {' '}
                  {m.beat / m.compared > 0.5
                    ? 'Es más de lo que daría elegir al azar, y con tantas decisiones no parece suerte.'
                    : 'Es menos de lo que daría elegir al azar, y con tantas decisiones no parece mala suerte: te habría ido mejor en el índice.'}
                </span>
              ) : (
                <span className="text-muted"> Está cerca del 50%: con esta cantidad de decisiones, no se distingue de elegir al azar.</span>
              )}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm">Todavía no hay decisiones con datos del mercado para comparar.</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Cada compra y venta se compara con lo que hizo en esos mismos días el S&amp;P 500 (CEDEARs) o el Merval (acciones), en dólares.
          Ejemplo: compraste y a los 90 días subió 5%, pero el S&amp;P 500 subió 10%: el precio subió, pero te habría ido mejor en el índice.
          Una venta le gana al mercado si, después, lo que vendiste anduvo peor que el índice. Con 50% sería como elegir al azar.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Aciertos totales" stats={s.all} sub={s.all.pending ? `${s.all.pending} esperando` : undefined} />
        <StatCard label="En compras" stats={s.buys} />
        <StatCard label="En ventas" stats={s.sells} />
      </section>
      <p className="-mt-3 text-xs text-muted">
        Una compra es acierto si a los 90 días el precio subió más de 2%; una venta, si bajó. En un mercado que viene subiendo, esto favorece a
        las compras: por eso lo principal es "contra el mercado". Una orden que el broker partió en varias cuenta como una decisión.
      </p>

      <Patterns journal={data} />

      {(data.closed.count > 0 || data.sold.count > 0) && (
        <details className="group rounded-xl bg-panel">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium">
            <span className="mr-2 inline-block text-muted transition group-open:rotate-90">›</span>
            Lo que pasó con tus ventas, en plata
          </summary>
          <div className="flex flex-col gap-4 px-2 pb-2">
            <WinsSummary journal={data} />
            <SoldSummary journal={data} />
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        {(['TODAS', 'ACIERTO', 'ERROR', 'NEUTRAL', 'PENDIENTE'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-sm px-3 py-1 text-xs transition ${filter === f ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
          >
            {{ TODAS: 'Todas', ACIERTO: 'Aciertos', ERROR: 'Errores', NEUTRAL: 'Neutrales', PENDIENTE: 'Esperando' }[f]}
          </button>
        ))}
      </div>

      {data.entries.length === 0 && <p className="text-muted">Cuando registres compras y ventas, vas a ver acá cómo te fue con cada decisión.</p>}

      <ul className="flex flex-col gap-3">
        {entries.map((e) => (
          <li key={e.id}>
            <Link to={`/operacion/${e.id}`} className="flex flex-col gap-2 rounded-xl bg-panel p-4 transition hover:bg-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`h-3 w-3 rounded-full ${e.type === 'COMPRA' ? 'bg-up' : 'bg-down'}`} />
                <span className="font-medium">
                  {e.type === 'COMPRA' ? 'Compra' : 'Venta'} {e.ticker}
                </span>
                <span className="tabular text-sm text-muted">
                  {date(e.date)} · {num(e.quantity)} a {money(e.price, currency)}
                </span>
                <span className="ml-auto">
                  <VerdictBadge verdict={e.verdict} days={e.verdictDays} noData={lacksPrices(e)} />
                </span>
              </div>
              {e.note_title && <p className="text-sm">“{e.note_title}”</p>}
              <p className="text-xs text-muted">{explainVerdict(e)}</p>
              <MarketLine type={e.type} market={e.market} days={e.verdictDays} />
              {soldWithinText(e, currency) && <p className="tabular text-xs">{soldWithinText(e, currency)}</p>}
              {e.missed != null && Math.abs(e.missed) >= 0.005 && (
                <p className="tabular text-xs text-muted">
                  Al precio de hoy: {e.missed > 0 ? 'dejaste de ganar' : 'te ahorraste de perder'}{' '}
                  <span className={e.missed > 0 ? 'text-down' : 'text-up'}>{money(Math.abs(e.missed), currency)}</span> por haber vendido.
                </p>
              )}
              <HorizonList entry={e} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
