import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'finanzas.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- Activos que el usuario sigue (acciones argentinas y CEDEARs de BYMA)
  CREATE TABLE IF NOT EXISTS assets (
    ticker     TEXT PRIMARY KEY,
    symbol     TEXT NOT NULL,              -- símbolo en Yahoo, ej: MELI.BA
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('ACCION', 'CEDEAR')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_sync  INTEGER                     -- epoch ms de la última actualización
  );

  -- Precio de cierre diario, siempre en pesos
  CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL REFERENCES assets(ticker) ON DELETE CASCADE,
    date   TEXT NOT NULL,                  -- YYYY-MM-DD (hora de Buenos Aires)
    open   REAL, high REAL, low REAL,
    close  REAL NOT NULL,
    volume REAL,
    PRIMARY KEY (ticker, date)
  );

  -- Cotización diaria del dólar (MEP = 'bolsa', CCL = 'contadoconliqui')
  CREATE TABLE IF NOT EXISTS fx_rates (
    kind TEXT NOT NULL,
    date TEXT NOT NULL,
    buy  REAL,
    sell REAL NOT NULL,
    PRIMARY KEY (kind, date)
  );

  -- Compras y ventas. Precio y comisiones en pesos.
  CREATE TABLE IF NOT EXISTS operations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker     TEXT NOT NULL REFERENCES assets(ticker) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('COMPRA', 'VENTA')),
    date       TEXT NOT NULL,
    quantity   REAL NOT NULL CHECK (quantity > 0),
    price      REAL NOT NULL CHECK (price > 0),
    fees       REAL NOT NULL DEFAULT 0 CHECK (fees >= 0),
    note_title TEXT,
    note_body  TEXT,
    note_link  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`);

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
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
