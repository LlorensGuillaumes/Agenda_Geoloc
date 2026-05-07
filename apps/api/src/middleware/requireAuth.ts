import type { Request, Response, NextFunction } from 'express';
import { auth, type Session } from '../auth.js';

declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

function buildHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: buildHeaders(req) });
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.session = session;
  next();
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: buildHeaders(req) });
  if (session) req.session = session;
  next();
}
