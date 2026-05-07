import { Router } from 'express';
import { eq, or, desc } from 'drizzle-orm';
import { alarms } from '@agenda/db';
import { createAlarmSchema, updateAlarmSchema } from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const userId = req.session!.user.id;
    const rows = await db
      .select()
      .from(alarms)
      .where(or(eq(alarms.ownerId, userId), eq(alarms.creatorId, userId)))
      .orderBy(desc(alarms.createdAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createAlarmSchema.parse(req.body);
    const userId = req.session!.user.id;
    const [row] = await db
      .insert(alarms)
      .values({
        title: data.title,
        notes: data.notes,
        triggerType: data.triggerType,
        timeConfig: data.timeConfig ?? null,
        locationConfig: data.locationConfig ?? null,
        ownerId: userId,
        creatorId: userId,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateAlarmSchema.parse(req.body);
    const userId = req.session!.user.id;
    const [existing] = await db
      .select()
      .from(alarms)
      .where(eq(alarms.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    if (existing.ownerId !== userId && existing.creatorId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const [row] = await db
      .update(alarms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(alarms.id, req.params.id))
      .returning();
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.session!.user.id;
    const [existing] = await db
      .select()
      .from(alarms)
      .where(eq(alarms.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    if (existing.ownerId !== userId && existing.creatorId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.delete(alarms).where(eq(alarms.id, req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
