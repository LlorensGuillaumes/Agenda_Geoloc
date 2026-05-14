import { Router } from 'express';
import { and, eq, inArray, or } from 'drizzle-orm';
import { friendships, user } from '@agenda/db';
import {
  friendRequestSchema,
  searchFriendSchema,
  updateFriendSchema,
} from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendPush } from '../push.js';

const router = Router();
router.use(requireAuth);

// Localiza un usuario por email para que el cliente pueda enviarle solicitud.
// Devuelve solo campos públicos (sin password, sin metadatos sensibles).
router.post('/search', async (req, res, next) => {
  try {
    const { email } = searchFriendSchema.parse(req.body);
    const meId = req.session!.user.id;
    const [found] = await db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(eq(user.email, email));
    if (!found) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    if (found.id === meId) {
      res.status(400).json({ error: 'CannotAddSelf' });
      return;
    }
    res.json(found);
  } catch (err) {
    next(err);
  }
});

// Crea solicitud de amistad. Idempotente respecto a la dirección: si ya existe
// (en cualquier dirección) un row con status pending/accepted/blocked, no se
// crea uno nuevo.
router.post('/requests', async (req, res, next) => {
  try {
    const { addresseeId } = friendRequestSchema.parse(req.body);
    const requesterId = req.session!.user.id;
    if (addresseeId === requesterId) {
      res.status(400).json({ error: 'CannotAddSelf' });
      return;
    }
    const [target] = await db.select().from(user).where(eq(user.id, addresseeId));
    if (!target) {
      res.status(404).json({ error: 'AddresseeNotFound' });
      return;
    }
    const [existing] = await db
      .select()
      .from(friendships)
      .where(
        or(
          and(
            eq(friendships.requesterId, requesterId),
            eq(friendships.addresseeId, addresseeId),
          ),
          and(
            eq(friendships.requesterId, addresseeId),
            eq(friendships.addresseeId, requesterId),
          ),
        ),
      );
    if (existing) {
      res.status(409).json({ error: 'AlreadyExists', friendship: existing });
      return;
    }
    const [row] = await db
      .insert(friendships)
      .values({ requesterId, addresseeId })
      .returning();
    res.status(201).json(row);

    // Push fire-and-forget al addressee (no bloquea la respuesta).
    sendPush({
      to: target.pushToken ?? '',
      title: 'Nueva solicitud de amistad',
      body: `${req.session!.user.name} te ha enviado una solicitud de amistad`,
      data: { type: 'friend_request', friendshipId: row.id },
    });
  } catch (err) {
    next(err);
  }
});

// Lista solicitudes pendientes con info del otro usuario y dirección. El
// cliente puede partir en "incoming"/"outgoing" según `direction`.
router.get('/requests', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const rows = await db
      .select({
        id: friendships.id,
        requesterId: friendships.requesterId,
        addresseeId: friendships.addresseeId,
        status: friendships.status,
        trustLevel: friendships.trustLevel,
        createdAt: friendships.createdAt,
        requester: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(friendships)
      .innerJoin(user, eq(user.id, friendships.requesterId))
      .where(
        and(
          eq(friendships.status, 'pending'),
          or(eq(friendships.requesterId, meId), eq(friendships.addresseeId, meId)),
        ),
      );
    // Resolver `addressee` por separado (Drizzle SQLite no soporta dos joins al
    // mismo table alias sin alias explícito).
    const ids = rows.map((r) => r.addresseeId);
    const addressees = ids.length
      ? await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(user)
          .where(inArray(user.id, ids))
      : [];
    const addresseeMap = new Map(addressees.map((a) => [a.id, a]));
    const out = rows.map((r) => ({
      ...r,
      addressee: addresseeMap.get(r.addresseeId) ?? null,
      direction: r.requesterId === meId ? 'outgoing' : 'incoming',
    }));
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Acepta una solicitud pendiente. Solo el addressee puede aceptar.
router.post('/requests/:id/accept', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const [fr] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, req.params.id));
    if (!fr) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    if (fr.addresseeId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (fr.status !== 'pending') {
      res.status(409).json({ error: 'NotPending' });
      return;
    }
    const [row] = await db
      .update(friendships)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(friendships.id, fr.id))
      .returning();
    res.json(row);

    // Push al requester avisando que su solicitud ha sido aceptada.
    const [requester] = await db
      .select({ pushToken: user.pushToken })
      .from(user)
      .where(eq(user.id, fr.requesterId));
    sendPush({
      to: requester?.pushToken ?? '',
      title: 'Solicitud aceptada',
      body: `${req.session!.user.name} ha aceptado tu solicitud de amistad`,
      data: { type: 'friend_accepted', friendshipId: fr.id },
    });
  } catch (err) {
    next(err);
  }
});

// Rechaza una solicitud pendiente (solo addressee) o deshace una amistad ya
// aceptada (cualquiera de las dos partes). Endpoint común para mantener una
// sola operación de borrado del row.
router.delete('/requests/:id', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const [fr] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, req.params.id));
    if (!fr) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    if (fr.requesterId !== meId && fr.addresseeId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.delete(friendships).where(eq(friendships.id, fr.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Lista amistades aceptadas con info del "otro" usuario.
router.get('/', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const rows = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.status, 'accepted'),
          or(eq(friendships.requesterId, meId), eq(friendships.addresseeId, meId)),
        ),
      );
    const otherIds = rows.map((r) =>
      r.requesterId === meId ? r.addresseeId : r.requesterId,
    );
    const others = otherIds.length
      ? await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(user)
          .where(inArray(user.id, otherIds))
      : [];
    const otherMap = new Map(others.map((o) => [o.id, o]));
    const out = rows.map((r) => {
      const otherId = r.requesterId === meId ? r.addresseeId : r.requesterId;
      return {
        id: r.id,
        status: r.status,
        trustLevel: r.trustLevel,
        createdAt: r.createdAt,
        acceptedAt: r.acceptedAt,
        friend: otherMap.get(otherId) ?? null,
      };
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Borra una amistad aceptada. Cualquiera de las dos partes puede romperla.
router.delete('/:id', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const [fr] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, req.params.id));
    if (!fr) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    if (fr.requesterId !== meId && fr.addresseeId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.delete(friendships).where(eq(friendships.id, fr.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Cambia el trust_level. Es un campo simétrico de la fila: cualquiera de las
// dos partes lo modifica y aplica a las alarmas que la otra le crea.
router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateFriendSchema.parse(req.body);
    const meId = req.session!.user.id;
    const [fr] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, req.params.id));
    if (!fr) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    if (fr.requesterId !== meId && fr.addresseeId !== meId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (fr.status !== 'accepted') {
      res.status(409).json({ error: 'NotAccepted' });
      return;
    }
    const patch: Partial<typeof friendships.$inferInsert> = {};
    if (data.trustLevel) patch.trustLevel = data.trustLevel;
    if (Object.keys(patch).length === 0) {
      res.json(fr);
      return;
    }
    const [row] = await db
      .update(friendships)
      .set(patch)
      .where(eq(friendships.id, fr.id))
      .returning();
    res.json(row);
  } catch (err) {
    next(err);
  }
});

export default router;
