import { BadRequestException } from '@nestjs/common';
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
    getIconUrl: vi.fn(),
    ...overrides,
  } as unknown as ProjectsService;
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
    it('redirects to the signed icon url', async () => {
      const getIconUrl = vi.fn().mockResolvedValue('https://signed.example/icon.png');
      const controller = new ProjectsController(fakeService({ getIconUrl }));

      const result = await controller.getIcon(request, 'project-1');

      expect(result).toEqual({ url: 'https://signed.example/icon.png' });
      expect(getIconUrl).toHaveBeenCalledWith('org-1', 'project-1');
    });
  });
});
