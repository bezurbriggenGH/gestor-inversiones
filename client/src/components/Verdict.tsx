import type { JournalEntry, OperationType, Verdict } from '../api';
import { pct, tone } from '../format';

const STYLE: Record<Verdict, string> = {
  ACIERTO: 'bg-up/15 text-up',
  ERROR: 'bg-down/15 text-down',
  NEUTRAL: 'bg-card text-muted',
};
const TEXT: Record<Verdict, string> = { ACIERTO: 'Acierto', ERROR: 'Error', NEUTRAL: 'Neutral' };

export function VerdictBadge({ verdict, days, noData }: { verdict: Verdict | null; days?: number | null; noData?: boolean }) {
  if (!verdict) return <span className="rounded-full bg-card px-2.5 py-0.5 text-xs text-muted">{noData ? 'Sin datos' : 'Esperando'}</span>;
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
          {h.available ? (
            <span className={tone(h.change)}>{pct(h.change)}</span>
          ) : (
            <span className="opacity-60">{h.noData ? 'sin datos' : 'pendiente'}</span>
          )}
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

type MarketInfo = { type: OperationType; market: JournalEntry['market']; days: number | null };

/** "El S&P 500 subió 10% en esos 90 días: tu compra anduvo 4,5% peor que el mercado." */
export function marketText({ type, market: m, days }: MarketInfo): string | null {
  if (!m || days == null) return null;
  const moved = `${m.change >= 0 ? 'subió' : 'bajó'} ${pct(Math.abs(m.change)).replace('+', '')}`;
  const start = `El ${m.label} ${moved} en esos ${days} días`;
  // Menos de 2% de diferencia: empate (la misma zona neutral que el veredicto)
  if (m.beat == null) return `${start}: ${type === 'COMPRA' ? 'tu compra' : 'lo que vendiste'} anduvo casi igual que el mercado (empate).`;
  const diff = pct(Math.abs(m.relative)).replace('+', '');
  const how =
    type === 'COMPRA'
      ? m.beat
        ? `tu compra le ganó al mercado por ${diff}`
        : `tu compra anduvo ${diff} peor que el mercado`
      : m.beat
        ? `lo que vendiste anduvo ${diff} peor que el mercado: salir no te costó`
        : `lo que vendiste le ganó al mercado por ${diff}: te convenía quedártelo`;
  return `${start}: ${how}.`;
}

/** La frase de arriba, en verde si la decisión le ganó al mercado y en rojo si no. */
export function MarketLine({ className = 'text-xs', ...info }: MarketInfo & { className?: string }) {
  const text = marketText(info);
  if (!text) return null;
  const beat = info.market!.beat;
  return <p className={`${className} ${beat == null ? 'text-muted' : beat ? 'text-up' : 'text-down'}`}>{text}</p>;
}

/** Ya pasó el plazo para evaluarla, pero no hay precios guardados de esa época. */
export const lacksPrices = (e: JournalEntry) => !e.verdict && e.horizons.some((h) => !h.available && h.noData);

export function explainVerdict(e: JournalEntry): string {
  if (lacksPrices(e)) return 'No hay precios guardados de esa época para evaluar esta operación (la fuente no tiene historial de este activo).';
  if (!e.verdict || e.verdictDays == null) return 'Todavía no pasaron 30 días desde la operación.';
  const h = e.horizons.find((x) => x.days === e.verdictDays);
  if (!h || !h.available) return '';
  const moved = `${h.change > 0 ? 'subió' : 'bajó'} ${pct(Math.abs(h.change)).replace('+', '')} en dólares en ${h.days} días`;
  if (e.verdict === 'NEUTRAL') return `El precio casi no se movió en dólares (${pct(h.change)} en ${h.days} días).`;
  if (e.type === 'COMPRA') return e.verdict === 'ACIERTO' ? `Buena compra: el precio ${moved}.` : `El precio ${moved} después de comprar.`;
  return e.verdict === 'ACIERTO' ? `Buena venta: el precio ${moved} después de vender.` : `Después de vender, el precio ${moved}.`;
}
