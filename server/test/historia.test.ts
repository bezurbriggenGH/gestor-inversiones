// Evolución de la cartera: TIR, rendimiento mes a mes, plazo fijo, splits y
// que las distintas pantallas den los mismos números.
import { close, near, op, pesos } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { buildHistory, monthlyReturns, plazoFijoIndex, xirr } from '../src/services/history.ts';
import { adjustForSplits, adjustOperations, assertNoShortSelling, buildPortfolio, computePosition } from '../src/services/portfolio.ts';

describe('TIR (rendimiento por año)', () => {
  test('pongo $1.000 y al año recibo $1.100 → 10% anual', () => {
    const r = xirr([
      { date: '2023-01-01', amount: -1000 },
      { date: '2024-01-01', amount: 1100 },
    ]);
    assert.ok(near(r, 0.1));
  });

  test('ganar 21% en dos años es 10% por año, no 10,5%', () => {
    const r = xirr([
      { date: '2023-01-01', amount: -1000 },
      { date: '2025-01-01', amount: 1210 },
    ]);
    assert.ok(near(r, 0.1, 1e-3));
  });

  test('con menos de un mes no se calcula (no es representativo)', () => {
    assert.equal(xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2024-01-15', amount: 1100 }]), null);
  });
});

describe('Rendimiento mes a mes', () => {
  test('una compra grande sobre una cartera chica no exagera la caída', () => {
    // Día 1: compro $10.000. Día 2: compro $40.000 más y todo baja 4% → la cartera vale $48.000.
    // El rendimiento del día es −4%. (Antes daba −20%: la caída de la compra nueva
    // se dividía solo por los $10.000 que ya había.)
    const [m] = monthlyReturns([
      { date: '2024-02-15', value: 10_000, netInvested: 10_000 },
      { date: '2024-02-16', value: 48_000, netInvested: 50_000 },
    ]);
    assert.ok(near(m.return, -0.04));
    assert.ok(near(m.gain, -2000));
  });

  test('una venta no cuenta como pérdida', () => {
    // Tengo $10.000, sube 10% y vendo la mitad: me quedan $5.500 y cobré $5.500
    const [m] = monthlyReturns([
      { date: '2024-03-01', value: 10_000, netInvested: 10_000 },
      { date: '2024-03-04', value: 5_500, netInvested: 4_500 },
    ]);
    assert.ok(near(m.return, 0.1));
    assert.ok(near(m.gain, 1000));
  });

  test('cada mes se mide por separado', () => {
    const months = monthlyReturns([
      { date: '2024-01-31', value: 1000, netInvested: 1000 },
      { date: '2024-02-29', value: 1100, netInvested: 1000 }, // +10% en febrero
      { date: '2024-03-29', value: 990, netInvested: 1000 }, // −10% en marzo
    ]);
    assert.deepEqual(
      months.map((m) => m.month),
      ['2024-01', '2024-02', '2024-03'],
    );
    assert.ok(near(months[1].return, 0.1));
    assert.ok(near(months[2].return, -0.1));
  });
});

describe('Plazo fijo', () => {
  test('con una tasa de 36,5% anual, en 30 días se gana 3%', () => {
    for (let d = 1; d <= 31; d++) {
      run("INSERT INTO index_values (series, date, value) VALUES ('plazofijo', ?, 0.365)", `2024-01-${String(d).padStart(2, '0')}`);
    }
    const idx = plazoFijoIndex('2024-01-01', '2024-01-31');
    assert.ok(near(idx.at('2024-01-31') / idx.at('2024-01-01'), 1.03, 1e-9));
  });
});

describe('Splits y cambios de ratio', () => {
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('SPLT', 'SPLT.BA', 'Prueba split', 'CEDEAR')");
  run("INSERT INTO split_events (ticker, date, factor) VALUES ('SPLT', '2024-06-01', 3)");

  test('las operaciones anteriores al split se ajustan: 10 a $300 pasan a ser 30 a $100', () => {
    const [antes, despues] = adjustForSplits([
      op('COMPRA', '2024-01-01', 10, 300, 0, 'SPLT'),
      op('COMPRA', '2024-07-01', 5, 110, 0, 'SPLT'),
    ]);
    assert.equal(antes.quantity, 30);
    assert.equal(antes.price, 100);
    assert.equal(despues.quantity, 5); // la posterior no cambia
  });

  test('el split no cambia la ganancia', () => {
    // Compré 10 a $300 (= $3.000). Hoy, después del split 3:1, cada una vale $120: 30 × $120 = $3.600
    const ops = adjustForSplits([op('COMPRA', '2024-01-01', 10, 300, 0, 'SPLT')]);
    const p = computePosition(ops, close('2024-07-01', 120), undefined, pesos).position;
    assert.equal(p.quantity, 30);
    assert.equal(p.costBasis, 3000);
    assert.equal(p.unrealized, 600); // igual que 10 × ($360 − $300) sin el split
  });
});

describe('Fracciones que deja un split (el broker solo acredita acciones enteras)', () => {
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('FRAC', 'FRAC.BA', 'Reparto de acciones', 'ACCION')");
  run("INSERT INTO split_events (ticker, date, factor) VALUES ('FRAC', '2025-01-10', 2.25)");
  run("INSERT INTO prices (ticker, date, close) VALUES ('FRAC', '2025-01-10', 50)");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('DIVA', 'DIVA.BA', 'Dividendo en acciones', 'CEDEAR')");
  run("INSERT INTO split_events (ticker, date, factor) VALUES ('DIVA', '2025-05-13', 1.01)");
  run("INSERT INTO prices (ticker, date, close) VALUES ('DIVA', '2025-05-13', 1000)");

  test('10 acciones con un reparto de ×2,25 son 22,5: quedan 22 y la media acción se cobra a $50', () => {
    const ops = adjustOperations([op('COMPRA', '2025-01-02', 10, 225, 0, 'FRAC')]);
    const fraccion = ops.find((o) => o.auto);
    assert.ok(fraccion);
    assert.equal(fraccion.type, 'VENTA');
    assert.ok(near(fraccion.quantity, 0.5));
    assert.equal(fraccion.price, 50);
    const p = computePosition(ops, close('2025-02-01', 50), undefined, pesos).position;
    assert.ok(near(p.quantity, 22));
    // Pagué $2.250 por 22,5 acciones ($100 cada una): la media que se cobra a $50 pierde $25
    assert.ok(near(p.realized, -25));
  });

  test('con 2 CEDEARs, un dividendo del 1% en acciones no acredita ninguno: al vender 2 no queda nada', () => {
    const ops = adjustOperations([op('COMPRA', '2025-04-15', 2, 1010, 0, 'DIVA'), op('VENTA', '2025-07-21', 2, 1100, 0, 'DIVA')]);
    assert.doesNotThrow(() => assertNoShortSelling(ops));
    const p = computePosition(ops, close('2025-08-01', 1100), undefined, pesos).position;
    assert.equal(p.quantity, 0);
  });

  test('con 300 CEDEARs, el 1% en acciones sí acredita 3 enteros y no queda fracción', () => {
    const ops = adjustOperations([op('COMPRA', '2025-04-15', 300, 1010, 0, 'DIVA')]);
    assert.equal(ops.filter((o) => o.auto).length, 0);
    assert.ok(near(computePosition(ops, close('2025-08-01', 1000), undefined, pesos).position.quantity, 303));
  });
});

describe('Las pantallas cuentan lo mismo', () => {
  // Una cartera de prueba completa: un activo, sus precios, el dólar y tres operaciones
  run("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Prueba', 'prueba@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('AAA', 'AAA.BA', 'Prueba', 'ACCION')");
  run("INSERT INTO user_assets (user_id, ticker) VALUES (1, 'AAA')");
  const prices: [string, number, number][] = [
    // fecha, precio, dólar
    ['2025-01-02', 1000, 1100],
    ['2025-02-03', 1200, 1150],
    ['2025-03-03', 1100, 1200],
    ['2025-04-01', 1500, 1250],
  ];
  for (const [date, px, usd] of prices) {
    run("INSERT INTO prices (ticker, date, close) VALUES ('AAA', ?, ?)", date, px);
    run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, ?)", date, usd);
  }
  const insert = (type: string, date: string, qty: number, price: number) =>
    run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (1, 'AAA', ?, ?, ?, ?)", type, date, qty, price);
  insert('COMPRA', '2025-01-02', 10, 1000);
  insert('VENTA', '2025-02-03', 4, 1200);
  insert('COMPRA', '2025-03-03', 6, 1100);

  test('el valor y la ganancia dan igual en la cartera y en la evolución', () => {
    const p = buildPortfolio(1, 'ARS', 'bolsa').summary;
    const h = buildHistory(1, 'ARS', 'bolsa').portfolio!;
    assert.equal(p.marketValue, 12 * 1500);
    assert.ok(near(p.marketValue, h.value));
    // Ganancia total = valor de hoy − plata puesta neta
    assert.ok(near(p.totalGain, h.value - h.netInvested));
  });

  test('en dólares, "haber comprado dólares" da exactamente la plata puesta y 0% por año', () => {
    const h = buildHistory(1, 'USD', 'bolsa');
    const dolar = h.benchmarks.find((b) => b.key === 'dolar')!;
    assert.ok(near(dolar.value, h.portfolio!.netInvested));
    assert.ok(near(dolar.irr, 0, 1e-6));
  });

  test('con dólar CCL la comparación dice "Dólar CCL"', () => {
    run("INSERT INTO fx_rates (kind, date, sell) VALUES ('contadoconliqui', '2025-01-02', 1150)");
    const h = buildHistory(1, 'ARS', 'contadoconliqui');
    assert.equal(h.benchmarks.find((b) => b.key === 'dolar')!.label, 'Dólar CCL');
  });

  test('un índice sin datos hace más de una semana no se compara; uno con datos de hace 4 días, sí', () => {
    // La cartera llega al 01/04. El Merval se cortó el 03/03 (un mes antes); el S&P 500 tiene hasta el 28/03.
    for (const d of ['2025-01-02', '2025-02-03', '2025-03-03']) run("INSERT INTO index_values (series, date, value) VALUES ('merval', ?, 100)", d);
    for (const d of ['2025-01-02', '2025-03-28']) run("INSERT INTO index_values (series, date, value) VALUES ('spy', ?, 100)", d);
    const h = buildHistory(1, 'ARS', 'bolsa');
    const merval = h.benchmarks.find((b) => b.key === 'merval')!;
    const spy = h.benchmarks.find((b) => b.key === 'spy')!;
    assert.equal(merval.frozen, true);
    assert.equal(merval.available, false);
    assert.equal(merval.diff, null); // no hay diferencia falsa contra un dato de hace un mes
    assert.equal(merval.lastDataDate, '2025-03-03');
    assert.equal(spy.frozen, false);
    assert.equal(spy.available, true);
  });
});

describe('Activo sin precios guardados de la época de la operación', () => {
  // Yahoo no tiene historial de algunos CEDEARs: el único precio guardado es posterior a la compra y a la venta
  run("INSERT INTO users (id, name, email, password_hash) VALUES (2, 'Otra', 'otra@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('NUE', 'NUE.BA', 'Sin historial', 'CEDEAR')");
  run("INSERT INTO user_assets (user_id, ticker) VALUES (2, 'NUE')");
  run("INSERT INTO prices (ticker, date, close) VALUES ('NUE', '2025-04-01', 5850)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (2, 'NUE', 'COMPRA', '2025-02-03', 135, 2910)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (2, 'NUE', 'VENTA', '2025-03-03', 135, 3137.5)");

  test('el día de la compra vale lo que pagué, no el precio de meses después', () => {
    const h = buildHistory(2, 'ARS', 'bolsa');
    const compra = h.points.find((p) => p.date === '2025-02-03')!;
    assert.equal(compra.value, 135 * 2910); // $392.850, no 135 × $5.850 = $789.750
  });

  test('la ganancia aparece en el mes en que vendí: 135 × ($3.137,50 − $2.910) = $30.712,50', () => {
    const months = buildHistory(2, 'ARS', 'bolsa').monthly;
    const feb = months.find((m) => m.month === '2025-02')!;
    const mar = months.find((m) => m.month === '2025-03')!;
    assert.ok(near(feb.gain, 0)); // antes: +$396.900 inventados
    assert.ok(near(feb.return, 0));
    assert.ok(near(mar.gain, 30_712.5));
    assert.ok(near(mar.return, 30_712.5 / 392_850));
  });
});

describe('Variación del día de la cartera', () => {
  // Dos acciones, 10 de cada una. La última rueda es el 01/04: HOYSI operó, HOYNO no.
  run("INSERT INTO users (id, name, email, password_hash) VALUES (3, 'Tercera', 'tercera@test.com', 'x')");
  for (const [ticker, rows] of [
    ['HOYSI', [['2025-03-31', 100], ['2025-04-01', 110]]],
    ['HOYNO', [['2025-03-28', 50], ['2025-03-31', 60]]],
  ] as const) {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES (?, ?, 'Prueba', 'ACCION')", ticker, `${ticker}.BA`);
    run('INSERT INTO user_assets (user_id, ticker) VALUES (3, ?)', ticker);
    for (const [date, px] of rows) run('INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?)', ticker, date, px);
    run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (3, ?, 'COMPRA', '2025-03-03', 10, 40)", ticker);
  }

  test('un activo que no operó en la última rueda no suma su variación de un día anterior', () => {
    const p = buildPortfolio(3, 'ARS', 'bolsa');
    // HOYSI: 10 × ($110 − $100) = $100. HOYNO subió $10 el 31/03, pero el 01/04 no se movió.
    assert.equal(p.summary.dayChange, 100); // antes: $200
    assert.equal(p.positions.find((x) => x.ticker === 'HOYNO')!.dayChange, 0);
    // Sobre lo que valía todo ayer: 10 × $100 + 10 × $60 = $1.600
    assert.ok(near(p.summary.dayChangePct, 100 / 1600));
    assert.equal(p.summary.marketValue, 10 * 110 + 10 * 60);
  });
});
