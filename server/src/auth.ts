// Autenticación con email y contraseña.
// - Contraseñas: se guarda solo un hash scrypt con "sal" aleatoria, nunca la contraseña.
// - Sesiones: token aleatorio en una cookie httpOnly (el JavaScript de la página no la puede leer).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { get, run, tx } from './db.ts';
import { HttpError } from './util.ts';

const COOKIE = 'sid';
const SESSION_DAYS = 30;

export interface User {
  id: number;
  name: string;
  email: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string, maxAgeSec: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`,
  );
}

export function startSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, Date.now() + SESSION_DAYS * 86_400_000);
  setSessionCookie(res, token, SESSION_DAYS * 86_400);
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  setSessionCookie(res, '', 0);
}

export function currentUser(req: Request): User | undefined {
  const token = readCookie(req, COOKIE);
  if (!token) return undefined;
  return get<User>(
    `SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    token,
    Date.now(),
  );
}

/** Middleware: corta con 401 si no hay sesión válida. */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Iniciá sesión para continuar');
  res.locals.user = user;
  next();
}

export function userId(res: Response): number {
  return (res.locals.user as User).id;
}

// Límite simple de intentos para frenar ataques de fuerza bruta
const attempts = new Map<string, { count: number; until: number }>();
export function checkRateLimit(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.count >= 8) throw new HttpError(429, 'Demasiados intentos. Esperá un minuto.');
  if (!a || a.until <= now) attempts.set(key, { count: 1, until: now + 60_000 });
  else a.count++;
}

function validatePassword(password: string) {
  if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
}

/** Token de la sesión actual (para no cerrarla al cambiar la contraseña). */
export function sessionToken(req: Request): string | undefined {
  return readCookie(req, COOKIE);
}

/**
 * Guarda una contraseña nueva y cierra las demás sesiones abiertas (otras compus o
 * celulares), por si alguien más tenía acceso. `keepToken` es la sesión que sigue abierta.
 */
function setPassword(userId: number, password: string, keepToken = '') {
  validatePassword(password);
  tx(() => {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), userId);
    run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', userId, keepToken);
  });
}

/** Cambio de contraseña desde la app: pide la actual para confirmar que sos vos. */
export function changePassword(userId: number, current: string, next: string, keepToken?: string): void {
  const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId);
  // 400 y no 401: un 401 haría que la app cierre la sesión
  if (!row || !verifyPassword(current, row.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta');
  if (current === next) throw new HttpError(400, 'La contraseña nueva tiene que ser distinta de la actual');
  setPassword(userId, next, keepToken);
}

/**
 * Recuperación para quien se olvidó la contraseña. La app corre en la compu del usuario
 * y no manda emails, así que se hace desde la terminal (npm run reset-password):
 * quien puede abrir la terminal de esa compu ya tiene acceso a la base de datos.
 * Cierra todas las sesiones abiertas.
 */
export function resetPassword(email: string, password: string): User {
  const user = get<User>('SELECT id, name, email FROM users WHERE email = ?', email.trim().toLowerCase());
  if (!user) throw new HttpError(404, `No hay ninguna cuenta con el email ${email.trim()}`);
  setPassword(user.id, password);
  return user;
}

export function register(name: string, email: string, password: string): User {
  name = name.trim();
  email = email.trim().toLowerCase();
  if (name.length < 2) throw new HttpError(400, 'Ingresá tu nombre');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email inválido');
  validatePassword(password);
  if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Ya existe una cuenta con ese email');

  return tx(() => {
    const id = Number(run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', name, email, hashPassword(password)).lastInsertRowid);
    // El primer usuario se queda con los datos cargados antes de que existiera el login
    if (id === 1 || !get('SELECT 1 FROM users WHERE id <> ?', id)) {
      run('UPDATE user_assets SET user_id = ? WHERE user_id = 0', id);
      run('UPDATE operations SET user_id = ? WHERE user_id = 0', id);
    }
    return { id, name, email };
  });
}

export function login(email: string, password: string): User {
  const row = get<User & { password_hash: string }>(
    'SELECT id, name, email, password_hash FROM users WHERE email = ?',
    email.trim().toLowerCase(),
  );
  if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(401, 'Email o contraseña incorrectos');
  return { id: row.id, name: row.name, email: row.email };
}
