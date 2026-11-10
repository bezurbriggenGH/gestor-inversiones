// Diario de decisiones: ¿acertaste con cada compra y venta?
//
// Se mira qué hizo el precio 30, 90 y 180 días después de cada operación (decide el de 90):
// - Compra: acierto si después subió (> +2%), error si bajó (< −2%).
// - Venta:  acierto si después bajó (vendiste antes de una caída), error si subió.
// Entre −2% y +2% se considera neutral.
//
// Los cambios de precio se miden SIEMPRE en dólares, aunque estés viendo la app en pesos:
// con inflación, casi cualquier precio en pesos sube más de 2% en 90 días, y entonces
// casi todas las compras parecerían aciertos y casi todas las ventas, errores.
import { all } from '../db.ts';
import type { FxKind } from '../providers/dolar.ts';
import { DateSeries, getOperations, loadFx, makeConverter, sortOps, type Currency } from './portfolio.ts';

export const HORIZONS = [30, 90, 180] as const;
const MAIN_HORIZON = 90;
const NEUTRAL_BAND = 0.02;

export type Verdict = 'ACIERTO' | 'ERROR' | 'NEUTRAL';

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function judge(type: 'COMPRA' | 'VENTA', change: number): Verdict {
  if (Math.abs(change) <= NEUTRAL_BAND) return 'NEUTRAL';
  const priceWentUp = change > 0;
  return (type === 'COMPRA') === priceWentUp ? 'ACIERTO' : 'ERROR';
}

export function buildJournal(userId: number, currency: Currency, kind: FxKind) {
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx); // para mostrar precios en la moneda elegida
  const judgeConv = makeConverter(fx.empty ? 'ARS' : 'USD', fx); // para medir si acertaste
  const ops = sortOps(getOperations(userId)).filter((o) => o.type !== 'DIVIDENDO');

  const priceCache = new Map<string, DateSeries>();
  const pricesOf = (ticker: string) => {
    let s = priceCache.get(ticker);
    if (!s) {
      s = new DateSeries(all('SELECT date, close AS value FROM prices WHERE ticker = ? ORDER BY date', ticker));
      priceCache.set(ticker, s);
    }
    return s;
  };

  const entries = ops
    .map((op) => {
      const s = pricesOf(op.ticker);
      const lastDate = s.empty ? '' : s.dates[s.dates.length - 1];
      const base = conv(op.price, op.date);
      const baseUsd = judgeConv(op.price, op.date);
      const type = op.type as 'COMPRA' | 'VENTA';
      const horizons = HORIZONS.map((days) => {
        const target = addDaysIso(op.date, days);
        if (s.empty || target > lastDate) return { days, available: false as const };
        const price = conv(s.at(target), target);
        const change = judgeConv(s.at(target), target) / baseUsd - 1;
        return { days, available: true as const, price, change, verdict: judge(type, change) };
      });
      // Cambio hasta hoy, para operaciones recientes
      const sinceChange = s.empty ? null : judgeConv(s.at(lastDate), lastDate) / baseUsd - 1;
      // Veredicto principal: a 90 días (o 30 si todavía no pasaron 90).
      // 180 días se muestra pero no decide: a ese plazo pesa más el mercado que la decisión.
      const main = [...horizons].reverse().find((h) => h.available && h.days <= MAIN_HORIZON);
      return {
        id: op.id,
        ticker: op.ticker,
        type,
        date: op.date,
        quantity: op.quantity,
        price: base,
        note_title: op.note_title,
        note_body: op.note_body,
        hasNote: Boolean(op.note_title || op.note_body),
        horizons,
        sinceChange,
        verdict: main && main.available ? main.verdict : null,
        verdictDays: main && main.available ? main.days : null,
      };
    })
    .reverse();

  const stats = (list: typeof entries) => {
    const judged = list.filter((e) => e.verdict && e.verdict !== 'NEUTRAL');
    const hits = judged.filter((e) => e.verdict === 'ACIERTO').length;
    return {
      total: list.length,
      judged: judged.length,
      hits,
      misses: judged.length - hits,
      neutral: list.filter((e) => e.verdict === 'NEUTRAL').length,
      pending: list.filter((e) => !e.verdict).length,
      hitRate: judged.length ? hits / judged.length : null,
    };
  };

  return {
    currency,
    entries,
    stats: {
      all: stats(entries),
      buys: stats(entries.filter((e) => e.type === 'COMPRA')),
      sells: stats(entries.filter((e) => e.type === 'VENTA')),
      withNote: stats(entries.filter((e) => e.hasNote)),
      withoutNote: stats(entries.filter((e) => !e.hasNote)),
    },
  };
}
