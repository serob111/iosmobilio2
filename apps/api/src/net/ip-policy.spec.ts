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
      ['192.0.0.1', 'IETF protocol assignments 192.0.0/24'],
      ['192.0.2.1', 'TEST-NET-1'],
      ['198.18.0.1', 'benchmarking 198.18/15'],
      ['198.19.255.255', 'benchmarking upper bound'],
      ['198.51.100.1', 'TEST-NET-2'],
      ['203.0.113.1', 'TEST-NET-3'],
    ])('rejects %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(true);
    });

    it.each([
      ['172.15.255.255', 'just below 172.16/12'],
      ['172.32.0.0', 'just above 172.16/12'],
      ['100.63.255.255', 'just below 100.64/10'],
      ['100.128.0.0', 'just above 100.64/10'],
      ['198.17.255.255', 'just below 198.18/15'],
      ['198.20.0.0', 'just above 198.18/15'],
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
      ['::', 'unspecified address (::/96)'],
      ['::127.0.0.1', 'deprecated IPv4-compatible form, embeds loopback (::/96 bans all of it)'],
      [
        '::8.8.8.8',
        'deprecated IPv4-compatible form, embeds a public address — still banned, ::/96 is unconditional',
      ],
      ['fc00::1', 'unique local fc00::/7'],
      ['fd12:3456:789a::1', 'unique local fd00::/8'],
      ['fe80::1', 'link-local fe80::/10'],
      ['fe80::abcd:1234:5678:9abc', 'link-local with interface id'],
      ['fec0::1', 'deprecated site-local fec0::/10'],
      ['ff02::1', 'multicast (all-nodes)'],
      ['ff00::', 'multicast lower bound'],
      ['2001::1', 'Teredo 2001::/32'],
      ['100::1', 'discard-only 100::/64'],
      ['::ffff:10.0.0.1', 'IPv4-mapped, embedded private address'],
      ['::ffff:127.0.0.1', 'IPv4-mapped, embedded loopback'],
      ['::ffff:8.8.8.8', 'IPv4-mapped, embedded public address — mapped form forbidden regardless'],
      ['::ffff:808:808', 'IPv4-mapped, hex-group form of 8.8.8.8'],
      ['64:ff9b::a9fe:a9fe', 'NAT64 embedding the cloud metadata address'],
      ['64:ff9b::7f00:1', 'NAT64 embedding loopback'],
      ['2002:7f00:1::', '6to4 embedding loopback'],
      ['2002:a9fe:a9fe::', '6to4 embedding the cloud metadata address'],
      ['::ffff:0:a00:1', 'IPv4-translated (::ffff:0:0:0/96), embedded private address'],
      ['64:ff9b:1::a00:1', 'RFC 8215 local-use NAT64 (64:ff9b:1::/48), embedded private address'],
    ])('rejects %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(true);
    });

    it.each([
      ['2001:4860:4860::8888', 'public (Google DNS)'],
      ['2606:4700:4700::1111', 'public (Cloudflare DNS)'],
      ['64:ff9b::808:808', 'NAT64 embedding a public address (8.8.8.8) — allowed'],
      ['2002:808:808::', '6to4 embedding a public address (8.8.8.8) — allowed'],
      ['64:ff9b:1::808:808', 'RFC 8215 local-use NAT64 embedding a public address — allowed'],
    ])('allows %s (%s)', (ip) => {
      expect(isForbiddenIp(ip)).toBe(false);
    });
  });

  it('treats a non-IP string as forbidden rather than guessing', () => {
    expect(isForbiddenIp('not-an-ip')).toBe(true);
  });
});
