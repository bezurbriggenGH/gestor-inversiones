// Cuentas: registro, ingreso, cambio y recuperación de contraseña.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { all, run } from '../src/db.ts';
import { changePassword, login, register, resetPassword } from '../src/auth.ts';

const status = (code: number) => (e: { status: number }) => e.status === code;
const sessions = (userId: number) => all<{ token: string }>('SELECT token FROM sessions WHERE user_id = ?', userId).map((s) => s.token);

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

  test('no se puede registrar dos veces el mismo email', () => {
    assert.throws(() => register('Ana', 'ana@test.com', 'clave-segura-2'), status(409));
  });

  test('la contraseña tiene que tener al menos 8 caracteres', () => {
    assert.throws(() => register('Beto', 'beto@test.com', 'corta'), status(400));
  });
});

describe('Cambiar la contraseña desde la app', () => {
  const user = register('Caro', 'caro@test.com', 'vieja-clave');
  const addSession = (token: string) => run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, user.id, Date.now() + 86_400_000);

  test('hay que poner bien la contraseña actual', () => {
    // 400 y no 401: un 401 haría que la app te saque de tu sesión
    assert.throws(() => changePassword(user.id, 'cualquiera', 'nueva-clave'), status(400));
  });

  test('la nueva tiene que ser distinta de la actual', () => {
    assert.throws(() => changePassword(user.id, 'vieja-clave', 'vieja-clave'), status(400));
  });

  test('después del cambio entra con la nueva y no con la vieja', () => {
    addSession('esta-compu');
    addSession('otro-celular');
    changePassword(user.id, 'vieja-clave', 'nueva-clave', 'esta-compu');
    assert.equal(login('caro@test.com', 'nueva-clave').id, user.id);
    assert.throws(() => login('caro@test.com', 'vieja-clave'), status(401));
  });

  test('se cierran las otras sesiones, pero no la tuya', () => {
    assert.deepEqual(sessions(user.id), ['esta-compu']);
  });
});

describe('Recuperar la contraseña (npm run reset-password)', () => {
  const user = register('Dani', 'dani@test.com', 'me-la-olvide');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', 'abierta', user.id, Date.now() + 86_400_000);

  test('pone una contraseña nueva sin pedir la anterior', () => {
    resetPassword(' DANI@test.com', 'recuperada-1');
    assert.equal(login('dani@test.com', 'recuperada-1').id, user.id);
  });

  test('cierra todas las sesiones abiertas', () => {
    assert.deepEqual(sessions(user.id), []);
  });

  test('avisa si el email no existe', () => {
    assert.throws(() => resetPassword('nadie@test.com', 'recuperada-1'), status(404));
  });

  test('también exige 8 caracteres', () => {
    assert.throws(() => resetPassword('dani@test.com', 'corta'), status(400));
  });
});
