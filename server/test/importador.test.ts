// Lectura de los números que vienen en los archivos de los brokers.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseNumber } from '../src/services/importer.ts';

describe('Números del archivo del broker', () => {
  test('formato argentino: "1.234,56" es 1234,56 y "12.000" es doce mil', () => {
    assert.equal(parseNumber('1.234,56'), 1234.56);
    assert.equal(parseNumber('12.000'), 12000);
    assert.equal(parseNumber('$ 3,5'), 3.5);
  });

  test('formato de EE.UU.: "1,234.56" es 1234,56 y "1234.56" también', () => {
    assert.equal(parseNumber('1,234.56'), 1234.56);
    assert.equal(parseNumber('1234.56'), 1234.56);
  });

  test('un dividendo de US$0.125 es 0,125, no 125', () => {
    assert.equal(parseNumber('0.125'), 0.125);
    assert.equal(parseNumber('0,125'), 0.125);
    assert.equal(parseNumber('-0.250'), -0.25);
  });

  test('vacío o sin números no es un número', () => {
    assert.equal(parseNumber(''), null);
    assert.equal(parseNumber('abc'), null);
    assert.equal(parseNumber(undefined), null);
  });
});

describe('Fechas del archivo del broker', () => {
  test('día/mes/año, año-mes-día y el número de fecha de Excel', () => {
    assert.equal(parseDate('02/11/2026'), '2026-11-02');
    assert.equal(parseDate('2026-11-02'), '2026-11-02');
    assert.equal(parseDate('2/11/26'), '2026-11-02');
    assert.equal(parseDate('45973'), '2025-11-12');
  });

  test('una fecha que no existe no se acepta (31 de febrero)', () => {
    assert.equal(parseDate('31/02/2026'), null);
    assert.equal(parseDate('29/02/2024'), '2024-02-29'); // 2024 sí fue bisiesto
  });

  test('una fecha de EE.UU. (mes/día) con día mayor a 12 no se acepta: no hay mes 25', () => {
    // Antes "12/25/2025" se guardaba como 2025-25-12
    assert.equal(parseDate('12/25/2025'), null);
  });
});

describe('Formatos que exporta Excel', () => {
  test('un número grande escrito como "1E+05" es cien mil (antes se leía 15)', () => {
    assert.equal(parseNumber('1E+05'), 100_000);
    assert.equal(parseNumber('1.5e3'), 1500);
  });

  test('una fecha con hora se lee igual: vale el día', () => {
    assert.equal(parseDate('2/11/2026 10:30'), '2026-11-02');
    assert.equal(parseDate('2026-11-02T10:30:00'), '2026-11-02');
    assert.equal(parseDate('45973.75'), '2025-11-12'); // número de fecha de Excel, a las 18:00
  });
});
