// Diario de decisiones y resultado de cada venta.
import { near, op, pesos } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { DateSeries, computePosition, convertOp } from '../src/services/portfolio.ts';
import { buildJournal } from '../src/services/journal.ts';

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
