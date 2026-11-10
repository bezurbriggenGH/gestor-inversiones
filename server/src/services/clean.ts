// Corrige errores conocidos de los datos de Yahoo después de guardarlos.
//
// 1. Cambios de ratio de CEDEARs no informados. Cuando BYMA cambia el ratio de un
//    CEDEAR (por ejemplo AAPL de 10 a 20 en enero de 2024), el precio se parte a la
//    mitad de un día para otro. Yahoo a veces lo informa como split y ajusta el
//    historial, pero muchas veces no: quedan precios viejos en otra escala y parece
//    que el activo se desplomó. Acá se detectan esos saltos y se ajusta todo lo
//    anterior, igual que hace Yahoo con un split. El cambio queda guardado como split,
//    así que las operaciones anteriores también se ajustan (ver adjustForSplits).
//
// 2. Dividendos imposibles: Yahoo a veces informa montos mil veces más grandes que el
//    real (por ejemplo ACN pagando $32.822 por un CEDEAR que vale $5.200). Se descartan.
import { all, run, tx } from '../db.ts';

/** Un CEDEAR no sube ni baja tanto en un día por el mercado: un salto así es un cambio de ratio. */
const JUMP = 1.8;
/** Ruedas que se miran antes y después del salto para confirmar que no fue un dato suelto. */
const WINDOW = 5;
/** Un dividendo mayor a la mitad del precio no es real. */
const MAX_DIVIDEND_YIELD = 0.5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Los ratios cambian por números redondos (2:1, 3:1): si el salto está cerca de uno, se usa ese. */
function roundFactor(x: number): number {
  const big = x >= 1 ? x : 1 / x;
  const n = Math.round(big);
  const nice = n >= 1 && Math.abs(big / n - 1) < 0.05 ? n : big;
  return x >= 1 ? nice : 1 / nice;
}

/**
 * Busca saltos de precio que sean cambios de ratio.
 * factor = cuántas unidades nuevas hay por cada vieja (precio de 25.100 a 12.697 → 2).
 */
export function detectRatioChanges(rows: { date: string; close: number }[]): { date: string; factor: number }[] {
  const changes: { date: string; factor: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i - 1].close / rows[i].close;
    if (x < JUMP && x > 1 / JUMP) continue;
    // El nivel nuevo tiene que mantenerse: si fue un dato suelto mal cargado, se ignora
    const before = median(rows.slice(Math.max(0, i - WINDOW), i).map((r) => r.close));
    const after = median(rows.slice(i, i + WINDOW).map((r) => r.close));
    const y = before / after;
    if (y < JUMP && y > 1 / JUMP) continue;
    changes.push({ date: rows[i].date, factor: roundFactor(x) });
  }
  return changes;
}

function fixRatioChanges(ticker: string): void {
  const rows = all<{ date: string; close: number }>('SELECT date, close FROM prices WHERE ticker = ? ORDER BY date', ticker);
  const changes = detectRatioChanges(rows);
  if (changes.length === 0) return;
  tx(() => {
    for (const { date, factor } of changes) {
      run(
        `UPDATE prices SET close = close / ?1, open = open / ?1, high = high / ?1, low = low / ?1, volume = volume * ?1
         WHERE ticker = ?2 AND date < ?3`,
        factor,
        ticker,
        date,
      );
      run('UPDATE dividend_events SET amount = amount / ? WHERE ticker = ? AND date < ?', factor, ticker, date);
      run(
        'INSERT INTO split_events (ticker, date, factor) VALUES (?, ?, ?) ON CONFLICT (ticker, date) DO UPDATE SET factor = excluded.factor',
        ticker,
        date,
        factor,
      );
    }
  });
  console.log(`[datos] ${ticker}: ${changes.length} cambio(s) de ratio ajustado(s)`);
}

function dropImpossibleDividends(ticker: string): void {
  // Se compara con el precio de ese día (o el primero disponible, si el activo empezó a cotizar después)
  const removed = run(
    `DELETE FROM dividend_events AS d
     WHERE d.ticker = ?1 AND d.amount > ?2 * COALESCE(
       (SELECT close FROM prices p WHERE p.ticker = d.ticker AND p.date <= d.date ORDER BY p.date DESC LIMIT 1),
       (SELECT close FROM prices p WHERE p.ticker = d.ticker AND p.date > d.date ORDER BY p.date LIMIT 1)
     )`,
    ticker,
    MAX_DIVIDEND_YIELD,
  ).changes;
  if (removed) console.log(`[datos] ${ticker}: ${removed} dividendo(s) imposible(s) descartado(s)`);
}

/** Corrige el historial guardado de un activo. Se puede llamar las veces que sea: si no hay nada que corregir, no cambia nada. */
export function cleanHistory(ticker: string): void {
  const type = all<{ type: string }>('SELECT type FROM assets WHERE ticker = ?', ticker)[0]?.type;
  // Solo en CEDEARs: en acciones locales un salto así puede ser real (por ejemplo, las PASO de 2019)
  if (type === 'CEDEAR') fixRatioChanges(ticker);
  dropImpossibleDividends(ticker);
}

/** Al arrancar: corrige lo que ya estaba guardado de antes. */
export function cleanAllHistories(): void {
  for (const { ticker } of all<{ ticker: string }>('SELECT ticker FROM assets')) cleanHistory(ticker);
}
