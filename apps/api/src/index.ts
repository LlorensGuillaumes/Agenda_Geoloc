import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';
import { env } from './env.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'agenda-api',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'ValidationError', details: err.flatten() });
    return;
  }
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: 'InternalServerError' });
});

app.listen(env.PORT, '127.0.0.1', () => {
  console.log(`[api] listening on http://127.0.0.1:${env.PORT} (${env.NODE_ENV})`);
});
