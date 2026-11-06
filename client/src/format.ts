import type { Currency } from './api';

const moneyFmt = new Map<string, Intl.NumberFormat>();

export function money(v: number, currency: Currency, signed = false): string {
  const key = `${currency}-${signed}`;
  let f = moneyFmt.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    moneyFmt.set(key, f);
  }
  return f.format(v);
}

const pctFmt = new Intl.NumberFormat('es-AR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
export const pct = (v: number) => pctFmt.format(v);

const numFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
export const num = (v: number) => numFmt.format(v);

/** 2026-07-14 → 14/07/2026 */
export const date = (iso: string) => iso.split('-').reverse().join('/');

export const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted');

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

export const FX_LABEL = { bolsa: 'MEP', contadoconliqui: 'CCL' } as const;
