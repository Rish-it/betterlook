import 'server-only';
import {drizzle, type PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import {verifiedDatabaseUrl} from './tls';

const globalDb = globalThis as typeof globalThis & {betterlookDb?: PostgresJsDatabase<typeof schema>};
let db: PostgresJsDatabase<typeof schema> | undefined;

export function getDb() {
  const cached = db ?? globalDb.betterlookDb;
  if (cached) return cached;

  const url = verifiedDatabaseUrl('DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL is required.');

  db = drizzle(postgres(url, {prepare: false}), {schema});
  if (process.env.NODE_ENV === 'development') globalDb.betterlookDb = db;
  return db;
}
