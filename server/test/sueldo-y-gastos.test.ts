// Sueldo y gastos: cuánto subió cada concepto contra la inflación del mismo período.
// Cada caso tiene un resultado que se puede sacar a mano.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.ts';
import { analyzeBudget, compareToInflation, inflationIndex, isMonth, nextMonth, prevMonth, toIndex } from '../src/services/budget.ts';

const montos = (pares: [string, number][]) => new Map(pares);
// Inflación inventada: 2% en febrero, 3% en marzo, 5% en abril (publicada hasta abril)
const ipc = montos([
  ['2026-02', 2],
  ['2026-03', 3],
  ['2026-04', 5],
]);

describe('Meses', () => {
  test('mes siguiente y anterior, cruzando el año', () => {
    assert.equal(nextMonth('2026-12'), '2027-01');
    assert.equal(nextMonth('2026-03'), '2026-04');
    assert.equal(prevMonth('2026-01'), '2025-12');
  });

  test('un mes válido es AAAA-MM con un mes de 01 a 12', () => {
    assert.ok(isMonth('2026-11'));
    for (const malo of ['2026-13', '2026-00', '2026-1', '11/2026', '', null, 202611]) assert.equal(isMonth(malo), false);
  });
});

describe('Contra la inflación', () => {
  test('la inflación se acumula mes a mes: 1,02 × 1,03 − 1 = 5,06%', () => {
    const r = compareToInflation(
      montos([
        ['2026-01', 100_000],
        ['2026-03', 110_000],
      ]),
      ipc,
    )!;
    assert.equal(r.from, '2026-01');
    assert.equal(r.to, '2026-03');
    assert.ok(near(r.change, 0.1)); // subió 10%
    assert.ok(near(r.inflation, 0.0506));
    // Poder de compra: 1,10 / 1,0506 − 1 = +4,70%: le ganó a la inflación
    assert.ok(near(r.real, 1.1 / 1.0506 - 1));
    assert.ok(r.real > 0);
  });

  test('si subió menos que la inflación, el poder de compra da negativo', () => {
    const r = compareToInflation(
      montos([
        ['2026-01', 100_000],
        ['2026-04', 105_000],
      ]),
      ipc,
    )!;
    // Inflación ene→abr: 1,02 × 1,03 × 1,05 − 1 = 10,313%; subió 5%
    assert.ok(near(r.inflation, 1.02 * 1.03 * 1.05 - 1));
    assert.ok(r.real < 0);
  });

  test('solo se compara hasta el último mes con inflación publicada', () => {
    // Mayo todavía no tiene inflación: se compara enero contra abril
    const r = compareToInflation(
      montos([
        ['2026-01', 100],
        ['2026-04', 120],
        ['2026-05', 200],
      ]),
      ipc,
    )!;
    assert.equal(r.to, '2026-04');
    assert.ok(near(r.change, 0.2));
  });

  test('con un solo mes (o sin inflación publicada después) no hay comparación', () => {
    assert.equal(compareToInflation(montos([['2026-01', 100]]), ipc), null);
    assert.equal(
      compareToInflation(
        montos([
          ['2026-05', 100],
          ['2026-06', 120],
        ]),
        ipc,
      ),
      null,
    );
  });
});

describe('Gráfico base 100', () => {
  test('cada monto dividido por el primero: 80.000 → 100.000 es 125', () => {
    const s = toIndex(
      montos([
        ['2026-02', 100_000],
        ['2026-01', 80_000],
      ]),
    );
    assert.deepEqual(
      s.map((p) => p.month),
      ['2026-01', '2026-02'],
    );
    assert.ok(near(s[1].value, 125));
  });

  test('la inflación arranca en 100 y se corta donde no hay dato publicado', () => {
    const s = inflationIndex('2026-01', '2026-06', ipc);
    assert.deepEqual(
      s.map((p) => p.month),
      ['2026-01', '2026-02', '2026-03', '2026-04'],
    );
    assert.ok(near(s[2].value, 105.06));
  });
});

describe('Análisis completo', () => {
  const items = [
    { id: 1, name: 'Sueldo', kind: 'INGRESO' as const },
    { id: 2, name: 'Otro ingreso fijo', kind: 'INGRESO' as const },
    { id: 3, name: 'Seguro del auto', kind: 'GASTO' as const },
    { id: 4, name: 'Alquiler', kind: 'GASTO' as const },
  ];
  const amounts = [
    { item_id: 1, month: '2026-01', amount: 900_000 },
    { item_id: 2, month: '2026-01', amount: 100_000 },
    { item_id: 1, month: '2026-03', amount: 1_000_000 },
    { item_id: 2, month: '2026-03', amount: 100_000 },
    { item_id: 3, month: '2026-01', amount: 50_000 },
    { item_id: 3, month: '2026-03', amount: 60_000 },
    { item_id: 4, month: '2026-03', amount: 400_000 },
  ];
  const a = analyzeBudget(items, amounts, ipc);

  test('los ingresos se suman: 1.000.000 en enero, 1.100.000 en marzo → +10%', () => {
    assert.ok(near(a.income.comparison!.change, 0.1));
  });

  test('cada gasto por separado: el seguro subió 20%; el alquiler tiene un solo mes', () => {
    const seguro = a.expenses.find((e) => e.name === 'Seguro del auto')!;
    assert.ok(near(seguro.comparison!.change, 0.2));
    assert.equal(a.expenses.find((e) => e.name === 'Alquiler')!.comparison, null);
  });

  test('lo que queda cada mes: ingresos − gastos', () => {
    // enero: 1.000.000 − 50.000; marzo: 1.100.000 − 60.000 − 400.000
    assert.deepEqual(a.leftover, [
      { month: '2026-01', amount: 950_000 },
      { month: '2026-03', amount: 640_000 },
    ]);
  });

  test('la inflación arranca el primer mes con ingresos', () => {
    assert.equal(a.inflation[0].month, '2026-01');
    assert.equal(a.lastInflationMonth, '2026-04');
  });
});
