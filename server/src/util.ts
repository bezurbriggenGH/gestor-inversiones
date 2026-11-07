export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const arFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha YYYY-MM-DD en hora de Buenos Aires. */
export function arDate(d: Date = new Date()): string {
  return arFormatter.format(d);
}

export function addDays(isoDate: string, days: number): Date {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Horario de BYMA: lunes a viernes de 11 a 17, hora argentina (UTC−3 todo el año).
// Se suma media hora para que Yahoo publique el precio de cierre.
const AR_OFFSET_MS = -3 * 3_600_000;
const MARKET_OPEN_MIN = 11 * 60;
const MARKET_CLOSE_MIN = 17 * 60 + 30;

/**
 * Último momento en que el mercado estuvo abierto, hasta `now`.
 * Si está abierto ahora, devuelve `now`. No conoce los feriados: esos días se consulta igual.
 */
export function lastMarketTime(now: number = Date.now()): number {
  const ar = new Date(now + AR_OFFSET_MS); // reloj argentino, leído con getUTC*
  for (let i = 0; i < 8; i++) {
    const midnight = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate() - i) - AR_OFFSET_MS;
    const dow = new Date(midnight + AR_OFFSET_MS).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const close = midnight + MARKET_CLOSE_MIN * 60_000;
    if (now >= close) return close;
    if (now >= midnight + MARKET_OPEN_MIN * 60_000) return now;
  }
  return now;
}
