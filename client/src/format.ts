import type { Currency } from './api';

const moneyFmt = new Map<string, Intl.NumberFormat>();

/**
 * Formatea plata. Con `compact`, sin centavos en montos de 100 o más: para vistas generales
 * (como las tarjetas), donde los centavos no aportan y solo agregan ruido.
 */
export function money(v: number, currency: Currency, signed = false, compact = false): string {
  const digits = compact && Math.abs(v) >= 100 ? 0 : 2;
  const key = `${currency}-${signed}-${digits}`;
  let f = moneyFmt.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    moneyFmt.set(key, f);
  }
  return f.format(v);
}

const pctFmt = [0, 1, 2].map(
  (d) => new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: 'exceptZero' }),
);
/** Porcentaje con signo (2 decimales salvo que se pida otra cosa). */
export const pct = (v: number, decimals: 0 | 1 | 2 = 2) => pctFmt[decimals].format(v);
/** Peso o participación (sin signo, 1 decimal): "24,1%". */
export const share = (v: number) => pctFmt[1].format(v).replace('+', '');

const numFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
export const num = (v: number) => numFmt.format(v);

/** 2026-07-14 → 14/07/2026 */
export const date = (iso: string) => iso.split('-').reverse().join('/');

export const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted');

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

export const FX_LABEL = { bolsa: 'MEP', contadoconliqui: 'CCL' } as const;

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * A qué día corresponde la "variación del día": "hoy" solo si el último precio es de hoy.
 * Un fin de semana, un feriado o antes de que abra el mercado, es la última rueda: "el viernes 07/11".
 */
export function dayLabel(priceDate: string | null | undefined): string {
  if (!priceDate || priceDate >= todayIso()) return 'hoy';
  const weekday = WEEKDAYS[new Date(`${priceDate}T12:00:00Z`).getUTCDay()];
  return `el ${weekday} ${priceDate.slice(8, 10)}/${priceDate.slice(5, 7)}`;
}

/** Versión corta para espacios chicos: "hoy" o "vie 06/11". */
export function shortDayLabel(priceDate: string | null | undefined): string {
  if (!priceDate || priceDate >= todayIso()) return 'hoy';
  const weekday = WEEKDAYS[new Date(`${priceDate}T12:00:00Z`).getUTCDay()].slice(0, 3);
  return `${weekday} ${priceDate.slice(8, 10)}/${priceDate.slice(5, 7)}`;
}

/** La fecha de precio más reciente de la cartera (para decir a qué día corresponde la variación). */
export function latestPriceDate(positions: { priceDate: string | null; quantity: number }[]): string | null {
  return positions.filter((p) => p.quantity > 0 && p.priceDate).reduce<string | null>((m, p) => (!m || p.priceDate! > m ? p.priceDate : m), null);
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
