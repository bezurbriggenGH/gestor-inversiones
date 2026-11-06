// Series de referencia para comparar la cartera (benchmarks).
import { fetchChart } from './yahoo.ts';

export interface IndexPoint {
  date: string;
  value: number;
}

/** UVA: índice diario que sigue a la inflación (CER). Fuente: ArgentinaDatos. */
export async function fetchUva(): Promise<IndexPoint[]> {
  const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/uva');
  if (!res.ok) throw new Error(`ArgentinaDatos (UVA) respondió ${res.status}`);
  const data = (await res.json()) as { fecha: string; valor: number }[];
  return data.filter((d) => d.valor > 0).map((d) => ({ date: d.fecha, value: d.valor }));
}

/** Tasa nominal anual de depósitos a 30 días (como fracción: 0.25 = 25%). */
export async function fetchDepositRate(): Promise<IndexPoint[]> {
  const res = await fetch('https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias');
  if (!res.ok) throw new Error(`ArgentinaDatos (tasas) respondió ${res.status}`);
  const data = (await res.json()) as { fecha: string; valor: number }[];
  // La fuente cambió de fracción (0.33) a porcentaje (28.18) en algún momento: normalizamos
  return data.filter((d) => d.valor > 0).map((d) => ({ date: d.fecha, value: d.valor > 1.5 ? d.valor / 100 : d.valor }));
}

/** Cierres diarios de un símbolo de Yahoo (índice Merval, CEDEAR de SPY, etc.). */
export async function fetchYahooSeries(symbol: string): Promise<IndexPoint[]> {
  const chart = await fetchChart(symbol, { range: '10y' });
  return chart.bars.map((b) => ({ date: b.date, value: b.close }));
}
