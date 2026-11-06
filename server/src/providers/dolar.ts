// Cotizaciones del dólar en Argentina.
// - Historial diario: ArgentinaDatos (api.argentinadatos.com)
// - Valor del momento: DolarApi (dolarapi.com)
import { arDate } from '../util.ts';

export const FX_KINDS = ['bolsa', 'contadoconliqui'] as const;
export type FxKind = (typeof FX_KINDS)[number];

export interface FxPoint {
  date: string;
  buy: number | null;
  sell: number;
}

export async function fetchFxHistory(kind: FxKind): Promise<FxPoint[]> {
  const res = await fetch(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${kind}`);
  if (!res.ok) throw new Error(`ArgentinaDatos respondió ${res.status}`);
  const data = (await res.json()) as { fecha: string; compra: number | null; venta: number | null }[];
  return data
    .filter((d) => d.venta != null && d.venta > 0)
    .map((d) => ({ date: d.fecha, buy: d.compra, sell: d.venta as number }));
}

export async function fetchFxToday(kind: FxKind): Promise<FxPoint> {
  const res = await fetch(`https://dolarapi.com/v1/dolares/${kind}`);
  if (!res.ok) throw new Error(`DolarApi respondió ${res.status}`);
  const d = (await res.json()) as { compra: number | null; venta: number; fechaActualizacion: string };
  return { date: arDate(new Date(d.fechaActualizacion)), buy: d.compra, sell: d.venta };
}
