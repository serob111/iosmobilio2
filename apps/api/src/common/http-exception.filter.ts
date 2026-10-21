import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import './request-id.types.js';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
};

/** Normalizes every thrown error (Nest's built-ins and our own) into { error: { code, message, requestId } }. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestId = request.id ?? 'unknown';

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;

    let code = STATUS_CODES[status] ?? 'ERROR';
    let message = 'Something went wrong';

    if (typeof body === 'string') {
      message = body;
    } else if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record.code === 'string') {
        code = record.code;
      }
      if (typeof record.message === 'string') {
        message = record.message;
      } else if (Array.isArray(record.message)) {
        message = record.message.join(', ');
      }
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'unhandled exception');
    }

    response.status(status).json({ error: { code, message, requestId } });
  }
}
