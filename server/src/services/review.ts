// Balance de tus decisiones: ¿operar te sumó o te restó, y cuánto te costó?
//
// 1. "¿Y si no hubieras tocado nada?": se congela la cartera tal como estaba un día y se la
//    valúa a los precios de hoy. Contra eso se pone lo que hiciste de verdad: lo que tenés hoy
//    más la plata que sacaste con ventas, menos la que pusiste en compras desde ese día.
//    Ejemplo: tenías 10 acciones que hoy valen $200 → quieto tendrías $2.000. Vendiste 4 a $150
//    ($600) y con $100 compraste otra cosa que hoy vale $150: tenés $1.200 + $150 en cartera y
//    $500 en el bolsillo = $1.850. Operar te restó $150.
//    Los dividendos no se cuentan en ninguno de los dos lados (casi no cambian con lo que operaste).
//    Viendo en pesos, la plata de cada compra y venta se lleva a pesos de hoy con la inflación (IPC),
//    la misma vara que el rendimiento real de la portada: $600 de marzo no valen lo mismo que $600 de
//    hoy. Ejemplo: vendí por $600 y desde entonces la inflación fue 25% → cuentan como $750 de hoy.
//
// 2. Comisiones: cuánto pagaste por comprar y vender, y qué parte de tu ganancia se llevaron. En pesos,
//    también en pesos de hoy y contra la ganancia descontada la inflación (ver buildCosts).
import { get } from '../db.ts';
import type { FxKind } from '../providers/dolar.ts';
import { buildHistory, inflationSeries } from './history.ts';
import { DateSeries, buildPortfolio, getOperations, loadFx, makeConverter, opTotal, sortOps, type Currency } from './portfolio.ts';

/** Lleva pesos de una fecha a pesos de hoy con la inflación. Sin índice, los deja como están. */
function toTodayPesos(inflation: DateSeries): (ars: number, date: string) => number {
  if (inflation.empty) return (ars) => ars;
  const today = inflation.at(inflation.dates[inflation.dates.length - 1]);
  return (ars, date) => (ars * today) / inflation.at(date);
}

export function buildHoldComparison(userId: number, currency: Currency, kind: FxKind, since: string) {
  const fx = loadFx(kind);
  const conv = makeConverter(currency, fx);
  // La plata de cada operación, en la moneda elegida: en pesos, llevada a pesos de hoy (ver arriba);
  // en dólares, con el dólar de su día
  const cashConv = currency === 'ARS' ? toTodayPesos(inflationSeries()) : conv;
  const ops = sortOps(getOperations(userId)).filter((o) => o.type !== 'DIVIDENDO');

  const byTicker = new Map<string, typeof ops>();
  for (const op of ops) byTicker.set(op.ticker, [...(byTicker.get(op.ticker) ?? []), op]);

  const rows = [...byTicker].map(([ticker, list]) => {
    const last = get<{ date: string; close: number }>('SELECT date, close FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1', ticker);
    const price = last ? conv(last.close, last.date) : 0;
    let heldThen = 0;
    let heldNow = 0;
    let bought = 0;
    let sold = 0;
    let trades = 0;
    for (const op of list) {
      const signed = op.type === 'COMPRA' ? op.quantity : -op.quantity;
      heldNow += signed;
      if (op.date < since) {
        heldThen += signed;
        continue;
      }
      const total = cashConv(opTotal(op), op.date);
      if (op.type === 'COMPRA') bought += total;
      else sold += total;
      if (!op.auto) trades++;
    }
    heldThen = Math.max(0, heldThen);
    heldNow = Math.max(0, heldNow);
    const frozenValue = heldThen * price;
    const actualValue = heldNow * price;
    const cash = sold - bought;
    return { ticker, heldThen, heldNow, price, frozenValue, actualValue, cash, trades, diff: actualValue + cash - frozenValue };
  });

  const sum = (k: 'frozenValue' | 'actualValue' | 'cash' | 'trades') => rows.reduce((acc, r) => acc + r[k], 0);
  const frozenValue = sum('frozenValue');
  const actualValue = sum('actualValue');
  const cash = sum('cash');
  return {
    currency,
    since,
    firstDate: ops[0]?.date ?? null,
    frozenValue, // lo que valdría hoy la cartera de ese día
    actualValue, // lo que vale hoy lo que tenés
    cash, // plata que sacaste (+) o pusiste (−) operando desde ese día
    result: actualValue + cash,
    diff: actualValue + cash - frozenValue, // positivo: operar te sumó
    trades: sum('trades'),
    // Solo lo que cambió: lo que no tocaste da 0 de diferencia
    rows: rows.filter((r) => r.trades > 0).sort((a, b) => b.diff - a.diff),
  };
}

export function buildCosts(userId: number, currency: Currency, kind: FxKind) {
  const conv = makeConverter(currency, loadFx(kind));
  const ops = getOperations(userId).filter((o) => !o.auto);

  const years = new Map<string, { year: string; fees: number; traded: number; operations: number }>();
  let fees = 0;
  let traded = 0;
  let operations = 0;
  let withoutFees = 0;
  let withheld = 0; // retenciones y gastos descontados de los dividendos
  for (const op of ops) {
    const fee = conv(op.fees, op.date);
    if (op.type === 'DIVIDENDO') {
      withheld += fee;
      continue;
    }
    const amount = conv(op.quantity * op.price, op.date);
    const y = years.get(op.date.slice(0, 4)) ?? { year: op.date.slice(0, 4), fees: 0, traded: 0, operations: 0 };
    y.fees += fee;
    y.traded += amount;
    y.operations++;
    years.set(y.year, y);
    fees += fee;
    traded += amount;
    operations++;
    if (op.fees === 0) withoutFees++;
  }

  // La ganancia ya tiene descontadas las comisiones: se compara contra lo que hubieras ganado sin pagarlas
  const gain = buildPortfolio(userId, currency, kind).summary.totalGain;
  const gainBeforeFees = gain + fees;

  // En pesos, lo mismo descontada la inflación: sumar comisiones de 2024 y de 2026 como si fueran los mismos
  // pesos subestima las viejas, y la ganancia en pesos sin ajustar está inflada. Cada comisión se lleva a
  // pesos de hoy, y se compara contra lo que le ganaste a la inflación (lo que muestra la portada).
  // Ejemplo: $100 de comisión con 50% de inflación desde entonces son $150 de hoy; si le ganaste a la
  // inflación por $100, sin comisiones le habrías ganado por $250: se llevaron 150 ÷ 250 = 60%.
  let real: { fees: number; gain: number; pctOfGain: number | null } | null = null;
  const realGain = currency === 'ARS' ? buildHistory(userId, 'ARS', kind).realReturn?.gain : undefined;
  if (realGain != null) {
    const toToday = toTodayPesos(inflationSeries());
    const realFees = ops.filter((o) => o.type !== 'DIVIDENDO').reduce((acc, o) => acc + toToday(o.fees, o.date), 0);
    real = { fees: realFees, gain: realGain, pctOfGain: realGain + realFees > 0 ? realFees / (realGain + realFees) : null };
  }
  return {
    currency,
    fees,
    traded,
    operations,
    withoutFees,
    withheld,
    pctOfTraded: traded > 0 ? fees / traded : 0,
    gain,
    pctOfGain: gainBeforeFees > 0 ? fees / gainBeforeFees : null,
    real,
    byYear: [...years.values()].sort((a, b) => a.year.localeCompare(b.year)).map((y) => ({ ...y, pctOfTraded: y.traded > 0 ? y.fees / y.traded : 0 })),
  };
}
