// Índice de inflación de la Comparativa, el rendimiento real, el Informe y el Simulador:
// se arma con el IPC mensual del INDEC (antes, índice UVA, que va unos dos meses atrasado).
import { near } from './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.ts';
import { inflationSeries } from '../src/services/history.ts';

// IPC: 10% en enero de 2025 y 2% en febrero. Marzo todavía no se publicó.
run("INSERT INTO index_values (series, date, value) VALUES ('ipc', '2025-01-31', 10)");
run("INSERT INTO index_values (series, date, value) VALUES ('ipc', '2025-02-28', 2)");
const s = inflationSeries('2025-03-31');

describe('Índice de inflación con el IPC', () => {
  test('el mes entero suma la inflación del mes: enero 10%', () => {
    assert.ok(near(s.at('2025-01-31'), 1.1)); // el índice arranca en 1 antes del 01/01/2025
  });

  test('dentro del mes se reparte pareja por día: al 16/01 van 16 de 31 días → 1,1^(16/31)', () => {
    assert.ok(near(s.at('2025-01-16'), Math.pow(1.1, 16 / 31)));
  });

  test('los meses se encadenan: enero y febrero → 1,10 × 1,02 = 1,122 (12,2%, no 12%)', () => {
    assert.ok(near(s.at('2025-02-28'), 1.122));
  });

  test('un mes todavía sin publicar se estima con el último publicado (marzo al 2% de febrero)', () => {
    assert.ok(near(s.at('2025-03-31') / s.at('2025-02-28'), 1.02));
  });

  test('una compra del 31/01 no carga con la inflación de enero: a fin de febrero, solo el 2%', () => {
    // Con el UVA, que va atrasado, a esa plata le habría tocado el 10% de enero
    assert.ok(near(s.at('2025-02-28') / s.at('2025-01-31'), 1.02));
  });

  test('sin IPC guardado no hay índice (la pantalla no compara contra la inflación)', () => {
    run("DELETE FROM index_values WHERE series = 'ipc'");
    assert.equal(inflationSeries('2025-03-31').empty, true);
  });
});
