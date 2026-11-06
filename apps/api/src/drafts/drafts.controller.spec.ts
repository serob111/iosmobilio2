import { PassThrough, Readable } from 'node:stream';
import { BadRequestException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { ObjectNotFoundError } from '@mobilio/storage';
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
    getIconStream: vi.fn(),
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

const draftStub = { id: 'draft-1' };
const requestWithDraft = { draft: draftStub, draftTokenHash: 'hash-1', headers: {} } as never;
const requestWithIp = { headers: {}, ip: '203.0.113.5' } as never;

describe('DraftsController', () => {
  describe('create', () => {
    it('throws BadRequestException (400) and never calls the rate limiter when request.ip is missing', async () => {
      const checkAndIncrement = vi.fn();
      const controller = new DraftsController(fakeService(), { checkAndIncrement } as unknown as DraftRateLimitService);

      await expect(
        controller.create({ headers: {} } as never, fakeResponse() as never, { url: 'example.com' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(checkAndIncrement).not.toHaveBeenCalled();
    });

    it('429s and never calls the service when the rate limit rejects the request', async () => {
      const createDraft = vi.fn();
      const controller = new DraftsController(fakeService({ createDraft }), fakeRateLimit(false));

      const error: unknown = await controller
        .create(requestWithIp, fakeResponse() as never, { url: 'example.com' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('requires a url', async () => {
      const controller = new DraftsController(fakeService(), fakeRateLimit(true));
      await expect(controller.create(requestWithIp, fakeResponse() as never, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates the draft and sets the claim-token cookie', async () => {
      const createDraft = vi.fn().mockResolvedValue({ rawToken: 'raw-token-value' });
      const controller = new DraftsController(fakeService({ createDraft }), fakeRateLimit(true));
      const res = fakeResponse();

      const result = await controller.create(requestWithIp, res as never, { url: 'example.com' });

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
    it('streams the icon bytes with an image/png content-type, nosniff, and no-store (not a signed-url redirect)', async () => {
      const bytes = Buffer.from('fake-png-bytes');
      const getIconStream = vi.fn().mockResolvedValue(Readable.from([bytes]));
      const controller = new DraftsController(fakeService({ getIconStream }), fakeRateLimit());
      const response = fakeStreamResponse();

      await controller.getIcon(requestWithDraft, response as never);

      expect(getIconStream).toHaveBeenCalledWith('draft-1');
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
      const getIconStream = vi.fn().mockRejectedValue(new ObjectNotFoundError('drafts/draft-1/icon.png'));
      const controller = new DraftsController(fakeService({ getIconStream }), fakeRateLimit());
      const response = fakeStreamResponse();

      const error: unknown = await controller.getIcon(requestWithDraft, response as never).catch((e) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'ICON_NOT_FOUND' });
    });

    it('rejects (so the global exception filter can still produce a normal JSON 500) when the stream fails before any bytes were sent', async () => {
      const getIconStream = vi.fn().mockResolvedValue(erroringStream([], new Error('storage read failed')));
      const controller = new DraftsController(fakeService({ getIconStream }), fakeRateLimit());
      const response = fakeStreamResponse();
      response.headersSent = false;

      await expect(controller.getIcon(requestWithDraft, response as never)).rejects.toThrow('storage read failed');
    });

    it('does not throw/crash — just logs — when the stream fails after headers were already sent', async () => {
      const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const getIconStream = vi
        .fn()
        .mockResolvedValue(erroringStream([Buffer.from('partial')], new Error('connection reset mid-transfer')));
      const controller = new DraftsController(fakeService({ getIconStream }), fakeRateLimit());
      const response = fakeStreamResponse();
      response.headersSent = true;

      await expect(controller.getIcon(requestWithDraft, response as never)).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalled();
      errorLog.mockRestore();
    });
  });
});
