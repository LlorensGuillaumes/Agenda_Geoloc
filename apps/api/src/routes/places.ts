import { Router } from 'express';
import { and, eq, inArray, or } from 'drizzle-orm';
import { friendships, placeShares, places, user } from '@agenda/db';
import { placeSchema, sharePlaceSchema, updatePlaceSchema } from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

// Lugares que un amigo ha compartido conmigo. Antes de las rutas con :id para
// que "shared-with-me" no sea capturado como un placeId.
router.get('/shared-with-me', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const shareRows = await db
      .select({
        place: places,
        ownerId: places.ownerId,
      })
      .from(placeShares)
      .innerJoin(places, eq(places.id, placeShares.placeId))
      .where(eq(placeShares.sharedWithUserId, meId));
    if (shareRows.length === 0) {
      res.json([]);
      return;
    }
    const ownerIds = Array.from(new Set(shareRows.map((r) => r.ownerId)));
    const owners = await db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(inArray(user.id, ownerIds));
    const ownerMap = new Map(owners.map((o) => [o.id, o]));
    res.json(
      shareRows.map((r) => ({
        ...r.place,
        owner: ownerMap.get(r.ownerId) ?? null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

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

// Comparte un lugar con un amigo. El target debe ser amistad `accepted` en
// cualquier dirección. Idempotente: si ya existe el share, devuelve el row
// existente con 200.
router.post('/:placeId/shares', async (req, res, next) => {
  try {
    const { userId: targetId } = sharePlaceSchema.parse(req.body);
    const meId = req.session!.user.id;
    const [place] = await db
      .select()
      .from(places)
      .where(eq(places.id, req.params.placeId));
    if (!place) {
      res.status(404).json({ error: 'PlaceNotFound' });
      return;
    }
    if (place.ownerId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (targetId === meId) {
      res.status(400).json({ error: 'CannotShareWithSelf' });
      return;
    }
    const [friendship] = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(
            and(
              eq(friendships.requesterId, meId),
              eq(friendships.addresseeId, targetId),
            ),
            and(
              eq(friendships.requesterId, targetId),
              eq(friendships.addresseeId, meId),
            ),
          ),
        ),
      );
    if (!friendship) {
      res.status(403).json({ error: 'NotFriends' });
      return;
    }
    const [existing] = await db
      .select()
      .from(placeShares)
      .where(
        and(
          eq(placeShares.placeId, place.id),
          eq(placeShares.sharedWithUserId, targetId),
        ),
      );
    if (existing) {
      res.json(existing);
      return;
    }
    const [row] = await db
      .insert(placeShares)
      .values({ placeId: place.id, sharedWithUserId: targetId })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// Lista quién tiene acceso a un lugar mío.
router.get('/:placeId/shares', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const [place] = await db
      .select()
      .from(places)
      .where(eq(places.id, req.params.placeId));
    if (!place) {
      res.status(404).json({ error: 'PlaceNotFound' });
      return;
    }
    if (place.ownerId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const shares = await db
      .select({
        id: placeShares.id,
        createdAt: placeShares.createdAt,
        sharedWith: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(placeShares)
      .innerJoin(user, eq(user.id, placeShares.sharedWithUserId))
      .where(eq(placeShares.placeId, place.id));
    res.json(shares);
  } catch (err) {
    next(err);
  }
});

// Revoca el share. Solo el dueño del lugar.
router.delete('/:placeId/shares/:userId', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const [place] = await db
      .select()
      .from(places)
      .where(eq(places.id, req.params.placeId));
    if (!place) {
      res.status(404).json({ error: 'PlaceNotFound' });
      return;
    }
    if (place.ownerId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db
      .delete(placeShares)
      .where(
        and(
          eq(placeShares.placeId, place.id),
          eq(placeShares.sharedWithUserId, req.params.userId),
        ),
      );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
