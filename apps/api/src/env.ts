import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).default('file:./local.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(16).default('dev_only_change_me_in_production_____'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
