// Control de calidad de los datos de un activo: qué se admite y qué no (con los casos reales que lo motivaron).
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, reliableStart } from '../src/services/quality.ts';

/** Precios diarios desde el 1/1/2024: una lista de cierres (volumen 1.000, salvo que se indique). */
const series = (closes: number[], volume: number | null = 1000) =>
  closes.map((close, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), close, volume }));
const repeat = (value: number, n: number) => Array<number>(n).fill(value);
/** Un precio que se mueve un poco todos los días alrededor de `base`. */
const moving = (base: number, n: number) => Array.from({ length: n }, (_, i) => base * (1 + (i % 3) * 0.01));
const code = (q: ReturnType<typeof assess>) => (q.ok ? 'OK' : q.code);

describe('Qué activos admite la app', () => {
  const base = { type: 'ACCION' as const, hasHistory: true, splits: [] };

  test('con historial y un precio que se mueve: se admite', () => {
    assert.deepEqual(assess({ ...base, rows: series(moving(100, 30)) }), { ok: true });
  });

  test('META, SDA, XP: la fuente solo publica el precio del día → sin historial', () => {
    assert.equal(code(assess({ ...base, hasHistory: false, rows: series([44_800]) })), 'SIN_HISTORIAL');
  });

  test('Disney: $10.416 repetido 10 ruedas con volumen cero → precio quieto', () => {
    assert.equal(code(assess({ ...base, rows: series([...moving(10_500, 10), ...repeat(10_416, 10)], 0) })), 'PRECIO_QUIETO');
  });

  test('una acción que casi no opera (mismo precio, pero sin dato de volumen) no se toma como precio quieto', () => {
    assert.deepEqual(assess({ ...base, rows: series([...moving(280, 10), ...repeat(284, 10)], null) }), { ok: true });
  });

  test('YPFD: split 10 a 1 con el historial bien ajustado ($8.290 → $8.105) → se admite', () => {
    const rows = series([...repeat(8_290, 10), ...repeat(8_105, 10)]);
    assert.deepEqual(assess({ ...base, rows, splits: [{ date: '2024-01-11', factor: 10 }] }), { ok: true });
  });

  test('Agrometal: split de 2,1 y el precio pasa de $120 a $27 → el split no coincide con el precio', () => {
    const rows = series([...repeat(120, 10), ...repeat(27, 10)]);
    assert.equal(code(assess({ ...base, rows, splits: [{ date: '2024-01-11', factor: 2.1 }] })), 'SPLIT_INCOHERENTE');
  });

  test('Semino: $27, un día a $113 y otra vez $29 → dato suelto', () => {
    assert.equal(code(assess({ ...base, rows: series([...moving(27, 10), 113.72, ...moving(29, 10)]) })), 'DATO_SUELTO');
  });

  test('las PASO de 2019: una acción argentina que cae 45% y se queda ahí es una caída real → se admite', () => {
    assert.deepEqual(assess({ ...base, rows: series([...repeat(174, 10), ...repeat(92, 10)]) }), { ok: true });
  });
});

describe('CEDEARs: un salto de precio tiene que poder confirmarse con EE.UU.', () => {
  const base = { type: 'CEDEAR' as const, hasHistory: true, splits: [] };
  // Moderna, 19/08/2026: el CEDEAR pasa de $5.210 a $14.310
  const rows = series([...repeat(5_210, 10), ...repeat(14_310, 10)]);
  const us = (values: number[]) => series(values).map((r) => ({ date: r.date, value: r.close }));

  test('con el precio de EE.UU. (también saltó: US$ 62,96 → US$ 174,38) es una suba real → se admite', () => {
    assert.deepEqual(assess({ ...base, rows, us: us([...repeat(62.96, 10), ...repeat(174.38, 10)]) }), { ok: true });
  });

  test('sin precio de EE.UU. no se puede saber si fue real o un cambio de ratio → no se admite', () => {
    assert.equal(code(assess({ ...base, rows })), 'SALTO_SIN_CONFIRMAR');
    assert.equal(code(assess({ ...base, rows, us: us(repeat(62.96, 10)) })), 'SALTO_SIN_CONFIRMAR'); // llega solo hasta el día anterior
  });

  test('BAC: el precio da un ratio de 11.872 contra 4 de la tabla → es otro instrumento', () => {
    assert.equal(code(assess({ ...base, rows: series(moving(7.17, 30)), ratioOff: 11_872 / 4 })), 'OTRO_INSTRUMENTO');
  });

  test('un ratio 10% corrido (la tabla quedó vieja) no es otro instrumento: se admite', () => {
    assert.deepEqual(assess({ ...base, rows: series(moving(1_000, 30)), ratioOff: 1.1 }), { ok: true });
  });
});

describe('Desde qué fecha sirven los precios de un activo', () => {
  /** Une tramos de precios y les pone fechas corridas desde el 1/1/2024. */
  const joined = (...parts: ReturnType<typeof series>[]) =>
    parts.flat().map((r, i) => ({ ...r, date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10) }));

  test('sin tramos quietos: desde el primer precio', () => {
    assert.equal(reliableStart(series(moving(100, 30))), '2024-01-01');
  });

  test('Disney: 5 días normales, 12 ruedas a $10.416 sin operaciones y después vuelve a moverse → desde el día 18', () => {
    assert.equal(reliableStart(joined(series(moving(10_500, 5)), series(repeat(10_416, 12), 0), series(moving(16_580, 5)))), '2024-01-18');
  });

  test('9 ruedas iguales no alcanzan (una acción chica puede no operar una semana y media)', () => {
    assert.equal(reliableStart(joined(series(moving(100, 5)), series(repeat(101, 9), 0), series(moving(100, 5)))), '2024-01-01');
  });

  test('sin precios: no hay fecha', () => {
    assert.equal(reliableStart([]), null);
  });
});
