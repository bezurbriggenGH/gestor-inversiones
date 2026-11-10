import type { JournalEntry, Verdict } from '../api';
import { pct, tone } from '../format';

const STYLE: Record<Verdict, string> = {
  ACIERTO: 'bg-up/15 text-up',
  ERROR: 'bg-down/15 text-down',
  NEUTRAL: 'bg-card text-muted',
};
const TEXT: Record<Verdict, string> = { ACIERTO: 'Acierto', ERROR: 'Error', NEUTRAL: 'Neutral' };

export function VerdictBadge({ verdict, days }: { verdict: Verdict | null; days?: number | null }) {
  if (!verdict) return <span className="rounded-full bg-card px-2.5 py-0.5 text-xs text-muted">Esperando</span>;
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STYLE[verdict]}`}>
      {TEXT[verdict]}
      {days ? ` · ${days}d` : ''}
    </span>
  );
}

/** "+12% a 30 días · −5% a 90 días · …" (cambios del precio en dólares) */
export function HorizonList({ entry }: { entry: JournalEntry }) {
  return (
    <div className="tabular flex flex-wrap gap-x-4 gap-y-1 text-xs" title="Cambio del precio en dólares desde la operación">
      <span className="text-muted">En US$:</span>
      {entry.horizons.map((h) => (
        <span key={h.days} className="text-muted">
          {h.days}d:{' '}
          {h.available ? <span className={tone(h.change)}>{pct(h.change)}</span> : <span className="opacity-60">pendiente</span>}
        </span>
      ))}
      {entry.sinceChange != null && (
        <span className="text-muted">
          hasta hoy: <span className={tone(entry.sinceChange)}>{pct(entry.sinceChange)}</span>
        </span>
      )}
    </div>
  );
}

export function explainVerdict(e: JournalEntry): string {
  if (!e.verdict || e.verdictDays == null) return 'Todavía no pasaron 30 días desde la operación.';
  const h = e.horizons.find((x) => x.days === e.verdictDays);
  if (!h || !h.available) return '';
  const moved = `${h.change > 0 ? 'subió' : 'bajó'} ${pct(Math.abs(h.change)).replace('+', '')} en dólares en ${h.days} días`;
  if (e.verdict === 'NEUTRAL') return `El precio casi no se movió en dólares (${pct(h.change)} en ${h.days} días).`;
  if (e.type === 'COMPRA') return e.verdict === 'ACIERTO' ? `Buena compra: el precio ${moved}.` : `El precio ${moved} después de comprar.`;
  return e.verdict === 'ACIERTO' ? `Buena venta: el precio ${moved} después de vender.` : `Después de vender, el precio ${moved}.`;
}
