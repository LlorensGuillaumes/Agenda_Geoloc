import { Router } from 'express';
import { and, desc, eq, or } from 'drizzle-orm';
import { alarms, friendships, placeShares, places, user } from '@agenda/db';
import { createAlarmSchema, updateAlarmSchema } from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendPush } from '../push.js';

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
    const creatorId = req.session!.user.id;
    const targetOwnerId = data.ownerId ?? creatorId;
    const isCrossAgenda = targetOwnerId !== creatorId;

    let status: 'active' | 'pending_acceptance' = 'active';

    if (isCrossAgenda) {
      // 1) Debe existir friendship aceptada entre creator y owner (cualquier dir).
      const [friendship] = await db
        .select()
        .from(friendships)
        .where(
          and(
            eq(friendships.status, 'accepted'),
            or(
              and(
                eq(friendships.requesterId, creatorId),
                eq(friendships.addresseeId, targetOwnerId),
              ),
              and(
                eq(friendships.requesterId, targetOwnerId),
                eq(friendships.addresseeId, creatorId),
              ),
            ),
          ),
        );
      if (!friendship) {
        res.status(403).json({ error: 'NotFriends' });
        return;
      }

      // 2) Si referencia un saved_place, el place debe pertenecer al owner Y
      // estar compartido con el creator. custom_point no tiene restricción.
      const cfg = data.locationConfig;
      if (cfg?.mode === 'saved_place') {
        if (!cfg.placeId) {
          res.status(400).json({ error: 'PlaceIdRequired' });
          return;
        }
        const [place] = await db
          .select()
          .from(places)
          .where(eq(places.id, cfg.placeId));
        if (!place) {
          res.status(404).json({ error: 'PlaceNotFound' });
          return;
        }
        if (place.ownerId !== targetOwnerId) {
          res.status(403).json({ error: 'PlaceNotOwnedByTarget' });
          return;
        }
        const [share] = await db
          .select()
          .from(placeShares)
          .where(
            and(
              eq(placeShares.placeId, place.id),
              eq(placeShares.sharedWithUserId, creatorId),
            ),
          );
        if (!share) {
          res.status(403).json({ error: 'PlaceNotShared' });
          return;
        }
      }

      // 3) El status depende del trust_level del owner sobre el creator.
      status = friendship.trustLevel === 'auto_accept' ? 'active' : 'pending_acceptance';
    } else {
      // Caso estándar: si el creator referencia un saved_place ajeno, no es
      // válido. Solo lugares propios.
      const cfg = data.locationConfig;
      if (cfg?.mode === 'saved_place' && cfg.placeId) {
        const [place] = await db
          .select()
          .from(places)
          .where(eq(places.id, cfg.placeId));
        if (!place || place.ownerId !== creatorId) {
          res.status(403).json({ error: 'PlaceNotOwned' });
          return;
        }
      }
    }

    const [row] = await db
      .insert(alarms)
      .values({
        title: data.title,
        notes: data.notes,
        triggerType: data.triggerType,
        timeConfig: data.timeConfig ?? null,
        locationConfig: data.locationConfig ?? null,
        ownerId: targetOwnerId,
        creatorId,
        status,
      })
      .returning();
    res.status(201).json(row);

    // Push fire-and-forget al owner cuando es cross-agenda. Si el status es
    // pending_acceptance, el push le pide confirmación; si es active (auto-
    // accept), simplemente le avisa que tiene una alarma nueva.
    if (isCrossAgenda) {
      const [owner] = await db
        .select({ pushToken: user.pushToken })
        .from(user)
        .where(eq(user.id, targetOwnerId));
      const requiresAccept = status === 'pending_acceptance';
      sendPush({
        to: owner?.pushToken ?? '',
        title: requiresAccept
          ? 'Alarma pendiente de aceptar'
          : 'Nueva alarma en tu agenda',
        body: `${req.session!.user.name}: "${row.title}"`,
        data: {
          type: requiresAccept ? 'alarm_pending' : 'alarm_created',
          alarmId: row.id,
        },
      });
    }
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

// Acepta una alarma que un amigo me creó. Solo owner. Transición
// pending_acceptance → active.
router.post('/:id/accept', async (req, res, next) => {
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
    if (existing.ownerId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (existing.status !== 'pending_acceptance') {
      res.status(409).json({ error: 'NotPending' });
      return;
    }
    const [row] = await db
      .update(alarms)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(alarms.id, existing.id))
      .returning();
    res.json(row);

    // Push al creator (solo si es otro user, lo normal en pending_acceptance).
    if (existing.creatorId !== existing.ownerId) {
      const [creator] = await db
        .select({ pushToken: user.pushToken })
        .from(user)
        .where(eq(user.id, existing.creatorId));
      sendPush({
        to: creator?.pushToken ?? '',
        title: 'Alarma aceptada',
        body: `${req.session!.user.name} ha aceptado "${row.title}"`,
        data: { type: 'alarm_accepted', alarmId: row.id },
      });
    }
  } catch (err) {
    next(err);
  }
});

// Rechaza una alarma pendiente. Solo owner. Borra el row (el creator pierde
// la copia; coherente con el flujo de friend request).
router.post('/:id/reject', async (req, res, next) => {
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
    if (existing.ownerId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (existing.status !== 'pending_acceptance') {
      res.status(409).json({ error: 'NotPending' });
      return;
    }
    await db.delete(alarms).where(eq(alarms.id, existing.id));
    res.status(204).send();

    // Push al creator avisando del rechazo (solo si era cross-agenda).
    if (existing.creatorId !== existing.ownerId) {
      const [creator] = await db
        .select({ pushToken: user.pushToken })
        .from(user)
        .where(eq(user.id, existing.creatorId));
      sendPush({
        to: creator?.pushToken ?? '',
        title: 'Alarma rechazada',
        body: `${req.session!.user.name} ha rechazado "${existing.title}"`,
        data: { type: 'alarm_rejected', alarmId: existing.id },
      });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
