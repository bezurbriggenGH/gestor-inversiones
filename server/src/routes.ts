import { Router } from 'express';
import { db, get } from './db.ts';
import { fetchChart, YahooNotFound, type YahooChart } from './providers/yahoo.ts';
import { saveBars, syncAll, syncAsset, syncFx } from './services/sync.ts';
import {
  assertNoShortSelling,
  buildAssetDetail,
  buildOperationDetail,
  buildPortfolio,
  getOperations,
  parseCurrency,
  parseFxKind,
  type OperationRow,
} from './services/portfolio.ts';
import { classify, normalizeTicker } from './tickers.ts';
import { HttpError, arDate } from './util.ts';

export const router = Router();

function requireAsset(raw: string): string {
  const ticker = normalizeTicker(raw);
  if (!get('SELECT 1 FROM assets WHERE ticker = ?', ticker)) throw new HttpError(404, `${ticker} no está en tu cartera`);
  return ticker;
}

// ---------- Cartera ----------

router.get('/portfolio', async (req, res) => {
  const errors = await syncAll();
  res.json({ ...buildPortfolio(parseCurrency(req.query.currency), parseFxKind(req.query.fx)), errors });
});

// ---------- Activos ----------

router.post('/assets', async (req, res) => {
  const ticker = normalizeTicker(String(req.body?.ticker ?? ''));
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw new HttpError(400, 'Ingresá un ticker válido, por ejemplo GGAL o MELI');
  if (get('SELECT 1 FROM assets WHERE ticker = ?', ticker)) throw new HttpError(409, `${ticker} ya está en tu cartera`);

  const symbol = `${ticker}.BA`;
  let chart: YahooChart;
  try {
    chart = await fetchChart(symbol, { range: '10y' });
  } catch (err) {
    if (err instanceof YahooNotFound) throw new HttpError(404, `No encontramos ${ticker} en BYMA`);
    throw new HttpError(502, 'No se pudo consultar Yahoo Finance. Probá de nuevo en un rato.');
  }
  if (chart.bars.length === 0) throw new HttpError(404, `${ticker} no tiene precios en BYMA`);

  const type = classify(ticker);
  db.prepare('INSERT INTO assets (ticker, symbol, name, type, last_sync) VALUES (?, ?, ?, ?, ?)').run(
    ticker,
    symbol,
    chart.name,
    type,
    Date.now(),
  );
  saveBars(ticker, chart.bars);
  res.status(201).json({ ticker, name: chart.name, type });
});

router.delete('/assets/:ticker', (req, res) => {
  const ticker = requireAsset(req.params.ticker);
  db.prepare('DELETE FROM assets WHERE ticker = ?').run(ticker);
  res.status(204).end();
});

router.get('/assets/:ticker', async (req, res) => {
  const ticker = requireAsset(req.params.ticker);
  await Promise.allSettled([syncAsset(ticker), syncFx()]);
  res.json(buildAssetDetail(ticker, parseCurrency(req.query.currency), parseFxKind(req.query.fx)));
});

/** Precio de cierre de una fecha (o el último anterior si fue feriado). Siempre en pesos. */
router.get('/assets/:ticker/price', (req, res) => {
  const ticker = requireAsset(req.params.ticker);
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

router.post('/assets/:ticker/operations', (req, res) => {
  const ticker = requireAsset(req.params.ticker);
  const b = req.body ?? {};

  const type = b.type;
  if (type !== 'COMPRA' && type !== 'VENTA') throw new HttpError(400, 'El tipo debe ser COMPRA o VENTA');
  const date = String(b.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Fecha inválida');
  if (date > arDate()) throw new HttpError(400, 'La fecha no puede ser futura');
  const quantity = Number(b.quantity);
  const price = Number(b.price);
  const fees = b.fees === '' || b.fees == null ? 0 : Number(b.fees);
  if (!(quantity > 0) || !Number.isFinite(quantity)) throw new HttpError(400, 'La cantidad debe ser mayor a 0');
  if (!(price > 0) || !Number.isFinite(price)) throw new HttpError(400, 'El precio debe ser mayor a 0');
  if (!(fees >= 0) || !Number.isFinite(fees)) throw new HttpError(400, 'Las comisiones no pueden ser negativas');
  const link = cleanText(b.note_link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw new HttpError(400, 'El link debe empezar con http:// o https://');

  const draft: OperationRow = {
    id: Number.MAX_SAFE_INTEGER,
    ticker,
    type,
    date,
    quantity,
    price,
    fees,
    note_title: cleanText(b.note_title, 120),
    note_body: cleanText(b.note_body, 5000),
    note_link: link,
    created_at: '',
  };
  assertNoShortSelling([...getOperations(ticker), draft]);

  const result = db
    .prepare(
      `INSERT INTO operations (ticker, type, date, quantity, price, fees, note_title, note_body, note_link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ticker, type, date, quantity, price, fees, draft.note_title, draft.note_body, draft.note_link);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.get('/operations/:id', (req, res) => {
  res.json(buildOperationDetail(Number(req.params.id), parseCurrency(req.query.currency), parseFxKind(req.query.fx)));
});

router.delete('/operations/:id', (req, res) => {
  const id = Number(req.params.id);
  const op = get<OperationRow>('SELECT * FROM operations WHERE id = ?', id);
  if (!op) throw new HttpError(404, 'Operación no encontrada');
  try {
    assertNoShortSelling(getOperations(op.ticker).filter((o) => o.id !== id));
  } catch {
    throw new HttpError(409, 'No se puede borrar esta compra: quedarían ventas sin respaldo. Borrá primero esas ventas.');
  }
  db.prepare('DELETE FROM operations WHERE id = ?').run(id);
  res.status(204).end();
});
