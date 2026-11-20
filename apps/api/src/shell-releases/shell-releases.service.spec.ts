import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ObjectStorage } from '@mobilio/storage';
import { ShellReleasesService } from './shell-releases.service.js';
import type { DbService } from '../db/db.service.js';

const UPLOAD_CONTENT = Buffer.from('fake ipa bytes');
const UPLOAD_SHA256 = createHash('sha256').update(UPLOAD_CONTENT).digest('hex');

type FakeRow = {
  id: string;
  version: string;
  ipaKey: string;
  manifest: Record<string, unknown>;
  sha256: string;
  isActive: boolean;
  createdAt: Date;
};

function fakeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'row-1',
    version: 'v1',
    ipaKey: 'shell-base/v1/base.ipa',
    manifest: {},
    sha256: UPLOAD_SHA256,
    isActive: false,
    createdAt: new Date(),
    ...overrides,
  };
}

/** selectResults[0] backs register()'s "does this version already exist" check; selectResults[1] backs the race-recovery re-select after a unique-violation. */
function fakeDbService(selectResults: Array<FakeRow[]>, insertOutcome: { row?: FakeRow; error?: unknown }): DbService {
  let call = 0;
  const select = () => ({
    from: () => ({
      where: () => Promise.resolve(selectResults[Math.min(call++, selectResults.length - 1)] ?? []),
    }),
  });
  const insert = () => ({
    values: () => ({
      returning: () =>
        insertOutcome.error ? Promise.reject(insertOutcome.error) : Promise.resolve([insertOutcome.row]),
    }),
  });
  return { db: { select, insert } } as unknown as DbService;
}

function fakeStorage(): ObjectStorage {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    putStream: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    getStream: vi.fn().mockResolvedValue(Readable.from(UPLOAD_CONTENT)),
    delete: vi.fn().mockResolvedValue(undefined),
    signedUrl: vi.fn(),
    copy: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
  };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key'), {
    cause: { code: '23505', constraint: 'shell_releases_version_unique' },
  });
}

describe('ShellReleasesService.register', () => {
  it('throws VALIDATION_ERROR when registering a brand-new version without an uploadId', async () => {
    const service = new ShellReleasesService(fakeDbService([[]], {}), fakeStorage());
    await expect(service.register('v1', {}, UPLOAD_SHA256, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recovers from a lost race (concurrent insert of the same brand-new version) by re-reading the winner — same sha256 returns unchanged', async () => {
    const winner = fakeRow();
    const dbService = fakeDbService([[], [winner]], { error: uniqueViolation() });
    const service = new ShellReleasesService(dbService, fakeStorage());

    const result = await service.register('v1', {}, UPLOAD_SHA256, 'c7b5f3f0-0000-7000-8000-000000000000');
    expect(result).toEqual({ status: 'unchanged', release: expect.objectContaining({ version: 'v1', sha256: UPLOAD_SHA256 }) });
  });

  it('recovers from a lost race, and rejects with SHELL_RELEASE_IMMUTABLE when the winner has a different sha256', async () => {
    const winner = fakeRow({ sha256: 'f'.repeat(64) });
    const dbService = fakeDbService([[], [winner]], { error: uniqueViolation() });
    const service = new ShellReleasesService(dbService, fakeStorage());

    await expect(service.register('v1', {}, UPLOAD_SHA256, 'c7b5f3f0-0000-7000-8000-000000000000')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('re-throws an insert error that is not the version-uniqueness violation, rather than misclassifying it as a race', async () => {
    const dbService = fakeDbService([[]], { error: new Error('connection reset') });
    const service = new ShellReleasesService(dbService, fakeStorage());

    await expect(service.register('v1', {}, UPLOAD_SHA256, 'c7b5f3f0-0000-7000-8000-000000000000')).rejects.toThrow(
      'connection reset',
    );
  });

  it('creates the row on a clean insert with no conflict', async () => {
    const row = fakeRow();
    const dbService = fakeDbService([[]], { row });
    const service = new ShellReleasesService(dbService, fakeStorage());

    const result = await service.register('v1', {}, UPLOAD_SHA256, 'c7b5f3f0-0000-7000-8000-000000000000');
    expect(result.status).toBe('created');
  });
});
