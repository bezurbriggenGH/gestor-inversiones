// Comparativa y simulador: casos que antes daban números engañosos.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { buildHistory } from '../src/services/history.ts';
import { simulate } from '../src/services/simulator.ts';

// Precios y dólar planos, e inflación en cero (IPC de 0% desde diciembre de 2024): las cuentas se sacan a mano
run("INSERT INTO index_values (series, date, value) VALUES ('ipc', '2024-12-31', 0)");
for (const date of ['2025-01-02', '2025-03-03', '2025-06-02', '2025-07-01']) {
  run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, 1000)", date);
}

describe('Vendiste mucho más de lo que pusiste', () => {
  // Compro 10 a $100 ($1.000). Triplica y vendo 8 a $300 ($2.400). Me quedan 2 que valen $600.
  run("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Prueba', 'prueba@test.com', 'x')");
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('AAA', 'AAA.BA', 'Prueba', 'ACCION')");
  run("INSERT INTO user_assets (user_id, ticker) VALUES (1, 'AAA')");
  for (const [date, px] of [['2025-01-02', 100], ['2025-06-02', 300], ['2025-07-01', 300]] as const) {
    run("INSERT INTO prices (ticker, date, close) VALUES ('AAA', ?, ?)", date, px);
  }
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (1, 'AAA', 'COMPRA', '2025-01-02', 10, 100)");
  run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (1, 'AAA', 'VENTA', '2025-06-02', 8, 300)");
  const h = buildHistory(1, 'ARS', 'bolsa');

  test('la ganancia contra la inflación se informa en plata y no como "0%"', () => {
    // Con inflación cero, esa plata "valdría" 1.000 − 2.400 = −1.400: no hay porcentaje posible.
    // Ganancia real = 600 − (−1.400) = 2.000, lo mismo que la ganancia en pesos.
    assert.equal(h.realReturn!.pct, null);
    assert.equal(h.realReturn!.gain, 2000);
  });

  test('la alternativa queda en −1.400 (no alcanzaba para esa venta) y no se le calcula porcentaje', () => {
    const infl = h.benchmarks.find((b) => b.key === 'inflacion')!;
    assert.equal(infl.value, -1400);
    assert.equal(infl.diff, 2000);
    assert.equal(infl.diffPct, null);
  });

  test('seis meses no se anualizan', () => {
    assert.equal(h.portfolio!.irr, null);
  });
});

describe('Simulador: dividendos netos de la retención', () => {
  // $1.000 en una acción local a $100 → 10 acciones. Paga $10 por acción: $100 brutos, 7% de retención → $93.
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('SIM', 'SIM.BA', 'Simulada', 'ACCION')");
  for (const date of ['2025-01-02', '2025-03-03', '2025-07-01']) run("INSERT INTO prices (ticker, date, close) VALUES ('SIM', ?, 100)", date);
  run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('SIM', '2025-03-03', 10)");

  test('cobra $93, no $100, igual que la cartera', () => {
    const sim = simulate('SIM', 1000, '2025-01-02', 'ARS', 'bolsa');
    assert.ok(Math.abs(sim.dividendsCash - 93) < 1e-9);
    const activo = sim.results.find((r) => r.key === 'activo')!;
    assert.ok(activo.available && Math.abs(activo.value - 1093) < 1e-9);
  });
});

describe('Simulador: una fecha anterior a las cotizaciones del dólar', () => {
  // El dólar guardado empieza el 02/01/2025 ($1.000). VIE tiene precios desde el 03/06/2024.
  // Antes, $1.000 del 03/06/2024 se pasaban con el dólar de 2025, que no es el de ese día.
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('VIE', 'VIE.BA', 'Vieja', 'ACCION')");
  for (const date of ['2024-06-03', '2025-01-02', '2025-07-01']) run("INSERT INTO prices (ticker, date, close) VALUES ('VIE', ?, 100)", date);

  test('se rechaza y dice desde cuándo hay cotizaciones, en dólares y también en pesos (la alternativa "dólar" usa el mismo dato)', () => {
    assert.throws(() => simulate('VIE', 1000, '2024-06-03', 'USD', 'bolsa'), /dólar MEP desde el 02\/01\/2025/);
    assert.throws(() => simulate('VIE', 1000, '2024-06-03', 'ARS', 'bolsa'), /dólar MEP desde el 02\/01\/2025/);
  });

  test('desde el primer día con cotización sí se simula: $1.000 a $1.000 por dólar = US$ 1', () => {
    const sim = simulate('VIE', 1000, '2025-01-02', 'USD', 'bolsa');
    assert.equal(sim.invested, 1);
  });
});

describe('Simulador en dólares: cada dividendo con el dólar del día en que se cobró', () => {
  // $1.000 → 10 acciones a $100. El 02/03/2026 cobra $93 netos con el dólar a $1.000 (US$ 0,093).
  // Después el dólar pasa a $2.000. Antes los $93 se pasaban con el dólar del final: US$ 0,0465.
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('SIU', 'SIU.BA', 'Simulada', 'ACCION')");
  for (const [date, usd] of [['2026-01-02', 1000], ['2026-03-02', 1000], ['2026-06-01', 2000]] as const) {
    run("INSERT INTO prices (ticker, date, close) VALUES ('SIU', ?, 100)", date);
    run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', ?, ?)", date, usd);
  }
  run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('SIU', '2026-03-02', 10)");

  test('US$ 0,093 de dividendos, no US$ 0,0465; el activo termina en US$ 0,50 + 0,093', () => {
    const sim = simulate('SIU', 1000, '2026-01-02', 'USD', 'bolsa');
    assert.ok(Math.abs(sim.dividendsCash - 0.093) < 1e-9);
    const activo = sim.results.find((r) => r.key === 'activo')!;
    assert.ok(activo.available && Math.abs(activo.value - (10 * 100) / 2000 - 0.093) < 1e-9);
  });
});
