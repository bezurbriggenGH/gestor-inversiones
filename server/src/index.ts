import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { router } from './routes.ts';
import { syncAll } from './services/sync.ts';
import { run } from './db.ts';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Encabezados de seguridad básicos
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use('/api', router);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// En producción el mismo servidor entrega el frontend ya compilado (client/dist)
const clientDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err?.status ? 'Error interno del servidor' : err.message });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`API lista en http://localhost:${PORT}`);
  // Actualiza al arrancar y cada 30 minutos mientras el servidor esté prendido.
  // Si estuvo apagado, la primera actualización completa los días que falten.
  const tick = () => {
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    syncAll();
  };
  tick();
  setInterval(tick, 30 * 60_000);
});
