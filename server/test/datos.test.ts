// Corrección de los datos de Yahoo: cambios de ratio no informados y dividendos imposibles.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { all, run } from '../src/db.ts';
import { cleanHistory, detectRatioChanges, unadjustedSplits } from '../src/services/clean.ts';
import { adjustForSplits, dividendEvents } from '../src/services/portfolio.ts';
import { saveBars } from '../src/services/sync.ts';

/** Precios diarios desde el 1/1/2024: una lista de cierres. */
const series = (closes: number[]) =>
  closes.map((close, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), close }));

const repeat = (value: number, n: number) => Array<number>(n).fill(value);

describe('Detectar cambios de ratio', () => {
  test('el precio se parte a la mitad y se queda ahí → cambio de ratio 2:1', () => {
    // Como AAPL en enero de 2024: de $25.100 a $12.697
    const changes = detectRatioChanges(series([...repeat(25_100, 10), ...repeat(12_697, 10)]));
    assert.deepEqual(changes, [{ date: '2024-01-11', factor: 2 }]);
  });

  test('un ratio 3:1 se redondea a 3 aunque ese día el precio se haya movido un poco', () => {
    const changes = detectRatioChanges(series([...repeat(43_589, 10), ...repeat(14_842, 10)]));
    assert.equal(changes[0].factor, 3);
  });

  test('un dato suelto mal cargado no es un cambio de ratio', () => {
    assert.deepEqual(detectRatioChanges(series([...repeat(100, 10), 10, ...repeat(100, 10)])), []);
  });

  test('un movimiento normal del mercado no es un cambio de ratio', () => {
    assert.deepEqual(detectRatioChanges(series([...repeat(100, 10), ...repeat(70, 10)])), []);
  });

  // Con el precio de la acción en EE.UU. se confirma (las fechas de series() arrancan el 01/01/2024)
  const us = (values: number[]) => series(values).map((r) => ({ date: r.date, value: r.close }));

  test('si la acción en EE.UU. también se desplomó, es una caída real: 10.000 → 4.500 no es un ratio ×2,22', () => {
    // Sin el control, 100 CEDEARs pasaban a ser 222 y la pérdida de 55% desaparecía
    assert.deepEqual(detectRatioChanges(series([...repeat(10_000, 10), ...repeat(4_500, 10)])), [{ date: '2024-01-11', factor: 10_000 / 4_500 }]);
    assert.deepEqual(detectRatioChanges(series([...repeat(10_000, 10), ...repeat(4_500, 10)]), us([...repeat(100, 10), ...repeat(45, 10)])), []);
  });

  test('si la acción en EE.UU. no se movió, se confirma el cambio de ratio 2:1', () => {
    const changes = detectRatioChanges(series([...repeat(25_100, 10), ...repeat(12_697, 10)]), us(repeat(190, 20)));
    assert.deepEqual(changes, [{ date: '2024-01-11', factor: 2 }]);
  });

  test('sin el precio de EE.UU. de ese día todavía, no se ajusta (se vuelve a mirar en la próxima actualización)', () => {
    assert.deepEqual(detectRatioChanges(series([...repeat(25_100, 10), ...repeat(12_697, 10)]), us(repeat(190, 10))), []);
  });
});

describe('Corregir el historial guardado', () => {
  const save = (ticker: string, type: string, closes: number[]) => {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES (?, ?, 'Prueba', ?)", ticker, `${ticker}.BA`, type);
    for (const r of series(closes)) run('INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?)', ticker, r.date, r.close);
  };
  const closes = (ticker: string) => all<{ close: number }>('SELECT close FROM prices WHERE ticker = ? ORDER BY date', ticker).map((r) => r.close);

  test('CEDEAR: se ajustan los precios viejos, los dividendos viejos y se registra el split', () => {
    save('CED', 'CEDEAR', [...repeat(200, 10), ...repeat(100, 10)]);
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('CED', '2024-01-05', 4)");
    cleanHistory('CED');
    assert.ok(closes('CED').every((c) => c === 100));
    assert.equal(all<{ amount: number }>("SELECT amount FROM dividend_events WHERE ticker = 'CED'")[0].amount, 2);
    assert.deepEqual(all("SELECT date, factor FROM split_events WHERE ticker = 'CED'").map((r) => ({ ...(r as object) })), [
      { date: '2024-01-11', factor: 2 },
    ]);
  });

  test('corregir dos veces no cambia nada la segunda vez', () => {
    cleanHistory('CED');
    assert.ok(closes('CED').every((c) => c === 100));
    assert.equal(all("SELECT 1 FROM split_events WHERE ticker = 'CED'").length, 1);
  });

  test('acción argentina: una caída fuerte puede ser real (las PASO de 2019) y no se toca', () => {
    save('ACC', 'ACCION', [...repeat(174, 10), ...repeat(92, 10)]);
    cleanHistory('ACC');
    assert.equal(closes('ACC')[0], 174);
    assert.equal(all("SELECT 1 FROM split_events WHERE ticker = 'ACC'").length, 0);
  });

  test('se descartan los dividendos imposibles y se quedan los normales', () => {
    save('DIV', 'CEDEAR', repeat(5200, 20));
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('DIV', '2024-01-05', 32822)"); // como ACN: 6 veces el precio
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('DIV', '2024-01-15', 31.5)"); // normal: 0,6%
    cleanHistory('DIV');
    assert.deepEqual(
      all<{ amount: number }>("SELECT amount FROM dividend_events WHERE ticker = 'DIV'").map((r) => r.amount),
      [31.5],
    );
  });
});

describe('Dividendos de CEDEARs', () => {
  // KO: ratio 5 (5 CEDEARs = 1 acción). En sept. 2019 pagó US$0,40 por acción y el MEP estaba a $69,21
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('KO', 'KO.BA', 'Coca-Cola', 'CEDEAR')");
  run("INSERT INTO index_values (series, date, value) VALUES ('usdiv:KO', '2019-09-13', 0.4)");
  run("INSERT INTO fx_rates (kind, date, buy, sell) VALUES ('bolsa', '2019-09-13', 69.21, 69.21)");
  run("INSERT INTO fx_rates (kind, date, buy, sell) VALUES ('bolsa', '2026-11-10', 1560, 1588)");
  // Lo que informa Yahoo en BYMA: pasado a pesos con un dólar de hoy, 22 veces más
  run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('KO', '2019-09-13', 123.6)");

  test('se paga en dólares ÷ ratio, al dólar de ese día: 0,40 ÷ 5 × $69,21 = $5,54 por CEDEAR', () => {
    const [d] = dividendEvents('KO', 'CEDEAR');
    assert.equal(d.date, '2019-09-13');
    assert.ok(Math.abs(d.amount - 5.5368) < 1e-6);
  });

  test('un CEDEAR sin ratio conocido no informa dividendos (el dato de Yahoo no es confiable)', () => {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('ZZZ', 'ZZZ.BA', 'Sin ratio', 'CEDEAR')");
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('ZZZ', '2024-01-10', 50)");
    assert.deepEqual(dividendEvents('ZZZ', 'CEDEAR'), []);
  });

  test('si los precios dicen que el ratio cambió y la tabla no, no se sugieren dividendos (saldrían multiplicados)', () => {
    // La tabla dice PEP 18 y PG 15. Con el CCL a $1.000 y la acción a US$ 100 en EE.UU.:
    // - PG en BYMA a $6.666,67 → ratio observado 100 × 1.000 ÷ 6.666,67 = 15, igual que la tabla.
    // - PEP en BYMA a $2.777,78 → ratio observado 36: BYMA lo pasó de 18 a 36 y la tabla quedó vieja.
    //   Con 18, cada dividendo saldría el doble de lo cobrado.
    run("INSERT INTO fx_rates (kind, date, buy, sell) VALUES ('contadoconliqui', '2026-11-02', 1000, 1000)");
    for (const [ticker, ars] of [['PEP', (100 * 1000) / 36], ['PG', (100 * 1000) / 15]] as const) {
      run("INSERT INTO assets (ticker, symbol, name, type) VALUES (?, ?, 'Prueba', 'CEDEAR')", ticker, `${ticker}.BA`);
      run("INSERT INTO index_values (series, date, value) VALUES (?, '2026-06-10', 1)", `usdiv:${ticker}`);
      for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
        run('INSERT INTO prices (ticker, date, close) VALUES (?, ?, ?)', ticker, date, ars);
        run('INSERT INTO index_values (series, date, value) VALUES (?, ?, 100)', `us:${ticker}`, date);
      }
    }
    assert.deepEqual(dividendEvents('PEP', 'CEDEAR'), []);
    assert.equal(dividendEvents('PG', 'CEDEAR').length, 1); // con el ratio bien, sí
  });

  test('en una acción local se usa lo que informa Yahoo, que ya está en pesos', () => {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('LOC', 'LOC.BA', 'Local', 'ACCION')");
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('LOC', '2024-05-10', 12.5)");
    assert.deepEqual(
      dividendEvents('LOC', 'ACCION').map((d) => ({ ...d })),
      [{ date: '2024-05-10', amount: 12.5 }],
    );
  });
});

describe('Cambio de ratio que Yahoo no informa, con la app actualizando todos los días', () => {
  test('compré 10 a $100 y el ratio cambia 2:1: quedan 20 a $50, hoy y los días siguientes', () => {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('RAT', 'RAT.BA', 'Prueba', 'CEDEAR')");
    // 40 ruedas (lunes a viernes) a $100 y, desde el cambio de ratio, a $50. Yahoo nunca ajusta las viejas.
    const days: string[] = [];
    for (const d = new Date('2026-03-02T00:00:00Z'); days.length < 50; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() % 6 !== 0) days.push(d.toISOString().slice(0, 10));
    }
    const CHANGE = 40;
    const yahoo = days.map((date, i) => ({ date, open: null, high: null, low: null, close: i < CHANGE ? 100 : 50, volume: null }));
    const weekBefore = (iso: string) => new Date(Date.parse(iso) - 7 * 86_400_000).toISOString().slice(0, 10);
    const compra = { ticker: 'RAT', date: days[5], quantity: 10, price: 100 };

    // Cada día la app baja desde una semana antes del último precio guardado (como syncAsset)
    for (let today = CHANGE - 1; today < days.length; today++) {
      const last = all<{ d: string | null }>("SELECT MAX(date) AS d FROM prices WHERE ticker = 'RAT'")[0].d;
      saveBars('RAT', yahoo.filter((b) => (!last || b.date >= weekBefore(last)) && b.date <= days[today]));
      if (today < CHANGE) continue;
      const splits = all<{ date: string; factor: number }>("SELECT date, factor FROM split_events WHERE ticker = 'RAT'").map((s) => ({ ...s }));
      assert.deepEqual(splits, [{ date: days[CHANGE], factor: 2 }], `splits al ${days[today]}`);
      assert.equal(adjustForSplits([compra])[0].quantity, 20, `tenencia al ${days[today]}`);
      const closes = all<{ close: number }>("SELECT close FROM prices WHERE ticker = 'RAT'").map((r) => r.close);
      assert.ok(closes.every((c) => c === 50), `precios al ${days[today]}`);
    }
  });
});

describe('Split que Yahoo informa pero sin ajustar los precios anteriores', () => {
  const split = [{ date: '2024-01-11', factor: 10 }];

  test('MIRG: split 10 a 1 y el precio pasa de $16.350 a $1.640 ese día → el historial quedó sin ajustar', () => {
    assert.deepEqual(unadjustedSplits(series([...repeat(16_350, 10), ...repeat(1_640, 10)]), split), split);
  });

  test('YPFD: mismo split, pero Yahoo ya ajustó ($8.290 → $8.105): no hay nada que corregir', () => {
    assert.deepEqual(unadjustedSplits(series([...repeat(8_290, 10), ...repeat(8_105, 10)]), split), []);
  });

  test('una caída de 45% el día de un split 10 a 1 no es el split sin ajustar (el precio tendría que caer 90%)', () => {
    assert.deepEqual(unadjustedSplits(series([...repeat(1_000, 10), ...repeat(550, 10)]), split), []);
  });

  test('un reparto de acciones del 1% no se mira: no se distingue de un día normal', () => {
    assert.deepEqual(unadjustedSplits(series([...repeat(101, 10), ...repeat(100, 10)]), [{ date: '2024-01-11', factor: 1.01 }]), []);
  });

  test('acción argentina: los precios anteriores se dividen por 10 una sola vez, aunque se corrija dos veces', () => {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('MIR', 'MIR.BA', 'Prueba', 'ACCION')");
    for (const r of series([...repeat(16_350, 10), ...repeat(1_640, 10)])) run("INSERT INTO prices (ticker, date, close) VALUES ('MIR', ?, ?)", r.date, r.close);
    run("INSERT INTO split_events (ticker, date, factor) VALUES ('MIR', '2024-01-11', 10)");
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('MIR', '2024-01-05', 300)");
    const closes = () => all<{ close: number }>("SELECT close FROM prices WHERE ticker = 'MIR' ORDER BY date").map((r) => r.close);
    cleanHistory('MIR');
    assert.deepEqual(closes(), [...repeat(1_635, 10), ...repeat(1_640, 10)]);
    assert.equal(all<{ amount: number }>("SELECT amount FROM dividend_events WHERE ticker = 'MIR'")[0].amount, 30);
    cleanHistory('MIR');
    assert.deepEqual(closes(), [...repeat(1_635, 10), ...repeat(1_640, 10)]);
  });

  test('con la app actualizando todos los días: compré 5 a $1.000, split 10 a 1 → 50 a $100 y ningún precio queda en $1.000', () => {
    run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('SPL', 'SPL.BA', 'Prueba', 'ACCION')");
    const days: string[] = [];
    for (const d = new Date('2026-03-02T00:00:00Z'); days.length < 50; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() % 6 !== 0) days.push(d.toISOString().slice(0, 10));
    }
    const CHANGE = 40;
    // Yahoo informa el split desde ese día, pero nunca ajusta los precios anteriores
    const yahoo = days.map((date, i) => ({ date, open: null, high: null, low: null, close: i < CHANGE ? 1000 : 100, volume: null }));
    const weekBefore = (iso: string) => new Date(Date.parse(iso) - 7 * 86_400_000).toISOString().slice(0, 10);
    const compra = { ticker: 'SPL', date: days[5], quantity: 5, price: 1000 };
    for (let today = CHANGE - 1; today < days.length; today++) {
      const last = all<{ d: string | null }>("SELECT MAX(date) AS d FROM prices WHERE ticker = 'SPL'")[0].d;
      const reported = today >= CHANGE ? [{ date: days[CHANGE], factor: 10 }] : [];
      // El día que aparece un split nuevo la app vuelve a bajar todo el historial (como downloadAsset)
      const full = today === CHANGE;
      saveBars('SPL', yahoo.filter((b) => (full || !last || b.date >= weekBefore(last)) && b.date <= days[today]), [], reported);
      if (today < CHANGE) continue;
      const adjusted = adjustForSplits([compra])[0];
      assert.equal(adjusted.quantity, 50, `tenencia al ${days[today]}`);
      assert.equal(adjusted.price, 100, `precio de compra al ${days[today]}`);
      const closes = all<{ close: number }>("SELECT close FROM prices WHERE ticker = 'SPL'").map((r) => r.close);
      assert.ok(closes.every((c) => c === 100), `precios al ${days[today]}`);
    }
  });
});
