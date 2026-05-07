import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { places } from '@agenda/db';
import { placeSchema, updatePlaceSchema } from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const ownerId = req.session!.user.id;
    const rows = await db.select().from(places).where(eq(places.ownerId, ownerId));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = placeSchema.parse(req.body);
    const ownerId = req.session!.user.id;
    const [row] = await db
      .insert(places)
      .values({ ...data, ownerId })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = updatePlaceSchema.parse(req.body);
    const ownerId = req.session!.user.id;
    const [existing] = await db
      .select()
      .from(places)
      .where(eq(places.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    if (existing.ownerId !== ownerId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const [row] = await db
      .update(places)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(places.id, req.params.id))
      .returning();
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const ownerId = req.session!.user.id;
    const [existing] = await db
      .select()
      .from(places)
      .where(eq(places.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    if (existing.ownerId !== ownerId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.delete(places).where(eq(places.id, req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
