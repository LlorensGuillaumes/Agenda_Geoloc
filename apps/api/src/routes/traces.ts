import { Router } from 'express';
import { and, desc, eq, gte } from 'drizzle-orm';
import { geofenceTraces } from '@agenda/db';
import { tracesBatchSchema } from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

// Insercció en batch. El mobile envia diversos rows en una petició perquè
// el polling pot generar-ne varis per minut quan el mode test és actiu.
router.post('/', async (req, res, next) => {
  try {
    const { traces } = tracesBatchSchema.parse(req.body);
    const userId = req.session!.user.id;
    const rows = traces.map((t) => ({
      userId,
      ts: new Date(t.ts),
      lat: t.lat,
      lng: t.lng,
      accuracy: t.accuracy ?? null,
      alarmId: t.alarmId ?? null,
      alarmTitle: t.alarmTitle ?? null,
      alarmEvent: t.alarmEvent ?? null,
      alarmRepeat: t.alarmRepeat ?? null,
      outerRadius: t.outerRadius ?? null,
      distance: t.distance ?? null,
      insideOuter: t.insideOuter ?? null,
      lastDistance: t.lastDistance ?? null,
      outsideStreak: t.outsideStreak ?? null,
      didFire: t.didFire,
      source: t.source ?? null,
      note: t.note ?? null,
    }));
    await db.insert(geofenceTraces).values(rows);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Llistat (debug). Filtra per timestamp opcional `from` (ISO).
router.get('/', async (req, res, next) => {
  try {
    const userId = req.session!.user.id;
    const fromParam = typeof req.query.from === 'string' ? req.query.from : null;
    const fromDate = fromParam ? new Date(fromParam) : null;
    const where = fromDate
      ? and(eq(geofenceTraces.userId, userId), gte(geofenceTraces.ts, fromDate))
      : eq(geofenceTraces.userId, userId);
    const rows = await db
      .select()
      .from(geofenceTraces)
      .where(where)
      .orderBy(desc(geofenceTraces.ts))
      .limit(500);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Esborra totes les traces del user (útil per netejar entre tests).
router.delete('/', async (req, res, next) => {
  try {
    const userId = req.session!.user.id;
    await db.delete(geofenceTraces).where(eq(geofenceTraces.userId, userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
