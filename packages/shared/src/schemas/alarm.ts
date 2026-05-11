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
  activeWindow: activeWindowSchema.optional(),
});

// Input al crear una alarma. ownerId NO viene del cliente: por defecto es el
// usuario autenticado. Para que un amigo cree alarma en agenda ajena (Fase 4)
// se añadirá un campo opcional `ownerId` validado contra friendships.
export const createAlarmSchema = z
  .object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    triggerType: triggerTypeSchema,
    timeConfig: timeConfigSchema.optional(),
    locationConfig: locationConfigSchema.optional(),
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
});

export type CreateAlarmInput = z.infer<typeof createAlarmSchema>;
export type UpdateAlarmInput = z.infer<typeof updateAlarmSchema>;
export type TimeConfigInput = z.infer<typeof timeConfigSchema>;
export type LocationConfigInput = z.infer<typeof locationConfigSchema>;
