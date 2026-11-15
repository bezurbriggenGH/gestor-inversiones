// Diario de decisiones y resultado de cada venta.
import { near, op, pesos } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { DateSeries, computePosition, convertOp } from '../src/services/portfolio.ts';
import { buildJournal, decisionOf, realDifference, robustDifference, type JudgedDecision } from '../src/services/journal.ts';

describe('Resultado de cada venta', () => {
  test('el % se calcula sobre lo que habían costado las acciones vendidas', () => {
    // Compro 10 a $100 y vendo 5 a $150: gano $250 sobre $500 que me habían costado esas 5 → +50%
    const compra = op('COMPRA', '2024-01-01', 10, 100);
    const venta = op('VENTA', '2024-02-01', 5, 150);
    const { realizedByOp } = computePosition([compra, venta], undefined, undefined, pesos);
    const sinDolar = new DateSeries([]);
    const v = convertOp(venta, pesos, sinDolar, realizedByOp);
    assert.equal(v.realized, 250);
    assert.ok(near(v.realizedPct, 0.5));
    assert.equal(convertOp(compra, pesos, sinDolar, realizedByOp).realizedPct, null); // una compra no tiene resultado
  });
});

describe('Diario de decisiones: se juzga en dólares', () => {
  // En pesos el precio sube 10% en 90 días, pero el dólar sube 25%: en dólares, la acción bajó 12%
  run("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Prueba', 'prueba@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('AAA', 'AAA.BA', 'Prueba', 'ACCION')");
  for (const [date, px, usd] of [
    ['2025-01-02', 1000, 1000],
    ['2025-04-02', 1100, 1250],
  ] as const) {
    run("INSERT INTO prices (ticker, date, close) VALUES ('AAA', ?, ?)", date, px);
    run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, ?)", date, usd);
  }
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (1, 'AAA', 'COMPRA', '2025-01-02', 10, 1000)");

  for (const currency of ['ARS', 'USD'] as const) {
    test(`una compra que en pesos subió pero en dólares bajó es un error (viendo en ${currency})`, () => {
      const [entry] = buildJournal(1, currency, 'bolsa').entries;
      assert.equal(entry.verdict, 'ERROR');
      const h90 = entry.horizons.find((h) => h.days === 90)!;
      assert.ok(h90.available && near(h90.change, 1100 / 1250 / (1000 / 1000) - 1)); // −12% en dólares
    });
  }
});

describe('Diario de decisiones: sin precios de la época no se juzga', () => {
  // El único precio guardado es de junio; la compra es de enero
  run("INSERT INTO users (id, name, email, password_hash) VALUES (2, 'Otra', 'otra@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('NUE', 'NUE.BA', 'Sin historial', 'CEDEAR')");
  run("INSERT INTO prices (ticker, date, close) VALUES ('NUE', '2025-06-02', 5850)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (2, 'NUE', 'COMPRA', '2025-01-02', 10, 2910)");

  test('a 30 y 90 días figura "sin datos" y no hay veredicto (antes: acierto de +100% contra el precio de junio)', () => {
    const [entry] = buildJournal(2, 'ARS', 'bolsa').entries;
    for (const days of [30, 90]) {
      const h = entry.horizons.find((x) => x.days === days)!;
      assert.equal(h.available, false);
      assert.equal('noData' in h && h.noData, true);
    }
    assert.equal(entry.verdict, null);
    // A 180 días (01/07) todavía no hay precio posterior guardado: sigue pendiente, no "sin datos"
    assert.equal('noData' in entry.horizons.find((x) => x.days === 180)!, false);
  });
});

describe('Lo que se marca en el gráfico de un activo', () => {
  test('la compra de AAA (subió en pesos, bajó 12% en dólares) queda como error a 90 días', () => {
    const [entry] = buildJournal(1, 'ARS', 'bolsa', 'AAA').entries;
    const d = decisionOf(entry);
    assert.equal(d.verdict, 'ERROR');
    assert.equal(d.days, 90);
    assert.ok(near(d.change!, -0.12));
    assert.equal(d.missed, null); // no es una venta
    assert.equal(d.noData, false);
  });

  test('pidiendo un activo, vienen solo sus operaciones', () => {
    assert.equal(buildJournal(1, 'ARS', 'bolsa', 'AAA').entries.length, 1);
    assert.equal(buildJournal(2, 'ARS', 'bolsa', 'AAA').entries.length, 0); // el otro usuario no tiene AAA
  });

  test('sin precios de la época: sin veredicto y marcada como "sin datos"', () => {
    const d = decisionOf(buildJournal(2, 'ARS', 'bolsa', 'NUE').entries[0]);
    assert.equal(d.verdict, null);
    assert.equal(d.noData, true);
  });
});

describe('Diario de decisiones: contra el mercado', () => {
  // Dólar fijo en $1.000 para que las cuentas salgan a mano. En 90 días el CEDEAR sube 5% y el S&P 500 sube 10%.
  run("INSERT INTO users (id, name, email, password_hash) VALUES (3, 'Mercado', 'mercado@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('CED', 'CED.BA', 'Cedear de prueba', 'CEDEAR')");
  for (const [date, px, spy] of [
    ['2025-07-01', 1000, 2000],
    ['2025-09-29', 1050, 2200],
  ] as const) {
    run("INSERT INTO prices (ticker, date, close) VALUES ('CED', ?, ?)", date, px);
    run("INSERT INTO index_values (series, date, value) VALUES ('spy', ?, ?)", date, spy);
    run("INSERT OR IGNORE INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, 1000)", date);
  }
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (3, 'CED', 'COMPRA', '2025-07-01', 10, 1000)");
  // La venta va en otro usuario: comprar y vender lo mismo el mismo día se compensa y no cuenta en el Diario
  run("INSERT INTO users (id, name, email, password_hash) VALUES (6, 'Vende', 'vende@test.com', 'x')");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (6, 'CED', 'VENTA', '2025-07-01', 5, 1000)");

  test('una compra que subió 5% es acierto, pero contra un mercado que subió 10% perdió 4,5%', () => {
    const j = buildJournal(3, 'ARS', 'bolsa');
    const compra = j.entries.find((e) => e.type === 'COMPRA')!;
    assert.equal(compra.verdict, 'ACIERTO');
    assert.equal(compra.market!.label, 'S&P 500');
    assert.ok(near(compra.market!.change, 0.1));
    assert.ok(near(compra.market!.relative, 1.05 / 1.1 - 1)); // −4,5%
    assert.equal(compra.market!.beat, false);
  });

  test('una venta antes de que el activo ande peor que el mercado le gana al mercado', () => {
    const j = buildJournal(6, 'ARS', 'bolsa');
    const venta = j.entries.find((e) => e.type === 'VENTA')!;
    assert.equal(venta.verdict, 'ERROR'); // el precio subió después de vender
    assert.equal(venta.market!.beat, true); // pero el mercado subió más: salir no fue peor que el índice
    // Compras y ventas, por separado
    assert.deepEqual(j.vsMarket, { compared: 1, beat: 1, even: 0, buys: { compared: 0, beat: 0 }, sells: { compared: 1, beat: 1 } });
    assert.deepEqual(buildJournal(3, 'ARS', 'bolsa').vsMarket.buys, { compared: 1, beat: 0 });
  });

  test('el gráfico del activo recibe la misma comparación', () => {
    const compra = buildJournal(3, 'ARS', 'bolsa', 'CED').entries.find((e) => e.type === 'COMPRA')!;
    const d = decisionOf(compra);
    assert.equal(d.market!.label, 'S&P 500');
    assert.equal(d.market!.beat, false);
  });

  test('a menos de 2% del mercado es un empate: no cuenta como victoria ni como derrota', () => {
    // Otro CEDEAR que en los mismos 90 días sube 9%: contra el 10% del S&P 500, 1,09 / 1,10 − 1 = −0,9%
    run("INSERT INTO users (id, name, email, password_hash) VALUES (5, 'Empate', 'empate@test.com', 'x')");
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('EMP', 'EMP.BA', 'Prueba', 'CEDEAR')");
    run("INSERT INTO prices (ticker, date, close) VALUES ('EMP', '2025-07-01', 1000), ('EMP', '2025-09-29', 1090)");
    run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (5, 'EMP', 'COMPRA', '2025-07-01', 10, 1000)");
    const j = buildJournal(5, 'ARS', 'bolsa');
    assert.equal(j.entries[0].verdict, 'ACIERTO'); // subió 9%
    assert.ok(near(j.entries[0].market!.relative, 1.09 / 1.1 - 1));
    assert.equal(j.entries[0].market!.beat, null);
    assert.deepEqual(j.vsMarket, { compared: 0, beat: 0, even: 1, buys: { compared: 0, beat: 0 }, sells: { compared: 0, beat: 0 } });
  });

  test('sin datos del índice en esas fechas no se compara (las acciones contra un Merval vacío)', () => {
    const [entry] = buildJournal(1, 'ARS', 'bolsa').entries;
    assert.equal(entry.market, null);
  });
});

describe('Diario de decisiones: cuántas decisiones hay de verdad', () => {
  // Compro 10 a $1.000 con el dólar a $1.000 (US$ 1 cada una). El broker parte la venta en dos
  // pedazos de 5 el mismo día, a $1.200 con el dólar a $1.300 (US$ 0,923 cada una).
  run("INSERT INTO users (id, name, email, password_hash) VALUES (4, 'Partida', 'partida@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('PAR', 'PAR.BA', 'Prueba', 'ACCION')");
  for (const [date, px, usd] of [
    ['2026-01-02', 1000, 1000],
    ['2026-04-02', 1200, 1300],
  ] as const) {
    run("INSERT INTO prices (ticker, date, close) VALUES ('PAR', ?, ?)", date, px);
    run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, ?)", date, usd);
  }
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (4, 'PAR', 'COMPRA', '2026-01-02', 10, 1000)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (4, 'PAR', 'VENTA', '2026-04-02', 5, 1200)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (4, 'PAR', 'VENTA', '2026-04-02', 5, 1200)");

  test('una venta partida en dos pedazos el mismo día es una sola decisión', () => {
    const j = buildJournal(4, 'ARS', 'bolsa');
    assert.equal(j.entries.length, 3); // en la lista se ven los tres movimientos
    assert.equal(j.stats.sells.total, 1); // pero en los porcentajes, la venta cuenta una vez
    assert.equal(j.stats.all.total, 2);
  });

  test('las ventas con ganancia se cuentan en dólares, aunque estés viendo en pesos', () => {
    for (const currency of ['ARS', 'USD'] as const) {
      const { closed } = buildJournal(4, currency, 'bolsa');
      // En pesos ganaste 10 × $200 = $2.000; en dólares perdiste 10 × (US$ 1 − 1.200/1.300) = US$ 0,77
      assert.equal(closed.currency, 'USD');
      assert.equal(closed.wins, 0);
      assert.equal(closed.losses, 1);
      assert.ok(near(closed.lost, 10 * (1 - 1200 / 1300)));
    }
  });
});

describe('¿Una diferencia entre dos porcentajes puede ser casualidad?', () => {
  test('44% en 198 compras contra 51% en 76 ventas: puede ser casualidad', () => {
    // Diferencia 7,4 puntos; por suerte varía unos 6,7 → 1,1 veces, menos de 1,96
    assert.equal(realDifference({ hits: 87, judged: 198 }, { hits: 39, judged: 76 }), false);
  });

  test('50% en 200 contra 20% en 100: es real', () => {
    // En total 40%; por suerte varía √(0,4 × 0,6 × (1/200 + 1/100)) = 6 puntos. La diferencia es 30: 5 veces
    assert.equal(realDifference({ hits: 100, judged: 200 }, { hits: 20, judged: 100 }), true);
  });

  test('con 100 de cada lado, hacen falta unos 14 puntos', () => {
    // 60% contra 46%: 14 puntos, 1,98 veces lo que varía por suerte (7,06) → real
    assert.equal(realDifference({ hits: 60, judged: 100 }, { hits: 46, judged: 100 }), true);
    // 59% contra 46%: 13 puntos, 1,84 veces (7,06) → puede ser casualidad
    assert.equal(realDifference({ hits: 59, judged: 100 }, { hits: 46, judged: 100 }), false);
  });

  test('con menos de 10 decisiones de un lado no se saca conclusión (3 de 4 no prueba nada)', () => {
    assert.equal(realDifference({ hits: 3, judged: 4 }, { hits: 20, judged: 100 }), false);
    assert.equal(realDifference({ hits: 9, judged: 9 }, { hits: 0, judged: 100 }), false);
  });
});

describe('Una diferencia que depende de un solo activo no se afirma', () => {
  // n decisiones de un activo, con h aciertos
  const of = (ticker: string, n: number, h: number): JudgedDecision[] =>
    Array.from({ length: n }, (_, i) => ({ ticker, hit: i < h }));

  test('acciones 32 de 87 contra CEDEARs 84 de 168: pasa la prueba simple, pero 31 de las 87 son de COME', () => {
    // COME: 31 decisiones, 5 aciertos. El resto de las acciones: 27 de 56 (48%), repartidas en 8 activos
    const acciones = [...of('COME', 31, 5), ...Array.from({ length: 8 }, (_, k) => of(`A${k}`, 7, k < 3 ? 4 : 3)).flat()];
    const cedears = Array.from({ length: 12 }, (_, k) => of(`C${k}`, 14, 7)).flat(); // 84 de 168
    assert.equal(acciones.length, 87);
    assert.equal(acciones.filter((d) => d.hit).length, 32);
    assert.equal(realDifference({ hits: 32, judged: 87 }, { hits: 84, judged: 168 }), true); // 2,01 veces: pasa 1,96
    // Sin COME: 27 de 56 contra 84 de 168 → nada. Además, con 3 comparaciones se pide 2,39 y no llega
    assert.equal(robustDifference(acciones, cedears), false);
  });

  test('una diferencia grande y repartida en muchos activos sí se afirma', () => {
    // 60 de 100 en 20 activos (3 de 5 cada uno) contra 20 de 100 en otros 20 (1 de 5 cada uno)
    const a = Array.from({ length: 20 }, (_, k) => of(`A${k}`, 5, 3)).flat();
    const b = Array.from({ length: 20 }, (_, k) => of(`B${k}`, 5, 1)).flat();
    assert.equal(robustDifference(a, b), true);
  });

  test('con 3 comparaciones a la vez se pide más: 2,01 veces alcanza para una sola, no para tres', () => {
    assert.equal(realDifference({ hits: 32, judged: 87 }, { hits: 84, judged: 168 }, 2.39), false);
  });
});

describe('Comprar y vender lo mismo el mismo día', () => {
  // El 02/04/2026 compro 6 y vendo 6 de OFS: la tenencia no cambia. Antes la venta figuraba como "te
  // ahorraste de perder" y como acierto, y la compra como error.
  run("INSERT INTO users (id, name, email, password_hash) VALUES (7, 'Mismo día', 'mismodia@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('OFS', 'OFS.BA', 'Prueba', 'ACCION')");
  run("INSERT INTO prices (ticker, date, close) VALUES ('OFS', '2026-01-02', 1000), ('OFS', '2026-04-02', 1200)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (7, 'OFS', 'COMPRA', '2026-01-02', 10, 1000)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (7, 'OFS', 'COMPRA', '2026-04-02', 6, 1200)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (7, 'OFS', 'VENTA', '2026-04-02', 6, 1200)");

  test('se compensan: no son decisiones ni cuentan como plata ahorrada o perdida', () => {
    const j = buildJournal(7, 'ARS', 'bolsa');
    assert.equal(j.entries.length, 3); // en la lista se ven
    assert.deepEqual(j.entries.filter((e) => e.date === '2026-04-02').map((e) => e.offset), [1, 1]);
    assert.equal(j.stats.all.total, 1); // solo cuenta la compra de enero
    assert.equal(j.sold.count, 0);
  });

  test('si se compensa solo una parte, cuenta lo que queda: compro 10 y vendo 4 el mismo día = compra de 6', () => {
    run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (7, 'OFS', 'VENTA', '2026-01-02', 4, 1000)");
    const enero = buildJournal(7, 'ARS', 'bolsa').entries.filter((e) => e.date === '2026-01-02');
    assert.ok(near(enero.find((e) => e.type === 'COMPRA')!.offset, 0.4));
    assert.equal(enero.find((e) => e.type === 'VENTA')!.offset, 1);
  });
});
