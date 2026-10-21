import { Test } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service.js';
import { DbService } from '../db/db.service.js';

const { runInTenantContextMock, getTenantDbMock, insertMock, valuesMock } = vi.hoisted(() => {
  const valuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const getTenantDbMock = vi.fn().mockReturnValue({ insert: insertMock });
  const runInTenantContextMock = vi.fn(async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn());
  return { runInTenantContextMock, getTenantDbMock, insertMock, valuesMock };
});

vi.mock('@mobilio/db', () => ({
  runInTenantContext: runInTenantContextMock,
  getTenantDb: getTenantDbMock,
  schema: { organizations: 'organizations-table', memberships: 'memberships-table' },
}));

vi.mock('@mobilio/config', () => ({
  slugify: (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));

vi.mock('../db/db.service.js', () => ({
  DbService: class {
    db = {};
  },
}));

describe('OrganizationsService', () => {
  beforeEach(() => {
    runInTenantContextMock.mockClear();
    getTenantDbMock.mockClear();
    insertMock.mockClear();
    valuesMock.mockClear();
  });

  async function buildService(): Promise<OrganizationsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [OrganizationsService, DbService],
    }).compile();
    return moduleRef.get(OrganizationsService);
  }

  it('uses the given name for the org display name and slug', async () => {
    const service = await buildService();
    await service.createPersonalOrganization('user-1', 'Ada Lovelace', 'ada@example.com');

    expect(valuesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "Ada Lovelace's workspace" }),
    );
    const orgInsertArg = valuesMock.mock.calls[0]?.[0] as { slug: string };
    expect(orgInsertArg.slug.startsWith('ada-lovelace-')).toBe(true);
  });

  it('falls back to the email local-part when name is blank (magic-link signups)', async () => {
    const service = await buildService();
    await service.createPersonalOrganization('user-1', '', 'ada@example.com');

    expect(valuesMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "ada's workspace" }));
  });

  it('creates the membership as owner for the same org/user', async () => {
    const service = await buildService();
    const { orgId } = await service.createPersonalOrganization('user-1', 'Ada', 'ada@example.com');

    expect(valuesMock).toHaveBeenNthCalledWith(2, { userId: 'user-1', orgId, role: 'owner' });
  });

  it('runs both inserts inside the same tenant context, scoped to the new org', async () => {
    const service = await buildService();
    const { orgId } = await service.createPersonalOrganization('user-1', 'Ada', 'ada@example.com');

    expect(runInTenantContextMock).toHaveBeenCalledTimes(1);
    expect(runInTenantContextMock.mock.calls[0]?.[1]).toEqual({ orgId, userId: 'user-1' });
  });
});
