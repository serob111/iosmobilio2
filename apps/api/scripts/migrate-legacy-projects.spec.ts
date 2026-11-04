import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { eq, schema, runInTenantContext, getTenantDb, type Db } from '@mobilio/db';
import type { ObjectStorage } from '@mobilio/storage';
import { uuidv7 } from 'uuidv7';
import { migrateLegacyProjects, formatReport, type MigrationOutcome } from './migrate-legacy-projects.js';

// Same opt-in-via-env-presence pattern as every other *.integration.spec.ts in this
// repo: skips locally without a live Postgres, hard-fails in CI (REQUIRE_LIVE_SERVICES)
// if the env is misconfigured rather than silently running 0 tests.
const hasLiveServices = Boolean(process.env.DATABASE_URL);
if (!hasLiveServices && process.env.REQUIRE_LIVE_SERVICES === 'true') {
  throw new Error('REQUIRE_LIVE_SERVICES=true but DATABASE_URL is not set');
}

function fakeStorage(): { storage: ObjectStorage; puts: Array<{ key: string; body: Buffer }> } {
  const puts: Array<{ key: string; body: Buffer }> = [];
  const storage: ObjectStorage = {
    put: async (key, body) => {
      puts.push({ key, body });
    },
    putStream: async () => {
      throw new Error('not used by this script');
    },
    get: async () => {
      throw new Error('not used by this script');
    },
    getStream: async () => {
      throw new Error('not used by this script');
    },
    delete: async () => {},
    signedUrl: async () => {
      throw new Error('not used by this script');
    },
  };
  return { storage, puts };
}

const validConfig = (overrides: Record<string, unknown> = {}) => ({
  id: 'placeholder-overwritten-by-the-script',
  name: 'Legacy Cafe',
  slug: 'legacy-cafe',
  bundleId: 'am.mobilio.app.legacycafe',
  source: { type: 'url', url: 'https://legacy-cafe.example' },
  theme: { primary: '#336699', background: '#FFFFFF', statusBar: 'dark' },
  tabs: [{ title: 'Menu', icon: 'grid', path: '/menu' }],
  features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
  allowedDomains: ['legacy-cafe.example'],
  trial: true,
  ...overrides,
});

describe.skipIf(!hasLiveServices)('migrate-legacy-projects (live Postgres)', () => {
  let db: Db;
  let orgId: string;
  let dataDir: string;

  beforeAll(async () => {
    const { createDb } = await import('@mobilio/db');
    ({ db } = createDb(process.env.DATABASE_URL!));

    // organizations_org_isolation (0002_organizations_rls.sql) only allows an insert
    // that satisfies its own policy: app.org_id must already equal the row's own id,
    // so the id is generated up front rather than left to the column's default.
    orgId = uuidv7();
    await runInTenantContext(db, { orgId, userId: 'test-setup' }, () =>
      getTenantDb()
        .insert(schema.organizations)
        .values({ id: orgId, name: 'Legacy Migration Test Org', slug: `legacy-migration-itest-${Date.now()}` }),
    );
  });

  afterAll(async () => {
    await runInTenantContext(db, { orgId, userId: 'test-setup' }, () =>
      getTenantDb().delete(schema.organizations).where(eq(schema.organizations.id, orgId)),
    );
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'mobilio-legacy-migration-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  async function writeFixture(legacyId: string, config: unknown, icon?: Buffer): Promise<void> {
    const dir = path.join(dataDir, legacyId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
    if (icon) {
      await writeFile(path.join(dir, 'icon.png'), icon);
    }
  }

  function outcomeFor(outcomes: MigrationOutcome[], legacyId: string): MigrationOutcome {
    const found = outcomes.find((o) => o.legacyId === legacyId);
    if (!found) throw new Error(`No outcome for ${legacyId}`);
    return found;
  }

  /** projects_org_isolation (0001_rls.sql) requires app.org_id set to see any row at all. */
  function selectProjects<T>(query: (db: Db) => Promise<T>): Promise<T> {
    return runInTenantContext(db, { orgId, userId: 'test-setup' }, () => query(getTenantDb()));
  }

  it('dry-run reports what would migrate but writes nothing to the DB or storage', async () => {
    await writeFixture('legacy-with-icon', validConfig({ name: 'With Icon' }));
    const icon = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    await writeFixture('legacy-with-icon', validConfig({ name: 'With Icon' }), icon);
    await writeFixture('legacy-broken-json', '{ not valid json');
    await writeFixture('legacy-invalid-config', { name: 'Missing required fields' });

    const { storage, puts } = fakeStorage();
    const outcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun: true, db, storage });

    expect(outcomeFor(outcomes, 'legacy-with-icon').kind).toBe('migrated');
    expect(outcomeFor(outcomes, 'legacy-broken-json').kind).toBe('error');
    expect(outcomeFor(outcomes, 'legacy-invalid-config').kind).toBe('error');
    expect(puts).toHaveLength(0);

    const rows = await selectProjects((scoped) => scoped.select().from(schema.projects).where(eq(schema.projects.orgId, orgId)));
    expect(rows).toHaveLength(0);
  });

  it('a broken-JSON legacy project is reported as an error and does not crash the script', async () => {
    await writeFixture('legacy-broken-json', '{ this is not json at all');
    await writeFixture('legacy-ok', validConfig({ name: 'Still Migrates' }));

    const { storage } = fakeStorage();
    const outcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun: false, db, storage });

    const broken = outcomeFor(outcomes, 'legacy-broken-json');
    expect(broken.kind).toBe('error');
    expect((broken as Extract<MigrationOutcome, { kind: 'error' }>).reason).toMatch(/Invalid JSON/);
    expect(outcomeFor(outcomes, 'legacy-ok').kind).toBe('migrated');
  });

  it('a real run creates the project + icon, falling back to a generated avatar when icon.png is missing', async () => {
    await writeFixture('legacy-no-icon', validConfig({ name: 'No Icon Here', slug: 'no-icon-here' }));

    const { storage, puts } = fakeStorage();
    const outcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun: false, db, storage });

    const outcome = outcomeFor(outcomes, 'legacy-no-icon');
    expect(outcome.kind).toBe('migrated');
    const projectId = (outcome as Extract<MigrationOutcome, { kind: 'migrated' }>).projectId;

    const [row] = await selectProjects((scoped) => scoped.select().from(schema.projects).where(eq(schema.projects.id, projectId)));
    expect(row?.name).toBe('No Icon Here');
    expect(row?.legacyId).toBe('legacy-no-icon');
    expect(row?.orgId).toBe(orgId);
    expect((row?.config as { source: { url: string } }).source.url).toBe('https://legacy-cafe.example');

    expect(puts.some((p) => p.key.includes(projectId))).toBe(true);
  });

  it('running the script twice does not duplicate: the second run skips everything already migrated', async () => {
    await writeFixture('legacy-twice', validConfig({ name: 'Migrate Me Once', slug: 'migrate-me-once' }));

    const first = fakeStorage();
    const firstOutcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun: false, db, storage: first.storage });
    expect(outcomeFor(firstOutcomes, 'legacy-twice').kind).toBe('migrated');
    expect(first.puts).toHaveLength(1);

    const second = fakeStorage();
    const secondOutcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun: false, db, storage: second.storage });
    const secondOutcome = outcomeFor(secondOutcomes, 'legacy-twice');
    expect(secondOutcome.kind).toBe('skipped');
    // Skipped before the icon step — no second upload for an id that was never (re-)inserted.
    expect(second.puts).toHaveLength(0);

    const rows = await selectProjects((scoped) =>
      scoped.select().from(schema.projects).where(eq(schema.projects.legacyId, 'legacy-twice')),
    );
    expect(rows).toHaveLength(1);
  });

  it('a dry-run that would skip an already-migrated project reports it as skipped, not migrated again', async () => {
    await writeFixture('legacy-dry-after-real', validConfig({ name: 'Real Then Dry', slug: 'real-then-dry' }));

    const real = fakeStorage();
    await migrateLegacyProjects({ dataDir, orgId, dryRun: false, db, storage: real.storage });

    const dry = fakeStorage();
    const outcomes = await migrateLegacyProjects({ dataDir, orgId, dryRun: true, db, storage: dry.storage });
    expect(outcomeFor(outcomes, 'legacy-dry-after-real').kind).toBe('skipped');
    expect(dry.puts).toHaveLength(0);
  });

  it('formatReport summarizes migrated/skipped/error counts', () => {
    const outcomes: MigrationOutcome[] = [
      { legacyId: 'a', kind: 'migrated', projectId: 'proj-a' },
      { legacyId: 'b', kind: 'skipped', reason: 'Already migrated into this org' },
      { legacyId: 'c', kind: 'error', reason: 'Invalid JSON in config.json: boom' },
    ];
    const report = formatReport(outcomes, false);
    expect(report).toContain('a -> proj-a');
    expect(report).toContain('b: Already migrated into this org');
    expect(report).toContain('c: Invalid JSON in config.json: boom');
    expect(report).toContain('Total: 1 migrated, 1 skipped, 1 errors');
  });
});
