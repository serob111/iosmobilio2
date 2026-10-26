import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ObjectNotFoundError } from '@mobilio/storage';
import { DraftsService } from './drafts.service.js';
import { hashDraftToken } from './draft-token.js';
import { AnalyzeSiteError } from '../projects/analyze-site.js';
import { DbService } from '../db/db.service.js';
import { OBJECT_STORAGE } from '../storage/object-storage.token.js';

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
const DRAFT_ID = '01a16033-3d3b-718f-b2f4-9508ec870bac';

const {
  runInTokenLookupContextMock,
  runInClaimContextMock,
  getTenantDbMock,
  insertMock,
  valuesMock,
  updateMock,
  setMock,
  whereMock,
  deleteMock,
  deleteWhereMock,
  deleteReturningMock,
  selectMock,
} = vi.hoisted(() => {
  const whereMock = vi.fn().mockReturnValue(chainTo(undefined));
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  const updateMock = vi.fn().mockReturnValue({ set: setMock });
  const valuesMock = vi.fn().mockReturnValue(chainTo(undefined));
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  const deleteReturningMock = vi.fn().mockResolvedValue([]);
  const deleteWhereMock = vi.fn().mockReturnValue({ returning: deleteReturningMock });
  const deleteMock = vi.fn().mockReturnValue({ where: deleteWhereMock });
  const selectMock = vi.fn().mockReturnValue({ from: () => ({ where: () => [] }) });
  const getTenantDbMock = vi.fn().mockReturnValue({
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    select: selectMock,
  });
  const runInTokenLookupContextMock = vi.fn(
    async (_db: unknown, _tokenHash: string, fn: () => Promise<unknown>) => fn(),
  );
  const runInClaimContextMock = vi.fn(
    async (_db: unknown, _params: unknown, fn: () => Promise<unknown>) => fn(),
  );
  return {
    runInTokenLookupContextMock,
    runInClaimContextMock,
    getTenantDbMock,
    insertMock,
    valuesMock,
    updateMock,
    setMock,
    whereMock,
    deleteMock,
    deleteWhereMock,
    deleteReturningMock,
    selectMock,
  };
});

vi.mock('@mobilio/db', () => ({
  runInTokenLookupContext: runInTokenLookupContextMock,
  runInClaimContext: runInClaimContextMock,
  getTenantDb: getTenantDbMock,
  schema: { drafts: { id: 'drafts.id', tokenHash: 'drafts.tokenHash' }, projects: { id: 'projects.id' } },
  eq: vi.fn((_col: unknown, value: unknown) => ({ col: 'id', value })),
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  gt: vi.fn((_col: unknown, value: unknown) => ({ col: 'expiresAt', gt: value })),
}));

vi.mock('../db/db.service.js', () => ({
  DbService: class {
    db = {};
  },
}));

const analyzeSiteMock = vi.hoisted(() => vi.fn());
vi.mock('../projects/analyze-site.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projects/analyze-site.js')>();
  return { ...actual, analyzeSite: analyzeSiteMock };
});

const processIconImageMock = vi.hoisted(() => vi.fn());
const generateLetterAvatarMock = vi.hoisted(() => vi.fn());
vi.mock('../projects/icon.js', () => ({
  processIconImage: processIconImageMock,
  generateLetterAvatar: generateLetterAvatarMock,
}));

describe('DraftsService', () => {
  let storagePut: ReturnType<typeof vi.fn>;
  let storageGet: ReturnType<typeof vi.fn>;
  let storageDelete: ReturnType<typeof vi.fn>;
  let storageSignedUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runInTokenLookupContextMock.mockClear();
    runInClaimContextMock.mockClear();
    getTenantDbMock.mockReset().mockReturnValue({
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
      select: selectMock,
    });
    insertMock.mockClear();
    valuesMock.mockReset().mockReturnValue(chainTo(undefined));
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockClear();
    deleteMock.mockClear();
    deleteWhereMock.mockClear();
    deleteReturningMock.mockReset().mockResolvedValue([]);
    selectMock.mockReset().mockReturnValue({ from: () => ({ where: () => [] }) });
    analyzeSiteMock.mockReset();
    processIconImageMock.mockReset();
    generateLetterAvatarMock.mockReset().mockResolvedValue(Buffer.from('avatar-bytes'));
    storagePut = vi.fn().mockResolvedValue(undefined);
    storageGet = vi.fn().mockResolvedValue(Buffer.from('icon-bytes'));
    storageDelete = vi.fn().mockResolvedValue(undefined);
    storageSignedUrl = vi.fn().mockResolvedValue('https://signed.example/icon.png');
  });

  async function buildService(): Promise<DraftsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DraftsService,
        DbService,
        {
          provide: OBJECT_STORAGE,
          useValue: { put: storagePut, get: storageGet, delete: storageDelete, signedUrl: storageSignedUrl },
        },
      ],
    }).compile();
    return moduleRef.get(DraftsService);
  }

  describe('createDraft', () => {
    const analysis = {
      name: 'Кофейня Уют',
      color: '#8B5E3C',
      iconBuffer: Buffer.from('icon-bytes'),
      tabs: [{ title: 'Главная', icon: 'home' as const, path: '/' }],
      hostname: 'cafe.example',
      url: 'https://cafe.example/',
    };

    it('analyzes the site, inserts a valid config under a fresh token, and uploads the icon', async () => {
      analyzeSiteMock.mockResolvedValue(analysis);
      const service = await buildService();

      const { rawToken } = await service.createDraft('cafe.example');

      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
      expect(analyzeSiteMock).toHaveBeenCalledWith('cafe.example');
      expect(insertMock).toHaveBeenCalled();
      const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(inserted.name).toBe('Кофейня Уют');
      expect(inserted.sourceUrl).toBe('https://cafe.example/');
      expect(inserted.configVersion).toBe(1);
      expect(typeof inserted.tokenHash).toBe('string');
      expect(inserted.expiresAt).toBeInstanceOf(Date);

      expect(storagePut).toHaveBeenCalledWith(
        `drafts/${inserted.id}/icon.png`,
        analysis.iconBuffer,
        'image/png',
      );
      // The insert's WITH CHECK policy requires the row's own token_hash to equal
      // app.lookup_token_hash for that same transaction — so the context tokenHash and
      // the inserted tokenHash must be the exact same value.
      expect(runInTokenLookupContextMock.mock.calls[0]?.[1]).toBe(inserted.tokenHash);
    });

    it('puts the icon before inserting the row (icon-first ordering)', async () => {
      analyzeSiteMock.mockResolvedValue(analysis);
      const callOrder: string[] = [];
      storagePut.mockImplementation(async () => {
        callOrder.push('put');
      });
      insertMock.mockImplementation(() => {
        callOrder.push('insert');
        return { values: valuesMock };
      });
      const service = await buildService();

      await service.createDraft('cafe.example');

      expect(callOrder).toEqual(['put', 'insert']);
    });

    it('deletes the already-put icon when the insert fails, and rethrows', async () => {
      analyzeSiteMock.mockResolvedValue(analysis);
      valuesMock.mockReturnValue(Promise.reject(new Error('db insert failed')));
      const service = await buildService();

      await expect(service.createDraft('cafe.example')).rejects.toThrow('db insert failed');
      expect(storageDelete).toHaveBeenCalledTimes(1);
      const [deletedKey] = storageDelete.mock.calls[0] as [string];
      expect(deletedKey).toMatch(/^drafts\/.+\/icon\.png$/);
    });

    it('forwards AnalyzeSiteError.code as the BadRequestException code', async () => {
      analyzeSiteMock.mockRejectedValue(new AnalyzeSiteError('UNSAFE_URL', 'Host resolves to a disallowed address'));
      const service = await buildService();

      const error: unknown = await service.createDraft('bad.example').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'UNSAFE_URL',
        message: 'Host resolves to a disallowed address',
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('falls back to SITE_UNREACHABLE for a non-AnalyzeSiteError rejection', async () => {
      analyzeSiteMock.mockRejectedValue(new Error('boom'));
      const service = await buildService();

      const error: unknown = await service.createDraft('bad.example').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'SITE_UNREACHABLE' });
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  describe('updateDraft', () => {
    const existingRow = {
      id: DRAFT_ID,
      config: {
        id: DRAFT_ID,
        bundleId: 'com.example.original',
        trial: true,
      },
    };

    const validConfig = {
      id: 'someone-elses-id',
      name: 'Updated',
      slug: 'updated',
      bundleId: 'com.evil.hijack',
      source: { type: 'url' as const, url: 'https://new.example/' },
      theme: { primary: '#000000', background: '#FFFFFF', statusBar: 'dark' as const },
      tabs: [{ title: 'Главная', icon: 'home', path: '/' }],
      features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
      allowedDomains: ['new.example'],
      trial: false,
    };

    it('rejects an invalid config with VALIDATION_ERROR', async () => {
      const service = await buildService();
      await expect(service.updateDraft('hash', DRAFT_ID, { not: 'a config' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no existing draft row matches draftId', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [] }) });
      const service = await buildService();

      await expect(service.updateDraft('hash', DRAFT_ID, validConfig)).rejects.toBeInstanceOf(NotFoundException);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('overwrites id/bundleId/trial from the existing row, ignoring whatever the body sent', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [existingRow] }) });
      const service = await buildService();

      const result = await service.updateDraft('the-token-hash', DRAFT_ID, validConfig);

      expect(result.id).toBe(DRAFT_ID);
      expect(result.bundleId).toBe('com.example.original');
      expect(result.trial).toBe(true);
      expect(runInTokenLookupContextMock.mock.calls[0]?.[1]).toBe('the-token-hash');

      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect((setArg.config as Record<string, unknown>).id).toBe(DRAFT_ID);
      expect((setArg.config as Record<string, unknown>).bundleId).toBe('com.example.original');
      expect((setArg.config as Record<string, unknown>).trial).toBe(true);
    });

    it('updates name/configVersion/sourceUrl for a url-type source', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [existingRow] }) });
      const service = await buildService();

      await service.updateDraft('hash', DRAFT_ID, validConfig);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated', configVersion: 1, sourceUrl: 'https://new.example/' }),
      );
    });

    it('leaves sourceUrl untouched for an html-type source', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [existingRow] }) });
      const htmlConfig = { ...validConfig, source: { type: 'html' as const, entry: 'index.html' } };
      const service = await buildService();
      await service.updateDraft('hash', DRAFT_ID, htmlConfig);

      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(setArg).not.toHaveProperty('sourceUrl');
    });
  });

  describe('uploadIcon', () => {
    it('rejects an unsupported mimetype', async () => {
      const service = await buildService();
      await expect(
        service.uploadIcon(DRAFT_ID, { buffer: Buffer.from('x'), mimetype: 'image/gif' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storagePut).not.toHaveBeenCalled();
    });

    it('rejects when sharp fails to process the image', async () => {
      processIconImageMock.mockRejectedValue(new Error('bad image'));
      const service = await buildService();
      await expect(
        service.uploadIcon(DRAFT_ID, { buffer: Buffer.from('x'), mimetype: 'image/png' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('processes and uploads a valid png to the draft icon key', async () => {
      const processed = Buffer.from('processed');
      processIconImageMock.mockResolvedValue(processed);
      const service = await buildService();

      await service.uploadIcon(DRAFT_ID, { buffer: Buffer.from('raw'), mimetype: 'image/png' });

      expect(storagePut).toHaveBeenCalledWith(`drafts/${DRAFT_ID}/icon.png`, processed, 'image/png');
    });
  });

  describe('getIconUrl', () => {
    it('signs the draft icon key with a filename', async () => {
      const service = await buildService();
      const url = await service.getIconUrl(DRAFT_ID);

      expect(url).toBe('https://signed.example/icon.png');
      expect(storageSignedUrl).toHaveBeenCalledWith(`drafts/${DRAFT_ID}/icon.png`, 300, 'icon.png');
    });
  });

  describe('claimDraft', () => {
    const draftRow = {
      id: DRAFT_ID,
      name: 'Draft',
      sourceUrl: 'https://x.example/',
      config: { id: DRAFT_ID, trial: true, theme: { primary: '#123456' } },
      configVersion: 1,
      tokenHash: 'the-hash',
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('throws NotFoundException and touches no storage when the pre-read finds no draft for the token', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [] }) });
      const service = await buildService();

      await expect(service.claimDraft(ORG_ID, USER_ID, 'raw-token')).rejects.toBeInstanceOf(NotFoundException);
      expect(insertMock).not.toHaveBeenCalled();
      expect(storageGet).not.toHaveBeenCalled();
      expect(storagePut).not.toHaveBeenCalled();
    });

    it('copies the icon to the new project key, deletes the draft row via DELETE...RETURNING, inserts the project, and best-effort removes the original icon', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [draftRow] }) });
      deleteReturningMock.mockResolvedValue([draftRow]);
      const service = await buildService();

      const { id: projectId } = await service.claimDraft(ORG_ID, USER_ID, 'raw-token');

      // Icon copied before the claim transaction (deleteMock/insertMock) even runs.
      expect(storageGet).toHaveBeenCalledWith(`drafts/${DRAFT_ID}/icon.png`);
      expect(storagePut).toHaveBeenCalledWith(
        `orgs/${ORG_ID}/projects/${projectId}/icon.png`,
        Buffer.from('icon-bytes'),
        'image/png',
      );

      expect(deleteMock).toHaveBeenCalled();
      expect(insertMock).toHaveBeenCalled();
      const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(inserted.id).toBe(projectId);
      expect(inserted.orgId).toBe(ORG_ID);
      expect((inserted.config as { id: string }).id).toBe(projectId);

      await Promise.resolve(); // let the fire-and-forget best-effort delete settle
      expect(storageDelete).toHaveBeenCalledWith(`drafts/${DRAFT_ID}/icon.png`);
      expect(runInClaimContextMock.mock.calls[0]?.[1]).toEqual({
        orgId: ORG_ID,
        userId: USER_ID,
        tokenHash: hashDraftToken('raw-token'),
      });
    });

    it('falls back to a generated letter avatar when the draft has no icon object (ObjectNotFoundError), without 500ing', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [draftRow] }) });
      deleteReturningMock.mockResolvedValue([draftRow]);
      storageGet.mockRejectedValue(new ObjectNotFoundError(`drafts/${DRAFT_ID}/icon.png`));
      const service = await buildService();

      const { id: projectId } = await service.claimDraft(ORG_ID, USER_ID, 'raw-token');

      expect(generateLetterAvatarMock).toHaveBeenCalledWith('D', '#123456');
      expect(storagePut).toHaveBeenCalledWith(
        `orgs/${ORG_ID}/projects/${projectId}/icon.png`,
        Buffer.from('avatar-bytes'),
        'image/png',
      );
    });

    it('rethrows a non-NotFound storage.get error instead of falling back to an avatar', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [draftRow] }) });
      storageGet.mockRejectedValue(new Error('S3 is down'));
      const service = await buildService();

      await expect(service.claimDraft(ORG_ID, USER_ID, 'raw-token')).rejects.toThrow('S3 is down');
      expect(generateLetterAvatarMock).not.toHaveBeenCalled();
      expect(storagePut).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it('404s and deletes the speculatively-copied project icon when the claim transaction finds nothing to delete (lost the race, or expired)', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [draftRow] }) });
      deleteReturningMock.mockResolvedValue([]);
      const service = await buildService();

      await expect(service.claimDraft(ORG_ID, USER_ID, 'raw-token')).rejects.toBeInstanceOf(NotFoundException);
      expect(insertMock).not.toHaveBeenCalled();
      // The copy at the project key (made before the transaction) must be cleaned up —
      // never the original draft's own icon, which is still legitimately someone else's.
      const deletedKeys = storageDelete.mock.calls.map((call) => call[0] as string);
      expect(deletedKeys.some((key) => key.includes('/projects/'))).toBe(true);
      expect(deletedKeys.some((key) => key.startsWith('drafts/'))).toBe(false);
    });

    it('deletes the speculatively-copied project icon and rethrows when the claim transaction itself throws', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [draftRow] }) });
      runInClaimContextMock.mockRejectedValueOnce(new Error('db exploded'));
      const service = await buildService();

      await expect(service.claimDraft(ORG_ID, USER_ID, 'raw-token')).rejects.toThrow('db exploded');
      const deletedKeys = storageDelete.mock.calls.map((call) => call[0] as string);
      expect(deletedKeys.some((key) => key.includes('/projects/'))).toBe(true);
    });
  });
});
