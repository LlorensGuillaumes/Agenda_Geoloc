import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';
import { toNodeHandler } from 'better-auth/node';
import { env } from './env.js';
import { auth } from './auth.js';
import { requireAuth } from './middleware/requireAuth.js';
import placesRouter from './routes/places.js';
import alarmsRouter from './routes/alarms.js';
import friendsRouter from './routes/friends.js';

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  }),
);

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Better-Auth expone su propio router en /api/auth/* y necesita ver el request
// crudo (sin express.json), por eso se monta ANTES del body parser.
app.all('/api/auth/*', toNodeHandler(auth));

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'agenda-api',
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.session!.user, session: req.session!.session });
});

app.use('/api/places', placesRouter);
app.use('/api/alarms', alarmsRouter);
app.use('/api/friends', friendsRouter);

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

app.listen(env.PORT, () => {
  console.log(`[api] listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
});
