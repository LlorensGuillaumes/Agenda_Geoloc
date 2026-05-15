import { z } from 'zod';

export const trustLevelSchema = z.enum(['manual_accept', 'auto_accept']);
export const friendshipStatusSchema = z.enum(['pending', 'accepted', 'blocked']);

export const searchFriendSchema = z.object({
  email: z.string().email(),
});

// Better-Auth genera IDs de usuario con un esquema propio (no UUID v4
// estándar), por eso aceptamos cualquier string no vacío. El backend valida
// la existencia del addressee en su tabla `user`.
export const friendRequestSchema = z.object({
  addresseeId: z.string().min(1),
});

export const updateFriendSchema = z.object({
  trustLevel: trustLevelSchema.optional(),
});

export type SearchFriendInput = z.infer<typeof searchFriendSchema>;
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;
export type UpdateFriendInput = z.infer<typeof updateFriendSchema>;
