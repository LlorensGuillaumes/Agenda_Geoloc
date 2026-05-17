import { z } from 'zod';

export const triggerTypeSchema = z.enum(['time', 'location', 'time_and_location']);
export const locationEventSchema = z.enum(['enter', 'exit', 'nearby']);
export const repeatSchema = z.enum(['once', 'daily', 'weekly']);

export const timeConfigSchema = z.object({
  datetime: z.string().datetime().optional(),
  repeat: repeatSchema,
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  timeWindow: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .optional(),
});

export const activeWindowSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

export const notifyActionSchema = z.enum(['call', 'whatsapp']);

export const notifyConfigSchema = z
  .object({
    contactName: z.string().max(100).optional(),
    // Acceptem qualsevol string raonable; al client ho passem per un netejat
    // mínim (treure espais, guions) abans d'usar-ho a tel: o wa.me.
    contactPhone: z.string().min(3).max(30).optional(),
    actions: z.array(notifyActionSchema).max(2),
    whatsappMessage: z.string().max(500).optional(),
  })
  .refine(
    (cfg) => cfg.actions.length === 0 || !!cfg.contactPhone,
    { message: 'contactPhone es necesario si se especifica alguna acción' },
  );

export const locationRepeatSchema = z.enum(['once', 'always']);

export const locationConfigSchema = z.object({
  mode: z.enum(['saved_place', 'custom_point']),
  placeId: z.string().uuid().optional(),
  customPoint: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusMeters: z.number().int().min(50).max(5000),
    })
    .optional(),
  event: locationEventSchema,
  repeat: locationRepeatSchema.optional(),
  activeWindow: activeWindowSchema.optional(),
});

// Input al crear una alarma. Si `ownerId` viene del cliente y difiere del
// usuario autenticado, el backend valida:
//  1) hay friendship `accepted` entre ambos
//  2) si la alarma referencia un saved_place, ese place pertenece a ownerId y
//     existe un place_share con el creator
// El status final (`active` vs `pending_acceptance`) lo decide el backend a
// partir de `trust_level` de la friendship.
export const createAlarmSchema = z
  .object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    triggerType: triggerTypeSchema,
    timeConfig: timeConfigSchema.optional(),
    locationConfig: locationConfigSchema.optional(),
    notifyConfig: notifyConfigSchema.optional(),
    // ownerId viene de Better-Auth (formato propio, no UUID v4 estándar).
    ownerId: z.string().min(1).optional(),
  })
  .refine(
    (data) => {
      if (data.triggerType === 'time' || data.triggerType === 'time_and_location') {
        return !!data.timeConfig;
      }
      return true;
    },
    { message: 'timeConfig requerido para trigger_type que incluye tiempo' },
  )
  .refine(
    (data) => {
      if (data.triggerType === 'location' || data.triggerType === 'time_and_location') {
        return !!data.locationConfig;
      }
      return true;
    },
    { message: 'locationConfig requerido para trigger_type que incluye ubicación' },
  );

export const updateAlarmSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
  timeConfig: timeConfigSchema.optional(),
  locationConfig: locationConfigSchema.optional(),
  notifyConfig: notifyConfigSchema.nullable().optional(),
  // ISO 8601. Quan el client marca una alarma com a disparada (once →
  // isActive=false), envia també aquest timestamp perquè la UI pugui
  // distingir entre "pausada manualment" i "disparada automàticament".
  lastFiredAt: z.string().datetime().nullable().optional(),
});

export type CreateAlarmInput = z.infer<typeof createAlarmSchema>;
export type UpdateAlarmInput = z.infer<typeof updateAlarmSchema>;
export type TimeConfigInput = z.infer<typeof timeConfigSchema>;
export type LocationConfigInput = z.infer<typeof locationConfigSchema>;
export type NotifyConfigInput = z.infer<typeof notifyConfigSchema>;
export type NotifyAction = z.infer<typeof notifyActionSchema>;
