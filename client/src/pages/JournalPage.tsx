import { useState } from 'react';
import { Link } from 'react-router';
import type { JournalStats, Verdict } from '../api';
import { useJournal } from '../hooks';
import { useSettings } from '../settings';
import { date, money, num, pct } from '../format';
import { ErrorBox, Loading } from '../components/ui';
import { HorizonList, VerdictBadge, explainVerdict } from '../components/Verdict';

function StatCard({ label, stats, sub }: { label: string; stats: JournalStats; sub?: string }) {
  return (
    <div className="rounded-xl bg-panel p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{stats.hitRate != null ? pct(stats.hitRate).replace('+', '') : '—'}</p>
      <p className="tabular text-xs text-muted">
        {stats.judged ? `${stats.hits} aciertos de ${stats.judged}` : 'sin operaciones evaluadas'}
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
  const entries = data.entries.filter((e) =>
    filter === 'TODAS' ? true : filter === 'PENDIENTE' ? !e.verdict : e.verdict === filter,
  );

  // Conclusión: ¿justificar las decisiones mejora los resultados?
  let insight: string | null = null;
  if (s.withNote.judged >= 2 && s.withoutNote.judged >= 2 && s.withNote.hitRate != null && s.withoutNote.hitRate != null) {
    const d = s.withNote.hitRate - s.withoutNote.hitRate;
    insight =
      Math.abs(d) < 0.05
        ? 'Acertás más o menos igual con o sin justificación.'
        : d > 0
          ? `Cuando escribís por qué operás, acertás ${Math.round(d * 100)} puntos más. Seguí justificando tus decisiones.`
          : `Curiosamente, acertás ${Math.round(-d * 100)} puntos menos en las operaciones que justificaste.`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Diario de decisiones</h1>
        <p className="mt-1 text-sm text-muted">
          Qué hizo el precio 30, 90 y 180 días después de cada compra y venta. Una compra es acierto si a los 90 días el precio subió; una
          venta, si bajó. Movimientos menores al 2% cuentan como neutrales.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Aciertos totales" stats={s.all} sub={s.all.pending ? `${s.all.pending} esperando` : undefined} />
        <StatCard label="En compras" stats={s.buys} />
        <StatCard label="En ventas" stats={s.sells} />
        <StatCard label="Con justificación" stats={s.withNote} sub={s.withoutNote.hitRate != null ? `sin: ${pct(s.withoutNote.hitRate).replace('+', '')}` : undefined} />
      </section>

      {insight && <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">💡 {insight}</p>}

      <div className="flex flex-wrap gap-2">
        {(['TODAS', 'ACIERTO', 'ERROR', 'NEUTRAL', 'PENDIENTE'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs transition ${filter === f ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
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
                  <VerdictBadge verdict={e.verdict} days={e.verdictDays} />
                </span>
              </div>
              {e.note_title && <p className="text-sm">“{e.note_title}”</p>}
              <p className="text-xs text-muted">{explainVerdict(e)}</p>
              <HorizonList entry={e} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
