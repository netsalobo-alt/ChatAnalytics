// Servidor HTTP: API + interface (Vite em desenvolvimento, arquivos estáticos em produção).

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createFirstAdmin, passwordProblem, sessionMiddleware, userCount } from './auth.ts';
import { api } from './routes.ts';
import { rescheduleAutoSync, startHousekeeping } from './scheduler.ts';

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';

// Administrador inicial via variáveis de ambiente (produção): fecha a tela de primeiro acesso.
if (userCount() === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const problem = passwordProblem(process.env.ADMIN_PASSWORD);
  if (problem) throw new Error(`ADMIN_PASSWORD inválida: ${problem}`);
  createFirstAdmin({ name: process.env.ADMIN_NAME || 'Administrador', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  console.log(`Administrador inicial criado: ${process.env.ADMIN_EMAIL}`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use('/api/backup/import', express.json({ limit: '200mb' }));
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', sessionMiddleware, api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

if (PROD) {
  const dist = path.resolve('dist');
  if (!fs.existsSync(dist)) throw new Error('Pasta dist ausente. Rode "npm run build" antes.');
  app.use(express.static(dist, { index: false, maxAge: '1y', immutable: true }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), { maxAge: 0 }));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, () => {
  console.log(`ChatAnalytics em http://localhost:${PORT}`);
  startHousekeeping();
  rescheduleAutoSync();
});
