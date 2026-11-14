// Cuentas: registro e ingreso con email y contraseña.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { all } from '../src/db.ts';
import { login, register } from '../src/auth.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { router } from '../src/routes.ts';
import { trustProxy } from '../src/util.ts';

const status = (code: number) => (e: { status: number }) => e.status === code;

describe('Registro e ingreso', () => {
  const user = register('Ana', 'Ana@Test.com', 'clave-segura-1');

  test('el email se guarda en minúsculas y se puede ingresar escribiéndolo como sea', () => {
    assert.equal(user.email, 'ana@test.com');
    assert.equal(login('ANA@test.com ', 'clave-segura-1').id, user.id);
  });

  test('la contraseña no se guarda tal cual', () => {
    const [row] = all<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id);
    assert.ok(!row.password_hash.includes('clave-segura-1'));
  });

  test('con la contraseña equivocada no entra', () => {
    assert.throws(() => login('ana@test.com', 'otra-cosa'), status(401));
  });

  test('con un email que no existe no entra', () => {
    assert.throws(() => login('nadie@test.com', 'clave-segura-1'), status(401));
  });

  test('no se puede registrar dos veces el mismo email', () => {
    assert.throws(() => register('Ana', 'ana@test.com', 'clave-segura-2'), status(409));
  });

  test('la contraseña tiene que tener al menos 8 caracteres', () => {
    assert.throws(() => register('Beto', 'beto@test.com', 'corta'), status(400));
  });

  test('el email tiene que ser válido', () => {
    assert.throws(() => register('Beto', 'beto-sin-arroba', 'clave-segura-3'), status(400));
  });
});

describe('Límite de intentos de login', () => {
  test('sin proxy configurado, no se le cree a X-Forwarded-For', () => {
    assert.equal(trustProxy(undefined), false);
    assert.equal(trustProxy('1'), 1);
  });

  test('cambiar X-Forwarded-For en cada intento no esquiva el límite', async () => {
    const app = express();
    app.set('trust proxy', trustProxy(undefined));
    app.use(express.json());
    app.use('/api', router);
    app.use((err: { status?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.status ?? 500).json({ error: err.message });
    });
    const server = app.listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    try {
      const statuses: number[] = [];
      // 8 intentos por minuto: el noveno se frena aunque cada uno diga venir de otra IP
      for (let i = 1; i <= 9; i++) {
        const r = await fetch(`${base}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i}` },
          body: JSON.stringify({ email: 'ana@test.com', password: 'mal' }),
        });
        statuses.push(r.status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 429]);
    } finally {
      server.close();
    }
  });
});
