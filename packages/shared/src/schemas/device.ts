import { z } from 'zod';

// El formato canónico de Expo es ExponentPushToken[xxxxxxxxxxxxx]. Lo dejamos
// laxo aceptando cualquier string no vacío para no romper en dispositivos
// que devuelvan formatos raros; el backend valida estrictamente antes de
// enviar.
export const deviceRegisterSchema = z.object({
  pushToken: z.string().min(1).max(200),
});

export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;
