import { describe, expect, it } from 'vitest';
import { RepackError } from '../src/errors';

describe('RepackError', () => {
  it('carries the stable code and message', () => {
    const error = new RepackError('ICON_INVALID', 'icon must be 1024x1024');
    expect(error.code).toBe('ICON_INVALID');
    expect(error.message).toBe('icon must be 1024x1024');
    expect(error.name).toBe('RepackError');
  });

  it('is a real Error instance (instanceof Error, not just duck-typed)', () => {
    const error = new RepackError('SIGNING_FAILED', 'rcodesign exited 1');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RepackError);
  });

  it('carries an optional cause for wrapping a lower-level error', () => {
    const lowLevel = new Error('ENOENT');
    const error = new RepackError('VERIFY_FAILED', 'could not verify', lowLevel);
    expect(error.cause).toBe(lowLevel);
  });

  it('cause is undefined when not provided', () => {
    const error = new RepackError('BASE_CHECKSUM_MISMATCH', 'sha256 mismatch');
    expect(error.cause).toBeUndefined();
  });
});
