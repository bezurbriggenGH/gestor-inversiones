// "Para revisar" en Composición: activos y sectores muy pesados, activos que se mueven juntos
// y el objetivo de reparto. Cada caso tiene un resultado que se puede sacar a mano.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.ts';
import { correlation, groupsMovingTogether, rebalance, reviewItems, weekOf, weeklyReturns } from '../src/services/diversification.ts';

/** Rendimientos semanales inventados: semana i → valor i. */
const serie = (values: number[]) => new Map(values.map((v, i) => [`s${i}`, v]));

describe('Rendimiento semanal', () => {
  test('la semana se identifica por su lunes', () => {
    assert.equal(weekOf('2026-11-13'), '2026-11-09'); // viernes → lunes de esa semana
    assert.equal(weekOf('2026-11-09'), '2026-11-09'); // lunes → el mismo
    assert.equal(weekOf('2026-11-15'), '2026-11-09'); // domingo → lunes anterior
  });

  test('último cierre de cada semana contra el de la anterior', () => {
    const r = weeklyReturns([
      { date: '2026-11-02', close: 90 },
      { date: '2026-11-06', close: 100 }, // cierre de la semana del 2/11
      { date: '2026-11-13', close: 110 }, // +10%
      { date: '2026-11-20', close: 99 }, // −10%
    ]);
    assert.deepEqual([...r.keys()], ['2026-11-09', '2026-11-16']);
    assert.ok(near(r.get('2026-11-09'), 0.1));
    assert.ok(near(r.get('2026-11-16'), -0.1));
  });

  test('una semana sin precios corta la cadena: no se compara contra una semana vieja', () => {
    const r = weeklyReturns([
      { date: '2026-11-06', close: 100 },
      { date: '2026-11-20', close: 150 }, // la semana del 9/11 no tuvo precios
    ]);
    assert.equal(r.size, 0);
  });
});

describe('Correlación (¿se mueven igual?)', () => {
  test('si uno siempre se mueve el doble que el otro, se mueven igual: 1', () => {
    assert.ok(near(correlation(serie([0.01, -0.02, 0.03]), serie([0.02, -0.04, 0.06]), 3), 1));
  });

  test('si uno sube cuando el otro baja: −1', () => {
    assert.ok(near(correlation(serie([0.01, -0.02, 0.03]), serie([-0.01, 0.02, -0.03]), 3), -1));
  });

  test('con menos semanas en común que el mínimo, no se opina', () => {
    assert.equal(correlation(serie([0.01, -0.02]), serie([0.02, -0.04]), 3), null);
  });

  test('solo cuentan las semanas que tienen los dos', () => {
    const a = new Map([['s1', 0.01], ['s2', -0.02], ['s3', 0.03], ['solo-a', 0.5]]);
    const b = new Map([['s1', 0.02], ['s2', -0.04], ['s3', 0.06], ['solo-b', -0.9]]);
    assert.ok(near(correlation(a, b, 3), 1));
  });
});

describe('Grupos que se mueven juntos', () => {
  const tabla: Record<string, number> = { 'A-B': 0.9, 'B-C': 0.85, 'A-C': 0.5, 'D-E': 0.95 };
  const corr = (x: string, y: string) => tabla[`${x}-${y}`] ?? tabla[`${y}-${x}`] ?? 0;

  test('si A se parece a B y B a C, pero A no a C, no van los tres juntos', () => {
    const grupos = groupsMovingTogether(['A', 'B', 'C', 'D', 'E', 'F'], corr, 0.8);
    assert.deepEqual(grupos.map((g) => [...g].sort()).sort(), [['A', 'B'], ['D', 'E']]);
  });

  test('si todos los pares se parecen, van los tres juntos', () => {
    const grupos = groupsMovingTogether(['A', 'B', 'C'], () => 0.9, 0.8);
    assert.deepEqual(grupos.map((g) => [...g].sort()), [['A', 'B', 'C']]);
  });
});

describe('Avisos de Para revisar', () => {
  const pos = (ticker: string, weight: number) => ({ ticker, weight });
  const sector = (name: string, tickers: string[], weight: number) => ({ name, tickers, weight, value: weight });

  test('un activo que pasa del 20% se avisa; uno de 20% justo, no', () => {
    const items = reviewItems([pos('YPFD', 0.28), pos('GGAL', 0.2), pos('AAPL', 0.52)], [], []);
    assert.deepEqual(
      items.map((i) => i.tickers[0]),
      ['AAPL', 'YPFD'],
    );
  });

  test('con un solo activo no se avisa concentración (no dice nada nuevo)', () => {
    assert.deepEqual(reviewItems([pos('YPFD', 1)], [], []), []);
  });

  test('un sector que pasa del 35% se avisa; un ETF o lo sin clasificar, no', () => {
    const positions = [pos('A', 0.1), pos('B', 0.1), pos('C', 0.1), pos('D', 0.1)];
    const items = reviewItems(
      positions,
      [sector('Bancos', ['A', 'B'], 0.4), sector('ETF', ['C', 'D'], 0.5), sector('Sin clasificar', ['C', 'D'], 0.5)],
      [],
    );
    assert.deepEqual(items, [{ kind: 'sector', name: 'Bancos', tickers: ['A', 'B'], weight: 0.4 }]);
  });

  test('activos que se mueven juntos: se suman sus pesos y se avisa si pasan del 20%', () => {
    // YPFD 15% + GGAL 10% = 25% → se avisa; CEPU 5% + EDN 5% = 10% → no
    const positions = [pos('YPFD', 0.15), pos('GGAL', 0.1), pos('CEPU', 0.05), pos('EDN', 0.05)];
    const items = reviewItems(positions, [], [
      ['GGAL', 'YPFD'],
      ['CEPU', 'EDN'],
    ]);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].tickers, ['YPFD', 'GGAL']); // el más pesado primero
    assert.ok(near(items[0].weight, 0.25));
  });

  test('si los que se mueven juntos son del mismo sector ya avisado, no se repite', () => {
    const positions = [pos('GGAL', 0.2), pos('BMA', 0.2), pos('AAPL', 0.2), pos('MSFT', 0.2), pos('KO', 0.2)];
    const items = reviewItems(positions, [sector('Bancos', ['GGAL', 'BMA'], 0.4)], [['GGAL', 'BMA']]);
    assert.deepEqual(
      items.map((i) => i.kind),
      ['sector'],
    );
  });
});

describe('Objetivo y rebalanceo', () => {
  test('$400.000 en acciones y $600.000 en CEDEARs, objetivo 50%', () => {
    const r = rebalance(400_000, 600_000, 0.5)!;
    assert.equal(r.onTarget, false);
    assert.equal(r.over, 'CEDEAR');
    assert.equal(r.under, 'ACCION');
    // Sin plata nueva: vender $100.000 de CEDEARs y comprar acciones → 500.000 y 500.000
    assert.ok(near(r.move, 100_000));
    // Con plata nueva: $200.000 en acciones → 600.000 de 1.200.000 = 50%
    assert.ok(near(r.newMoney, 200_000));
  });

  test('faltan CEDEARs: $800.000 en acciones y $200.000 en CEDEARs, objetivo 40%', () => {
    const r = rebalance(800_000, 200_000, 0.4)!;
    assert.equal(r.under, 'CEDEAR');
    assert.ok(near(r.move, 200_000)); // 400.000 − 200.000
    // Sobran acciones: 800.000 / (1.000.000 + x) = 60% → x = 333.333,33
    assert.ok(near(r.newMoney, 1_000_000 / 3, 0.01));
  });

  test('hasta 5 puntos de diferencia está dentro del objetivo', () => {
    assert.equal(rebalance(450_000, 550_000, 0.5)!.onTarget, true); // 55%: justo en el límite
    assert.equal(rebalance(440_000, 560_000, 0.5)!.onTarget, false); // 56%
  });

  test('objetivo 0% en CEDEARs: con plata nueva no se llega nunca, hay que vender', () => {
    const r = rebalance(500_000, 500_000, 0)!;
    assert.equal(r.newMoney, null);
    assert.ok(near(r.move, 500_000));
  });

  test('sin tenencias no hay nada que rebalancear', () => {
    assert.equal(rebalance(0, 0, 0.5), null);
  });
});
