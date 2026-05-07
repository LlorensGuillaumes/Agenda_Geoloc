import { z } from 'zod';

export const placeSchema = z.object({
  name: z.string().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(50).max(5000).default(150),
  icon: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  address: z.string().optional(),
});

export const updatePlaceSchema = placeSchema.partial();

export const sharePlaceSchema = z.object({
  userId: z.string().uuid(),
});

export type PlaceInput = z.infer<typeof placeSchema>;
export type UpdatePlaceInput = z.infer<typeof updatePlaceSchema>;
export type SharePlaceInput = z.infer<typeof sharePlaceSchema>;
