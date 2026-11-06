#!/usr/bin/env -S npx tsx
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_SCHEMA_VERSION, parseProjectConfig } from '@mobilio/config';
import { createDb, schema, eq, runInTenantContext, getTenantDb, type Db } from '@mobilio/db';
import { createObjectStorageFromEnv, projectIconKey, type ObjectStorage } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
import { processIconImage, generateLetterAvatar } from '../src/projects/icon.js';

/**
 * Migrates the old file-storage projects (apps/web's legacy
 * data/<legacyId>/{config.json,icon.png}, from before apps/api existed) into a
 * specific org's `projects` table. Not a user-facing feature — a one-off CLI run
 * once per org that has legacy data to bring over.
 *
 * Usage: npx tsx scripts/migrate-legacy-projects.ts --org <orgId> [--dry-run] [--data-dir <path>]
 */

export type MigrationOutcome =
  | { legacyId: string; kind: 'migrated'; projectId: string }
  | { legacyId: string; kind: 'skipped'; reason: string }
  | { legacyId: string; kind: 'error'; reason: string };

export type MigrateLegacyProjectsOptions = {
  dataDir: string;
  orgId: string;
  dryRun: boolean;
  db: Db;
  storage: ObjectStorage;
};

// RLS's projects_org_isolation policy (packages/db/migrations/0001_rls.sql) keys only
// on app.org_id — app.user_id has no bearing on this table at all (no createdBy
// column, no FK). A fixed, non-user-shaped value is deliberate here: it documents
// that fact rather than implying some real user performed these writes, and avoids
// an extra query to find a real member just to satisfy runInTenantContext's signature.
const SCRIPT_ACTOR = 'legacy-migration-script';

function isLegacyIdConflict(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
  return cause?.code === '23505' && cause?.constraint === 'projects_legacy_id_unique';
}

/**
 * Idempotent via projects.legacy_id (nullable unique): each legacy project is looked
 * up by that id, scoped to the target org, before being inserted — a second run (or a
 * legacy id already migrated into this same org by an earlier run) is reported as
 * "skipped", never duplicated. A single bad legacy project (unreadable/invalid
 * config.json) is recorded as an error and does not stop the rest from migrating.
 */
export async function migrateLegacyProjects(options: MigrateLegacyProjectsOptions): Promise<MigrationOutcome[]> {
  const { dataDir, orgId, dryRun, db, storage } = options;
  const outcomes: MigrationOutcome[] = [];

  let entries: string[];
  try {
    const dirents = await readdir(dataDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (error) {
    throw new Error(`Could not read data directory ${dataDir}: ${(error as Error).message}`);
  }

  for (const legacyId of entries) {
    const dir = path.join(dataDir, legacyId);

    let raw: string;
    try {
      raw = await readFile(path.join(dir, 'config.json'), 'utf8');
    } catch (error) {
      outcomes.push({ legacyId, kind: 'error', reason: `Could not read config.json: ${(error as Error).message}` });
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      outcomes.push({ legacyId, kind: 'error', reason: `Invalid JSON in config.json: ${(error as Error).message}` });
      continue;
    }

    // A fresh id, not the legacy "p_..." string — config.id is meant to match the real
    // row's id everywhere else a project is created (see ProjectsService.createProject),
    // and the legacy string wouldn't even be a valid uuid for the projects.id column.
    const projectId = uuidv7();
    const configInput =
      data && typeof data === 'object' ? { ...(data as Record<string, unknown>), id: projectId } : data;
    const parsed = parseProjectConfig(configInput);
    if (!parsed.success) {
      outcomes.push({ legacyId, kind: 'error', reason: `Invalid config: ${parsed.errors.join('; ')}` });
      continue;
    }

    if (parsed.data.source.type !== 'url') {
      outcomes.push({ legacyId, kind: 'error', reason: `Unsupported source type: ${parsed.data.source.type}` });
      continue;
    }
    const sourceUrl = parsed.data.source.url;

    try {
      const alreadyMigrated = await runInTenantContext(db, { orgId, userId: SCRIPT_ACTOR }, async () => {
        const existing = await getTenantDb()
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(eq(schema.projects.legacyId, legacyId));
        return existing.length > 0;
      });

      if (alreadyMigrated) {
        outcomes.push({ legacyId, kind: 'skipped', reason: 'Already migrated into this org' });
        continue;
      }

      if (dryRun) {
        outcomes.push({ legacyId, kind: 'migrated', projectId });
        continue;
      }

      // Icon write first, DB insert second: an icon object with no project row
      // pointing at it is harmless (nothing ever reads an orphaned key), but a
      // project row inserted before the icon write succeeds would be permanently
      // icon-less — the legacy_id uniqueness check above makes a re-run see it as
      // "already migrated" and skip it forever, never getting a second chance at
      // the icon. Same fallback as DraftsService.claimDraft's missing-icon case: a
      // legacy project without an icon.png (or one that fails to decode) gets a
      // generated letter avatar instead of leaving the project iconless.
      let iconBuffer: Buffer;
      try {
        const rawIcon = await readFile(path.join(dir, 'icon.png'));
        iconBuffer = await processIconImage(rawIcon);
      } catch {
        iconBuffer = await generateLetterAvatar(parsed.data.name.charAt(0) || '?', parsed.data.theme.primary);
      }
      await storage.put(projectIconKey(orgId, projectId), iconBuffer, 'image/png');

      try {
        await runInTenantContext(db, { orgId, userId: SCRIPT_ACTOR }, () =>
          getTenantDb().insert(schema.projects).values({
            id: projectId,
            orgId,
            name: parsed.data.name,
            sourceUrl,
            config: parsed.data,
            configVersion: CONFIG_SCHEMA_VERSION,
            legacyId,
          }),
        );
      } catch (error) {
        // The existence check above is scoped to this org's own tenant context (RLS
        // hides every other org's rows from it), so it can't tell "never migrated
        // anywhere" apart from "migrated into a *different* org" — only the unique
        // constraint itself (global across orgs) catches the latter, as a raw
        // Postgres error that'd otherwise surface as an opaque unique-violation
        // message instead of an actionable one.
        if (isLegacyIdConflict(error)) {
          outcomes.push({ legacyId, kind: 'error', reason: 'Already migrated into another org' });
          continue;
        }
        throw error;
      }

      outcomes.push({ legacyId, kind: 'migrated', projectId });
    } catch (error) {
      outcomes.push({ legacyId, kind: 'error', reason: (error as Error).message });
    }
  }

  return outcomes;
}

export function formatReport(outcomes: MigrationOutcome[], dryRun: boolean): string {
  const migrated = outcomes.filter((o): o is Extract<MigrationOutcome, { kind: 'migrated' }> => o.kind === 'migrated');
  const skipped = outcomes.filter((o): o is Extract<MigrationOutcome, { kind: 'skipped' }> => o.kind === 'skipped');
  const errors = outcomes.filter((o): o is Extract<MigrationOutcome, { kind: 'error' }> => o.kind === 'error');

  const lines: string[] = [];
  lines.push(dryRun ? '[dry run] Would migrate:' : 'Migrated:');
  for (const o of migrated) lines.push(`  ${o.legacyId} -> ${o.projectId}`);
  lines.push('Skipped:');
  for (const o of skipped) lines.push(`  ${o.legacyId}: ${o.reason}`);
  lines.push('Errors:');
  for (const o of errors) lines.push(`  ${o.legacyId}: ${o.reason}`);
  lines.push(`Total: ${migrated.length} migrated, ${skipped.length} skipped, ${errors.length} errors`);
  return lines.join('\n');
}

function parseArgs(argv: string[]): { orgId: string; dryRun: boolean; dataDir: string } {
  let orgId: string | undefined;
  let dryRun = false;
  let dataDir = path.resolve(process.cwd(), '..', '..', 'data', 'projects');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--org') {
      orgId = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--data-dir') {
      dataDir = path.resolve(argv[++i]!);
    }
  }

  if (!orgId) {
    throw new Error('Usage: migrate-legacy-projects.ts --org <orgId> [--dry-run] [--data-dir <path>]');
  }
  return { orgId, dryRun, dataDir };
}

async function main(): Promise<void> {
  const { orgId, dryRun, dataDir } = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const { pool, db } = createDb(databaseUrl);
  try {
    // organizations_org_isolation (packages/db/migrations/0002_organizations_rls.sql)
    // only makes a row visible when app.org_id already equals that row's own id — an
    // unscoped select here would always see zero rows regardless of whether the org
    // actually exists.
    const orgExists = await runInTenantContext(db, { orgId, userId: SCRIPT_ACTOR }, async () => {
      const [org] = await getTenantDb()
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, orgId));
      return Boolean(org);
    });
    if (!orgExists) {
      throw new Error(`Organization ${orgId} does not exist`);
    }

    const storage = createObjectStorageFromEnv();
    const outcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun, db, storage });
    console.log(formatReport(outcomes, dryRun));

    if (outcomes.some((o) => o.kind === 'error')) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
