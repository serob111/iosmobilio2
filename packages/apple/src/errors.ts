export type AppStoreConnectErrorCode = 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'INVALID_RESPONSE';

export type AppStoreConnectErrorOptions = {
  status?: number;
  responseBody?: unknown;
  cause?: unknown;
};

export class AppStoreConnectError extends Error {
  readonly code: AppStoreConnectErrorCode;
  readonly status?: number;
  readonly responseBody?: unknown;
  readonly cause?: unknown;

  constructor(code: AppStoreConnectErrorCode, message: string, options: AppStoreConnectErrorOptions = {}) {
    super(message);
    this.name = 'AppStoreConnectError';
    this.code = code;
    this.status = options.status;
    this.responseBody = options.responseBody;
    this.cause = options.cause;
  }
}
