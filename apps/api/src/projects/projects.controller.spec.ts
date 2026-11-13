import { PassThrough, Readable } from 'node:stream';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ObjectNotFoundError } from '@mobilio/storage';
import { ProjectsController } from './projects.controller.js';
import type { ProjectsService } from './projects.service.js';

function fakeService(
  overrides: Partial<Record<keyof ProjectsService, ReturnType<typeof vi.fn>>> = {},
) {
  return {
    createProject: vi.fn(),
    listProjects: vi.fn(),
    updateProject: vi.fn(),
    uploadIcon: vi.fn(),
    getIconStream: vi.fn(),
    ...overrides,
  } as unknown as ProjectsService;
}

function fakeStreamResponse() {
  const stream = new PassThrough();
  return Object.assign(stream, { set: vi.fn(), headersSent: false });
}

/** Pushes `chunks` in order, then destroys with `error` on the next read — simulating an upstream stream that fails partway (or immediately, for an empty chunks array) through delivery. */
function erroringStream(chunks: Buffer[], error: Error): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i < chunks.length) {
        this.push(chunks[i++]!);
      } else {
        process.nextTick(() => this.destroy(error));
      }
    },
  });
}

const projectStub = { id: 'project-1' };
const request = { tenant: { orgId: 'org-1', userId: 'user-1' }, project: projectStub } as never;

describe('ProjectsController', () => {
  describe('create', () => {
    it('requires a url', async () => {
      const controller = new ProjectsController(fakeService());
      await expect(controller.create(request, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delegates to the service with the tenant from OrgGuard', async () => {
      const createProject = vi.fn().mockResolvedValue({ id: 'project-1' });
      const controller = new ProjectsController(fakeService({ createProject }));

      const result = await controller.create(request, { url: 'example.com' });

      expect(result).toEqual({ id: 'project-1' });
      expect(createProject).toHaveBeenCalledWith('org-1', 'user-1', 'example.com');
    });
  });

  describe('list', () => {
    it('delegates to the service scoped to the tenant', async () => {
      const rows = [{ id: 'project-1' }];
      const listProjects = vi.fn().mockResolvedValue(rows);
      const controller = new ProjectsController(fakeService({ listProjects }));

      await expect(controller.list(request)).resolves.toBe(rows);
      expect(listProjects).toHaveBeenCalledWith('org-1', 'user-1');
    });
  });

  describe('getOne', () => {
    it('returns request.project, already fetched by ProjectGuard', () => {
      const controller = new ProjectsController(fakeService());
      expect(controller.getOne(request)).toBe(projectStub);
    });
  });

  describe('update', () => {
    it('delegates to the service with the tenant and path projectId', async () => {
      const updated = { id: 'project-1', name: 'New' };
      const updateProject = vi.fn().mockResolvedValue(updated);
      const controller = new ProjectsController(fakeService({ updateProject }));

      const body = { id: 'project-1' };
      const result = await controller.update(request, 'project-1', body);

      expect(result).toBe(updated);
      expect(updateProject).toHaveBeenCalledWith('org-1', 'user-1', 'project-1', body);
    });
  });

  describe('uploadIcon', () => {
    it('rejects when no file was attached', async () => {
      const controller = new ProjectsController(fakeService());
      await expect(controller.uploadIcon(request, 'project-1', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('delegates to the service with the uploaded file', async () => {
      const uploadIcon = vi.fn().mockResolvedValue(undefined);
      const controller = new ProjectsController(fakeService({ uploadIcon }));
      const file = { buffer: Buffer.from('x'), mimetype: 'image/png' } as Express.Multer.File;

      const result = await controller.uploadIcon(request, 'project-1', file);

      expect(result).toEqual({ ok: true });
      expect(uploadIcon).toHaveBeenCalledWith('org-1', 'project-1', file);
    });
  });

  describe('getIcon', () => {
    it('streams the icon bytes with an image/png content-type, nosniff, and no-store (not a signed-url redirect)', async () => {
      const bytes = Buffer.from('fake-png-bytes');
      const getIconStream = vi.fn().mockResolvedValue(Readable.from([bytes]));
      const controller = new ProjectsController(fakeService({ getIconStream }));
      const response = fakeStreamResponse();

      await controller.getIcon(request, response as never, 'project-1');

      expect(getIconStream).toHaveBeenCalledWith('org-1', 'project-1');
      expect(response.set).toHaveBeenCalledWith({
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const received = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      });
      expect(received).toEqual(bytes);
    });

    it('404s with ICON_NOT_FOUND when the underlying object is missing', async () => {
      const getIconStream = vi.fn().mockRejectedValue(new ObjectNotFoundError('orgs/org-1/projects/project-1/icon.png'));
      const controller = new ProjectsController(fakeService({ getIconStream }));
      const response = fakeStreamResponse();

      const error: unknown = await controller.getIcon(request, response as never, 'project-1').catch((e) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'ICON_NOT_FOUND' });
    });

    it('rejects (so the global exception filter can still produce a normal JSON 500) when the stream fails before any bytes were sent', async () => {
      const getIconStream = vi.fn().mockResolvedValue(erroringStream([], new Error('storage read failed')));
      const controller = new ProjectsController(fakeService({ getIconStream }));
      const response = fakeStreamResponse();
      response.headersSent = false;

      await expect(controller.getIcon(request, response as never, 'project-1')).rejects.toThrow('storage read failed');
    });

    it('does not throw/crash — just logs — when the stream fails after headers were already sent', async () => {
      const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const getIconStream = vi
        .fn()
        .mockResolvedValue(erroringStream([Buffer.from('partial')], new Error('connection reset mid-transfer')));
      const controller = new ProjectsController(fakeService({ getIconStream }));
      const response = fakeStreamResponse();
      response.headersSent = true;

      await expect(controller.getIcon(request, response as never, 'project-1')).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalled();
      errorLog.mockRestore();
    });
  });
});
