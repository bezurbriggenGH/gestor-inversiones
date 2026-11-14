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
  unregisteredDividends,
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

  test('variación del día con una compra de hoy: tenía 10 a $100, hoy vale $110 y compré 5 a $105 → gané $125', () => {
    const p = position(
      [op('COMPRA', '2024-01-01', 10, 90), op('COMPRA', '2024-06-02', 5, 105)],
      close('2024-06-02', 110),
      close('2024-06-01', 100),
    );
    assert.ok(near(p.dayChange, 125)); // 10 × ($110 − $100) + 5 × ($110 − $105), no 15 × $10
    assert.ok(near(p.prevMarketValue, 1000));
  });

  test('variación del día con una venta de hoy: tenía 10 a $100 y vendí todo a $108 → gané $80', () => {
    const p = position(
      [op('COMPRA', '2024-01-01', 10, 90), op('VENTA', '2024-06-02', 10, 108)],
      close('2024-06-02', 110),
      close('2024-06-01', 100),
    );
    assert.ok(near(p.dayChange, 80)); // vendí a $108 lo que ayer valía $100
  });

  test('variación del día: un feriado largo en el medio no la borra (5 días corridos sin rueda)', () => {
    // Último precio el miércoles 27/03 y el siguiente el lunes 01/04: es la rueda anterior, cuenta
    const p = position([op('COMPRA', '2024-01-01', 10, 90)], close('2024-04-01', 110), close('2024-03-27', 100));
    assert.equal(p.dayChange, 100);
  });

  test('variación del día: si el precio anterior es de hace una semana, no es "hoy" y se informa 0', () => {
    // Tengo 1.312 unidades. Precios guardados: $295 el 06/11 y $206,75 el 13/11, nada en el medio.
    // Antes: "hoy −29,9%", −$115.784. Eso es lo que bajó en una semana, no hoy.
    const p = position([op('COMPRA', '2026-06-02', 1312, 500)], close('2026-11-13', 206.75), close('2026-11-06', 295));
    assert.equal(p.dayChange, 0);
    assert.equal(p.dayChangePct, 0);
    assert.equal(p.marketValue, 1312 * 206.75); // el valor sí usa el último precio
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

describe('Dividendos pendientes de cargar', () => {
  const corte = (date: string) => ({ date });
  const fechas = (events: { date: string }[]) => events.map((e) => e.date);

  test('un dividendo cobrado 45 días después del corte ya está cargado (SPY: corte 20/09, cobro 04/11)', () => {
    // Antes se sugería igual: solo se daba por cargado si el cobro era a MENOS de 45 días
    assert.deepEqual(unregisteredDividends([corte('2024-09-20')], ['2024-11-04']), []);
  });

  test('un cobro que tardó 89 días también cuenta (PBR: corte 03/06, cobro 31/08)', () => {
    assert.deepEqual(unregisteredDividends([corte('2026-06-03')], ['2026-08-31']), []);
  });

  test('cada cobro cubre un solo dividendo: dos cortes y un cobro → queda uno pendiente', () => {
    // El cobro del 04/11 es del corte de septiembre; el de diciembre todavía no se cobró
    const pendientes = unregisteredDividends([corte('2024-09-20'), corte('2024-12-20')], ['2024-11-04']);
    assert.deepEqual(fechas(pendientes), ['2024-12-20']);
  });

  test('si no cobraste uno del medio, el pendiente es ese y no otro', () => {
    // Cortes cada tres meses; se cargaron el primero y el tercero (cobrados a los 4 días)
    const cortes = [corte('2025-02-10'), corte('2025-05-12'), corte('2025-08-11')];
    assert.deepEqual(fechas(unregisteredDividends(cortes, ['2025-02-14', '2025-08-15'])), ['2025-05-12']);
  });

  test('un cobro de otra época no tapa nada: sin nada cargado cerca, sigue pendiente', () => {
    assert.deepEqual(fechas(unregisteredDividends([corte('2025-02-10')], ['2024-06-01', '2025-09-01'])), ['2025-02-10']);
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
