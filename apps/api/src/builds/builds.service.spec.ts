import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BuildsService } from './builds.service.js';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';
import { BUILD_RUNNER, type BuildRunner } from './build-runner.js';

/** A query-builder chain stub: any method call returns itself, and awaiting it resolves to `result`. */
function chainTo(result: unknown): unknown {
  const target = () => chainTo(result);
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(result);
      }
      return () => chainTo(result);
    },
    apply() {
      return chainTo(result);
    },
  });
}

const ORG_ID = '01a16033-3d3b-718f-b2f4-9508ec870bab';
const USER_ID = 'user-1';
const PROJECT_ID = '01a16033-3d3b-718f-b2f4-9508ec870bac';
const BUILD_ID = '01a16033-3d3b-718f-b2f4-9508ec870bad';

const {
  runInTenantContextMock,
  runInBuildContextMock,
  getTenantDbMock,
  insertMock,
  valuesMock,
  updateMock,
  setMock,
  whereMock,
  selectMock,
} = vi.hoisted(() => {
  const whereMock = vi.fn().mockReturnValue(chainTo(undefined));
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });
  const valuesMock = vi.fn().mockReturnValue(chainTo(undefined));
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const selectMock = vi.fn().mockReturnValue({ from: () => ({ where: () => chainTo([]) }) });
  const getTenantDbMock = vi.fn().mockReturnValue({
    insert: insertMock,
    update: updateMock,
    select: selectMock,
  });
  const runInTenantContextMock = vi.fn(async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn());
  const runInBuildContextMock = vi.fn();
  return {
    runInTenantContextMock,
    runInBuildContextMock,
    getTenantDbMock,
    insertMock,
    valuesMock,
    updateMock,
    setMock,
    whereMock,
    selectMock,
  };
});

vi.mock('@mobilio/db', () => ({
  runInTenantContext: runInTenantContextMock,
  runInBuildContext: runInBuildContextMock,
  getTenantDb: getTenantDbMock,
  schema: {
    builds: { id: 'builds.id', projectId: 'builds.projectId', createdAt: 'builds.createdAt' },
    projects: { id: 'projects.id' },
  },
  eq: vi.fn((_col: unknown, value: unknown) => ({ col: 'eq', value })),
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
}));

vi.mock('../db/db.service.js', () => ({
  DbService: class {
    db = {};
  },
}));

describe('BuildsService', () => {
  let storagePut: ReturnType<typeof vi.fn>;
  let storagePutStream: ReturnType<typeof vi.fn>;
  let storageDelete: ReturnType<typeof vi.fn>;
  let storageSignedUrl: ReturnType<typeof vi.fn>;
  let buildRunner: { dispatch: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    runInTenantContextMock.mockClear();
    runInBuildContextMock.mockReset();
    getTenantDbMock.mockReset().mockReturnValue({ insert: insertMock, update: updateMock, select: selectMock });
    insertMock.mockClear();
    valuesMock.mockReset().mockReturnValue(chainTo(undefined));
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockReset().mockReturnValue(chainTo(undefined));
    selectMock.mockReset().mockReturnValue({ from: () => ({ where: () => chainTo([]) }) });
    storagePut = vi.fn().mockResolvedValue(undefined);
    storagePutStream = vi.fn().mockImplementation(async (_key: string, stream: NodeJS.ReadableStream) => {
      // Drain the stream so the pipeline actually runs the validation transform (and
      // can reject before "uploading" anything), matching real putStream semantics.
      const chunks: unknown[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    });
    storageDelete = vi.fn().mockResolvedValue(undefined);
    storageSignedUrl = vi.fn().mockResolvedValue('https://signed.example/app.ipa');
    buildRunner = { dispatch: vi.fn().mockResolvedValue(undefined) };
  });

  async function buildService(): Promise<BuildsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BuildsService,
        DbService,
        {
          provide: OBJECT_STORAGE,
          useValue: { put: storagePut, putStream: storagePutStream, delete: storageDelete, signedUrl: storageSignedUrl },
        },
        { provide: BUILD_RUNNER, useValue: buildRunner as unknown as BuildRunner },
      ],
    }).compile();
    return moduleRef.get(BuildsService);
  }

  describe('createBuild', () => {
    it('inserts a queued build, dispatches it, and returns {id, status}', async () => {
      const service = await buildService();
      const result = await service.createBuild(ORG_ID, USER_ID, PROJECT_ID, 'https://api.example.com');

      expect(result.status).toBe('queued');
      expect(insertMock).toHaveBeenCalled();
      const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(inserted.id).toBe(result.id);
      expect(inserted.orgId).toBe(ORG_ID);
      expect(inserted.projectId).toBe(PROJECT_ID);
      expect(inserted.status).toBe('queued');
      expect(typeof inserted.tokenHash).toBe('string');

      expect(buildRunner.dispatch).toHaveBeenCalledWith({
        id: result.id,
        token: expect.stringMatching(/^[0-9a-f]{64}$/),
        baseUrl: 'https://api.example.com',
      });
    });

    it('maps a unique-violation on the active-build index to 409 BUILD_IN_PROGRESS', async () => {
      valuesMock.mockReturnValueOnce(
        Promise.reject(Object.assign(new Error('db error'), { cause: { code: '23505', constraint: 'builds_one_active_per_project' } })),
      );
      const service = await buildService();

      const error: unknown = await service.createBuild(ORG_ID, USER_ID, PROJECT_ID, 'https://api.example.com').catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'BUILD_IN_PROGRESS' });
      expect(buildRunner.dispatch).not.toHaveBeenCalled();
    });

    it('rethrows an unrelated insert error untouched', async () => {
      valuesMock.mockReturnValueOnce(Promise.reject(new Error('connection reset')));
      const service = await buildService();

      await expect(service.createBuild(ORG_ID, USER_ID, PROJECT_ID, 'https://api.example.com')).rejects.toThrow(
        'connection reset',
      );
    });

    it('marks the build failed and throws 502 BUILD_DISPATCH_FAILED when the runner dispatch rejects', async () => {
      buildRunner.dispatch.mockRejectedValue(new Error('GitHub is down'));
      const service = await buildService();

      const error: unknown = await service.createBuild(ORG_ID, USER_ID, PROJECT_ID, 'https://api.example.com').catch((e) => e);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).getResponse()).toMatchObject({ code: 'BUILD_DISPATCH_FAILED' });

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', tokenHash: null, tokenExpiresAt: null }),
      );
    });
  });

  describe('startBuild', () => {
    it('transitions queued -> building and records runId/runUrl', async () => {
      const build = { id: BUILD_ID, status: 'queued', startedAt: null };
      runInBuildContextMock.mockImplementation(async (_db: unknown, _hash: string, fn: (b: typeof build) => unknown) => {
        whereMock.mockReturnValueOnce(chainTo([{ ...build, status: 'building', runId: 42, runUrl: 'https://run' }]));
        return fn(build);
      });

      const service = await buildService();
      const result = await service.startBuild('hash', 42, 'https://run');

      expect(result.status).toBe('building');
      expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'building', runId: 42, runUrl: 'https://run' }));
    });

    it('is idempotent when called again while already building', async () => {
      const build = { id: BUILD_ID, status: 'building', startedAt: new Date('2024-01-01') };
      runInBuildContextMock.mockImplementation(async (_db: unknown, _hash: string, fn: (b: typeof build) => unknown) => {
        whereMock.mockReturnValueOnce(chainTo([{ ...build, runId: 42, runUrl: 'https://run' }]));
        return fn(build);
      });

      const service = await buildService();
      const result = await service.startBuild('hash', 42, 'https://run');
      expect(result.status).toBe('building');
      // startedAt is preserved, not overwritten, on a repeat call.
      expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ startedAt: build.startedAt }));
    });

    it('throws 409 INVALID_BUILD_STATE when the build already finished', async () => {
      const build = { id: BUILD_ID, status: 'done', startedAt: new Date() };
      runInBuildContextMock.mockImplementation(async (_db: unknown, _hash: string, fn: (b: typeof build) => unknown) =>
        fn(build),
      );

      const service = await buildService();
      const error: unknown = await service.startBuild('hash', 1, 'https://run').catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'INVALID_BUILD_STATE' });
    });

    it('throws 404 BUILD_NOT_FOUND when the token resolves to nothing', async () => {
      runInBuildContextMock.mockResolvedValue(undefined);
      const service = await buildService();
      await expect(service.startBuild('hash', 1, 'https://run')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getBuildConfig', () => {
    it('returns the project config and the build template version', async () => {
      const build = { id: BUILD_ID, projectId: PROJECT_ID, templateVersion: '1' };
      selectMock.mockReturnValue({ from: () => ({ where: () => chainTo([{ config: { name: 'App' } }]) }) });
      runInBuildContextMock.mockImplementation(async (_db: unknown, _hash: string, fn: (b: typeof build) => unknown) =>
        fn(build),
      );

      const service = await buildService();
      const result = await service.getBuildConfig('hash');
      expect(result).toEqual({ config: { name: 'App' }, templateVersion: '1' });
    });

    it('throws 404 BUILD_NOT_FOUND when the token resolves to nothing', async () => {
      runInBuildContextMock.mockResolvedValue(undefined);
      const service = await buildService();
      await expect(service.getBuildConfig('hash')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('uploadIpa', () => {
    const buildRef = { id: BUILD_ID, orgId: ORG_ID, projectId: PROJECT_ID, status: 'building' };

    it('throws 409 before touching storage when the build is not building', async () => {
      const service = await buildService();
      await expect(
        service.uploadIpa('hash', { ...buildRef, status: 'queued' }, chainTo(undefined) as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(storagePut).not.toHaveBeenCalled();
    });

    it('404s and cleans up the orphaned icon when the race is lost (build no longer building by the time of the final update)', async () => {
      const { Readable } = await import('node:stream');
      runInBuildContextMock.mockImplementation(
        async (_db: unknown, _hash: string, fn: (b: { status: string }) => unknown) => fn({ status: 'done' }),
      );
      const service = await buildService();

      const zipStream = Readable.from([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('rest')]);
      await expect(service.uploadIpa('hash', buildRef, zipStream)).rejects.toBeInstanceOf(ConflictException);
      expect(storageDelete).toHaveBeenCalled();
    });

    it('gives every call its own storage key, even for the exact same build', async () => {
      const { Readable } = await import('node:stream');
      runInBuildContextMock.mockImplementation(
        async (_db: unknown, _hash: string, fn: (b: { status: string }) => unknown) => fn({ status: 'building' }),
      );
      whereMock.mockReturnValue(chainTo([{ id: BUILD_ID, status: 'done' }]));
      const service = await buildService();

      const zip = () => Readable.from([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('rest')]);
      await service.uploadIpa('hash', buildRef, zip());
      await service.uploadIpa('hash', buildRef, zip());

      const [firstKey] = storagePutStream.mock.calls[0]!;
      const [secondKey] = storagePutStream.mock.calls[1]!;
      expect(firstKey).not.toBe(secondKey);
      // The build's own ipaKey is set to whichever specific attempt's key won the
      // database race — never a static key recomputed from org/project/build alone.
      expect(setMock.mock.calls[0]![0]).toMatchObject({ ipaKey: firstKey });
      expect(setMock.mock.calls[1]![0]).toMatchObject({ ipaKey: secondKey });
    });

    it("on a lost race, deletes exactly this attempt's own key, never a shared/static one", async () => {
      const { Readable } = await import('node:stream');
      runInBuildContextMock.mockImplementation(
        async (_db: unknown, _hash: string, fn: (b: { status: string }) => unknown) => fn({ status: 'done' }),
      );
      const service = await buildService();

      const zipStream = Readable.from([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('rest')]);
      await expect(service.uploadIpa('hash', buildRef, zipStream)).rejects.toBeInstanceOf(ConflictException);

      const [uploadedKey] = storagePutStream.mock.calls[0]!;
      expect(storageDelete).toHaveBeenCalledWith(uploadedKey);
    });
  });

  describe('failBuild', () => {
    it('transitions queued/building -> failed with a truncated error', async () => {
      const build = { id: BUILD_ID, status: 'building' };
      runInBuildContextMock.mockImplementation(async (_db: unknown, _hash: string, fn: (b: typeof build) => unknown) => {
        whereMock.mockReturnValueOnce(chainTo([{ ...build, status: 'failed' }]));
        return fn(build);
      });

      const service = await buildService();
      const longError = 'x'.repeat(3000);
      await service.failBuild('hash', longError);

      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect((setArg.error as string).length).toBe(2000);
      expect(setArg.status).toBe('failed');
      expect(setArg.tokenHash).toBeNull();
    });

    it('throws 409 when the build already finished', async () => {
      const build = { id: BUILD_ID, status: 'done' };
      runInBuildContextMock.mockImplementation(async (_db: unknown, _hash: string, fn: (b: typeof build) => unknown) =>
        fn(build),
      );
      const service = await buildService();
      await expect(service.failBuild('hash', 'oops')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getIpaUrl', () => {
    it('throws 404 IPA_NOT_READY when the build is not done', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => chainTo([{ id: BUILD_ID, status: 'building', ipaKey: null }]) }) });
      const service = await buildService();
      await expect(service.getIpaUrl(ORG_ID, USER_ID, PROJECT_ID, BUILD_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 IPA_NOT_READY when done but somehow has no ipaKey', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => chainTo([{ id: BUILD_ID, status: 'done', ipaKey: null }]) }) });
      const service = await buildService();
      await expect(service.getIpaUrl(ORG_ID, USER_ID, PROJECT_ID, BUILD_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns a signed url for the build's own recorded ipaKey (not a recomputed static key), named after the project slug", async () => {
      let call = 0;
      const winningKey = `orgs/${ORG_ID}/projects/${PROJECT_ID}/builds/${BUILD_ID}/app.ipa-some-attempt-uuid`;
      selectMock.mockImplementation(() => ({
        from: () => ({
          where: () =>
            chainTo(
              call++ === 0
                ? [{ id: BUILD_ID, status: 'done', ipaKey: winningKey }]
                : [{ config: { slug: 'cafe-uyut' } }],
            ),
        }),
      }));
      const service = await buildService();
      const url = await service.getIpaUrl(ORG_ID, USER_ID, PROJECT_ID, BUILD_ID);
      expect(url).toBe('https://signed.example/app.ipa');
      expect(storageSignedUrl).toHaveBeenCalledWith(winningKey, 300, 'cafe-uyut.ipa');
    });
  });
});
