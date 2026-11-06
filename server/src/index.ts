import express, { type NextFunction, type Request, type Response } from 'express';
import { router } from './routes.ts';
import { syncAll } from './services/sync.ts';

const app = express();
app.use(express.json());
app.use('/api', router);

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
  syncAll();
  setInterval(syncAll, 30 * 60_000);
});
