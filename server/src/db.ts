import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'finanzas.db'));
db.exec('PRAGMA journal_mode = WAL;');

// Migraciones: cada una lleva la base de una versión a la siguiente.
// La versión actual se guarda en PRAGMA user_version.
const migrations: string[] = [
  // v1: primera versión (un solo usuario)
  `
  CREATE TABLE IF NOT EXISTS assets (
    ticker     TEXT PRIMARY KEY,
    symbol     TEXT NOT NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('ACCION', 'CEDEAR')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_sync  INTEGER
  );
  CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL REFERENCES assets(ticker) ON DELETE CASCADE,
    date   TEXT NOT NULL,
    open REAL, high REAL, low REAL,
    close  REAL NOT NULL,
    volume REAL,
    PRIMARY KEY (ticker, date)
  );
  CREATE TABLE IF NOT EXISTS fx_rates (
    kind TEXT NOT NULL,
    date TEXT NOT NULL,
    buy  REAL,
    sell REAL NOT NULL,
    PRIMARY KEY (kind, date)
  );
  CREATE TABLE IF NOT EXISTS operations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker     TEXT NOT NULL REFERENCES assets(ticker) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('COMPRA', 'VENTA')),
    date       TEXT NOT NULL,
    quantity   REAL NOT NULL CHECK (quantity > 0),
    price      REAL NOT NULL CHECK (price > 0),
    fees       REAL NOT NULL DEFAULT 0 CHECK (fees >= 0),
    note_title TEXT, note_body TEXT, note_link TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `,
  // v2: usuarios, dividendos, alertas e índices para comparar.
  // "assets" pasa a ser el catálogo global de instrumentos (precios compartidos);
  // cada usuario tiene su lista en "user_assets". user_id = 0 marca datos de la
  // versión anterior: se le asignan al primer usuario que se registre.
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE user_assets (
    user_id  INTEGER NOT NULL,
    ticker   TEXT NOT NULL REFERENCES assets(ticker),
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, ticker)
  );
  INSERT INTO user_assets (user_id, ticker, added_at) SELECT 0, ticker, created_at FROM assets;

  CREATE TABLE operations_v2 (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL DEFAULT 0,
    ticker     TEXT NOT NULL REFERENCES assets(ticker),
    -- DIVIDENDO: quantity = acciones que tenías, price = monto por acción, fees = retenciones
    type       TEXT NOT NULL CHECK (type IN ('COMPRA', 'VENTA', 'DIVIDENDO')),
    date       TEXT NOT NULL,
    quantity   REAL NOT NULL CHECK (quantity > 0),
    price      REAL NOT NULL CHECK (price > 0),
    fees       REAL NOT NULL DEFAULT 0 CHECK (fees >= 0),
    note_title TEXT, note_body TEXT, note_link TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO operations_v2 (id, user_id, ticker, type, date, quantity, price, fees, note_title, note_body, note_link, created_at)
    SELECT id, 0, ticker, type, date, quantity, price, fees, note_title, note_body, note_link, created_at FROM operations;
  DROP TABLE operations;
  ALTER TABLE operations_v2 RENAME TO operations;
  CREATE INDEX operations_user_ticker ON operations (user_id, ticker);

  -- Dividendos informados por Yahoo (monto por acción, en pesos)
  CREATE TABLE dividend_events (
    ticker TEXT NOT NULL REFERENCES assets(ticker) ON DELETE CASCADE,
    date   TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (ticker, date)
  );

  -- Series para comparar: uva (inflación), plazofijo (TNA), merval, spy
  CREATE TABLE index_values (
    series TEXT NOT NULL,
    date   TEXT NOT NULL,
    value  REAL NOT NULL,
    PRIMARY KEY (series, date)
  );

  CREATE TABLE alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker       TEXT NOT NULL REFERENCES assets(ticker),
    direction    TEXT NOT NULL CHECK (direction IN ('ARRIBA', 'ABAJO')),
    price        REAL NOT NULL CHECK (price > 0),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    triggered_at TEXT,
    trigger_price REAL,
    seen         INTEGER NOT NULL DEFAULT 0
  );
  `,
];

function migrate() {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  // Bases creadas por la primera versión no tenían user_version: se detectan por sus tablas
  const legacy = current === 0 && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'assets'").get();
  const start = legacy ? 1 : current;
  if (start >= migrations.length) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  for (let v = start; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
      console.log(`[db] migración a v${v + 1} aplicada`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

migrate();
db.exec('PRAGMA foreign_keys = ON;');

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
