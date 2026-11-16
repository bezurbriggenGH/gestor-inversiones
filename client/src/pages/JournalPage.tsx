import { useState } from 'react';
import { Link } from 'react-router';
import type { JournalStats, Verdict } from '../api';
import { useJournal } from '../hooks';
import { useSettings } from '../settings';
import { date, money, num, pct } from '../format';
import { Button, ErrorBox, Explain, Loading } from '../components/ui';
import { HorizonList, VerdictBadge, explainVerdict, lacksPrices, MarketLine } from '../components/Verdict';
import { Patterns, WinsSummary, soldWithinText } from '../components/Balance';

// Con menos decisiones evaluadas, un porcentaje dice muy poco (3 de 4 no prueba nada): no se muestra
const MIN_JUDGED = 10;
const PAGE = 20;

/** Un margen de error en puntos: 0,066 → "6,6 puntos" */
const points = (m: number) => `${(m * 100).toFixed(1).replace('.', ',')} puntos`;

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
            : `${stats.hits} aciertos de ${stats.judged}${stats.margin != null ? ` · ± ${points(stats.margin)}` : ''}`}
        {sub ? ` · ${sub}` : ''}
      </p>
    </div>
  );
}

type Filter = 'TODAS' | Verdict | 'PENDIENTE';

export function JournalPage() {
  const { currency, fxKind } = useSettings();
  const { data, isLoading, error } = useJournal();
  const [filter, setFilter] = useState<Filter>('TODAS');
  // Se muestran de a PAGE decisiones: con cientos de operaciones, la lista entera mide decenas de pantallas
  const [shown, setShown] = useState(PAGE);

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
        <h1 className="text-2xl font-semibold tracking-tight">Diario de decisiones</h1>
        <p className="mt-1 text-sm text-muted">
          Qué hizo el precio 30, 90 y 180 días después de cada compra y venta, medido en dólares (así la inflación no hace que toda compra
          parezca un acierto). Mira el <span className="text-text">momento</span> de cada decisión, no si ganaste plata: eso está más abajo,
          en "Lo que pasó con tus ventas, en plata".
        </p>
        <p className="mt-1 text-xs text-muted">
          Se usa el dólar {fxKind === 'contadoconliqui' ? 'CCL' : 'MEP'}, el que tenés elegido en el menú (también si estás viendo en pesos). Con
          el otro dólar algunos aciertos cambian, porque no se mueven igual; "Contra el mercado" da lo mismo con los dos.
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
              {m.even > 0 && <span className="text-muted"> Otras {m.even} quedaron a menos de 2% del mercado: empates, no cuentan.</span>}
              {/* Con esta cantidad de decisiones, el porcentaje puede moverse por suerte: se dice cuánto */}
              {m.margin != null && (
                <span className="text-muted">
                  {' '}
                  Con esta cantidad de decisiones, el porcentaje tiene un margen de error de ± {points(m.margin)} (puede estar entre{' '}
                  {pct(Math.max(0, m.beat / m.compared - m.margin), 0).replace('+', '')} y {pct(Math.min(1, m.beat / m.compared + m.margin), 0).replace('+', '')}).
                </span>
              )}
              {m.compared < MIN_JUDGED && <span className="text-muted"> Son muy pocas todavía para sacar conclusiones.</span>}
            </p>
            {/* Compras y ventas por separado: no se miden con la misma vara (ver la explicación de abajo) */}
            <p className="tabular mt-1 text-sm text-muted">
              Compras: {m.buys.beat} de {m.buys.compared}
              {m.buys.compared > 0 && ` (${pct(m.buys.beat / m.buys.compared, 0).replace('+', '')})`} · Ventas: {m.sells.beat} de {m.sells.compared}
              {m.sells.compared > 0 && ` (${pct(m.sells.beat / m.sells.compared, 0).replace('+', '')})`}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm">Todavía no hay decisiones con datos del mercado para comparar.</p>
        )}
        <Explain label="¿Cómo se mide?" className="mt-3">
          <p>
            Cada compra y venta se compara con lo que hizo en esos mismos días el S&amp;P 500 (CEDEARs) o el Merval (acciones), en dólares.
            Ejemplo: compraste y a los 90 días subió 5%, pero el S&amp;P 500 subió 10%: el precio subió, pero te habría ido mejor en el índice.
            Una venta le gana al mercado si, después, lo que vendiste anduvo peor que el índice. Solo cuentan las decisiones que ya cumplieron
            90 días.
          </p>
          <p>
            Compras y ventas no se miden con la misma vara: unas pocas empresas explican gran parte de la suba del índice, así que la mayoría
            de las acciones individuales anda peor que él. Por eso una compra al azar suele ganarle al mercado menos de la mitad de las veces,
            y una venta al azar, más de la mitad.
          </p>
        </Explain>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Aciertos totales" stats={s.all} sub={s.all.pending ? `${s.all.pending} esperando` : undefined} />
        <StatCard label="En compras" stats={s.buys} />
        <StatCard label="En ventas" stats={s.sells} />
      </section>
      <div className="-mt-3 flex flex-col gap-1">
        <p className="text-xs text-muted">Una compra es acierto si a los 90 días el precio subió más de 2%; una venta, si bajó.</p>
        <Explain label="Más detalle">
          <p>
            En un mercado que viene subiendo, esto favorece a las compras: por eso lo principal es "contra el mercado". Una orden que el broker
            partió en varias cuenta como una decisión, y solo entran las que ya cumplieron 90 días. Se mide con el dólar que elegiste (MEP o
            CCL): con el otro, los porcentajes cambian un poco.
          </p>
        </Explain>
      </div>

      <Patterns journal={data} />

      {data.closed.count > 0 && (
        <details className="group rounded-xl bg-panel">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium">
            <span className="mr-2 inline-block text-muted transition group-open:rotate-90">›</span>
            Lo que pasó con tus ventas, en plata
          </summary>
          <div className="flex flex-col gap-4 px-2 pb-2">
            <WinsSummary journal={data} />
          </div>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        {(['TODAS', 'ACIERTO', 'ERROR', 'NEUTRAL', 'PENDIENTE'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setShown(PAGE);
            }}
            aria-pressed={filter === f}
            className={`rounded-sm px-3 py-1 text-xs transition ${filter === f ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
          >
            {{ TODAS: 'Todas', ACIERTO: 'Aciertos', ERROR: 'Errores', NEUTRAL: 'Neutrales', PENDIENTE: 'Esperando' }[f]}
          </button>
        ))}
      </div>

      {data.entries.length === 0 && <p className="text-muted">Cuando registres compras y ventas, vas a ver acá cómo te fue con cada decisión.</p>}

      <ul className="flex flex-col gap-3">
        {entries.slice(0, shown).map((e) => (
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
                  {e.offset > 0.999 ? (
                    <span className="rounded-md bg-card px-2 py-0.5 text-xs text-muted">Se compensa</span>
                  ) : (
                    <VerdictBadge verdict={e.verdict} days={e.verdictDays} noData={lacksPrices(e)} />
                  )}
                </span>
              </div>
              {e.note_title && <p className="text-sm">“{e.note_title}”</p>}
              {e.offset > 0.999 ? (
                // Comprar y vender lo mismo el mismo día no cambia lo que tenés: no es una decisión
                <p className="text-xs text-muted">
                  Ese día también {e.type === 'COMPRA' ? 'vendiste' : 'compraste'} {e.ticker}: se compensan y tu tenencia no cambió, así que no
                  cuenta como decisión en el Diario.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted">{explainVerdict(e)}</p>
                  {e.offset > 0 && (
                    <p className="text-xs text-muted">
                      Ese día también {e.type === 'COMPRA' ? 'vendiste' : 'compraste'} {e.ticker}: cuenta solo la parte que no se compensa.
                    </p>
                  )}
                  <MarketLine type={e.type} market={e.market} days={e.verdictDays} />
                </>
              )}
              {soldWithinText(e, currency) && <p className="tabular text-xs">{soldWithinText(e, currency)}</p>}
              {e.missed != null && e.offset < 0.999 && Math.abs(e.missed) >= 0.005 && (
                <p className="tabular text-xs text-muted">
                  Al precio de hoy: {e.missed > 0 ? 'dejaste de ganar' : 'te ahorraste de perder'}{' '}
                  <span className={e.missed > 0 ? 'text-down' : 'text-up'}>{money(Math.abs(e.missed), currency)}</span> por haber vendido (sin contar si después volviste a comprar).
                </p>
              )}
              <HorizonList entry={e} />
            </Link>
          </li>
        ))}
      </ul>

      {entries.length > shown && (
        <div className="flex flex-col items-center gap-2">
          <p className="tabular text-xs text-muted">
            Mostrando {shown} de {entries.length}
          </p>
          <Button onClick={() => setShown((n) => n + PAGE)}>Ver {Math.min(PAGE, entries.length - shown)} más</Button>
        </div>
      )}
    </div>
  );
}
