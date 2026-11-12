// Simulador "¿Y si hubiera invertido…?"
//
// Toma un monto en pesos invertido en una fecha y muestra cuánto valdría hoy en un
// activo, comparado con lo que habría pasado con esa misma plata en dólares, plazo
// fijo, ajustada por inflación o guardada en pesos ("colchón").
import { all, get } from '../db.ts';
import type { FxKind } from '../providers/dolar.ts';
import { HttpError, arDate } from '../util.ts';
import { DateSeries, dividendEvents, loadFx, type Currency } from './portfolio.ts';
import { loadIndex, plazoFijoIndex } from './history.ts';

export const ALTERNATIVES = {
  activo: 'El activo',
  dolar: 'Dólar',
  plazofijo: 'Plazo fijo',
  inflacion: 'Inflación',
  colchon: 'Pesos en el colchón',
} as const;
type Alt = keyof typeof ALTERNATIVES;

export function simulate(ticker: string, amount: number, date: string, currency: Currency, kind: FxKind) {
  const asset = get<{ name: string; type: string }>('SELECT name, type FROM assets WHERE ticker = ?', ticker);
  if (!asset) throw new HttpError(404, `No encontramos ${ticker}`);

  const rows = all<{ date: string; close: number }>('SELECT date, close FROM prices WHERE ticker = ? ORDER BY date', ticker);
  if (rows.length === 0) throw new HttpError(404, `${ticker} no tiene precios`);
  if (date < rows[0].date) {
    throw new HttpError(400, `Tenemos precios de ${ticker} desde el ${rows[0].date.split('-').reverse().join('/')}. Elegí una fecha posterior.`);
  }
  if (date >= rows[rows.length - 1].date) throw new HttpError(400, 'Elegí una fecha anterior a hoy.');

  // Se "compra" el primer día hábil desde la fecha elegida
  const startIdx = rows.findIndex((r) => r.date >= date);
  const days = rows.slice(startIdx);
  const start = days[0];
  const units = amount / start.close;

  const fx = loadFx(kind);
  if (fx.empty) throw new HttpError(503, 'Todavía no hay cotizaciones del dólar');
  const uva = loadIndex('uva');
  const pf = plazoFijoIndex(start.date, arDate());

  // Dividendos cobrados en el camino (brutos, sin reinvertir)
  const dividends = dividendEvents(ticker, asset.type).filter((d) => d.date > start.date);
  let divIdx = 0;
  let cash = 0;

  const toCur = (ars: number, d: string) => (currency === 'ARS' ? ars : ars / fx.at(d));
  const grow = (s: DateSeries, d: string) => (s.empty ? null : (amount * s.at(d)) / s.at(start.date));

  const points = days.map((r) => {
    while (divIdx < dividends.length && dividends[divIdx].date <= r.date) cash += units * dividends[divIdx++].amount;
    const values: Record<Alt, number | null> = {
      activo: units * r.close + cash,
      dolar: grow(fx, r.date),
      plazofijo: grow(pf, r.date),
      inflacion: grow(uva, r.date),
      colchon: amount,
    };
    const conv = {} as Record<Alt, number | null>;
    for (const k of Object.keys(values) as Alt[]) conv[k] = values[k] == null ? null : toCur(values[k]!, r.date);
    return { date: r.date, ...conv };
  });

  const first = points[0];
  const last = points[points.length - 1];
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86_400_000);

  const results = (Object.keys(ALTERNATIVES) as Alt[]).map((k) => {
    const from = first[k];
    const to = last[k];
    if (from == null || to == null) return { key: k, label: ALTERNATIVES[k], available: false as const };
    const ret = to / from - 1;
    return {
      key: k,
      label: ALTERNATIVES[k],
      available: true as const,
      value: to,
      gain: to - from,
      return: ret,
      annual: years >= 1 ? Math.pow(1 + ret, 1 / years) - 1 : null,
    };
  });

  // El peor momento: cuánto llegaste a ir perdiendo contra lo que pusiste
  let worst = { date: first.date, return: 0 };
  let best = { date: first.date, return: 0 };
  for (const p of points) {
    const r = p.activo! / first.activo! - 1;
    if (r < worst.return) worst = { date: p.date, return: r };
    if (r > best.return) best = { date: p.date, return: r };
  }

  return {
    ticker,
    name: asset.name,
    type: asset.type,
    currency,
    amount,
    invested: first.activo!,
    startDate: start.date,
    startPrice: start.close,
    units,
    endDate: last.date,
    years,
    dividendsCash: toCur(cash, last.date),
    results,
    worst,
    best,
    points,
  };
}
