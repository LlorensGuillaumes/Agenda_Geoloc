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
//
// Dos queries: una para outgoing (yo soy requester → "other" es addressee),
// otra para incoming (yo soy addressee → "other" es requester). Cada una
// con un único JOIN al user que actúa de "other", lo que garantiza que ese
// objeto nunca sale null.
router.get('/requests', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const baseFields = {
      id: friendships.id,
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
      status: friendships.status,
      trustLevel: friendships.trustLevel,
      createdAt: friendships.createdAt,
    };
    const userFields = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };

    const outgoingRows = await db
      .select({ ...baseFields, other: userFields })
      .from(friendships)
      .innerJoin(user, eq(user.id, friendships.addresseeId))
      .where(
        and(
          eq(friendships.status, 'pending'),
          eq(friendships.requesterId, meId),
        ),
      );
    const incomingRows = await db
      .select({ ...baseFields, other: userFields })
      .from(friendships)
      .innerJoin(user, eq(user.id, friendships.requesterId))
      .where(
        and(
          eq(friendships.status, 'pending'),
          eq(friendships.addresseeId, meId),
        ),
      );

    const out = [
      ...outgoingRows.map(({ other, ...r }) => ({
        ...r,
        direction: 'outgoing' as const,
        requester: null,
        addressee: other,
      })),
      ...incomingRows.map(({ other, ...r }) => ({
        ...r,
        direction: 'incoming' as const,
        requester: other,
        addressee: null,
      })),
    ];
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
// Hacemos dos queries con JOIN explícito (una para cuando soy requester,
// otra para cuando soy addressee) y las unimos. Garantiza que el "friend"
// nunca sale null si la amistad existe — la versión anterior con un
// segundo SELECT + inArray fallaba en producción al resolver el nombre.
router.get('/', async (req, res, next) => {
  try {
    const meId = req.session!.user.id;
    const baseSelect = {
      id: friendships.id,
      status: friendships.status,
      trustLevel: friendships.trustLevel,
      createdAt: friendships.createdAt,
      acceptedAt: friendships.acceptedAt,
      friend: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    };
    const asRequester = await db
      .select(baseSelect)
      .from(friendships)
      .innerJoin(user, eq(user.id, friendships.addresseeId))
      .where(
        and(
          eq(friendships.status, 'accepted'),
          eq(friendships.requesterId, meId),
        ),
      );
    const asAddressee = await db
      .select(baseSelect)
      .from(friendships)
      .innerJoin(user, eq(user.id, friendships.requesterId))
      .where(
        and(
          eq(friendships.status, 'accepted'),
          eq(friendships.addresseeId, meId),
        ),
      );
    res.json([...asRequester, ...asAddressee]);
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
