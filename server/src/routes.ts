import { Router } from 'express';
import { get, run, tx, all } from './db.ts';
import { YahooNotFound } from './providers/yahoo.ts';
import { ensureAsset, syncAll, syncAsset, syncFx, syncIndices } from './services/sync.ts';
import {
  assertNoShortSelling,
  buildAssetDetail,
  buildOperationDetail,
  buildPortfolio,
  getOperations,
  getRawOperations,
  adjustForSplits,
  parseCurrency,
  parseFxKind,
  requireUserAsset,
  type OperationRow,
  type OpType,
} from './services/portfolio.ts';
import { buildHistory } from './services/history.ts';
import { buildJournal } from './services/journal.ts';
import { CSV_TEMPLATE, parseCsv } from './services/importer.ts';
import { checkAlerts, listAlerts } from './services/alerts.ts';
import { searchCatalog } from './catalog.ts';
import { simulate } from './services/simulator.ts';
import { classify, normalizeTicker } from './tickers.ts';
import { checkRateLimit, currentUser, endSession, login, register, requireUser, startSession, userId } from './auth.ts';
import { HttpError, arDate } from './util.ts';

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

router.get('/portfolio', async (req, res) => {
  const errors = await syncAll();
  const { currency, fx } = q(req);
  const portfolio = buildPortfolio(userId(res), currency, fx);
  const history = buildHistory(userId(res), 'ARS', fx);
  res.json({ ...portfolio, realReturn: history.realReturn, errors });
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Elegí una fecha');
  await ensureCatalogAsset(ticker);
  await Promise.allSettled([syncAsset(ticker), syncFx(), syncIndices()]);
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
  run('INSERT INTO user_assets (user_id, ticker) VALUES (?, ?)', userId(res), ticker);
  const asset = get<{ ticker: string; name: string; type: string }>('SELECT ticker, name, type FROM assets WHERE ticker = ?', ticker);
  res.status(201).json(asset);
});

router.delete('/assets/:ticker', (req, res) => {
  const uid = userId(res);
  const ticker = requireUserAsset(uid, normalizeTicker(req.params.ticker)).ticker;
  tx(() => {
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
  res.json(buildAssetDetail(userId(res), ticker, currency, fx));
});

/** Precio de cierre de una fecha (o el último anterior si fue feriado). Siempre en pesos. */
router.get('/assets/:ticker/price', (req, res) => {
  const ticker = requireUserAsset(userId(res), normalizeTicker(req.params.ticker)).ticker;
  const date = typeof req.query.date === 'string' ? req.query.date : arDate();
  const row = get<{ date: string; close: number }>(
    'SELECT date, close FROM prices WHERE ticker = ? AND date <= ? ORDER BY date DESC LIMIT 1',
    ticker,
    date,
  );
  if (!row) throw new HttpError(404, 'No hay precio para esa fecha');
  res.json(row);
});

// ---------- Operaciones ----------

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

const OP_TYPES: OpType[] = ['COMPRA', 'VENTA', 'DIVIDENDO'];

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
  const date = String(b.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Fecha inválida');
  if (date > arDate()) throw new HttpError(400, 'La fecha no puede ser futura');
  const quantity = Number(b.quantity);
  const price = Number(b.price);
  const fees = b.fees === '' || b.fees == null ? 0 : Number(b.fees);
  if (!(quantity > 0) || !Number.isFinite(quantity)) throw new HttpError(400, 'La cantidad debe ser mayor a 0');
  if (!(price > 0) || !Number.isFinite(price)) throw new HttpError(400, 'El precio debe ser mayor a 0');
  if (!(fees >= 0) || !Number.isFinite(fees)) throw new HttpError(400, 'Las comisiones no pueden ser negativas');
  if (type !== 'COMPRA' && fees >= quantity * price) throw new HttpError(400, 'Las comisiones o retenciones no pueden superar el total');
  const link = cleanText(b.note_link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw new HttpError(400, 'El link debe empezar con http:// o https://');

  const draft = {
    user_id: uid,
    ticker,
    type,
    date,
    quantity,
    price,
    fees,
    note_title: cleanText(b.note_title, 120),
    note_body: cleanText(b.note_body, 5000),
    note_link: link,
  };
  assertNoShortSelling([...getOperations(uid, ticker), ...adjustForSplits([{ ...draft, id: Number.MAX_SAFE_INTEGER, created_at: '' }])]);
  res.status(201).json({ id: insertOperation(draft) });
});

router.get('/operations/:id', (req, res) => {
  const { currency, fx } = q(req);
  res.json(buildOperationDetail(userId(res), Number(req.params.id), currency, fx));
});

router.delete('/operations/:id', (req, res) => {
  const uid = userId(res);
  const id = Number(req.params.id);
  const op = get<OperationRow>('SELECT * FROM operations WHERE id = ? AND user_id = ?', id, uid);
  if (!op) throw new HttpError(404, 'Operación no encontrada');
  try {
    assertNoShortSelling(getOperations(uid, op.ticker).filter((o) => o.id !== id));
  } catch {
    throw new HttpError(409, 'No se puede borrar esta compra: quedarían ventas sin respaldo. Borrá primero esas ventas.');
  }
  run('DELETE FROM operations WHERE id = ?', id);
  res.status(204).end();
});

// ---------- Alertas ----------

router.get('/alerts', (_req, res) => {
  res.json(listAlerts(userId(res)));
});

router.post('/alerts', (req, res) => {
  const uid = userId(res);
  const ticker = requireUserAsset(uid, normalizeTicker(String(req.body?.ticker ?? ''))).ticker;
  const direction = req.body?.direction;
  const price = Number(req.body?.price);
  if (direction !== 'ARRIBA' && direction !== 'ABAJO') throw new HttpError(400, 'Dirección inválida');
  if (!(price > 0)) throw new HttpError(400, 'El precio debe ser mayor a 0');
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

  // Verificar que cada ticker exista en BYMA (se agrega al catálogo global si hace falta)
  const tickers = [...new Set(rows.filter((r) => r.ticker && !r.errors.length && !r.ignored).map((r) => r.ticker as string))];
  const unknown = new Set<string>();
  for (const t of tickers) {
    try {
      await ensureCatalogAsset(t);
    } catch {
      unknown.add(t);
    }
  }

  const today = arDate();
  for (const r of rows) {
    if (r.ticker && unknown.has(r.ticker)) {
      r.errors.push(`no encontramos ${r.ticker} en BYMA (por ahora la app maneja acciones y CEDEARs; bonos y fondos todavía no)`);
    }
    if (r.date && r.date > today) r.errors.push('fecha futura');
  }

  // Duplicados: misma operación ya cargada
  const existingByTicker = new Map<string, OperationRow[]>();
  // Se compara contra lo cargado tal cual (sin ajustar por splits), igual que viene en el archivo
  for (const t of tickers) existingByTicker.set(t, getRawOperations(uid, t));
  for (const r of rows) {
    if (r.errors.length || !r.ticker || r.ignored) continue;
    const dup = existingByTicker
      .get(r.ticker)
      ?.some((o) => o.type === r.type && o.date === r.date && Math.abs(o.quantity - r.quantity!) < 1e-9 && Math.abs(o.price - r.price!) < 1e-6);
    if (dup) r.status = 'duplicada';
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
    try {
      assertNoShortSelling(adjustForSplits([...(existingByTicker.get(t) ?? []), ...drafts]), t);
    } catch (err) {
      // Se marcan solo las ventas: las compras de ese ticker se pueden importar igual
      for (const r of newOps) if (r.type === 'VENTA') r.errors.push(err instanceof Error ? err.message : 'ventas sin respaldo');
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
