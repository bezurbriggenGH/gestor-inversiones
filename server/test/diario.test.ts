// Diario de decisiones y resultado de cada venta.
import { near, op, pesos } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { DateSeries, computePosition, convertOp } from '../src/services/portfolio.ts';
import { buildJournal, decisionOf } from '../src/services/journal.ts';

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
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (3, 'CED', 'VENTA', '2025-07-01', 5, 1000)");

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
    const j = buildJournal(3, 'ARS', 'bolsa');
    const venta = j.entries.find((e) => e.type === 'VENTA')!;
    assert.equal(venta.verdict, 'ERROR'); // el precio subió después de vender
    assert.equal(venta.market!.beat, true); // pero el mercado subió más: salir no fue peor que el índice
    assert.deepEqual(j.vsMarket, { compared: 2, beat: 1 });
  });

  test('el gráfico del activo recibe la misma comparación', () => {
    const compra = buildJournal(3, 'ARS', 'bolsa', 'CED').entries.find((e) => e.type === 'COMPRA')!;
    const d = decisionOf(compra);
    assert.equal(d.market!.label, 'S&P 500');
    assert.equal(d.market!.beat, false);
  });

  test('sin datos del índice en esas fechas no se compara (las acciones contra un Merval vacío)', () => {
    const [entry] = buildJournal(1, 'ARS', 'bolsa').entries;
    assert.equal(entry.market, null);
  });
});
