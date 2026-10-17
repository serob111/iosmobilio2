import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, getClientIp } from '../../lib/rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to `limit` requests within the window, then blocks', () => {
    const key = 'rate-limit-test-basic';
    expect(checkRateLimit(key, 3, 10_000)).toBe(true);
    expect(checkRateLimit(key, 3, 10_000)).toBe(true);
    expect(checkRateLimit(key, 3, 10_000)).toBe(true);
    expect(checkRateLimit(key, 3, 10_000)).toBe(false);
  });

  it('allows requests again once the window has elapsed', () => {
    const key = 'rate-limit-test-window';
    expect(checkRateLimit(key, 1, 10_000)).toBe(true);
    expect(checkRateLimit(key, 1, 10_000)).toBe(false);

    vi.advanceTimersByTime(10_001);

    expect(checkRateLimit(key, 1, 10_000)).toBe(true);
  });

  it('tracks different keys independently', () => {
    expect(checkRateLimit('rate-limit-test-a', 1, 10_000)).toBe(true);
    expect(checkRateLimit('rate-limit-test-b', 1, 10_000)).toBe(true);
    expect(checkRateLimit('rate-limit-test-a', 1, 10_000)).toBe(false);
    expect(checkRateLimit('rate-limit-test-b', 1, 10_000)).toBe(false);
  });
});

describe('getClientIp', () => {
  it('returns the first ip from a comma-separated x-forwarded-for header', () => {
    const request = new Request('http://test.local', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('trims whitespace around the first ip', () => {
    const request = new Request('http://test.local', {
      headers: { 'x-forwarded-for': '  203.0.113.5  , 10.0.0.1' },
    });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('returns "unknown" when the header is absent', () => {
    const request = new Request('http://test.local');
    expect(getClientIp(request)).toBe('unknown');
  });
});
