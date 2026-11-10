// Ayudas para los tests.
//
// Este archivo se importa PRIMERO en cada test: apunta la app a una base de datos
// vacía en una carpeta temporal, así los tests nunca tocan tus datos reales.
// (Cada archivo de test corre en su propio proceso, con su propia base.)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperationRow, OpType } from '../src/services/portfolio.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'gestor-test-'));

let nextId = 1;

/** Arma una operación con lo mínimo: tipo, fecha, cantidad, precio y comisión. */
export function op(type: OpType, date: string, quantity: number, price: number, fees = 0, ticker = 'TEST'): OperationRow {
  return {
    id: nextId++,
    user_id: 1,
    ticker,
    type,
    date,
    quantity,
    price,
    fees,
    note_title: null,
    note_body: null,
    note_link: null,
    created_at: date,
  };
}

/** Precio de cierre de un día (para el precio actual de un activo). */
export const close = (date: string, value: number) => ({ date, close: value, volume: null });

/** Sin conversión: todo en pesos. */
export const pesos = (ars: number) => ars;

/** Compara números con decimales (los cálculos con plata nunca dan exacto al último decimal). */
export function near(actual: number | null | undefined, expected: number, tolerance = 1e-6): boolean {
  return actual != null && Math.abs(actual - expected) <= tolerance;
}
