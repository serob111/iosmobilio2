import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Creates the mobilio_migrator/mobilio_app roles if they don't exist yet. Must run as
 * the cluster's bootstrap superuser (POSTGRES_BOOTSTRAP_URL) — mobilio_migrator can't
 * create itself, and this is the one step in the migration pipeline that needs
 * superuser privileges. Everything after this runs as mobilio_migrator.
 */
async function bootstrapRoles(): Promise<void> {
  const superuserUrl = process.env.POSTGRES_BOOTSTRAP_URL;
  const migratorPassword = process.env.MOBILIO_MIGRATOR_PASSWORD;
  const appPassword = process.env.MOBILIO_APP_PASSWORD;
  if (!superuserUrl || !migratorPassword || !appPassword) {
    throw new Error(
      'POSTGRES_BOOTSTRAP_URL, MOBILIO_MIGRATOR_PASSWORD and MOBILIO_APP_PASSWORD are required to run migrations',
    );
  }

  const template = readFileSync(resolve(__dirname, '../sql/0000_bootstrap_roles.sql'), 'utf8');
  const sqlText = template
    .replaceAll('__MOBILIO_MIGRATOR_PASSWORD__', escapeSqlLiteral(migratorPassword))
    .replaceAll('__MOBILIO_APP_PASSWORD__', escapeSqlLiteral(appPassword));

  const pool = new Pool({ connectionString: superuserUrl });
  try {
    await pool.query(sqlText);
  } finally {
    await pool.end();
  }
}

/** Runs Drizzle's generated migrations (tables + RLS policies) as mobilio_migrator. */
async function runMigrations(): Promise<void> {
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
  if (!migratorUrl) {
    throw new Error('MIGRATOR_DATABASE_URL is required to run migrations');
  }

  const pool = new Pool({ connectionString: migratorUrl });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, '../migrations') });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  await bootstrapRoles();
  await runMigrations();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
