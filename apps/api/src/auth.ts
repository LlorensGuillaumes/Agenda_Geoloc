import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db.js';
import { env } from './env.js';
import * as schema from '@agenda/db';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // En v1: dejamos email auto-verificado en dev; al integrar email provider
    // habrá que poner requireEmailVerification: true.
  },
  user: {
    additionalFields: {
      pushToken: {
        type: 'string',
        required: false,
        input: false, // no se acepta vía signup; se setea desde /api/devices/register
      },
    },
  },
  trustedOrigins: [
    'http://localhost:8081',
    'http://localhost:19006',
    'http://localhost:19000',
    'exp://localhost:8081',
    // Para testear en dispositivo físico vía LAN, añade aquí tu IP local,
    // p.ej. 'http://192.168.1.42:8081' y 'exp://192.168.1.42:8081'.
  ],
});

export type Session = typeof auth.$Infer.Session;
