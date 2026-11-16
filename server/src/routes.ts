import express, { Router } from 'express';
import { MAX_IMAGE_BYTES, addImage, deleteImage, deleteImagesOf, firstImageIds, imageCounts, imageFile, listImages } from './services/images.ts';
import { get, run, tx, all } from './db.ts';
import { YahooNotFound } from './providers/yahoo.ts';
import { ensureAsset, syncAll, syncAsset, syncFx, syncIndices, syncIpc } from './services/sync.ts';
import {
  assertNoShortSelling,
  buildAssetDetail,
  buildOperationDetail,
  buildPortfolio,
  excludedAssets,
  exclusionReason,
  getRawOperations,
  adjustOperations,
  loadFx,
  maxHoldingBetween,
  parseCurrency,
  parseFxKind,
  requireUserAsset,
  splitFactorAfter,
  type OperationRow,
  type OpType,
} from './services/portfolio.ts';
import { buildHistory } from './services/history.ts';
import { buildJournal, decisionOf } from './services/journal.ts';
import { buildCosts, buildHoldComparison } from './services/review.ts';
import { buildReview } from './services/diversification.ts';
import { buildBudget, isMonth, prevMonth } from './services/budget.ts';
import { CSV_TEMPLATE, parseCsv } from './services/importer.ts';
import { checkAlerts, listAlerts } from './services/alerts.ts';
import { searchCatalog } from './catalog.ts';
import { assetQuality, beforeHistoryProblem } from './services/quality.ts';
import { simulate } from './services/simulator.ts';
import { classify, normalizeTicker } from './tickers.ts';
import { checkRateLimit, currentUser, endSession, login, register, requireUser, startSession, userId } from './auth.ts';
import { HttpError, addDays, arDate, isRealDate, waitAtMost } from './util.ts';

export const router = Router();

// ---------- Autenticación (pública) ----------

router.post('/auth/register', (req, res) => {
  checkRateLimit(`register:${req.ip}`);
  const { name, email, password } = req.body ?? {};
  const user = register(String(name ?? ''), String(email ?? ''), String(password ?? ''));
  startSession(res, user.id);
  res.status(201).json(user);
});

router.post('/auth/login', (req, res) => {
  checkRateLimit(`login:${req.ip}`);
  const user = login(String(req.body?.email ?? ''), String(req.body?.password ?? ''));
  startSession(res, user.id);
  res.json(user);
});

router.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});

router.get('/auth/me', (req, res) => {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Sin sesión');
  res.json(user);
});

// ---------- Todo lo de abajo requiere sesión ----------
router.use(requireUser);

const q = (req: { query: Record<string, unknown> }) => ({
  currency: parseCurrency(req.query.currency),
  fx: parseFxKind(req.query.fx),
});

// La portada no espera a Yahoo más que esto: si anda lento, se muestra lo guardado y la actualización
// sigue en segundo plano. La pantalla vuelve a preguntar enseguida y ahí ya trae los precios nuevos.
const SYNC_WAIT_MS = 2_000;

router.get('/portfolio', async (req, res) => {
  const sync = await waitAtMost(
    syncAll().catch((err: unknown) => [err instanceof Error ? err.message : String(err)]),
    SYNC_WAIT_MS,
  );
  const errors = sync.done ? sync.value : [];
  const { currency, fx } = q(req);
  const portfolio = buildPortfolio(userId(res), currency, fx);
  const history = buildHistory(userId(res), 'ARS', fx);
  const target = get<{ target_cedear: number | null }>('SELECT target_cedear FROM users WHERE id = ?', userId(res))?.target_cedear ?? null;
  const review = buildReview(portfolio.positions, portfolio.exposure.sectors, target, arDate());
  // Lo que el usuario cargó y la app no puede seguir (ver quality.ts): se lista aparte, con el motivo
  res.json({ ...portfolio, realReturn: history.realReturn, review, errors, updating: !sync.done, excluded: excludedAssets(userId(res)) });
});

/** Objetivo de reparto: qué porcentaje de la cartera querés en CEDEARs (el resto, en acciones). null lo quita. */
router.put('/target', (req, res) => {
  const cedear = req.body?.cedear;
  if (cedear !== null && !(Number.isInteger(cedear) && cedear >= 0 && cedear <= 100))
    throw new HttpError(400, 'El objetivo tiene que ser un porcentaje entero entre 0 y 100');
  run('UPDATE users SET target_cedear = ? WHERE id = ?', cedear === null ? null : cedear / 100, userId(res));
  res.status(204).end();
});

router.get('/history', async (req, res) => {
  await Promise.allSettled([syncFx(), syncIndices()]);
  const { currency, fx } = q(req);
  res.json(buildHistory(userId(res), currency, fx));
});

router.get('/journal', (req, res) => {
  const { currency, fx } = q(req);
  res.json(buildJournal(userId(res), currency, fx));
});

/** ¿Y si no hubieras comprado ni vendido nada desde `since`? */
router.get('/hold', (req, res) => {
  const since = String(req.query.since ?? '');
  if (!isRealDate(since)) throw new HttpError(400, 'Elegí una fecha válida');
  const { currency, fx } = q(req);
  res.json(buildHoldComparison(userId(res), currency, fx, since));
});

/** Cuánto pagaste en comisiones. */
router.get('/costs', (req, res) => {
  const { currency, fx } = q(req);
  res.json(buildCosts(userId(res), currency, fx));
});

router.get('/search', (req, res) => {
  const owned = new Set(all<{ ticker: string }>('SELECT ticker FROM user_assets WHERE user_id = ?', userId(res)).map((r) => r.ticker));
  const results = searchCatalog(String(req.query.q ?? '')).map((r) => ({ ...r, owned: owned.has(r.ticker) }));
  res.json(results);
});

/** Simulador: ¿cuánto tendría hoy si hubiera invertido `amount` pesos en `ticker` el día `date`? */
router.get('/simulate', async (req, res) => {
  const ticker = normalizeTicker(String(req.query.ticker ?? ''));
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw new HttpError(400, 'Elegí un activo');
  const amount = Number(req.query.amount);
  if (!(amount > 0) || amount > 1e13) throw new HttpError(400, 'Ingresá un monto mayor a cero');
  const date = String(req.query.date ?? '');
  if (!isRealDate(date)) throw new HttpError(400, 'Elegí una fecha válida');
  await ensureCatalogAsset(ticker);
  await Promise.allSettled([syncAsset(ticker), syncFx(), syncIndices()]);
  const quality = assetQuality(ticker);
  if (!quality.ok) throw new HttpError(422, `Por ahora la app no puede simular ${ticker}: ${quality.reason}.`);
  const tooEarly = beforeHistoryProblem(ticker, date);
  if (tooEarly) throw new HttpError(400, tooEarly.replace('no puede registrar operaciones anteriores (no las podría valuar)', 'elegí una fecha posterior'));
  const { currency, fx } = q(req);
  res.json(simulate(ticker, amount, date, currency, fx));
});

// ---------- Activos ----------

async function ensureCatalogAsset(ticker: string) {
  try {
    await ensureAsset(ticker, `${ticker}.BA`, classify(ticker));
  } catch (err) {
    if (err instanceof YahooNotFound) throw new HttpError(404, `No encontramos ${ticker} en BYMA`);
    if (err instanceof Error && err.message.includes('no tiene precios')) throw new HttpError(404, `${ticker} no tiene precios en BYMA`);
    throw new HttpError(502, 'No se pudo consultar Yahoo Finance. Probá de nuevo en un rato.');
  }
}

router.post('/assets', async (req, res) => {
  const ticker = normalizeTicker(String(req.body?.ticker ?? ''));
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw new HttpError(400, 'Ingresá un ticker válido, por ejemplo GGAL o MELI');
  if (get('SELECT 1 FROM user_assets WHERE user_id = ? AND ticker = ?', userId(res), ticker)) {
    throw new HttpError(409, `${ticker} ya está en tu cartera`);
  }
  await ensureCatalogAsset(ticker);
  // Solo se agregan activos cuyos datos cumplen todos los requisitos: con esos, todas las funciones valen
  const quality = assetQuality(ticker);
  if (!quality.ok) throw new HttpError(422, `Por ahora la app no puede seguir ${ticker}: ${quality.reason}.`);
  run('INSERT INTO user_assets (user_id, ticker) VALUES (?, ?)', userId(res), ticker);
  const asset = get<{ ticker: string; name: string; type: string }>('SELECT ticker, name, type FROM assets WHERE ticker = ?', ticker);
  res.status(201).json(asset);
});

router.delete('/assets/:ticker', (req, res) => {
  const uid = userId(res);
  const ticker = requireUserAsset(uid, normalizeTicker(req.params.ticker)).ticker;
  tx(() => {
    deleteImagesOf(getRawOperations(uid, ticker).map((o) => o.id));
    run('DELETE FROM operations WHERE user_id = ? AND ticker = ?', uid, ticker);
    run('DELETE FROM alerts WHERE user_id = ? AND ticker = ?', uid, ticker);
    run('DELETE FROM user_assets WHERE user_id = ? AND ticker = ?', uid, ticker);
  });
  res.status(204).end();
});

router.get('/assets/:ticker', async (req, res) => {
  const ticker = requireUserAsset(userId(res), normalizeTicker(req.params.ticker)).ticker;
  await Promise.allSettled([syncAsset(ticker), syncFx()]);
  const { currency, fx } = q(req);
  const detail = buildAssetDetail(userId(res), ticker, currency, fx);
  // Cuántas fotos tiene cada operación, para marcarlas en el historial
  const counts = imageCounts(userId(res));
  const firstImages = firstImageIds(userId(res));
  // Cómo salió cada compra y venta, para pintarlas en el gráfico según el veredicto del Diario
  const decisions = new Map(buildJournal(userId(res), currency, fx, ticker).entries.map((e) => [e.id, decisionOf(e)]));
  res.json({
    ...detail,
    // Si la app no puede seguir este activo, por qué (no entra en la cartera ni en los cálculos)
    excluded: exclusionReason(userId(res), ticker),
    operations: detail.operations.map((o) => ({
      ...o,
      imageCount: counts.get(o.id) ?? 0,
      firstImageId: firstImages.get(o.id) ?? null,
      decision: decisions.get(o.id) ?? null,
    })),
  });
});

/**
 * Precio de cierre de una fecha (o el último anterior si fue feriado), en pesos y en la escala de esa
 * fecha: es el que sugiere el formulario, y la operación se guarda tal como se cargó (después se ajusta
 * por los splits posteriores). Con el cierre guardado, que ya está en la escala de hoy, una compra
 * anterior a un split quedaba ajustada dos veces: 10 AAPL del 01/12/2023 se guardaban a la mitad del precio.
 */
router.get('/assets/:ticker/price', (req, res) => {
  const ticker = requireUserAsset(userId(res), normalizeTicker(req.params.ticker)).ticker;
  const date = typeof req.query.date === 'string' ? req.query.date : arDate();
  const row = get<{ date: string; close: number }>(
    'SELECT date, close FROM prices WHERE ticker = ? AND date <= ? ORDER BY date DESC LIMIT 1',
    ticker,
    date,
  );
  if (!row) throw new HttpError(404, 'No hay precio para esa fecha');
  // Los splits que rigen después de la fecha de la operación (no la del precio: si fue feriado, son iguales)
  res.json({ date: row.date, close: row.close * splitFactorAfter(ticker, date) });
});

// ---------- Operaciones ----------

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

const OP_TYPES: OpType[] = ['COMPRA', 'VENTA', 'DIVIDENDO'];

// Límites de sentido común: nadie tiene mil millones de acciones de una empresa
const MAX_QUANTITY = 1_000_000_000;
const MAX_PRICE = 1_000_000_000_000;
// Un dividendo se paga semanas después de la fecha de corte: si vendiste en el medio,
// lo cobrás igual. Por eso se mira lo máximo que tuviste en los 90 días anteriores al pago.
const DIVIDEND_WINDOW_DAYS = 90;
// Un dividendo no puede ser de más de la mitad de lo que valían las acciones (el mismo límite que clean.ts)
const MAX_DIVIDEND_SHARE = 0.5;

/**
 * Controla cantidad, precio y comisiones. Devuelve qué está mal, o null si está todo bien.
 * Lo usan la carga a mano y la importación: un archivo no puede meter lo que el formulario rechaza.
 */
export function amountsProblem(type: OpType, quantity: number, price: number, fees: number): string | null {
  if (!(quantity > 0) || !Number.isFinite(quantity)) return 'La cantidad debe ser mayor a 0';
  // En BYMA no se operan fracciones de acciones ni de CEDEARs
  if (!Number.isInteger(quantity)) return 'La cantidad tiene que ser un número entero (no se operan fracciones de acciones)';
  if (quantity > MAX_QUANTITY) return 'La cantidad es demasiado grande';
  if (!(price > 0) || !Number.isFinite(price)) return 'El precio debe ser mayor a 0';
  if (price > MAX_PRICE) return 'El precio es demasiado grande';
  if (!(fees >= 0) || !Number.isFinite(fees)) return 'Las comisiones no pueden ser negativas';
  if (type === 'COMPRA' ? fees > quantity * price : fees >= quantity * price) {
    return 'Las comisiones o retenciones no pueden superar el monto de la operación';
  }
  return null;
}

/**
 * Una operación anterior a las cotizaciones del dólar guardadas no se puede pasar a dólares: se usaría el
 * primer dólar que hay, años después (con una de 2017, el MEP de octubre de 2018, más o menos el doble).
 * Y una fecha como 01/01/1900 desarma la TIR y el calendario. Mientras no haya cotizaciones guardadas
 * (la primera vez que se usa la app) no se controla.
 */
function tooOldProblem(date: string): string | null {
  const first = get<{ d: string | null }>('SELECT MAX(first) AS d FROM (SELECT MIN(date) AS first FROM fx_rates GROUP BY kind)')?.d;
  if (!first || date >= first) return null;
  return `La app tiene cotizaciones del dólar desde el ${first.split('-').reverse().join('/')}: no puede registrar operaciones anteriores (no las podría pasar a dólares)`;
}

/** Lo máximo que tuviste en los 90 días anteriores al pago de un dividendo. */
function maxHoldingBeforeDividend(ops: OperationRow[], div: OperationRow): number {
  const from = addDays(div.date, -DIVIDEND_WINDOW_DAYS).toISOString().slice(0, 10);
  return maxHoldingBetween(ops.filter((o) => o.id !== div.id), from, div.date);
}

/** ¿Los dividendos que ya estaban cargados siguen siendo posibles con estos cambios? */
function assertDividendsStillPossible(before: OperationRow[], after: OperationRow[], ticker: string, what: string) {
  for (const div of after.filter((o) => o.type === 'DIVIDENDO')) {
    const prev = before.find((o) => o.id === div.id);
    // Solo se frena lo que este cambio rompe: si ya no cerraba antes, no es culpa de este cambio
    const okBefore = prev != null && prev.quantity <= maxHoldingBeforeDividend(before, prev) + 1e-9;
    const okAfter = div.quantity <= maxHoldingBeforeDividend(after, div) + 1e-9;
    if (okBefore && !okAfter) {
      const when = div.date.split('-').reverse().join('/');
      throw new HttpError(409, `No se puede ${what}: el dividendo de ${ticker} del ${when} quedaría por más acciones de las que tenías. Corregí o borrá primero ese dividendo.`);
    }
  }
}

/** Un dividendo solo puede ser por acciones que tuviste cerca de la fecha de pago. */
function assertPossibleDividend(ops: OperationRow[], div: OperationRow, ticker: string) {
  const max = maxHoldingBeforeDividend(ops, div);
  const when = div.date.split('-').reverse().join('/');
  if (max <= 0) throw new HttpError(409, `No tenías ${ticker} en los 90 días anteriores al ${when}: no pudiste cobrar ese dividendo.`);
  if (div.quantity > max + 1e-9) {
    throw new HttpError(409, `El dividendo es por ${div.quantity} acciones, pero en los 90 días anteriores al ${when} tuviste como mucho ${max}.`);
  }
  // El monto: los dividendos del broker vienen como "1 × el total", y con cantidad 1 el control de arriba
  // deja pasar cualquier monto. Ninguna empresa paga en un dividendo más de la mitad de lo que vale la
  // acción (el mismo límite que se usa con los datos de Yahoo): con 7 GGAL que valían $35.000, un
  // dividendo de $5.000.000 es un cero de más. Todo en la escala de hoy (precio guardado y cantidad ajustada).
  const close = get<{ close: number }>('SELECT close FROM prices WHERE ticker = ? AND date <= ? ORDER BY date DESC LIMIT 1', ticker, div.date)?.close;
  const gross = div.quantity * div.price;
  if (close && gross > max * close * MAX_DIVIDEND_SHARE) {
    const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-AR')}`;
    throw new HttpError(
      409,
      `El dividendo (${fmt(gross)}) es más de la mitad de lo que valían tus ${ticker} el ${when} (${fmt(max * close)}): revisá que no sobre un cero.`,
    );
  }
}

/** Justificación de una operación: título, texto y un link opcional. */
function readNote(b: Record<string, unknown>) {
  const link = cleanText(b.note_link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw new HttpError(400, 'El link debe empezar con http:// o https://');
  return { note_title: cleanText(b.note_title, 120), note_body: cleanText(b.note_body, 5000), note_link: link };
}

/**
 * Un número como lo escribe una persona: "1500" o "1500.25". Number() también acepta "1e3" (mil) o "0x10"
 * (dieciséis), que nadie quiso cargar: esos dan NaN y se rechazan como cualquier dato inválido.
 */
export function plainNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  return typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
}

// Un precio más de 10 veces más alto o más bajo que el cierre de ese día es un cero de más o de menos:
// ni en un día de pánico una acción opera a la décima parte de su cierre
const MAX_PRICE_JUMP = 10;

/**
 * ¿El precio de una compra o venta es absurdo comparado con el cierre de ese día? Se compara en la escala
 * de esa fecha (el cierre guardado ya está ajustado por los splits posteriores; ver splitFactorAfter).
 * Ejemplo: EDN cotiza a $1.186 y se carga una compra a $1.186.000 → se rechaza.
 */
export function priceProblem(ticker: string, type: OpType, date: string, price: number): string | null {
  if (type === 'DIVIDENDO') return null;
  const row = get<{ close: number }>('SELECT close FROM prices WHERE ticker = ? AND date <= ? ORDER BY date DESC LIMIT 1', ticker, date);
  if (!row) return null;
  const close = row.close * splitFactorAfter(ticker, date);
  if (price <= close * MAX_PRICE_JUMP && price >= close / MAX_PRICE_JUMP) return null;
  const fmt = (v: number) => `$${v.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
  return `El precio (${fmt(price)}) está a más de 10 veces del cierre de ese día (${fmt(close)}): revisá que no sobre o falte un cero`;
}

/**
 * Compras y ventas solo se hacen en días hábiles: BYMA no opera sábados ni domingos. Los dividendos sí
 * pueden acreditarse un fin de semana. (Los feriados no se controlan: la app no tiene la lista.)
 */
export function weekendProblem(type: OpType, date: string): string | null {
  if (type === 'DIVIDENDO') return null;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6 ? 'Esa fecha cae en fin de semana y BYMA no opera: revisá que sea la del día de la operación' : null;
}

/** Fecha, cantidad, precio y comisiones de una operación, controlados igual al cargarla y al editarla. */
function readAmounts(type: OpType, b: Record<string, unknown>, ticker: string) {
  const date = String(b.date ?? '');
  if (!isRealDate(date)) throw new HttpError(400, 'Fecha inválida');
  if (date > arDate()) throw new HttpError(400, 'La fecha no puede ser futura');
  const tooOld = tooOldProblem(date);
  if (tooOld) throw new HttpError(400, tooOld);
  const quantity = plainNumber(b.quantity);
  const price = plainNumber(b.price);
  const fees = b.fees === '' || b.fees == null ? 0 : plainNumber(b.fees);
  const problem =
    beforeHistoryProblem(ticker, date) ?? weekendProblem(type, date) ?? amountsProblem(type, quantity, price, fees) ?? priceProblem(ticker, type, date, price);
  if (problem) throw new HttpError(400, problem);
  return { date, quantity, price, fees };
}

function insertOperation(op: Omit<OperationRow, 'id' | 'created_at'>) {
  return Number(
    run(
      `INSERT INTO operations (user_id, ticker, type, date, quantity, price, fees, note_title, note_body, note_link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      op.user_id,
      op.ticker,
      op.type,
      op.date,
      op.quantity,
      op.price,
      op.fees,
      op.note_title,
      op.note_body,
      op.note_link,
    ).lastInsertRowid,
  );
}

router.post('/assets/:ticker/operations', (req, res) => {
  const uid = userId(res);
  const ticker = requireUserAsset(uid, normalizeTicker(req.params.ticker)).ticker;
  const b = req.body ?? {};

  const type = b.type as OpType;
  if (!OP_TYPES.includes(type)) throw new HttpError(400, 'El tipo debe ser COMPRA, VENTA o DIVIDENDO');
  const { date, quantity, price, fees } = readAmounts(type, b, ticker);

  const draft = { user_id: uid, ticker, type, date, quantity, price, fees, ...readNote(b) };
  // Se recalcula todo junto: una compra nueva puede cambiar las fracciones que deja un split
  const withDraft = adjustOperations([...getRawOperations(uid, ticker), { ...draft, id: Number.MAX_SAFE_INTEGER, created_at: '' }]);
  const adjusted = withDraft.find((o) => o.id === Number.MAX_SAFE_INTEGER)!;
  assertNoShortSelling(withDraft);
  if (type === 'DIVIDENDO') assertPossibleDividend(withDraft.filter((o) => o !== adjusted), adjusted, ticker);
  res.status(201).json({ id: insertOperation(draft) });
});

router.get('/operations/:id', (req, res) => {
  const { currency, fx } = q(req);
  const id = Number(req.params.id);
  res.json({ ...buildOperationDetail(userId(res), id, currency, fx), images: listImages(userId(res), id) });
});

// ---------- Fotos de las operaciones ----------

// La foto llega tal cual (no en JSON), con su tipo en Content-Type
router.post('/operations/:id/images', express.raw({ type: 'image/*', limit: MAX_IMAGE_BYTES }), (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'El archivo no es una imagen (se aceptan JPG, PNG, GIF y WEBP)');
  const id = addImage(userId(res), Number(req.params.id), req.body);
  res.status(201).json({ id });
});

router.get('/images/:id', (req, res) => {
  const { path, mime } = imageFile(userId(res), Number(req.params.id));
  // Privada: el navegador la puede guardar, pero nadie más (las fotos no cambian nunca)
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(mime).sendFile(path);
});

router.delete('/images/:id', (req, res) => {
  deleteImage(userId(res), Number(req.params.id));
  res.status(204).end();
});

// Agregar o cambiar la justificación después (por ejemplo, en operaciones importadas del broker)
router.put('/operations/:id/note', (req, res) => {
  const note = readNote(req.body ?? {});
  const changed = run(
    'UPDATE operations SET note_title = ?, note_body = ?, note_link = ? WHERE id = ? AND user_id = ?',
    note.note_title,
    note.note_body,
    note.note_link,
    Number(req.params.id),
    userId(res),
  ).changes;
  if (!changed) throw new HttpError(404, 'Operación no encontrada');
  res.status(204).end();
});

// Corregir una operación mal cargada: fecha, cantidad, precio y comisiones, tal como se cargaron
// (antes de ajustar por splits). El tipo no cambia, y la justificación y las fotos quedan como estaban.
router.put('/operations/:id', (req, res) => {
  const uid = userId(res);
  const id = Number(req.params.id);
  const op = get<OperationRow>('SELECT * FROM operations WHERE id = ? AND user_id = ?', id, uid);
  if (!op) throw new HttpError(404, 'Operación no encontrada');
  const { date, quantity, price, fees } = readAmounts(op.type, req.body ?? {}, op.ticker);

  const raw = getRawOperations(uid, op.ticker);
  const before = adjustOperations(raw);
  // Se recalcula todo junto: cambiar una compra puede cambiar las fracciones que deja un split
  const after = adjustOperations(raw.map((o) => (o.id === id ? { ...o, date, quantity, price, fees } : o)));
  try {
    assertNoShortSelling(after);
  } catch (err) {
    throw new HttpError(409, `Con ese cambio quedarían ventas sin respaldo. ${err instanceof Error ? err.message : ''}`.trim());
  }
  if (op.type === 'DIVIDENDO') assertPossibleDividend(after, after.find((o) => o.id === id)!, op.ticker);
  else assertDividendsStillPossible(before, after, op.ticker, 'hacer este cambio');

  run('UPDATE operations SET date = ?, quantity = ?, price = ?, fees = ? WHERE id = ? AND user_id = ?', date, quantity, price, fees, id, uid);
  res.status(204).end();
});

router.delete('/operations/:id', (req, res) => {
  const uid = userId(res);
  const id = Number(req.params.id);
  const op = get<OperationRow>('SELECT * FROM operations WHERE id = ? AND user_id = ?', id, uid);
  if (!op) throw new HttpError(404, 'Operación no encontrada');
  const raw = getRawOperations(uid, op.ticker);
  const after = adjustOperations(raw.filter((o) => o.id !== id));
  try {
    assertNoShortSelling(after);
  } catch {
    throw new HttpError(409, 'No se puede borrar esta compra: quedarían ventas sin respaldo. Borrá primero esas ventas.');
  }
  if (op.type !== 'DIVIDENDO') assertDividendsStillPossible(adjustOperations(raw), after, op.ticker, 'borrar esta operación');
  tx(() => {
    deleteImagesOf([id]);
    run('DELETE FROM operations WHERE id = ?', id);
  });
  res.status(204).end();
});

// ---------- Sueldo y gastos (opcional) ----------

router.get('/budget', async (_req, res) => {
  await syncIpc().catch(() => {}); // sin internet se usa la inflación guardada
  res.json(buildBudget(userId(res)));
});

/** El concepto tiene que ser del usuario. */
function requireBudgetItem(user: number, id: unknown): number {
  const item = get<{ id: number }>('SELECT id FROM budget_items WHERE id = ? AND user_id = ?', Number(id), user);
  if (!item) throw new HttpError(404, 'No existe ese concepto');
  return item.id;
}

router.post('/budget/items', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const kind = req.body?.kind;
  if (!name) throw new HttpError(400, 'Escribí un nombre (por ejemplo, "Seguro del auto")');
  if (name.length > 40) throw new HttpError(400, 'El nombre puede tener hasta 40 letras');
  if (kind !== 'INGRESO' && kind !== 'GASTO') throw new HttpError(400, 'Elegí si es un ingreso o un gasto');
  if (get('SELECT 1 FROM budget_items WHERE user_id = ? AND name = ? COLLATE NOCASE', userId(res), name))
    throw new HttpError(400, `Ya tenés un concepto llamado "${name}"`);
  const r = run('INSERT INTO budget_items (user_id, name, kind) VALUES (?, ?, ?)', userId(res), name, kind);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.delete('/budget/items/:id', (req, res) => {
  const id = requireBudgetItem(userId(res), req.params.id);
  tx(() => {
    run('DELETE FROM budget_amounts WHERE item_id = ?', id);
    run('DELETE FROM budget_items WHERE id = ?', id);
  });
  res.status(204).end();
});

/** Cargar, cambiar o borrar (amount: null) el monto de un concepto en un mes. */
router.put('/budget/amounts', (req, res) => {
  const id = requireBudgetItem(userId(res), req.body?.itemId);
  const { month, amount } = req.body ?? {};
  if (!isMonth(month)) throw new HttpError(400, 'Elegí un mes válido');
  if (month > arDate().slice(0, 7)) throw new HttpError(400, 'No se pueden cargar meses que todavía no pasaron');
  if (amount === null) {
    run('DELETE FROM budget_amounts WHERE item_id = ? AND month = ?', id, month);
    return res.status(204).end();
  }
  if (typeof amount !== 'number' || !(amount > 0)) throw new HttpError(400, 'El monto tiene que ser mayor a cero');
  if (amount > 1e12) throw new HttpError(400, 'El monto es demasiado grande');
  run(
    'INSERT INTO budget_amounts (item_id, month, amount) VALUES (?, ?, ?) ON CONFLICT (item_id, month) DO UPDATE SET amount = excluded.amount',
    id,
    month,
    amount,
  );
  res.status(204).end();
});

/** Repetir el mes anterior: completa los conceptos vacíos de `month` con lo que valían el mes anterior. */
router.post('/budget/copy', (req, res) => {
  const month = req.body?.month;
  if (!isMonth(month)) throw new HttpError(400, 'Elegí un mes válido');
  if (month > arDate().slice(0, 7)) throw new HttpError(400, 'No se pueden cargar meses que todavía no pasaron');
  const r = run(
    `INSERT INTO budget_amounts (item_id, month, amount)
     SELECT a.item_id, ?, a.amount FROM budget_amounts a JOIN budget_items i ON i.id = a.item_id
     WHERE i.user_id = ? AND a.month = ?
     ON CONFLICT (item_id, month) DO NOTHING`,
    month,
    userId(res),
    prevMonth(month),
  );
  res.json({ copied: Number(r.changes) });
});

// ---------- Alertas ----------

router.get('/alerts', (_req, res) => {
  res.json(listAlerts(userId(res)));
});

router.post('/alerts', (req, res) => {
  const uid = userId(res);
  const ticker = requireUserAsset(uid, normalizeTicker(String(req.body?.ticker ?? ''))).ticker;
  const direction = req.body?.direction;
  const price = plainNumber(req.body?.price); // "1e5" no es un precio que alguien escriba
  if (direction !== 'ARRIBA' && direction !== 'ABAJO') throw new HttpError(400, 'Dirección inválida');
  if (!(price > 0)) throw new HttpError(400, 'El precio debe ser mayor a 0');
  // "Infinity" también es mayor a 0: se guardaba vacío y la alerta se disparaba sola
  if (!Number.isFinite(price) || price > MAX_PRICE) throw new HttpError(400, 'El precio es demasiado grande');
  const id = Number(run('INSERT INTO alerts (user_id, ticker, direction, price) VALUES (?, ?, ?, ?)', uid, ticker, direction, price).lastInsertRowid);
  checkAlerts(ticker);
  res.status(201).json({ id });
});

router.delete('/alerts/:id', (req, res) => {
  run('DELETE FROM alerts WHERE id = ? AND user_id = ?', Number(req.params.id), userId(res));
  res.status(204).end();
});

router.post('/alerts/seen', (_req, res) => {
  run('UPDATE alerts SET seen = 1 WHERE user_id = ? AND triggered_at IS NOT NULL', userId(res));
  res.status(204).end();
});

// ---------- Importación CSV ----------

router.get('/import/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-operaciones.csv"');
  res.send('﻿' + CSV_TEMPLATE);
});

router.post('/import', async (req, res) => {
  const uid = userId(res);
  const text = String(req.body?.csv ?? '');
  const commit = req.body?.commit === true;
  if (!text.trim()) throw new HttpError(400, 'El archivo está vacío');

  const parsed = parseCsv(text);
  if (parsed.error) throw new HttpError(400, parsed.error);
  const rows = parsed.rows.map((r) => ({ ...r, ticker: r.ticker ? normalizeTicker(r.ticker) : null, status: (r.ignored ? 'ignorada' : 'ok') as 'ok' | 'error' | 'duplicada' | 'ignorada' }));
  if (rows.length > 2000) throw new HttpError(400, 'Máximo 2000 operaciones por archivo');

  // Dividendos cobrados en dólares: se pasan a pesos con el dólar MEP de ese día
  if (rows.some((r) => r.priceInUsd)) {
    await syncFx().catch(() => {});
    const mep = loadFx('bolsa');
    for (const r of rows) {
      if (!r.priceInUsd || !r.date || r.price == null) continue;
      if (mep.empty) {
        r.errors.push('no hay cotización del dólar MEP para pasar el dividendo a pesos');
        continue;
      }
      const rate = mep.at(r.date);
      r.price = Math.round(r.price * rate * 100) / 100;
      r.note = `${r.note} × MEP $${rate.toLocaleString('es-AR')}`;
    }
  }

  // Verificar que cada ticker exista en BYMA (se agrega al catálogo global si hace falta)
  const tickers = [...new Set(rows.filter((r) => r.ticker && !r.errors.length && !r.ignored).map((r) => r.ticker as string))];
  const unknown = new Set<string>();
  // No es lo mismo "ese ticker no existe" que "no se pudo preguntar" (sin internet, Yahoo caído)
  const unreachable = new Set<string>();
  for (const t of tickers) {
    try {
      await ensureCatalogAsset(t);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) unknown.add(t);
      else unreachable.add(t);
    }
  }

  const today = arDate();
  for (const r of rows) {
    if (r.ticker && unknown.has(r.ticker)) {
      r.errors.push(`no encontramos ${r.ticker} en BYMA (por ahora la app maneja acciones y CEDEARs; bonos y fondos todavía no)`);
    }
    const quality = r.ticker && !unknown.has(r.ticker) && !unreachable.has(r.ticker) && !r.ignored ? assetQuality(r.ticker) : null;
    if (quality && !quality.ok) r.errors.push(`por ahora la app no puede seguir ${r.ticker}: ${quality.reason}`);
    const tooEarly = r.ticker && r.date && quality?.ok ? beforeHistoryProblem(r.ticker, r.date) : null;
    if (tooEarly) r.errors.push(tooEarly.charAt(0).toLowerCase() + tooEarly.slice(1));
    if (r.ticker && unreachable.has(r.ticker)) {
      r.errors.push(`no se pudo consultar Yahoo Finance para verificar ${r.ticker}: revisá la conexión y probá de nuevo`);
    }
    if (r.date && r.date > today) r.errors.push('fecha futura');
    const tooOld = r.date ? tooOldProblem(r.date) : null;
    if (tooOld) r.errors.push(tooOld.charAt(0).toLowerCase() + tooOld.slice(1));
    // Las mismas reglas que al cargar a mano (después de pasar a pesos los dividendos en dólares)
    if (!r.ignored && !r.errors.length && r.type && r.quantity != null && r.price != null) {
      const problem =
        (r.date ? weekendProblem(r.type, r.date) : null) ??
        amountsProblem(r.type, r.quantity, r.price, r.fees) ??
        (r.ticker && r.date ? priceProblem(r.ticker, r.type, r.date, r.price) : null);
      if (problem) r.errors.push(problem.charAt(0).toLowerCase() + problem.slice(1));
    }
  }

  // Duplicados: misma operación ya cargada
  const existingByTicker = new Map<string, OperationRow[]>();
  // Se compara contra lo cargado tal cual (sin ajustar por splits), igual que viene en el archivo
  for (const t of tickers) existingByTicker.set(t, getRawOperations(uid, t));
  // Se cuentan: si ya hay 2 compras iguales cargadas (mismo día, cantidad y precio) y el archivo trae 3,
  // 2 son duplicadas y 1 es nueva. Antes bastaba con que existiera una igual: la tercera se perdía.
  const sameKey = (o: { type: string | null; date: string | null; quantity: number | null; price: number | null }) =>
    `${o.type}|${o.date}|${o.quantity}|${Math.round((o.price ?? 0) * 1e6)}`;
  const alreadyLoaded = new Map<string, number>();
  for (const [t, ops] of existingByTicker) for (const o of ops) alreadyLoaded.set(`${t}|${sameKey(o)}`, (alreadyLoaded.get(`${t}|${sameKey(o)}`) ?? 0) + 1);
  for (const r of rows) {
    if (r.errors.length || !r.ticker || r.ignored) continue;
    const key = `${r.ticker}|${sameKey(r)}`;
    const left = alreadyLoaded.get(key) ?? 0;
    if (left > 0) {
      r.status = 'duplicada';
      alreadyLoaded.set(key, left - 1);
    }
  }

  // Ventas sin respaldo, por ticker
  for (const t of tickers) {
    const newOps = rows.filter((r) => r.ticker === t && !r.errors.length && r.status === 'ok');
    const drafts = newOps.map((r, i) => ({
      id: 1e12 + i,
      user_id: uid,
      ticker: t,
      type: r.type!,
      date: r.date!,
      quantity: r.quantity!,
      price: r.price!,
      fees: r.fees,
      note_title: r.note,
      note_body: null,
      note_link: null,
      created_at: '',
    }));
    const adjusted = adjustOperations([...(existingByTicker.get(t) ?? []), ...drafts]);
    try {
      assertNoShortSelling(adjusted, t);
    } catch (err) {
      for (const r of newOps) if (r.type === 'VENTA') r.errors.push(err instanceof Error ? err.message : 'ventas sin respaldo');
      continue;
    }
    // Dividendos: el mismo control que al cargarlos a mano (tenías el activo cerca de esa fecha)
    drafts.forEach((d, i) => {
      if (d.type !== 'DIVIDENDO') return;
      try {
        assertPossibleDividend(adjusted, adjusted.find((o) => o.id === d.id)!, t);
      } catch (err) {
        newOps[i].errors.push(err instanceof Error ? err.message : 'dividendo imposible');
      }
    });
  }

  // Si una fila de un activo tiene un error, no se importa ninguna de ese activo: si entraran las demás
  // solas, la tenencia quedaría distinta a la del broker (por ejemplo, una venta rechazada porque faltaba
  // una compra vieja dejaría más acciones de las que tenés). Se corrige esa fila y se vuelve a importar:
  // lo ya importado sale como duplicado.
  const failed = new Set(rows.filter((r) => r.errors.length && r.ticker && !r.ignored).map((r) => r.ticker!));
  for (const r of rows) {
    if (r.ticker && failed.has(r.ticker) && !r.errors.length && r.status === 'ok') {
      r.errors.push(`no se importa porque otra fila de ${r.ticker} tiene un error: sola, te dejaría una tenencia distinta a la del broker. Corregí esa fila y volvé a importar el archivo.`);
    }
  }

  for (const r of rows) if (r.errors.length) r.status = 'error';
  const valid = rows.filter((r) => r.status === 'ok');

  if (commit && valid.length) {
    tx(() => {
      for (const t of new Set(valid.map((r) => r.ticker!))) {
        run('INSERT OR IGNORE INTO user_assets (user_id, ticker) VALUES (?, ?)', uid, t);
      }
      for (const r of valid) {
        insertOperation({
          user_id: uid,
          ticker: r.ticker!,
          type: r.type!,
          date: r.date!,
          quantity: r.quantity!,
          price: r.price!,
          fees: r.fees,
          note_title: r.note,
          note_body: null,
          note_link: null,
        });
      }
    });
  }

  res.json({
    committed: commit,
    columns: parsed.columns,
    rows,
    summary: {
      total: rows.length,
      ok: valid.length,
      errors: rows.filter((r) => r.status === 'error').length,
      ignored: rows.filter((r) => r.status === 'ignorada').length,
      duplicates: rows.filter((r) => r.status === 'duplicada').length,
    },
  });
});
