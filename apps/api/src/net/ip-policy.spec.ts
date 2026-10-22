import { describe, expect, it } from 'vitest';
import { isForbiddenIp } from './ip-policy.js';

describe('isForbiddenIp', () => {
  describe('IPv4 forbidden ranges', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'loopback upper bound'],
      ['10.0.0.1', 'private 10/8'],
      ['10.255.255.255', 'private 10/8 upper bound'],
      ['172.16.0.1', 'private 172.16/12'],
      ['172.31.255.255', 'private 172.16/12 upper bound'],
      ['192.168.0.1', 'private 192.168/16'],
      ['169.254.0.1', 'link-local 169.254/16'],
      ['169.254.169.254', 'cloud metadata endpoint'],
      ['100.64.0.1', 'shared address space 100.64/10'],
      ['100.127.255.255', 'shared address space upper bound'],
      ['0.0.0.1', '"this network" 0/8'],
      ['0.255.255.255', '"this network" upper bound'],
      ['224.0.0.1', 'multicast'],
      ['240.0.0.1', 'reserved'],
      ['255.255.255.255', 'broadcast'],
    ])('rejects %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(true);
    });

    it.each([
      ['172.15.255.255', 'just below 172.16/12'],
      ['172.32.0.0', 'just above 172.16/12'],
      ['100.63.255.255', 'just below 100.64/10'],
      ['100.128.0.0', 'just above 100.64/10'],
      ['223.255.255.255', 'just below 224/4'],
      ['8.8.8.8', 'public (Google DNS)'],
      ['1.1.1.1', 'public (Cloudflare DNS)'],
    ])('allows %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(false);
    });
  });

  describe('IPv6 forbidden ranges', () => {
    it.each([
      ['::1', 'loopback'],
      ['fc00::1', 'unique local fc00::/7'],
      ['fd12:3456:789a::1', 'unique local fd00::/8'],
      ['fe80::1', 'link-local fe80::/10'],
      ['fe80::abcd:1234:5678:9abc', 'link-local with interface id'],
      ['::ffff:10.0.0.1', 'IPv4-mapped, embedded private address'],
      ['::ffff:127.0.0.1', 'IPv4-mapped, embedded loopback'],
      ['::ffff:8.8.8.8', 'IPv4-mapped, embedded public address — mapped form forbidden regardless'],
      ['::ffff:808:808', 'IPv4-mapped, hex-group form of 8.8.8.8'],
    ])('rejects %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(true);
    });

    it.each([
      ['2001:4860:4860::8888', 'public (Google DNS)'],
      ['2606:4700:4700::1111', 'public (Cloudflare DNS)'],
    ])('allows %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(false);
    });
  });

  it('treats a non-IP string as forbidden rather than guessing', () => {
    expect(isForbiddenIp('not-an-ip')).toBe(true);
  });
});
