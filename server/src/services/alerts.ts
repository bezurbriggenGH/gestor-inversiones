// Alertas de precio: "avisame si GGAL baja de $4.500".
// Se revisan cada vez que se actualiza el precio del activo.
import { all, get, run } from '../db.ts';

export interface AlertRow {
  id: number;
  user_id: number;
  ticker: string;
  direction: 'ARRIBA' | 'ABAJO';
  price: number;
  created_at: string;
  triggered_at: string | null;
  trigger_price: number | null;
  seen: number;
}

export function checkAlerts(ticker: string) {
  const last = get<{ close: number }>('SELECT close FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1', ticker);
  if (!last) return;
  const pending = all<AlertRow>('SELECT * FROM alerts WHERE ticker = ? AND triggered_at IS NULL', ticker);
  for (const a of pending) {
    const hit = a.direction === 'ARRIBA' ? last.close >= a.price : last.close <= a.price;
    if (hit) run("UPDATE alerts SET triggered_at = datetime('now'), trigger_price = ? WHERE id = ?", last.close, a.id);
  }
}

export function listAlerts(userId: number) {
  return all<AlertRow & { current: number | null }>(
    `SELECT a.*, (SELECT close FROM prices p WHERE p.ticker = a.ticker ORDER BY date DESC LIMIT 1) AS current
     FROM alerts a WHERE a.user_id = ?
     ORDER BY a.triggered_at IS NULL, a.triggered_at DESC, a.created_at DESC`,
    userId,
  );
}
