// Cálculos de la cartera: precio promedio, ganancias, dividendos, dólares.
// Cada caso tiene un resultado que se puede sacar a mano.
import { close, near, op, pesos } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateSeries,
  assertNoShortSelling,
  computePosition,
  holdingBefore,
  makeConverter,
  peakCapital,
} from '../src/services/portfolio.ts';

const position = (ops: ReturnType<typeof op>[], last?: ReturnType<typeof close>, prev?: ReturnType<typeof close>) =>
  computePosition(ops, last, prev, pesos).position;

describe('Precio promedio', () => {
  test('dos compras a distinto precio: el promedio queda en el medio', () => {
    // 10 a $100 + 10 a $200 = $3.000 por 20 acciones → $150 cada una
    const p = position([op('COMPRA', '2024-01-01', 10, 100), op('COMPRA', '2024-02-01', 10, 200)]);
    assert.equal(p.quantity, 20);
    assert.equal(p.avgCost, 150);
    assert.equal(p.costBasis, 3000);
  });

  test('las comisiones de compra se suman al costo', () => {
    // 10 a $100 + $10 de comisión = $1.010 → $101 cada una
    const p = position([op('COMPRA', '2024-01-01', 10, 100, 10)]);
    assert.equal(p.costBasis, 1010);
    assert.equal(p.avgCost, 101);
  });

  test('vender no cambia el precio promedio de lo que queda', () => {
    const p = position([
      op('COMPRA', '2024-01-01', 10, 100),
      op('COMPRA', '2024-02-01', 10, 200),
      op('VENTA', '2024-03-01', 5, 300),
    ]);
    assert.equal(p.quantity, 15);
    assert.equal(p.avgCost, 150);
  });

  test('si vendés todo y volvés a comprar, el promedio arranca de cero', () => {
    const p = position([
      op('COMPRA', '2024-01-01', 10, 100),
      op('VENTA', '2024-02-01', 10, 150),
      op('COMPRA', '2024-03-01', 10, 200),
    ]);
    assert.equal(p.avgCost, 200);
  });
});

describe('Ganancias', () => {
  test('ganancia de una venta: precio de venta menos precio promedio', () => {
    // Promedio $150, vendo 10 a $180 → 10 × $30 = $300
    const p = position([
      op('COMPRA', '2024-01-01', 10, 100),
      op('COMPRA', '2024-02-01', 10, 200),
      op('VENTA', '2024-03-01', 10, 180),
    ]);
    assert.equal(p.realized, 300);
  });

  test('las comisiones de venta se descuentan de la ganancia', () => {
    // Costo $1.010; cobro 10 × $120 − $12 = $1.188 → gané $178
    const p = position([op('COMPRA', '2024-01-01', 10, 100, 10), op('VENTA', '2024-02-01', 10, 120, 12)]);
    assert.equal(p.realized, 178);
  });

  test('ganancia en lo que tenés: valor de hoy menos lo que te costó', () => {
    // 10 a $100; hoy vale $130 y ayer $120
    const p = position([op('COMPRA', '2024-01-01', 10, 100)], close('2024-06-02', 130), close('2024-06-01', 120));
    assert.equal(p.marketValue, 1300);
    assert.equal(p.unrealized, 300);
    assert.ok(near(p.unrealizedPct, 0.3));
    assert.equal(p.dayChange, 100); // 10 × ($130 − $120)
    assert.ok(near(p.dayChangePct, 130 / 120 - 1));
  });

  test('acertijo de la vaca: compro a 2.000, vendo a 2.200, recompro a 2.300, vendo a 2.500 → gané 400', () => {
    const ops = [
      op('COMPRA', '2024-01-01', 1, 2000),
      op('VENTA', '2024-02-01', 1, 2200),
      op('COMPRA', '2024-03-01', 1, 2300),
      op('VENTA', '2024-04-01', 1, 2500),
    ];
    const p = position(ops);
    assert.equal(p.totalGain, 400); // ni 500, ni 300, ni 100
    assert.equal(p.quantity, 0);
    // De tu bolsillo pusiste $2.000 y después $100 más para recomprar
    assert.equal(peakCapital(ops, pesos), 2100);
  });

  test('acertijo de Martín: vende caro, recompra barato → gana 950', () => {
    const ops = [
      op('COMPRA', '2024-01-01', 10, 100),
      op('VENTA', '2024-02-01', 5, 150),
      op('COMPRA', '2024-03-01', 5, 120),
      op('VENTA', '2024-04-01', 10, 180),
    ];
    const p = position(ops);
    assert.equal(p.totalGain, 950);
    assert.equal(peakCapital(ops, pesos), 1000);
    assert.ok(near(p.totalGainPct, 0.95)); // 950 sobre los $1.000 que llegó a poner
  });

  test('acertijo de Martín: Laura, que no hizo nada, gana 800 (150 menos)', () => {
    const p = position([op('COMPRA', '2024-01-01', 10, 100), op('VENTA', '2024-04-01', 10, 180)]);
    assert.equal(p.totalGain, 800);
  });

  test('el % de ganancia no cuenta dos veces la plata que rota', () => {
    // Compro a 100, vendo a 150, compro a 200, vendo a 250: gané 100 poniendo como mucho 150
    const ops = [
      op('COMPRA', '2024-01-01', 1, 100),
      op('VENTA', '2024-02-01', 1, 150),
      op('COMPRA', '2024-03-01', 1, 200),
      op('VENTA', '2024-04-01', 1, 250),
    ];
    const p = position(ops);
    assert.equal(p.totalGain, 100);
    assert.ok(near(p.totalGainPct, 100 / 150)); // 67%, no 33% (100 / 300 sumando las compras)
  });
});

describe('Dividendos', () => {
  test('se suman netos de retención y no cambian el precio promedio', () => {
    // 10 acciones × $2 = $20, menos $0,60 de retención = $19,40
    // (El precio sigue en $100, así que toda la ganancia es el dividendo)
    const p = position([op('COMPRA', '2024-01-01', 10, 100), op('DIVIDENDO', '2024-03-01', 10, 2, 0.6)], close('2024-03-02', 100));
    assert.ok(near(p.dividends, 19.4));
    assert.equal(p.avgCost, 100);
    assert.ok(near(p.totalGain, 19.4));
  });

  test('cuenta lo que tenías el día anterior al pago', () => {
    const ops = [op('COMPRA', '2024-01-10', 10, 100), op('VENTA', '2024-02-01', 4, 120)];
    assert.equal(holdingBefore(ops, '2024-02-01'), 10); // la venta de ese mismo día no cuenta
    assert.equal(holdingBefore(ops, '2024-02-02'), 6);
    assert.equal(holdingBefore(ops, '2024-01-10'), 0); // todavía no las tenía
  });
});

describe('Controles', () => {
  test('no se puede vender más de lo que se tiene', () => {
    assert.throws(
      () => assertNoShortSelling([op('COMPRA', '2024-01-01', 10, 100), op('VENTA', '2024-02-01', 15, 120)]),
      (e: { status: number }) => e.status === 409,
    );
  });

  test('no se puede vender algo que nunca se compró', () => {
    assert.throws(() => assertNoShortSelling([op('VENTA', '2024-02-01', 1, 120)]), /no hay compras/);
  });

  test('compra y venta el mismo día: primero cuenta la compra, aunque se haya cargado después', () => {
    const venta = op('VENTA', '2024-02-01', 10, 120);
    const compra = op('COMPRA', '2024-02-01', 10, 100);
    assert.doesNotThrow(() => assertNoShortSelling([venta, compra]));
    assert.equal(position([venta, compra]).realized, 200);
  });
});

describe('Dólares', () => {
  const fx = new DateSeries([
    { date: '2024-01-01', value: 1000 },
    { date: '2024-06-01', value: 1250 },
  ]);

  test('cada monto se convierte con el dólar del día en que ocurrió', () => {
    // Compro 10 a $10.000 con el dólar a $1.000 → US$ 10 cada una, US$ 100 en total.
    // Hoy valen $15.000 con el dólar a $1.250 → US$ 12 cada una.
    const usd = makeConverter('USD', fx);
    const p = computePosition([op('COMPRA', '2024-01-01', 10, 10_000)], close('2024-06-01', 15_000), undefined, usd).position;
    assert.equal(p.costBasis, 100);
    assert.equal(p.marketValue, 120);
    assert.ok(near(p.unrealizedPct, 0.2)); // +20% en dólares...
    const ars = position([op('COMPRA', '2024-01-01', 10, 10_000)], close('2024-06-01', 15_000));
    assert.ok(near(ars.unrealizedPct, 0.5)); // ...y +50% en pesos, porque también subió el dólar
  });

  test('en un feriado se usa el último dólar conocido', () => {
    assert.equal(fx.at('2024-03-15'), 1000);
    assert.equal(fx.at('2024-07-01'), 1250);
    assert.equal(fx.at('2023-12-01'), 1000); // antes del primer dato: el primero
  });
});
