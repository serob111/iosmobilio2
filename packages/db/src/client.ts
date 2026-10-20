import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Connects as whichever role the given connection string authenticates as — callers
 * decide which role that is (app runtime uses the `mobilio_app` role's URL; migrations
 * use `mobilio_migrator`'s). This package has no opinion on role selection beyond RLS
 * itself trusting Postgres to enforce it, not the connection string.
 */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
