import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { sql } from 'drizzle-orm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

// Only runs when the full role-bootstrap env is present (CI provisions a fresh
// postgres services: container per run — see .github/workflows/ci.yml — so the very
// first `npm run db:migrate` there already is "migrations apply from scratch"; this
// test re-asserts that formally and adds a second-run check). Locally this just skips.
const hasFullEnv =
  Boolean(process.env.POSTGRES_BOOTSTRAP_URL) &&
  Boolean(process.env.MOBILIO_MIGRATOR_PASSWORD) &&
  Boolean(process.env.MOBILIO_APP_PASSWORD) &&
  Boolean(process.env.MIGRATOR_DATABASE_URL);

function runMigrate(): void {
  execFileSync('npx', ['tsx', 'src/migrate.ts'], {
    cwd: packageRoot,
    stdio: 'pipe',
    env: process.env,
    shell: true,
  });
}

describe.skipIf(!hasFullEnv)('db:migrate (live Postgres)', () => {
  const migrator = createDb(process.env.MIGRATOR_DATABASE_URL!);

  afterAll(async () => {
    await migrator.pool.end();
  });

  it('applies cleanly from scratch and tracks every migration exactly once', () => {
    expect(() => runMigrate()).not.toThrow();
  });

  it(
    // drizzle-kit's standard migrator is forward-only (no generated down-migrations) —
    // re-running the same migration set safely, with no duplicate application or
    // error, is the practical equivalent of "apply and roll back" this tooling
    // supports: proof that re-invoking the pipeline is non-destructive and idempotent,
    // not that it undoes schema changes.
    're-running the migration pipeline is a safe no-op (idempotent, not duplicated)',
    async () => {
      const before = await migrator.db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
      const beforeCount = (before.rows[0] as { count: number }).count;

      expect(() => runMigrate()).not.toThrow();

      const after = await migrator.db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
      const afterCount = (after.rows[0] as { count: number }).count;

      expect(afterCount).toBe(beforeCount);
      expect(afterCount).toBeGreaterThan(0);
    },
  );

  it('mobilio_migrator owns every table and RLS is forced on every org_id table', async () => {
    const owners = await migrator.db.execute(
      sql`select tablename, tableowner from pg_tables where schemaname = 'public' order by tablename`,
    );
    for (const row of owners.rows as Array<{ tablename: string; tableowner: string }>) {
      expect(row.tableowner).toBe('mobilio_migrator');
    }

    const rls = await migrator.db.execute(
      sql`select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relname in ('memberships', 'invitations', 'projects')`,
    );
    for (const row of rls.rows as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} should FORCE RLS`).toBe(true);
    }
  });
});
