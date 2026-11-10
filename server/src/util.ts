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

/** ¿Es una fecha AAAA-MM-DD que existe? (rechaza, por ejemplo, el 30 de febrero) */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
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

const FETCH_TIMEOUT_MS = 10_000;

/**
 * fetch con tiempo límite: si la fuente no responde en 10 segundos, se corta y se sigue
 * con lo guardado. Sin esto, una API colgada dejaría la pantalla cargando para siempre.
 */
export async function fetchWithTimeout(url: string, source: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`${source} no respondió en ${FETCH_TIMEOUT_MS / 1000} segundos`);
    }
    throw new Error(`No se pudo conectar con ${source}`);
  }
}
