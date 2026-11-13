// Corrección de los datos de Yahoo: cambios de ratio no informados y dividendos imposibles.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { all, run } from '../src/db.ts';
import { cleanHistory, detectRatioChanges } from '../src/services/clean.ts';
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
