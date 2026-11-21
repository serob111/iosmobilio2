/**
 * Stable codes a caller (apps/worker's RepackRunner, a later phase) can branch on
 * without parsing message text — every failure path in this package throws a
 * RepackError with one of these.
 */
export type RepackErrorCode = 'INVALID_CONFIG' | 'ICON_INVALID' | 'SIGNING_FAILED' | 'VERIFY_FAILED' | 'BASE_CHECKSUM_MISMATCH';

export class RepackError extends Error {
  readonly code: RepackErrorCode;
  readonly cause?: unknown;

  constructor(code: RepackErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'RepackError';
    this.code = code;
    this.cause = cause;
  }
}
