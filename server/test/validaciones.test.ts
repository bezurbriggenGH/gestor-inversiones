// Casos límite: "¿qué pasa si…?" — lo que una persona podría cargar mal desde la pantalla.
// Se prueba el servidor de punta a punta (como lo usa la app), con una base vacía.
import './helpers.ts';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { run } from '../src/db.ts';
import { router } from '../src/routes.ts';
import { isRealDate } from '../src/util.ts';
import { maxHoldingBetween } from '../src/services/portfolio.ts';
import { op } from './helpers.ts';

// ---------- Un servidor de prueba con un usuario y un activo ----------

let server: Server;
let base = '';
const COOKIE = 'sid=sesion-de-prueba';

before(async () => {
  run("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Prueba', 'prueba@test.com', 'x')");
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 1, ?)', 'sesion-de-prueba', Date.now() + 86_400_000);
  run("INSERT INTO assets (ticker, symbol, name, type, last_sync) VALUES ('AAA', 'AAA.BA', 'Prueba', 'ACCION', ?)", Date.now());
  run("INSERT INTO prices (ticker, date, close) VALUES ('AAA', '2025-01-02', 100)");
  run("INSERT INTO user_assets (user_id, ticker) VALUES (1, 'AAA')");
  // Todo figura como recién actualizado: los tests nunca salen a internet (Yahoo, dólar, índices)
  for (const key of ['fx', 'fx-history', 'indices', 'index-full:ipc', 'splits:AAA']) {
    run('INSERT INTO sync_state (key, value) VALUES (?, ?)', key, Date.now());
  }

  const app = express();
  app.use(express.json());
  app.use('/api', router);
  app.use((err: { status?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, error: text ? (JSON.parse(text).error as string | undefined) : undefined, body: text ? JSON.parse(text) : null };
}

/** Carga una operación de AAA; por defecto, comprar 10 a $100 el 02/01/2025. */
const add = (o: Record<string, unknown> = {}) =>
  call('POST', '/assets/AAA/operations', { type: 'COMPRA', date: '2025-01-02', quantity: 10, price: 100, fees: 0, ...o });

// ---------- Casos ----------

describe('Cantidades, precios y comisiones', () => {
  test('una compra normal se guarda', async () => {
    assert.equal((await add()).status, 201); // ahora tengo 10
  });

  for (const [caso, datos, mensaje] of [
    ['cantidad negativa', { quantity: -5 }, /mayor a 0/],
    ['cantidad cero', { quantity: 0 }, /mayor a 0/],
    ['cantidad con decimales (2,5 acciones)', { quantity: 2.5 }, /entero/],
    ['cantidad que no es un número', { quantity: 'abc' }, /mayor a 0/],
    ['cantidad absurda', { quantity: 1e20 }, /demasiado grande/],
    ['precio negativo', { price: -100 }, /mayor a 0/],
    ['precio cero', { price: 0 }, /mayor a 0/],
    ['comisión negativa', { fees: -1 }, /negativas/],
    ['comisión mayor que lo que se compró', { quantity: 1, price: 100, fees: 1000 }, /superar/],
    ['tipo de operación inventado', { type: 'REGALO' }, /COMPRA, VENTA o DIVIDENDO/],
  ] as const) {
    test(`rechaza ${caso}`, async () => {
      const r = await add(datos);
      assert.equal(r.status, 400);
      assert.match(r.error!, mensaje);
    });
  }
});

describe('Fechas', () => {
  test('rechaza una fecha futura', async () => {
    assert.equal((await add({ date: '2099-01-01' })).status, 400);
  });

  test('rechaza una fecha anterior a las cotizaciones del dólar (01/01/1900 desarmaba la TIR)', async () => {
    // El MEP guardado arranca el 29/10/2018 y el CCL el 02/01/2013: se toma el más tardío
    run("INSERT INTO fx_rates (kind, date, sell) VALUES ('bolsa', '2018-10-29', 60), ('contadoconliqui', '2013-01-02', 8)");
    for (const date of ['1900-01-01', '2017-05-02', '2018-10-28']) {
      const r = await add({ date });
      assert.equal(r.status, 400, date);
      assert.match(r.error!, /cotizaciones del dólar desde el 29\/10\/2018/);
    }
    run("DELETE FROM fx_rates WHERE date IN ('2018-10-29', '2013-01-02')");
  });

  test('rechaza una fecha que no existe (30 de febrero)', async () => {
    assert.equal((await add({ date: '2025-02-30' })).status, 400);
  });

  test('rechaza una fecha en otro formato', async () => {
    assert.equal((await add({ date: '02/01/2025' })).status, 400);
  });

  test('reconoce fechas reales, incluido el 29 de febrero de un año bisiesto', () => {
    assert.ok(isRealDate('2024-02-29'));
    assert.ok(!isRealDate('2025-02-29'));
    assert.ok(!isRealDate('2025-13-01'));
  });
});

describe('Ventas', () => {
  test('no se puede vender más de lo que se tiene', async () => {
    const r = await add({ type: 'VENTA', date: '2025-03-01', quantity: 11 });
    assert.equal(r.status, 409);
    assert.match(r.error!, /había 10/);
  });

  test('no se puede vender antes de haber comprado', async () => {
    const r = await add({ type: 'VENTA', date: '2024-12-01', quantity: 1 });
    assert.equal(r.status, 409);
    assert.match(r.error!, /no hay compras anteriores/);
  });

  test('una venta posible se guarda', async () => {
    assert.equal((await add({ type: 'VENTA', date: '2025-03-01', quantity: 4, price: 120 })).status, 201); // quedan 6
  });

  test('no se puede borrar una compra si una venta quedaría sin respaldo', async () => {
    const ops = (await call('GET', '/assets/AAA?currency=ARS&fx=bolsa')).body.operations as { id: number; type: string }[];
    const compra = ops.find((o) => o.type === 'COMPRA')!;
    const r = await call('DELETE', `/operations/${compra.id}`);
    assert.equal(r.status, 409);
    assert.match(r.error!, /sin respaldo/);
  });
});

describe('Dividendos', () => {
  test('no por más acciones de las que se tenían', async () => {
    const r = await add({ type: 'DIVIDENDO', date: '2025-03-10', quantity: 50, price: 2 });
    assert.equal(r.status, 409);
    assert.match(r.error!, /como mucho 10/);
  });

  test('no de una época en que no se tenía el activo', async () => {
    const r = await add({ type: 'DIVIDENDO', date: '2024-06-01', quantity: 5, price: 2 });
    assert.equal(r.status, 409);
    assert.match(r.error!, /No tenías AAA/);
  });

  test('sí si vendiste después de la fecha de corte (se mira lo que tuviste en los 90 días anteriores)', async () => {
    // El 01/03 vendí 4 y me quedaron 6, pero el dividendo del 10/03 puede ser por las 10 que tenía antes
    assert.equal((await add({ type: 'DIVIDENDO', date: '2025-03-10', quantity: 10, price: 2 })).status, 201);
  });

  test('lo máximo que se tuvo entre dos fechas', () => {
    const ops = [op('COMPRA', '2025-01-02', 10, 100), op('VENTA', '2025-03-01', 4, 120), op('COMPRA', '2025-05-01', 20, 90)];
    assert.equal(maxHoldingBetween(ops, '2025-02-01', '2025-04-01'), 10);
    assert.equal(maxHoldingBetween(ops, '2025-03-02', '2025-04-01'), 6);
    assert.equal(maxHoldingBetween(ops, '2024-01-01', '2024-12-31'), 0);
  });
});

describe('Activos', () => {
  test('no se puede cargar una operación de un activo que no está en la cartera', async () => {
    const r = await call('POST', '/assets/ZZZ/operations', { type: 'COMPRA', date: '2025-01-02', quantity: 1, price: 1 });
    assert.equal(r.status, 404);
  });

  test('no se puede agregar dos veces el mismo activo', async () => {
    assert.equal((await call('POST', '/assets', { ticker: 'AAA' })).status, 409);
  });

  test('rechaza un ticker con símbolos raros', async () => {
    assert.equal((await call('POST', '/assets', { ticker: 'GG@L!' })).status, 400);
  });

  test('al borrar un activo se borra toda su historia, y si se vuelve a agregar empieza de cero', async () => {
    assert.equal((await call('DELETE', '/assets/AAA')).status, 204);
    assert.equal((await call('GET', '/assets/AAA?currency=ARS&fx=bolsa')).status, 404);
    // El activo sigue en el catálogo (sus precios se comparten): se puede volver a agregar sin consultar Yahoo
    assert.equal((await call('POST', '/assets', { ticker: 'AAA' })).status, 201);
    const detalle = await call('GET', '/assets/AAA?currency=ARS&fx=bolsa');
    assert.equal(detalle.body.operations.length, 0);
    assert.equal(detalle.body.position.quantity, 0);
  });
});

describe('Sin sesión', () => {
  test('sin iniciar sesión no se puede ver ni cargar nada', async () => {
    const r = await fetch(base + '/portfolio');
    assert.equal(r.status, 401);
  });
});

describe('Importar un archivo: las mismas reglas que al cargar a mano', () => {
  const csv = [
    'Fecha;Tipo;Ticker;Cantidad;Precio;Comision',
    '02/01/2025;Compra;AAA;10;100;0', // bien
    '31/02/2025;Compra;AAA;1;100;0', // el 31 de febrero no existe
    '12/25/2024;Compra;AAA;1;100;0', // fecha de EE.UU.: no hay mes 25
    '03/01/2025;Compra;AAA;2,5;100;0', // no se operan fracciones
    '03/01/2025;Compra;AAA;1;100;5000', // comisión mayor que la compra
    '03/01/2025;Compra;AAA;1;0;0', // precio cero
  ].join('\n');

  test('la vista previa marca con error cada fila que el formulario rechazaría', async () => {
    const r = await call('POST', '/import', { csv, commit: false });
    assert.equal(r.status, 200);
    const filas = r.body.rows as { status: string; errors: string[] }[];
    assert.deepEqual(filas.map((f) => f.status), ['error', 'error', 'error', 'error', 'error', 'error']);
    // La primera está bien, pero no entra sola: las demás de AAA fallaron
    assert.match(filas[0].errors.join(), /otra fila de AAA tiene un error/);
    assert.match(filas[1].errors.join(), /fecha inválida/);
    assert.match(filas[2].errors.join(), /fecha inválida/);
    assert.match(filas[3].errors.join(), /entero/);
    assert.match(filas[4].errors.join(), /superar/);
    assert.match(filas[5].errors.join(), /precio/);
  });

  test('al confirmar no se importa nada de AAA: una parte sola dejaría una tenencia distinta a la del broker', async () => {
    const r = await call('POST', '/import', { csv, commit: true });
    assert.equal(r.body.summary.ok, 0);
    const detalle = await call('GET', '/assets/AAA?currency=ARS&fx=bolsa');
    assert.equal(detalle.body.position.quantity, 0);
  });

  test('con el archivo corregido entra todo: quedan 10 acciones', async () => {
    const r = await call('POST', '/import', { csv: csv.split('\n').slice(0, 2).join('\n'), commit: true });
    assert.equal(r.body.summary.ok, 1);
    const detalle = await call('GET', '/assets/AAA?currency=ARS&fx=bolsa');
    assert.equal(detalle.body.position.quantity, 10);
    assert.deepEqual(detalle.body.operations.map((o: { date: string }) => o.date), ['2025-01-02']);
  });

  test('un dividendo de una época en que no tenías el activo se rechaza, igual que a mano (y frena el resto de ese activo)', async () => {
    // AAA se compró el 02/01/2025: un dividendo del 01/12/2024 es imposible
    const r = await call('POST', '/import', {
      csv: ['Fecha;Tipo;Ticker;Cantidad;Precio;Comision', '01/12/2024;Dividendo;AAA;1;50;0', '03/01/2025;Compra;AAA;1;100;0'].join('\n'),
      commit: false,
    });
    const filas = r.body.rows as { status: string; errors: string[] }[];
    assert.match(filas[0].errors.join(), /no pudiste cobrar ese dividendo/);
    assert.match(filas[1].errors.join(), /otra fila de AAA/);
  });
});

describe('Alertas', () => {
  test('rechaza un precio que no es un número de verdad ("Infinity")', async () => {
    const r = await call('POST', '/alerts', { ticker: 'AAA', direction: 'ABAJO', price: 'Infinity' });
    assert.equal(r.status, 400);
    assert.equal((await call('GET', '/alerts')).body.length, 0); // antes quedaba guardada y se disparaba sola
  });

  test('una alerta normal se guarda', async () => {
    assert.equal((await call('POST', '/alerts', { ticker: 'AAA', direction: 'ABAJO', price: 50 })).status, 201);
  });
});

describe('Importar un ticker que la app no conoce', () => {
  const csv = 'Fecha;Tipo;Ticker;Cantidad;Precio\n02/01/2025;Compra;ZZZ;1;100';
  const real = globalThis.fetch;
  /** Reemplaza a Yahoo por uno de mentira (los pedidos al servidor de prueba pasan igual). */
  const yahoo = (answer: () => Promise<globalThis.Response>) => {
    globalThis.fetch = ((url: Parameters<typeof fetch>[0], init?: RequestInit) => (String(url).startsWith(base) ? real(url, init) : answer())) as typeof fetch;
  };
  after(() => {
    globalThis.fetch = real;
  });

  test('sin internet: avisa que no se pudo consultar, no que el ticker no existe', async () => {
    yahoo(() => Promise.reject(new TypeError('fetch failed')));
    const [fila] = (await call('POST', '/import', { csv, commit: false })).body.rows as { status: string; errors: string[] }[];
    assert.equal(fila.status, 'error');
    assert.match(fila.errors.join(), /no se pudo consultar Yahoo Finance/);
    assert.doesNotMatch(fila.errors.join(), /no encontramos/);
  });

  test('con internet y un ticker que no existe: "no encontramos ZZZ en BYMA"', async () => {
    yahoo(() => Promise.resolve(new globalThis.Response('{}', { status: 404 })));
    const [fila] = (await call('POST', '/import', { csv, commit: false })).body.rows as { status: string; errors: string[] }[];
    assert.match(fila.errors.join(), /no encontramos ZZZ en BYMA/);
  });
});

describe('Sueldo y gastos', () => {
  let sueldo = 0;

  test('un concepto se crea; sin nombre, con tipo raro o repetido, no', async () => {
    const r = await call('POST', '/budget/items', { name: 'Sueldo', kind: 'INGRESO' });
    assert.equal(r.status, 201);
    sueldo = r.body.id;
    assert.match((await call('POST', '/budget/items', { name: '  ', kind: 'GASTO' })).error ?? '', /Escribí un nombre/);
    assert.match((await call('POST', '/budget/items', { name: 'Luz', kind: 'OTRO' })).error ?? '', /ingreso o un gasto/);
    assert.match((await call('POST', '/budget/items', { name: 'sueldo', kind: 'INGRESO' })).error ?? '', /Ya tenés/);
  });

  for (const [caso, datos, mensaje] of [
    ['monto cero', { month: '2026-01', amount: 0 }, /mayor a cero/],
    ['monto negativo', { month: '2026-01', amount: -5 }, /mayor a cero/],
    ['monto como texto', { month: '2026-01', amount: '1000' }, /mayor a cero/],
    ['mes inválido', { month: '2026-13', amount: 1000 }, /mes válido/],
    ['mes futuro', { month: '2999-01', amount: 1000 }, /todavía no pasaron/],
  ] as const) {
    test(`no se acepta un ${caso}`, async () => {
      const r = await call('PUT', '/budget/amounts', { itemId: sueldo, ...datos });
      assert.equal(r.status, 400);
      assert.match(r.error ?? '', mensaje);
    });
  }

  test('un concepto de otro usuario (o que no existe) no se puede tocar', async () => {
    const r = await call('PUT', '/budget/amounts', { itemId: 9999, month: '2026-01', amount: 1000 });
    assert.equal(r.status, 404);
  });

  test('cargar, repetir el mes anterior y borrar', async () => {
    assert.equal((await call('PUT', '/budget/amounts', { itemId: sueldo, month: '2026-01', amount: 1_000_000 })).status, 204);
    assert.equal((await call('POST', '/budget/copy', { month: '2026-02' })).body.copied, 1);
    // Repetir de nuevo no pisa lo que ya está
    assert.equal((await call('POST', '/budget/copy', { month: '2026-02' })).body.copied, 0);
    let b = (await call('GET', '/budget')).body;
    assert.deepEqual(
      b.amounts.map((a: { month: string; amount: number }) => [a.month, a.amount]),
      [
        ['2026-01', 1_000_000],
        ['2026-02', 1_000_000],
      ],
    );
    assert.equal((await call('PUT', '/budget/amounts', { itemId: sueldo, month: '2026-02', amount: null })).status, 204);
    assert.equal((await call('DELETE', `/budget/items/${sueldo}`)).status, 204);
    b = (await call('GET', '/budget')).body;
    assert.equal(b.items.length, 0);
    assert.equal(b.amounts.length, 0);
  });
});

describe('Objetivo de reparto (Composición)', () => {
  for (const [caso, valor] of [
    ['más de 100%', 150],
    ['negativo', -10],
    ['con decimales', 33.3],
    ['texto', 'mitad'],
  ] as const) {
    test(`no se acepta un objetivo ${caso}`, async () => {
      const r = await call('PUT', '/target', { cedear: valor });
      assert.equal(r.status, 400);
      assert.match(r.error ?? '', /entero entre 0 y 100/);
    });
  }

  test('se guarda, la cartera lo devuelve y se puede quitar', async () => {
    assert.equal((await call('PUT', '/target', { cedear: 30 })).status, 204);
    // Solo hay acciones (AAA): 0% en CEDEARs, con objetivo 30% → faltan CEDEARs
    const con = (await call('GET', '/portfolio')).body.review.target;
    assert.equal(con.target, 0.3);
    assert.equal(con.onTarget, false);
    assert.equal(con.under, 'CEDEAR');
    assert.equal((await call('PUT', '/target', { cedear: null })).status, 204);
    assert.equal((await call('GET', '/portfolio')).body.review.target, null);
  });
});

describe('Importar operaciones repetidas idénticas', () => {
  // Pasa de verdad: dos compras de 1 SCCO el mismo día al mismo precio (el broker partió la orden)
  test('si ya hay 2 compras iguales y el archivo trae 3, entra 1 (no se pierde la tercera)', async () => {
    run("INSERT INTO assets (ticker, symbol, name, type, last_sync) VALUES ('DUP', 'DUP.BA', 'Prueba', 'ACCION', ?)", Date.now());
    run("INSERT INTO prices (ticker, date, close) VALUES ('DUP', '2025-02-10', 100)");
    run("INSERT INTO user_assets (user_id, ticker) VALUES (1, 'DUP')");
    run("INSERT INTO sync_state (key, value) VALUES ('splits:DUP', ?)", Date.now());
    for (let i = 0; i < 2; i++) {
      const r = await call('POST', '/assets/DUP/operations', { type: 'COMPRA', date: '2025-02-10', quantity: 5, price: 100, fees: 0 });
      assert.equal(r.status, 201, r.error ?? '');
    }
    const fila = '10/02/2025;Compra;DUP;5;100;0';
    const csv = ['Fecha;Tipo;Ticker;Cantidad;Precio;Comision', fila, fila, fila].join('\n');
    const preview = await call('POST', '/import', { csv, commit: false });
    assert.deepEqual(preview.body.rows.map((f: { status: string }) => f.status), ['duplicada', 'duplicada', 'ok']);
    await call('POST', '/import', { csv, commit: true });
    const detalle = await call('GET', '/assets/DUP?currency=ARS&fx=bolsa');
    assert.equal(detalle.body.position.quantity, 15); // antes quedaban 10
    // Importarlo otra vez: ahora las 3 están cargadas
    const again = await call('POST', '/import', { csv, commit: false });
    assert.deepEqual(again.body.rows.map((f: { status: string }) => f.status), ['duplicada', 'duplicada', 'duplicada']);
  });
});

describe('Un dividendo con un cero de más', () => {
  // DVD: 10 acciones a $100 = $1.000. Un dividendo de más de la mitad ($500) no existe.
  test('cargado como "1 × el total", se rechaza si es más de la mitad de lo que valían tus acciones', async () => {
    run("INSERT INTO assets (ticker, symbol, name, type, last_sync) VALUES ('DVD', 'DVD.BA', 'Prueba', 'ACCION', ?)", Date.now());
    run("INSERT INTO prices (ticker, date, close) VALUES ('DVD', '2025-01-02', 100)");
    run("INSERT INTO user_assets (user_id, ticker) VALUES (1, 'DVD')");
    run("INSERT INTO sync_state (key, value) VALUES ('splits:DVD', ?)", Date.now());
    assert.equal((await call('POST', '/assets/DVD/operations', { type: 'COMPRA', date: '2025-01-02', quantity: 10, price: 100, fees: 0 })).status, 201);
    const div = (price: number) => call('POST', '/assets/DVD/operations', { type: 'DIVIDENDO', date: '2025-02-01', quantity: 1, price, fees: 0 });
    const r = await div(5000);
    assert.equal(r.status, 409);
    assert.match(r.error!, /más de la mitad de lo que valían tus DVD/);
    assert.equal((await div(40)).status, 201); // $40 sobre $1.000 (4%) es un dividendo normal
  });

  test('importado, también', async () => {
    const r = await call('POST', '/import', { csv: 'Fecha;Tipo;Ticker;Cantidad;Precio;Comision\n03/02/2025;Dividendo;DVD;1;5000;0', commit: false });
    assert.match(r.body.rows[0].errors.join(), /más de la mitad/);
  });
});

describe('Números raros y precios con un cero de más', () => {
  test('cantidad o precio escritos como "1e3" o "0x10" no se aceptan (sí "10" y "100.5")', async () => {
    for (const quantity of ['1e3', '0x10', '1,5']) assert.equal((await add({ quantity })).status, 400, quantity);
    assert.equal((await add({ price: '1e2' })).status, 400);
    assert.equal((await add({ quantity: '10', price: '100.5' })).status, 201);
  });

  test('un precio a más de 10 veces del cierre de ese día se rechaza: AAA cerró a $100 el 02/01/2025', async () => {
    const r = await add({ price: 100_000 });
    assert.equal(r.status, 400);
    assert.match(r.error!, /más de 10 veces del cierre/);
    assert.equal((await add({ price: 9 })).status, 400); // un cero de menos
    assert.equal((await add({ price: 150 })).status, 201); // lejos, pero posible
  });

  test('importado, también', async () => {
    const r = await call('POST', '/import', { csv: 'Fecha;Tipo;Ticker;Cantidad;Precio;Comision\n02/01/2025;Compra;AAA;1;100000;0', commit: false });
    assert.match(r.body.rows[0].errors.join(), /más de 10 veces del cierre/);
  });
});
