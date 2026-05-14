import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { user } from '@agenda/db';
import { deviceRegisterSchema } from '@agenda/shared';
import { db } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();
router.use(requireAuth);

// Registra el push token del dispositivo actual contra el usuario autenticado.
// Idempotente: si el token ya está guardado para este usuario, no hace nada.
// El cliente lo llama tras login y al detectar cambios de token (rotación de
// expo push tokens al reinstalar / al cambiar de device).
router.post('/register', async (req, res, next) => {
  try {
    const { pushToken } = deviceRegisterSchema.parse(req.body);
    const userId = req.session!.user.id;
    await db
      .update(user)
      .set({ pushToken })
      .where(eq(user.id, userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Borra el push token del usuario actual (útil al logout para que no le
// sigan llegando notifs en un device del que se desconectó).
router.delete('/register', async (req, res, next) => {
  try {
    const userId = req.session!.user.id;
    await db
      .update(user)
      .set({ pushToken: null })
      .where(eq(user.id, userId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
