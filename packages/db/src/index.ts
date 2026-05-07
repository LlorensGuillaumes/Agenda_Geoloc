import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type Database = LibSQLDatabase<typeof schema>;

export function createDb(url: string, authToken?: string): {
  db: Database;
  client: Client;
} {
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema });
  return { db, client };
}

export * from './schema.js';
