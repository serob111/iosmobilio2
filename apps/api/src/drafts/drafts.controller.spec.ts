import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { DraftsController } from './drafts.controller.js';
import type { DraftsService } from './drafts.service.js';
import type { DraftRateLimitService } from './draft-rate-limit.js';
import { DRAFT_COOKIE_NAME } from './draft-token.js';
import './draft.types.js';

function fakeService(overrides: Partial<Record<keyof DraftsService, ReturnType<typeof vi.fn>>> = {}) {
  return {
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    uploadIcon: vi.fn(),
    getIconUrl: vi.fn(),
    claimDraft: vi.fn(),
    ...overrides,
  } as unknown as DraftsService;
}

function fakeRateLimit(allowed = true) {
  return { checkAndIncrement: vi.fn().mockResolvedValue(allowed) } as unknown as DraftRateLimitService;
}

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

const draftStub = { id: 'draft-1' };
const requestWithDraft = { draft: draftStub, draftTokenHash: 'hash-1', headers: {} } as never;

describe('DraftsController', () => {
  describe('create', () => {
    it('429s and never calls the service when the rate limit rejects the request', async () => {
      const createDraft = vi.fn();
      const controller = new DraftsController(fakeService({ createDraft }), fakeRateLimit(false));

      const error: unknown = await controller
        .create({ headers: {} } as never, fakeResponse() as never, { url: 'example.com' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('requires a url', async () => {
      const controller = new DraftsController(fakeService(), fakeRateLimit(true));
      await expect(controller.create({ headers: {} } as never, fakeResponse() as never, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates the draft and sets the claim-token cookie', async () => {
      const createDraft = vi.fn().mockResolvedValue({ rawToken: 'raw-token-value' });
      const controller = new DraftsController(fakeService({ createDraft }), fakeRateLimit(true));
      const res = fakeResponse();

      const result = await controller.create({ headers: {} } as never, res as never, { url: 'example.com' });

      expect(result).toEqual({ ok: true });
      expect(createDraft).toHaveBeenCalledWith('example.com');
      expect(res.cookie).toHaveBeenCalledWith(DRAFT_COOKIE_NAME, 'raw-token-value', expect.any(Object));
    });
  });

  describe('getMe', () => {
    it('returns request.draft, already resolved by DraftGuard', () => {
      const controller = new DraftsController(fakeService(), fakeRateLimit());
      expect(controller.getMe(requestWithDraft)).toBe(draftStub);
    });
  });

  describe('update', () => {
    it('delegates to the service with the draft token hash and the draft id from the guard', async () => {
      const updated = { id: 'draft-1', name: 'New' };
      const updateDraft = vi.fn().mockResolvedValue(updated);
      const controller = new DraftsController(fakeService({ updateDraft }), fakeRateLimit());

      const body = { id: 'draft-1' };
      const result = await controller.update(requestWithDraft, body);

      expect(result).toBe(updated);
      expect(updateDraft).toHaveBeenCalledWith('hash-1', 'draft-1', body);
    });
  });

  describe('uploadIcon', () => {
    it('rejects when no file was attached', async () => {
      const controller = new DraftsController(fakeService(), fakeRateLimit());
      await expect(controller.uploadIcon(requestWithDraft, undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('delegates to the service with the uploaded file and the draft id', async () => {
      const uploadIcon = vi.fn().mockResolvedValue(undefined);
      const controller = new DraftsController(fakeService({ uploadIcon }), fakeRateLimit());
      const file = { buffer: Buffer.from('x'), mimetype: 'image/png' } as Express.Multer.File;

      const result = await controller.uploadIcon(requestWithDraft, file);

      expect(result).toEqual({ ok: true });
      expect(uploadIcon).toHaveBeenCalledWith('draft-1', file);
    });
  });

  describe('getIcon', () => {
    it('redirects to the signed icon url', async () => {
      const getIconUrl = vi.fn().mockResolvedValue('https://signed.example/icon.png');
      const controller = new DraftsController(fakeService({ getIconUrl }), fakeRateLimit());

      const result = await controller.getIcon(requestWithDraft);

      expect(result).toEqual({ url: 'https://signed.example/icon.png' });
      expect(getIconUrl).toHaveBeenCalledWith('draft-1');
    });
  });
});
