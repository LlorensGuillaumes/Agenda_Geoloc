import { createDb } from '@agenda/db';
import { env } from './env.js';

export const { db, client } = createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
