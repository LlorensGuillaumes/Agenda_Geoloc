import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const url = process.env.DATABASE_URL ?? 'file:./local.db';
const authToken = process.env.DATABASE_AUTH_TOKEN;

export default {
  schema: './src/schema.ts',
  out: './drizzle/migrations',
  dialect: 'turso',
  dbCredentials: authToken ? { url, authToken } : { url },
} satisfies Config;
