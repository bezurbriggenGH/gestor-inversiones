// Sueldo y gastos fijos: un apartado opcional, aparte de las inversiones.
//
// Cada mes se carga a mano el monto de unos pocos conceptos fijos (sueldo, alquiler, seguro del auto,
// servicios…). Con eso se responde: ¿mi sueldo sigue a la inflación? ¿qué gasto sube más rápido?
//
// Criterios:
// - Todo en pesos. Los ingresos se suman entre sí (sueldo + otro ingreso fijo) y se comparan como uno.
// - "Cuánto subió" un concepto: su último monto contra el primero (no se promedian meses).
// - La inflación del mismo período es la oficial (IPC del INDEC), acumulada mes a mes:
//   de enero a marzo, con 2% en febrero y 3% en marzo, es 1,02 × 1,03 − 1 = 5,06%.
//   Se compara solo hasta el último mes con inflación publicada (sale a mediados del mes siguiente).
// - Ganarle a la inflación = subir más que ella. Poder de compra: (1 + suba) / (1 + inflación) − 1.
import { all } from '../db.ts';

export type BudgetKind = 'INGRESO' | 'GASTO';

export interface BudgetItem {
  id: number;
  name: string;
  kind: BudgetKind;
}

export interface BudgetAmount {
  item_id: number;
  month: string; // 'AAAA-MM'
  amount: number;
}

/** Mes siguiente: '2026-12' → '2027-01'. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Mes anterior: '2026-01' → '2025-12'. */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** ¿Es un mes real 'AAAA-MM'? */
export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s >= '1990-01';
}

export interface Comparison {
  from: string;
  to: string;
  /** Cuánto subió el concepto (0.5 = 50%) */
  change: number;
  /** Inflación del mismo período */
  inflation: number;
  /** Diferencia en poder de compra: positivo = subió más que la inflación */
  real: number;
}

/**
 * Cuánto subió una serie de montos mensuales contra la inflación del mismo período.
 * null si no hay al menos dos meses con dato dentro de lo que ya tiene inflación publicada.
 */
export function compareToInflation(values: Map<string, number>, ipc: Map<string, number>): Comparison | null {
  const months = [...values.keys()].sort();
  if (months.length < 2) return null;
  const from = months[0];
  // El último mes con dato al que se llega con inflación publicada para todos los meses del medio
  let inflationFactor = 1;
  let to: string | null = null;
  let factorAtTo = 1;
  const last = months[months.length - 1];
  for (let m = nextMonth(from); m <= last; m = nextMonth(m)) {
    const pct = ipc.get(m);
    if (pct === undefined) break;
    inflationFactor *= 1 + pct / 100;
    if (values.has(m)) {
      to = m;
      factorAtTo = inflationFactor;
    }
  }
  if (!to) return null;
  const change = values.get(to)! / values.get(from)! - 1;
  const inflation = factorAtTo - 1;
  return { from, to, change, inflation, real: (1 + change) / (1 + inflation) - 1 };
}

/** Serie base 100: cada monto dividido por el primero, × 100. */
export function toIndex(values: Map<string, number>): { month: string; value: number }[] {
  const months = [...values.keys()].sort();
  if (months.length === 0) return [];
  const base = values.get(months[0])!;
  return months.map((m) => ({ month: m, value: (values.get(m)! / base) * 100 }));
}

/** Inflación acumulada base 100 desde `from` (que vale 100) hasta el último mes publicado o `until`. */
export function inflationIndex(from: string, until: string, ipc: Map<string, number>): { month: string; value: number }[] {
  const out = [{ month: from, value: 100 }];
  let value = 100;
  for (let m = nextMonth(from); m <= until; m = nextMonth(m)) {
    const pct = ipc.get(m);
    if (pct === undefined) break;
    value *= 1 + pct / 100;
    out.push({ month: m, value });
  }
  return out;
}

/** Todo el análisis: ingresos sumados, cada gasto, la inflación y lo que queda cada mes. */
export function analyzeBudget(items: BudgetItem[], amounts: BudgetAmount[], ipc: Map<string, number>) {
  const kindOf = new Map(items.map((i) => [i.id, i.kind]));
  const byItem = new Map<number, Map<string, number>>(items.map((i) => [i.id, new Map()]));
  const income = new Map<string, number>();
  const expenses = new Map<string, number>();
  for (const a of amounts) {
    const kind = kindOf.get(a.item_id);
    if (!kind) continue;
    byItem.get(a.item_id)!.set(a.month, a.amount);
    const total = kind === 'INGRESO' ? income : expenses;
    total.set(a.month, (total.get(a.month) ?? 0) + a.amount);
  }

  const months = [...new Set(amounts.map((a) => a.month))].sort();
  const firstIncome = [...income.keys()].sort()[0];
  const lastMonth = months[months.length - 1];

  return {
    /** Lo que queda cada mes: ingresos − gastos (solo meses con los dos cargados) */
    leftover: months.filter((m) => income.has(m) && expenses.has(m)).map((m) => ({ month: m, amount: income.get(m)! - expenses.get(m)! })),
    income: { index: toIndex(income), comparison: compareToInflation(income, ipc) },
    expenses: items
      .filter((i) => i.kind === 'GASTO')
      .map((i) => ({ id: i.id, name: i.name, index: toIndex(byItem.get(i.id)!), comparison: compareToInflation(byItem.get(i.id)!, ipc) })),
    // La inflación se dibuja desde el primer mes con ingresos (o el primer mes cargado)
    inflation: lastMonth ? inflationIndex(firstIncome ?? months[0], lastMonth, ipc) : [],
    /** Último mes con inflación publicada */
    lastInflationMonth: [...ipc.keys()].sort().at(-1) ?? null,
  };
}

/** Inflación mensual guardada: '2026-10' → 2.2 (%). */
export function loadIpc(): Map<string, number> {
  return new Map(all<{ date: string; value: number }>("SELECT date, value FROM index_values WHERE series = 'ipc'").map((r) => [r.date.slice(0, 7), r.value]));
}

export function buildBudget(userId: number) {
  const items = all<BudgetItem>('SELECT id, name, kind FROM budget_items WHERE user_id = ? ORDER BY kind DESC, created_at, id', userId);
  const amounts = all<BudgetAmount>(
    'SELECT a.item_id, a.month, a.amount FROM budget_amounts a JOIN budget_items i ON i.id = a.item_id WHERE i.user_id = ? ORDER BY a.month',
    userId,
  );
  return { items, amounts, analysis: analyzeBudget(items, amounts, loadIpc()) };
}
