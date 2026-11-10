// Cuentas: registro e ingreso con email y contraseña.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { all } from '../src/db.ts';
import { login, register } from '../src/auth.ts';

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
