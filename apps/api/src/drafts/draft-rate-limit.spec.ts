import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { getClientRateLimitKey } from './draft-rate-limit.js';

function requestWithIp(ip: string | undefined): Request {
  return { ip } as unknown as Request;
}

describe('getClientRateLimitKey', () => {
  it('throws BadRequestException when request.ip is missing', () => {
    expect(() => getClientRateLimitKey(requestWithIp(undefined))).toThrow(BadRequestException);
  });

  it('keys an IPv4 address by its exact value', () => {
    expect(getClientRateLimitKey(requestWithIp('203.0.113.5'))).toBe('203.0.113.5');
  });

  it('keys two different IPv4 addresses differently', () => {
    const a = getClientRateLimitKey(requestWithIp('203.0.113.5'));
    const b = getClientRateLimitKey(requestWithIp('203.0.113.6'));
    expect(a).not.toBe(b);
  });

  it('keys an IPv4-mapped IPv6 address (::ffff:a.b.c.d) by the embedded IPv4 address', () => {
    expect(getClientRateLimitKey(requestWithIp('::ffff:203.0.113.5'))).toBe('203.0.113.5');
  });

  it('keys two IPv6 addresses within the same /64 identically', () => {
    const a = getClientRateLimitKey(requestWithIp('2001:db8:abcd:1::1'));
    const b = getClientRateLimitKey(requestWithIp('2001:db8:abcd:1::2'));
    expect(a).toBe(b);
  });

  it('keys two IPv6 addresses in different /64s differently', () => {
    const a = getClientRateLimitKey(requestWithIp('2001:db8:abcd:1::1'));
    const b = getClientRateLimitKey(requestWithIp('2001:db8:abcd:2::1'));
    expect(a).not.toBe(b);
  });

  it('keys a fully-expanded 8-group IPv6 address (no "::" shorthand) by its first 4 groups', () => {
    const a = getClientRateLimitKey(requestWithIp('2001:db8:abcd:1:2:3:4:5'));
    const b = getClientRateLimitKey(requestWithIp('2001:db8:abcd:1:9:9:9:9'));
    expect(a).toBe(b);
  });

  it('handles the unspecified address :: without throwing', () => {
    expect(() => getClientRateLimitKey(requestWithIp('::'))).not.toThrow();
  });

  it('handles loopback ::1 without throwing', () => {
    expect(() => getClientRateLimitKey(requestWithIp('::1'))).not.toThrow();
  });
});
