// Balance de tus decisiones: ¿y si no hubieras tocado nada?, comisiones, qué pasó con lo que
// vendiste y dónde acertás más. Cada caso tiene un resultado que se puede sacar a mano.
import { near } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { buildCosts, buildHoldComparison } from '../src/services/review.ts';
import { buildJournal, decisionOf } from '../src/services/journal.ts';

let nextUser = 1;
/** Un usuario nuevo con sus operaciones: [ticker, tipo, fecha, cantidad, precio, comisión]. */
function user(ops: [string, string, string, number, number, number?][]): number {
  const id = nextUser++;
  run("INSERT INTO users (id, name, email, password_hash) VALUES (?, 'Prueba', ?, 'x')", id, `u${id}@test.com`);
  for (const ticker of new Set(ops.map((o) => o[0]))) run('INSERT INTO user_assets (user_id, ticker) VALUES (?, ?)', id, ticker);
  for (const [ticker, type, date, qty, price, fees = 0] of ops) {
    run('INSERT INTO operations (user_id, ticker, type, date, quantity, price, fees) VALUES (?, ?, ?, ?, ?, ?, ?)', id, ticker, type, date, qty, price, fees);
  }
  return id;
}

// Dos activos y el dólar. Precios de hoy (01/06): AAA $200, BBB $30. Dólar: $1.000 en enero y marzo, $1.250 en junio.
for (const [ticker, type] of [['AAA', 'ACCION'], ['BBB', 'CEDEAR']] as const) {
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES (?, ?, 'Prueba', ?)", ticker, `${ticker}.BA`, type);
}
for (const [ticker, date, px] of [
  ['AAA', '2025-01-02', 100],
  ['AAA', '2025-03-03', 150],
  ['AAA', '2025-06-02', 200],
  ['BBB', '2025-03-03', 20],
  ['BBB', '2025-06-02', 30],
] as const) {
  run('INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?)', ticker, date, px);
}
for (const [date, usd] of [['2025-01-02', 1000], ['2025-03-03', 1000], ['2025-06-02', 1250]] as const) {
  run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, ?)", date, usd);
}

describe('¿Y si no hubieras tocado nada?', () => {
  // En enero compro 10 AAA. En marzo vendo 4 a $150 ($600) y con $100 compro 5 BBB.
  const id = user([
    ['AAA', 'COMPRA', '2025-01-02', 10, 100],
    ['AAA', 'VENTA', '2025-03-03', 4, 150],
    ['BBB', 'COMPRA', '2025-03-03', 5, 20],
  ]);

  test('quieto desde febrero tendría 10 × $200 = $2.000; operando tengo $1.850: operar me restó $150', () => {
    const h = buildHoldComparison(id, 'ARS', 'bolsa', '2025-02-01');
    assert.equal(h.frozenValue, 2000);
    assert.equal(h.actualValue, 6 * 200 + 5 * 30); // $1.350 en cartera
    assert.equal(h.cash, 600 - 100); // $500 en el bolsillo
    assert.equal(h.result, 1850);
    assert.equal(h.diff, -150);
    assert.equal(h.trades, 2);
  });

  test('por activo: vender 4 AAA a $150 que hoy valen $200 restó $200; BBB sumó $50', () => {
    const rows = buildHoldComparison(id, 'ARS', 'bolsa', '2025-02-01').rows;
    assert.deepEqual(rows.map((r) => [r.ticker, r.diff]), [['BBB', 50], ['AAA', -200]]);
  });

  test('si desde esa fecha no operé, no hay diferencia', () => {
    const h = buildHoldComparison(id, 'ARS', 'bolsa', '2025-04-01');
    assert.equal(h.diff, 0);
    assert.equal(h.trades, 0);
    assert.equal(h.frozenValue, 1350);
  });

  test('en dólares, cada monto con el dólar de su fecha: quieto US$ 1,60; operando US$ 1,58', () => {
    // Quieto: 10 × $200 ÷ $1.250 = 1,60. Operando: $1.350 ÷ $1.250 = 1,08 en cartera + ($600 − $100) ÷ $1.000 = 0,50
    const h = buildHoldComparison(id, 'USD', 'bolsa', '2025-02-01');
    assert.ok(near(h.frozenValue, 1.6));
    assert.ok(near(h.result, 1.58));
    assert.ok(near(h.diff, -0.02));
  });
});

describe('Comisiones', () => {
  // Compro 10 a $100 con $10 de comisión; vendo 5 a $120 con $6. Hoy vale $200.
  const id = user([
    ['AAA', 'COMPRA', '2025-01-02', 10, 100, 10],
    ['AAA', 'VENTA', '2025-03-03', 5, 120, 6],
    ['AAA', 'DIVIDENDO', '2025-03-03', 5, 2, 3], // $3 de retención: no es una comisión
  ]);

  test('pagué $16 sobre $1.600 operados: el 1%', () => {
    const c = buildCosts(id, 'ARS', 'bolsa');
    assert.equal(c.fees, 16);
    assert.equal(c.traded, 1600);
    assert.ok(near(c.pctOfTraded, 0.01));
    assert.equal(c.operations, 2);
    assert.equal(c.withheld, 3);
    assert.deepEqual(c.byYear.map((y) => [y.year, y.fees]), [['2025', 16]]);
  });

  test('qué parte de la ganancia se llevaron: $16 de los $600 que hubiera ganado sin pagarlas', () => {
    // Costo $1.010 ($101 c/u). Venta: $600 − $6 − $505 = $89. Lo que queda: 5 × $200 − $505 = $495. Dividendo neto: $7.
    // Ganancia $591; sin comisiones hubiera sido $607.
    const c = buildCosts(id, 'ARS', 'bolsa');
    assert.ok(near(c.gain, 591));
    assert.ok(near(c.pctOfGain!, 16 / 607));
  });
});

describe('Qué pasó con lo que vendiste', () => {
  // Vendo 4 AAA a $150 (dólar $1.000 → US$ 0,15). Hoy vale $200 con el dólar a $1.250 (US$ 0,16).
  const id = user([
    ['AAA', 'COMPRA', '2025-01-02', 10, 100],
    ['AAA', 'VENTA', '2025-03-03', 4, 150],
  ]);

  test('en dólares subió 1 centavo: dejé de ganar 4 × US$ 0,01 = US$ 0,04', () => {
    const j = buildJournal(id, 'USD', 'bolsa');
    const venta = j.entries.find((e) => e.type === 'VENTA')!;
    assert.ok(near(venta.missed!, 0.04));
    assert.equal(j.entries.find((e) => e.type === 'COMPRA')!.missed, null); // solo aplica a ventas
  });

  test('viendo en pesos son $50 de hoy, no los $200 que da restar pesos de fechas distintas', () => {
    const j = buildJournal(id, 'ARS', 'bolsa');
    assert.ok(near(j.entries.find((e) => e.type === 'VENTA')!.missed!, 50));
    assert.ok(near(j.sold.missed, 50));
    assert.equal(j.sold.missedCount, 1);
    assert.equal(j.sold.saved, 0);
    assert.ok(near(j.sold.net, -50)); // en conjunto, vender no me convino
  });
});

describe('Patrones del Diario', () => {
  // AAA (acción): de enero a abril pasó de US$ 0,10 a US$ 0,15 → comprar fue un acierto.
  // BBB (CEDEAR): comprado en marzo a $40 cuando valía $20 → a los 90 días (junio) vale $30: error.
  const id = user([
    ['AAA', 'COMPRA', '2025-01-02', 10, 100],
    ['BBB', 'COMPRA', '2025-03-03', 5, 40],
  ]);

  test('separa los aciertos en acciones argentinas y en CEDEARs', () => {
    const s = buildJournal(id, 'ARS', 'bolsa').stats;
    assert.deepEqual([s.acciones.judged, s.acciones.hits], [1, 1]);
    assert.deepEqual([s.cedears.judged, s.cedears.hits], [1, 0]);
    assert.equal(s.all.hitRate, 0.5);
  });
});

describe('Ventas con ganancia (compras y ventas muy desparejas)', () => {
  // Compro 10, vendo 2, compro 4, vendo 1, vendo 3, vendo 5, compro 15.
  // Promedio: $100 hasta la segunda compra; después (8 × $100 + 4 × $200) ÷ 12 = $133,33.
  const id = user([
    ['AAA', 'COMPRA', '2025-01-02', 10, 100],
    ['AAA', 'VENTA', '2025-01-10', 2, 130], // 2 × ($130 − $100) = +$60
    ['AAA', 'COMPRA', '2025-01-20', 4, 200],
    ['AAA', 'VENTA', '2025-02-03', 1, 150], // 1 × ($150 − $133,33) = +$16,67 (aunque lo último lo compré a $200)
    ['AAA', 'VENTA', '2025-02-10', 3, 120], // 3 × ($120 − $133,33) = −$40
    ['AAA', 'VENTA', '2025-02-20', 5, 180], // 5 × ($180 − $133,33) = +$233,33
    ['AAA', 'COMPRA', '2025-03-03', 15, 160],
  ]);

  test('gané en 3 de 4 ventas: $310 en las buenas y $40 en la mala', () => {
    const c = buildJournal(id, 'ARS', 'bolsa').closed;
    assert.deepEqual([c.count, c.wins, c.losses], [4, 3, 1]);
    assert.ok(near(c.gained, 60 + 50 / 3 + 700 / 3)); // $310
    assert.ok(near(c.lost, 40));
    assert.equal(c.winRate, 0.75);
  });

  test('cada venta trae su resultado; las compras, no', () => {
    const entries = buildJournal(id, 'ARS', 'bolsa').entries.filter((e) => e.type === 'VENTA').reverse();
    assert.ok(near(entries[0].realized!, 60));
    assert.ok(near(entries[2].realized!, -40));
    assert.equal(buildJournal(id, 'ARS', 'bolsa').entries.find((e) => e.type === 'COMPRA')!.realized, null);
  });
});

describe('Una orden de venta partida en varias cuenta como una sola', () => {
  // El broker ejecutó la venta de 6 en tres partes el mismo día: 2 ganando y 1 perdiendo
  const id = user([
    ['AAA', 'COMPRA', '2025-01-02', 10, 100],
    ['AAA', 'VENTA', '2025-01-10', 2, 130], // +$60
    ['AAA', 'VENTA', '2025-01-10', 2, 120], // +$40
    ['AAA', 'VENTA', '2025-01-10', 2, 90], // −$20
  ]);

  test('es una venta con ganancia de $80, no dos ganadoras y una perdedora', () => {
    const c = buildJournal(id, 'ARS', 'bolsa').closed;
    assert.deepEqual([c.count, c.wins, c.losses], [1, 1, 0]);
    assert.ok(near(c.gained, 80));
    assert.equal(c.lost, 0);
  });
});

describe('Compra con mal momento, pero vendida antes con ganancia', () => {
  // Compro 10 BBB a $20 en marzo y las vendo a los pocos días a $40. A los 90 días el precio... no importa:
  // lo que se informa es que dentro del plazo vendí 10 y gané 10 × ($40 − $20) = $200.
  const id = user([
    ['BBB', 'COMPRA', '2025-03-03', 10, 20],
    ['BBB', 'VENTA', '2025-03-10', 10, 40],
  ]);

  test('la compra informa lo que se vendió dentro de su plazo y con qué resultado', () => {
    const compra = buildJournal(id, 'ARS', 'bolsa').entries.find((e) => e.type === 'COMPRA')!;
    assert.deepEqual(compra.soldWithin, { quantity: 10, realized: 200 });
    assert.deepEqual(decisionOf(compra).soldWithin, { quantity: 10, realized: 200 }); // llega también al gráfico
  });

  test('una venta posterior al plazo no se le atribuye a la compra', () => {
    // Compro en enero (se juzga a 90 días: hasta el 02/04) y vendo en junio
    const otro = user([
      ['AAA', 'COMPRA', '2025-01-02', 10, 100],
      ['AAA', 'VENTA', '2025-06-02', 10, 200],
    ]);
    assert.equal(buildJournal(otro, 'ARS', 'bolsa').entries.find((e) => e.type === 'COMPRA')!.soldWithin, null);
  });
});
