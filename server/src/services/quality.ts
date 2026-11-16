// Control de calidad de los datos de un activo: el único lugar que decide si la app lo puede seguir.
//
// La app trabaja solo con activos cuyos datos cumplen todos los requisitos. Con esos, todas las funciones
// (cartera, evolución, Diario, simulador) valen completas. Los que no cumplen no se admiten: no se pueden
// agregar y, si ya estaban cargados, quedan afuera de todos los cálculos (sus operaciones siguen guardadas
// y la portada los lista con el motivo). Así el resto del código no necesita casos especiales para datos
// malos: no hay "si falta el precio, entonces…" repartidos por la app.
//
// El día que se conecte una fuente mejor, cambia el proveedor (providers/) y este archivo deja pasar más
// activos; el resto de la app no se toca.
//
// Requisitos:
// 1. Historial: la fuente publica precios de días anteriores, no solo el de hoy.
// 2. Precio vivo: las últimas ruedas no repiten el mismo precio con volumen cero.
// 3. Splits coherentes: después de un split grande, el precio sigue en la misma escala.
// 4. Sin datos sueltos: ningún día salta a casi el doble (o la mitad) y vuelve al día siguiente.
// 5. Saltos confirmados (CEDEARs): un salto grande y sostenido tiene el precio de EE.UU. para saber si fue
//    una suba real o un cambio de ratio.
// 6. Es el activo que dice ser (CEDEARs de la tabla): el precio corresponde al ratio.
import { all, get } from '../db.ts';
import { confirmSymbolOf } from '../cedears.ts';
import { buildCedearInfo } from './cedear.ts';
import { detectRatioChanges } from './clean.ts';

export type QualityCode = 'SIN_HISTORIAL' | 'PRECIO_QUIETO' | 'SPLIT_INCOHERENTE' | 'DATO_SUELTO' | 'SALTO_SIN_CONFIRMAR' | 'OTRO_INSTRUMENTO';
export type Quality = { ok: true } | { ok: false; code: QualityCode; reason: string };

/** Desde cuánto se considera un salto (el mismo criterio que clean.ts: 1,8 veces). */
const JUMP = 1.8;
/** Ruedas que se miran antes y después de un split. */
const WINDOW = 5;
/** Ruedas seguidas con el mismo precio y sin volumen para decir que el precio está quieto. */
const STUCK_SESSIONS = 10;
/** Cuánto puede alejarse el ratio observado del de la tabla antes de decir que es otro instrumento. */
const WRONG_INSTRUMENT = 5;

interface Row {
  date: string;
  close: number;
  volume?: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const isJump = (x: number) => x >= JUMP || x <= 1 / JUMP;
const dmy = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Revisa los datos de un activo. Devuelve el primer requisito que no cumple, o `ok`.
 * `rows` ordenadas por fecha. `us`: precio de la acción en EE.UU. (solo CEDEARs).
 */
export function assess(input: {
  type: 'ACCION' | 'CEDEAR';
  hasHistory: boolean;
  rows: Row[];
  splits: { date: string; factor: number }[];
  us?: { date: string; value: number }[];
  /** CEDEARs de la tabla: ratio que surge de los precios ÷ ratio de la tabla */
  ratioOff?: number | null;
}): Quality {
  const { rows, splits } = input;
  const fail = (code: QualityCode, reason: string): Quality => ({ ok: false, code, reason });

  if (!input.hasHistory) return fail('SIN_HISTORIAL', 'la fuente de precios solo publica su precio del día, sin historial');

  const last = rows.slice(-STUCK_SESSIONS);
  if (last.length === STUCK_SESSIONS && last.every((r) => r.close === last[0].close && r.volume === 0)) {
    return fail('PRECIO_QUIETO', `la fuente repite el mismo precio hace ${STUCK_SESSIONS} ruedas o más, sin operaciones`);
  }

  for (const s of splits) {
    if (!isJump(s.factor)) continue;
    const i = rows.findIndex((r) => r.date >= s.date);
    if (i <= 0) continue;
    const before = median(rows.slice(Math.max(0, i - WINDOW), i).map((r) => r.close));
    const after = median(rows.slice(i, i + WINDOW).map((r) => r.close));
    // Con el historial bien ajustado, el precio de antes y el de después del split son parecidos
    if (isJump(before / after)) return fail('SPLIT_INCOHERENTE', `el split del ${dmy(s.date)} no coincide con lo que hizo el precio`);
  }

  for (let i = 1; i < rows.length - 1; i++) {
    const up = rows[i].close / rows[i - 1].close;
    const down = rows[i].close / rows[i + 1].close;
    if ((up >= JUMP && down >= JUMP) || (up <= 1 / JUMP && down <= 1 / JUMP)) {
      return fail('DATO_SUELTO', `el precio del ${dmy(rows[i].date)} no tiene relación con el del día anterior ni con el del siguiente`);
    }
  }

  if (input.type === 'CEDEAR') {
    const us = input.us ?? [];
    for (const jump of detectRatioChanges(rows)) {
      // Con el precio de EE.UU. de esos días, clean.ts ya resolvió si era una suba real o un cambio de ratio
      const known = us.some((p) => p.date < jump.date) && us.some((p) => p.date >= jump.date);
      if (!known) return fail('SALTO_SIN_CONFIRMAR', `el precio saltó el ${dmy(jump.date)} y no hay precio de EE.UU. para saber si fue real o un cambio de ratio`);
    }
    if (input.ratioOff != null && (input.ratioOff >= WRONG_INSTRUMENT || input.ratioOff <= 1 / WRONG_INSTRUMENT)) {
      return fail('OTRO_INSTRUMENTO', 'el precio que da la fuente no corresponde a este CEDEAR');
    }
  }
  return { ok: true };
}

// Los controles miran desde que hay cotización del dólar MEP: antes no se pueden cargar operaciones, así que
// un dato roto de 2017 no deja afuera a un activo que hoy funciona bien
function checkFrom(): string {
  return get<{ d: string | null }>("SELECT MIN(date) AS d FROM fx_rates WHERE kind = 'bolsa'")?.d ?? '0000-00-00';
}

/**
 * Desde qué fecha sirven los precios de un activo: el primer precio guardado o, si después hubo un tramo con
 * el precio quieto (el mismo cierre 10 ruedas o más, sin operaciones), el primer precio posterior a ese tramo.
 * Disney figuró a $10.416 desde el 24/05/2024 hasta el 13/11/2026: sus precios sirven recién desde el 16/11/2026.
 * Muchos CEDEARs tienen tramos así en 2019 y 2020; por eso no se descarta el activo entero, solo ese período.
 * `rows` ordenadas por fecha. Devuelve null si no hay precios.
 */
export function reliableStart(rows: Row[]): string | null {
  if (rows.length === 0) return null;
  let start = rows[0].date;
  let run = 0;
  for (let i = 0; i < rows.length; i++) {
    const same = i > 0 && rows[i].close === rows[i - 1].close && rows[i].volume === 0 && rows[i - 1].volume === 0;
    run = same ? run + 1 : 1;
    // Mientras dura el tramo, los precios sirven recién desde el día siguiente (si lo hay)
    if (run >= STUCK_SESSIONS) start = rows[i + 1]?.date ?? rows[i].date;
  }
  return start;
}

const cache = new Map<string, { stamp: string; quality: Quality; from: string | null }>();

function assetData(ticker: string): { quality: Quality; from: string | null } {
  const asset = get<{ type: 'ACCION' | 'CEDEAR' }>('SELECT type FROM assets WHERE ticker = ?', ticker);
  if (!asset) return { quality: { ok: false, code: 'SIN_HISTORIAL', reason: 'no está en el catálogo' }, from: null };
  const from = checkFrom();
  const info = get<{ n: number; last: string | null; splits: number; nohist: number }>(
    `SELECT (SELECT COUNT(*) FROM prices WHERE ticker = ?1) AS n, (SELECT MAX(date) FROM prices WHERE ticker = ?1) AS last,
            (SELECT COUNT(*) FROM split_events WHERE ticker = ?1) AS splits,
            (SELECT COUNT(*) FROM sync_state WHERE key = 'nohist:' || ?1) AS nohist`,
    ticker,
  )!;
  const usSeries = `us:${confirmSymbolOf(ticker)}`;
  const usCount = asset.type === 'CEDEAR' ? (get<{ n: number }>('SELECT COUNT(*) AS n FROM index_values WHERE series = ?', usSeries)?.n ?? 0) : 0;
  const stamp = [info.n, info.last, info.splits, info.nohist, usCount, from].join('|');
  const cached = cache.get(ticker);
  if (cached?.stamp === stamp) return cached;

  const cedear = asset.type === 'CEDEAR' ? buildCedearInfo(ticker) : null;
  const rows = all<Row>('SELECT date, close, volume FROM prices WHERE ticker = ? ORDER BY date', ticker);
  const quality = assess({
    type: asset.type,
    hasHistory: info.nohist === 0,
    rows: rows.filter((r) => r.date >= from),
    splits: all('SELECT date, factor FROM split_events WHERE ticker = ? AND date >= ? ORDER BY date', ticker, from),
    us: asset.type === 'CEDEAR' ? all('SELECT date, value FROM index_values WHERE series = ? ORDER BY date', usSeries) : undefined,
    ratioOff: cedear && 'observedRatio' in cedear && cedear.observedRatio ? cedear.observedRatio / cedear.ratio : null,
  });
  const data = { stamp, quality, from: reliableStart(rows) };
  cache.set(ticker, data);
  return data;
}

/** El control de un activo guardado. Se recalcula solo cuando cambian sus datos. */
export function assetQuality(ticker: string): Quality {
  return assetData(ticker).quality;
}

/** Desde qué fecha sirven los precios guardados de un activo (ver reliableStart). */
export function reliableFrom(ticker: string): string | null {
  return assetData(ticker).from;
}

/** Una operación anterior a los precios que sirven no se puede valuar ni juzgar: no se acepta. */
export function beforeHistoryProblem(ticker: string, date: string): string | null {
  const first = reliableFrom(ticker);
  if (!first || date >= first) return null;
  return `La app tiene precios confiables de ${ticker} desde el ${dmy(first)}: no puede registrar operaciones anteriores (no las podría valuar)`;
}
