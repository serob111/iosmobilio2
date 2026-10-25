import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  DRAFT_COOKIE_NAME,
  clearDraftCookie,
  generateDraftToken,
  hashDraftToken,
  readDraftCookie,
  setDraftCookie,
} from './draft-token.js';

describe('generateDraftToken', () => {
  it('returns a raw token whose sha256 hash matches tokenHash, and a 7-day expiry', () => {
    const before = Date.now();
    const { rawToken, tokenHash, expiresAt } = generateDraftToken();

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(expiresAt.getTime()).toBeGreaterThan(before + 6 * 24 * 60 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThan(before + 8 * 24 * 60 * 60 * 1000);
  });

  it('never repeats a raw token across calls', () => {
    const a = generateDraftToken();
    const b = generateDraftToken();
    expect(a.rawToken).not.toBe(b.rawToken);
  });
});

describe('hashDraftToken', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashDraftToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});

describe('setDraftCookie / clearDraftCookie', () => {
  const originalCookieSecure = process.env.COOKIE_SECURE;

  afterEach(() => {
    if (originalCookieSecure === undefined) {
      delete process.env.COOKIE_SECURE;
    } else {
      process.env.COOKIE_SECURE = originalCookieSecure;
    }
  });

  function fakeResponse(): Response & { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> } {
    return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response & {
      cookie: ReturnType<typeof vi.fn>;
      clearCookie: ReturnType<typeof vi.fn>;
    };
  }

  it('sets an httpOnly, lax-samesite cookie with a 7-day maxAge', () => {
    const res = fakeResponse();
    setDraftCookie(res, 'raw-token');

    expect(res.cookie).toHaveBeenCalledWith(
      DRAFT_COOKIE_NAME,
      'raw-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  it('defaults secure to true when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE;
    const res = fakeResponse();
    setDraftCookie(res, 'raw-token');
    expect(res.cookie).toHaveBeenCalledWith(DRAFT_COOKIE_NAME, 'raw-token', expect.objectContaining({ secure: true }));
  });

  it('only turns secure off when COOKIE_SECURE is exactly "false"', () => {
    process.env.COOKIE_SECURE = 'false';
    const res = fakeResponse();
    setDraftCookie(res, 'raw-token');
    expect(res.cookie).toHaveBeenCalledWith(
      DRAFT_COOKIE_NAME,
      'raw-token',
      expect.objectContaining({ secure: false }),
    );
  });

  it('treats any other COOKIE_SECURE value as still secure (fail safe, not fail open)', () => {
    process.env.COOKIE_SECURE = 'nope';
    const res = fakeResponse();
    setDraftCookie(res, 'raw-token');
    expect(res.cookie).toHaveBeenCalledWith(DRAFT_COOKIE_NAME, 'raw-token', expect.objectContaining({ secure: true }));
  });

  it('clears the cookie with the exact same attributes it was set with', () => {
    delete process.env.COOKIE_SECURE;
    const res = fakeResponse();
    setDraftCookie(res, 'raw-token');
    clearDraftCookie(res);

    const [, , setOptions] = res.cookie.mock.calls[0] as [string, string, Record<string, unknown>];
    const [, clearOptions] = res.clearCookie.mock.calls[0] as [string, Record<string, unknown>];
    expect(clearOptions).toEqual({
      httpOnly: setOptions.httpOnly,
      secure: setOptions.secure,
      sameSite: setOptions.sameSite,
      path: setOptions.path,
    });
  });
});

describe('readDraftCookie', () => {
  function requestWithCookieHeader(header: string | undefined): Request {
    return { headers: { cookie: header } } as unknown as Request;
  }

  it('returns undefined when there is no Cookie header at all', () => {
    expect(readDraftCookie(requestWithCookieHeader(undefined))).toBeUndefined();
  });

  it('returns undefined when the header exists but has no matching cookie name', () => {
    expect(readDraftCookie(requestWithCookieHeader('other=value; another=thing'))).toBeUndefined();
  });

  it('finds the draft cookie among several others, in any position', () => {
    const header = `other=1; ${DRAFT_COOKIE_NAME}=raw-token-value; another=2`;
    expect(readDraftCookie(requestWithCookieHeader(header))).toBe('raw-token-value');
  });

  it('decodes a percent-encoded value', () => {
    const header = `${DRAFT_COOKIE_NAME}=${encodeURIComponent('a b')}`;
    expect(readDraftCookie(requestWithCookieHeader(header))).toBe('a b');
  });

  it('ignores a malformed segment with no "=" rather than throwing', () => {
    const header = `garbage; ${DRAFT_COOKIE_NAME}=value`;
    expect(readDraftCookie(requestWithCookieHeader(header))).toBe('value');
  });

  it('returns undefined (not a thrown error) for a malformed %-escape in the cookie value', () => {
    const header = `${DRAFT_COOKIE_NAME}=%`;
    expect(() => readDraftCookie(requestWithCookieHeader(header))).not.toThrow();
    expect(readDraftCookie(requestWithCookieHeader(header))).toBeUndefined();
  });

  it('returns undefined for a truncated %-escape sequence', () => {
    const header = `${DRAFT_COOKIE_NAME}=%2`;
    expect(readDraftCookie(requestWithCookieHeader(header))).toBeUndefined();
  });
});
