import { BadRequestException, NotFoundException, PayloadTooLargeException, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';
import './request-id.types.js';

function makeHost(requestId: string | undefined) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status };
  const request = { id: requestId };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('maps a custom { code, message } exception body through unchanged', () => {
    const { host, status, json } = makeHost('req-1');
    filter.catch(new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' }), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Organization not found', requestId: 'req-1' },
    });
  });

  it('derives a status-based code for a plain Nest exception without a custom body', () => {
    const { host, status, json } = makeHost('req-2');
    filter.catch(new BadRequestException('oops'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: { code: 'BAD_REQUEST', message: 'oops', requestId: 'req-2' } });
  });

  it('joins a class-validator-style array message', () => {
    const { host, json } = makeHost('req-3');
    filter.catch(new BadRequestException({ message: ['email is required', 'role is invalid'] }), host);

    expect(json).toHaveBeenCalledWith({
      error: { code: 'BAD_REQUEST', message: 'email is required, role is invalid', requestId: 'req-3' },
    });
  });

  it('falls back to INTERNAL_ERROR for a non-HttpException error', () => {
    const { host, status, json } = makeHost('req-4');
    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'req-4' },
    });
  });

  it('maps a 413 (e.g. FileInterceptor\'s own PayloadTooLargeException for a too-large upload) to FILE_TOO_LARGE', () => {
    // FileInterceptor (@nestjs/platform-express) already converts Multer's raw
    // LIMIT_FILE_SIZE error into a PayloadTooLargeException itself, before this filter
    // ever runs — there's no raw MulterError to special-case here, just another status
    // code to map like any other.
    const { host, status, json } = makeHost('req-5');
    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'FILE_TOO_LARGE', message: 'File too large', requestId: 'req-5' },
    });
  });

  it('falls back to "unknown" when the request has no id', () => {
    const { host, json } = makeHost(undefined);
    filter.catch(new NotFoundException(), host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ requestId: 'unknown' }) }));
  });
});
