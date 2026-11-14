// Pedidos a Yahoo: de a pocos, sin insistir después de un error y sin pedir de más.
// Yahoo se reemplaza por uno de mentira: los tests nunca salen a internet.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { all, run } from '../src/db.ts';
import { dueForSync, syncAll } from '../src/services/sync.ts';

// El dólar y los índices figuran como recién actualizados: acá solo se prueban los activos
for (const key of ['fx', 'fx-history', 'indices']) run('INSERT INTO sync_state (key, value) VALUES (?, ?)', key, Date.now());

const addAsset = (ticker: string) => {
  run("INSERT INTO assets (ticker, symbol, name, type) VALUES (?, ?, 'Prueba', 'ACCION')", ticker, `${ticker}.BA`);
  run('INSERT INTO user_assets (user_id, ticker) VALUES (1, ?)', ticker);
};

/** Un Yahoo de mentira: anota cada pedido y cuántos hubo a la vez. `status` decide qué responde a cada símbolo. */
function fakeYahoo(status: (symbol: string) => number) {
  const log = { symbols: [] as string[], atOnce: 0, maxAtOnce: 0 };
  globalThis.fetch = (async (url: string | URL | Request) => {
    // El buscador de Yahoo (para saber el sector) va aparte: no es un pedido de precios
    const asked = new URL(String(url));
    if (asked.pathname.endsWith('/search')) {
      const symbol = asked.searchParams.get('q')!;
      return new Response(JSON.stringify({ quotes: [{ symbol, sector: 'Financial Services', quoteType: 'EQUITY' }] }), { status: 200 });
    }
    const symbol = decodeURIComponent(new URL(String(url)).pathname.split('/').pop()!);
    log.symbols.push(symbol);
    log.maxAtOnce = Math.max(log.maxAtOnce, ++log.atOnce);
    await new Promise((r) => setTimeout(r, 15)); // lo que tarda en responder
    log.atOnce--;
    const code = status(symbol);
    if (code !== 200) return new Response('{}', { status: code });
    const chart = { meta: { gmtoffset: -10_800 }, timestamp: [1_767_366_000], indicators: { quote: [{ close: [100] }] } };
    return new Response(JSON.stringify({ chart: { result: [chart] } }), { status: 200 });
  }) as typeof fetch;
  return log;
}

describe('Pedidos a Yahoo', () => {
  test('con 12 activos por actualizar, nunca hay más de 5 pedidos a la vez', async () => {
    for (let i = 1; i <= 12; i++) addAsset(`ACT${i}`);
    const yahoo = fakeYahoo(() => 200);
    const errors = await syncAll();
    assert.deepEqual(errors, []);
    assert.equal(yahoo.symbols.length, 12); // se pidieron todos...
    assert.equal(yahoo.maxAtOnce, 5); // ...pero de a 5 (antes: los 12 juntos)
  });

  test('un activo que la app no conoce: el sector se le pregunta a Yahoo y queda guardado en castellano', () => {
    const sectors = all<{ sector: string | null }>("SELECT sector FROM assets WHERE ticker LIKE 'ACT%'").map((a) => a.sector);
    assert.equal(sectors.length, 12);
    assert.ok(sectors.every((x) => x === 'Finanzas')); // Yahoo dijo "Financial Services"
  });

  test('recién actualizados, una segunda vuelta no pide nada', async () => {
    const yahoo = fakeYahoo(() => 200);
    await syncAll();
    assert.equal(yahoo.symbols.length, 0);
  });

  test('si un activo falla, se avisa pero no se vuelve a pedir enseguida', async () => {
    addAsset('FALLA');
    const yahoo = fakeYahoo((symbol) => (symbol === 'FALLA.BA' ? 500 : 200));
    assert.equal((await syncAll()).length, 1);
    assert.equal(yahoo.symbols.length, 1);
    // Segunda carga de la cartera, un instante después: sigue avisando, sin otro pedido
    const again = await syncAll();
    assert.equal(again.length, 1);
    assert.match(again[0], /Yahoo Finance respondió 500/);
    assert.equal(yahoo.symbols.length, 1); // antes: un pedido nuevo en cada carga
  });

  test('si Yahoo responde 429 (demasiados pedidos), no se le pide nada más por un rato', async () => {
    for (let i = 1; i <= 8; i++) addAsset(`MAS${i}`);
    const yahoo = fakeYahoo(() => 429);
    const errors = await syncAll();
    assert.equal(errors.length, 9); // los 8 nuevos + FALLA, que sigue en espera
    assert.ok(errors.some((e) => /pidió esperar/.test(e)));
    // Salen los 5 que ya estaban en camino; los otros 3 ni se piden
    assert.equal(yahoo.symbols.length, 5);
    const stored = all<{ n: number }>("SELECT COUNT(*) AS n FROM prices WHERE ticker LIKE 'MAS%'")[0].n;
    assert.equal(stored, 0);
  });
});

describe('Cada cuánto se actualiza un activo', () => {
  // Lunes 16/11/2026 a las 12:00 de Buenos Aires: mercado abierto
  const now = Date.parse('2026-11-16T12:00:00-03:00');
  const hours = (n: number) => now - n * 3_600_000;

  test('lo que tenés en cartera: cada 15 minutos con el mercado abierto', () => {
    assert.equal(dueForSync(hours(1), true, now), true);
    assert.equal(dueForSync(now - 5 * 60_000, true, now), false); // hace 5 minutos: todavía no
  });

  test('lo que ya vendiste del todo: una vez por día', () => {
    assert.equal(dueForSync(hours(1), false, now), false); // hace una hora: no hace falta
    assert.equal(dueForSync(hours(25), false, now), true); // hace más de un día: sí
  });

  test('un activo que nunca se actualizó se actualiza siempre', () => {
    assert.equal(dueForSync(null, false, now), true);
  });

  test('con el mercado cerrado y el cierre ya guardado, no se pide nada', () => {
    const sabado = Date.parse('2026-11-14T15:00:00-03:00');
    const viernesNoche = Date.parse('2026-11-13T20:00:00-03:00');
    assert.equal(dueForSync(viernesNoche, true, sabado), false);
  });
});
