import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProjectsService } from './projects.service.js';
import { AnalyzeSiteError } from './analyze-site.js';
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
const PROJECT_ID = '01a16033-3d3b-718f-b2f4-9508ec870bac';

const {
  runInTenantContextMock,
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
  const selectMock = vi.fn().mockReturnValue({ from: () => ({ where: () => [] }) });
  const getTenantDbMock = vi.fn().mockReturnValue({ insert: insertMock, update: updateMock, select: selectMock });
  const runInTenantContextMock = vi.fn(
    async (_db: unknown, _identity: unknown, fn: () => Promise<unknown>) => fn(),
  );
  return {
    runInTenantContextMock,
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
  getTenantDb: getTenantDbMock,
  schema: { projects: { id: 'projects.id' } },
  eq: vi.fn((_col: unknown, value: unknown) => ({ col: 'id', value })),
}));

vi.mock('../db/db.service.js', () => ({
  DbService: class {
    db = {};
  },
}));

const analyzeSiteMock = vi.hoisted(() => vi.fn());
vi.mock('./analyze-site.js', async (importOriginal) => {
  // Mocks analyzeSite() itself but keeps the real AnalyzeSiteError class — ProjectsService
  // does `error instanceof AnalyzeSiteError`, which needs a real class, not a mock.
  const actual = await importOriginal<typeof import('./analyze-site.js')>();
  return { ...actual, analyzeSite: analyzeSiteMock };
});

const processIconImageMock = vi.hoisted(() => vi.fn());
vi.mock('./icon.js', () => ({ processIconImage: processIconImageMock }));

describe('ProjectsService', () => {
  let storagePut: ReturnType<typeof vi.fn>;
  let storageSignedUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runInTenantContextMock.mockClear();
    getTenantDbMock
      .mockReset()
      .mockReturnValue({ insert: insertMock, update: updateMock, select: selectMock });
    insertMock.mockClear();
    valuesMock.mockClear();
    updateMock.mockClear();
    setMock.mockClear();
    whereMock.mockClear();
    selectMock.mockReset().mockReturnValue({ from: () => ({ where: () => [] }) });
    analyzeSiteMock.mockReset();
    processIconImageMock.mockReset();
    storagePut = vi.fn().mockResolvedValue(undefined);
    storageSignedUrl = vi.fn().mockResolvedValue('https://signed.example/icon.png');
  });

  async function buildService(): Promise<ProjectsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        DbService,
        { provide: OBJECT_STORAGE, useValue: { put: storagePut, signedUrl: storageSignedUrl } },
      ],
    }).compile();
    return moduleRef.get(ProjectsService);
  }

  describe('createProject', () => {
    const analysis = {
      name: 'Кофейня Уют',
      color: '#8B5E3C',
      iconBuffer: Buffer.from('icon-bytes'),
      tabs: [{ title: 'Главная', icon: 'home' as const, path: '/' }],
      hostname: 'cafe.example',
      url: 'https://cafe.example/',
    };

    it('analyzes the site, inserts a valid config, and uploads the icon', async () => {
      analyzeSiteMock.mockResolvedValue(analysis);
      const service = await buildService();

      const { id } = await service.createProject(ORG_ID, USER_ID, 'cafe.example');

      expect(analyzeSiteMock).toHaveBeenCalledWith('cafe.example');
      expect(insertMock).toHaveBeenCalled();
      const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(inserted.id).toBe(id);
      expect(inserted.orgId).toBe(ORG_ID);
      expect(inserted.name).toBe('Кофейня Уют');
      expect(inserted.sourceUrl).toBe('https://cafe.example/');
      expect(inserted.configVersion).toBe(1);
      expect((inserted.config as { tabs: unknown }).tabs).toEqual(analysis.tabs);

      expect(storagePut).toHaveBeenCalledWith(
        `orgs/${ORG_ID}/projects/${id}/icon.png`,
        analysis.iconBuffer,
        'image/png',
      );
      expect(runInTenantContextMock.mock.calls[0]?.[1]).toEqual({ orgId: ORG_ID, userId: USER_ID });
    });

    it('forwards AnalyzeSiteError.code as the BadRequestException code (e.g. UNSAFE_URL)', async () => {
      analyzeSiteMock.mockRejectedValue(
        new AnalyzeSiteError('UNSAFE_URL', 'Host resolves to a disallowed address'),
      );
      const service = await buildService();

      const error: unknown = await service
        .createProject(ORG_ID, USER_ID, 'bad.example')
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'UNSAFE_URL',
        message: 'Host resolves to a disallowed address',
      });
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('falls back to SITE_UNREACHABLE for a non-AnalyzeSiteError rejection', async () => {
      analyzeSiteMock.mockRejectedValue(new Error('something unexpected'));
      const service = await buildService();

      const error: unknown = await service
        .createProject(ORG_ID, USER_ID, 'bad.example')
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'SITE_UNREACHABLE',
      });
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  describe('listProjects', () => {
    it('queries through runInTenantContext scoped to orgId/userId', async () => {
      const rows = [
        {
          id: PROJECT_ID,
          name: 'Project',
          sourceUrl: 'https://x',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      getTenantDbMock.mockReturnValue({ select: () => chainTo(rows) });

      const service = await buildService();
      const result = await service.listProjects(ORG_ID, USER_ID);

      expect(result).toBe(rows);
      expect(runInTenantContextMock.mock.calls[0]?.[1]).toEqual({ orgId: ORG_ID, userId: USER_ID });
    });
  });

  describe('updateProject', () => {
    const existingRow = {
      id: PROJECT_ID,
      config: {
        id: PROJECT_ID,
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
      await expect(
        service.updateProject(ORG_ID, USER_ID, PROJECT_ID, { not: 'a config' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no existing project row matches projectId', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [] }) });
      const service = await buildService();
      await expect(
        service.updateProject(ORG_ID, USER_ID, PROJECT_ID, validConfig),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('overwrites id/bundleId/trial from the existing row, ignoring whatever the body sent', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [existingRow] }) });
      const service = await buildService();

      const result = await service.updateProject(ORG_ID, USER_ID, PROJECT_ID, validConfig);

      expect(result.id).toBe(PROJECT_ID);
      expect(result.bundleId).toBe('com.example.original');
      expect(result.trial).toBe(true);

      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect((setArg.config as Record<string, unknown>).id).toBe(PROJECT_ID);
      expect((setArg.config as Record<string, unknown>).bundleId).toBe('com.example.original');
      expect((setArg.config as Record<string, unknown>).trial).toBe(true);
    });

    it('updates name/config/configVersion and sourceUrl for a url-type source', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [existingRow] }) });
      const service = await buildService();
      await service.updateProject(ORG_ID, USER_ID, PROJECT_ID, validConfig);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated',
          configVersion: 1,
          sourceUrl: 'https://new.example/',
        }),
      );
    });

    it('leaves sourceUrl untouched for an html-type source', async () => {
      selectMock.mockReturnValue({ from: () => ({ where: () => [existingRow] }) });
      const htmlConfig = { ...validConfig, source: { type: 'html' as const, entry: 'index.html' } };
      const service = await buildService();
      await service.updateProject(ORG_ID, USER_ID, PROJECT_ID, htmlConfig);

      const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(setArg).not.toHaveProperty('sourceUrl');
    });
  });

  describe('uploadIcon', () => {
    it('rejects an unsupported mimetype', async () => {
      const service = await buildService();
      await expect(
        service.uploadIcon(ORG_ID, PROJECT_ID, { buffer: Buffer.from('x'), mimetype: 'image/gif' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storagePut).not.toHaveBeenCalled();
    });

    it('rejects when sharp fails to process the image', async () => {
      processIconImageMock.mockRejectedValue(new Error('bad image'));
      const service = await buildService();
      await expect(
        service.uploadIcon(ORG_ID, PROJECT_ID, { buffer: Buffer.from('x'), mimetype: 'image/png' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('processes and uploads a valid png to the project icon key', async () => {
      const processed = Buffer.from('processed');
      processIconImageMock.mockResolvedValue(processed);
      const service = await buildService();

      await service.uploadIcon(ORG_ID, PROJECT_ID, {
        buffer: Buffer.from('raw'),
        mimetype: 'image/png',
      });

      expect(storagePut).toHaveBeenCalledWith(
        `orgs/${ORG_ID}/projects/${PROJECT_ID}/icon.png`,
        processed,
        'image/png',
      );
    });
  });

  describe('getIconUrl', () => {
    it('signs the project icon key with a filename', async () => {
      const service = await buildService();
      const url = await service.getIconUrl(ORG_ID, PROJECT_ID);

      expect(url).toBe('https://signed.example/icon.png');
      expect(storageSignedUrl).toHaveBeenCalledWith(
        `orgs/${ORG_ID}/projects/${PROJECT_ID}/icon.png`,
        300,
        'icon.png',
      );
    });
  });
});
