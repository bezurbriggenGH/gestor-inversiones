// Corregir una operación ya cargada: se prueba el servidor de punta a punta, con una base vacía.
import './helpers.ts';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { get, run } from '../src/db.ts';
import { router } from '../src/routes.ts';

let server: Server;
let base = '';
const COOKIE = 'sid=sesion-de-prueba';

before(async () => {
  run("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Prueba', 'prueba@test.com', 'x')");
  run("INSERT INTO users (id, name, email, password_hash) VALUES (2, 'Otra', 'otra@test.com', 'x')");
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, 1, ?)', 'sesion-de-prueba', Date.now() + 86_400_000);
  for (const t of ['AAA', 'DIV', 'SPL', 'OTR']) {
    run("INSERT INTO assets (ticker, symbol, name, type, last_sync) VALUES (?, ?, 'Prueba', 'ACCION', ?)", t, `${t}.BA`, Date.now());
    run("INSERT INTO prices (ticker, date, close) VALUES (?, '2025-01-02', 100)", t);
    run('INSERT INTO user_assets (user_id, ticker) VALUES (?, ?)', t === 'OTR' ? 2 : 1, t);
    run('INSERT INTO sync_state (key, value) VALUES (?, ?)', `splits:${t}`, Date.now());
  }
  // SPL se dividió 2 a 1 el 01/03/2025: 10 a $100 cargadas antes pasan a ser 20 a $50
  run("INSERT INTO split_events (ticker, date, factor) VALUES ('SPL', '2025-03-01', 2)");
  // Los tests nunca salen a internet (Yahoo, dólar, índices)
  for (const key of ['fx', 'fx-history', 'indices', 'index-full:ipc']) run('INSERT INTO sync_state (key, value) VALUES (?, ?)', key, Date.now());

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

async function add(ticker: string, o: Record<string, unknown>): Promise<number> {
  const r = await call('POST', `/assets/${ticker}/operations`, { type: 'COMPRA', date: '2025-01-02', quantity: 10, price: 100, fees: 0, ...o });
  assert.equal(r.status, 201, r.error ?? '');
  return r.body.id;
}

const edit = (id: number, o: Record<string, unknown>) =>
  call('PUT', `/operations/${id}`, { date: '2025-01-02', quantity: 10, price: 100, fees: 0, ...o });

const saved = (id: number) => get<{ date: string; quantity: number; price: number; fees: number; note_title: string | null; type: string }>('SELECT * FROM operations WHERE id = ?', id)!;

describe('Corregir una operación', () => {
  test('se cambian precio y comisiones; la justificación y el tipo quedan como estaban', async () => {
    const id = await add('AAA', { note_title: 'Compro por los resultados' });
    const r = await edit(id, { price: 120, fees: 5 });
    assert.equal(r.status, 204, r.error ?? '');
    const op = saved(id);
    assert.equal(op.price, 120);
    assert.equal(op.fees, 5);
    assert.equal(op.type, 'COMPRA');
    assert.equal(op.note_title, 'Compro por los resultados');
    // El resultado se recalcula: 10 compradas a $120 + $5 → costo $1.205
    const detail = await call('GET', `/operations/${id}?currency=ARS&fx=bolsa`);
    assert.equal(detail.body.operation.totalConv, 1205);
  });

  test('con datos inválidos no se guarda nada (las mismas reglas que al cargarla)', async () => {
    const id = await add('AAA', { date: '2025-01-03' });
    assert.equal((await edit(id, { quantity: 1.5 })).status, 400);
    assert.equal((await edit(id, { quantity: 0 })).status, 400);
    assert.equal((await edit(id, { date: '2999-01-01' })).status, 400);
    assert.equal((await edit(id, { date: '2025-02-30' })).status, 400);
    assert.equal((await edit(id, { fees: 2000 })).status, 400); // comisión mayor que el monto
    assert.equal(saved(id).date, '2025-01-03');
  });

  test('no se puede dejar una venta sin respaldo', async () => {
    // AAA: compras de 10 (02/01) y 10 (03/01); vendo 15 el 10/01
    const venta = await add('AAA', { type: 'VENTA', date: '2025-01-10', quantity: 15 });
    // Pasar la venta a antes de la segunda compra: ese día solo había 10
    const r = await edit(venta, { date: '2025-01-02', quantity: 15 });
    assert.equal(r.status, 409);
    assert.match(r.error!, /ventas sin respaldo/);
    assert.equal(saved(venta).date, '2025-01-10');
    // Achicarla sí se puede
    assert.equal((await edit(venta, { date: '2025-01-10', quantity: 12 })).status, 204);
  });

  test('no se puede achicar una compra que respalda un dividendo ya cargado', async () => {
    const compra = await add('DIV', {});
    const div = await add('DIV', { type: 'DIVIDENDO', date: '2025-02-01', quantity: 10, price: 5 });
    const r = await edit(compra, { quantity: 4 });
    assert.equal(r.status, 409);
    assert.match(r.error!, /dividendo de DIV del 01\/02\/2025/);
    // Tampoco se puede borrar: el dividendo quedaría por acciones que no tenías
    assert.equal((await call('DELETE', `/operations/${compra}`)).status, 409);
    // Y el dividendo no puede ser por más de lo que tenías
    assert.equal((await edit(div, { date: '2025-02-01', quantity: 11, price: 5 })).status, 409);
    assert.equal((await edit(div, { date: '2025-02-01', quantity: 10, price: 6 })).status, 204);
    assert.equal(saved(div).price, 6);
  });

  test('con un split, se corrige lo que se cargó y el ajuste se vuelve a aplicar', async () => {
    const id = await add('SPL', { date: '2025-01-02', quantity: 10, price: 100 });
    const before = await call('GET', `/operations/${id}?currency=ARS&fx=bolsa`);
    assert.equal(before.body.operation.quantity, 20); // en la escala de hoy
    assert.deepEqual(before.body.loaded, { date: '2025-01-02', quantity: 10, price: 100, fees: 0 }); // tal como se cargó
    assert.equal((await edit(id, { quantity: 12, price: 100 })).status, 204);
    const after = await call('GET', `/operations/${id}?currency=ARS&fx=bolsa`);
    assert.equal(after.body.operation.quantity, 24);
    assert.equal(after.body.operation.price, 50);
  });

  test('no se puede corregir una operación de otro usuario', async () => {
    run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (2, 'OTR', 'COMPRA', '2025-01-02', 10, 100)");
    const ajena = get<{ id: number }>("SELECT id FROM operations WHERE user_id = 2")!.id;
    assert.equal((await edit(ajena, { price: 1 })).status, 404);
    assert.equal(saved(ajena).price, 100);
  });
});

describe('El precio que sugiere el formulario, antes de un split', () => {
  // SPL se dividió 2 a 1 el 01/03/2025. El cierre guardado del 02/01/2025 es $100, ya en la escala de hoy:
  // ese día una acción valía $200. Si el formulario sugiriera $100, la compra se guardaría a $100 y la app la
  // ajustaría otra vez (×2 en cantidad, ÷2 en precio): 10 a $200 terminarían costando $1.000 en vez de $2.000.
  test('antes del split, el cierre en la escala de esa fecha: $100 × 2 = $200', async () => {
    const r = await call('GET', '/assets/SPL/price?date=2025-01-02');
    assert.deepEqual(r.body, { date: '2025-01-02', close: 200 });
  });

  test('desde el día del split (rige desde su fecha), el cierre tal cual', async () => {
    run("INSERT INTO prices (ticker, date, close) VALUES ('SPL', '2025-03-03', 60)");
    assert.deepEqual((await call('GET', '/assets/SPL/price?date=2025-03-03')).body, { date: '2025-03-03', close: 60 });
  });

  test('comprar al precio sugerido da el costo real: 10 a $200 son $2.000 (20 a $100 en la escala de hoy)', async () => {
    const id = await add('SPL', { date: '2025-01-02', quantity: 10, price: 200 });
    const detail = await call('GET', `/operations/${id}?currency=ARS&fx=bolsa`);
    assert.equal(detail.body.operation.quantity, 20);
    assert.equal(detail.body.operation.price, 100);
    assert.equal(detail.body.operation.totalConv, 2000);
  });
});

describe('El dividendo que sugiere la app, antes de un split', () => {
  test('viene en la escala de su fecha y se puede guardar tal cual (no queda ajustado dos veces)', async () => {
    // SPL pagó $5 por acción el 01/02/2025, en la escala de hoy: ese día eran $10 por cada una de las de antes.
    // De SPL se tienen, de los tests de arriba, 12 + 10 compradas el 02/01/2025 = 22 de antes del split (44 de hoy).
    run("INSERT INTO dividend_events (ticker, date, amount) VALUES ('SPL', '2025-02-01', 5)");
    const asset = await call('GET', '/assets/SPL?currency=ARS&fx=bolsa');
    const d = asset.body.pendingDividends[0];
    assert.equal(d.quantity, 22);
    assert.equal(d.amountPerShare, 10);
    assert.equal(d.gross, 220); // 44 de hoy × $5 = 22 de antes × $10
    // Guardarlo con lo sugerido: antes venía como 44, × 2 por el split = 88 > las que tenías, y se rechazaba
    const r = await call('POST', '/assets/SPL/operations', { type: 'DIVIDENDO', date: d.date, quantity: d.quantity, price: d.amountPerShare, fees: 0 });
    assert.equal(r.status, 201, r.error ?? '');
  });
});
