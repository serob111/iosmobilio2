import net from 'node:net';

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

const IPV4_FORBIDDEN_RANGES: Array<[network: string, prefixLength: number]> = [
  ['127.0.0.0', 8], // loopback
  ['10.0.0.0', 8], // private
  ['172.16.0.0', 12], // private
  ['192.168.0.0', 16], // private
  ['169.254.0.0', 16], // link-local (includes the 169.254.169.254 cloud metadata endpoint)
  ['100.64.0.0', 10], // shared address space / CGNAT
  ['0.0.0.0', 8], // "this network"
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
];

function isForbiddenIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  // 224.0.0.0 and above: multicast (224-239), reserved (240-255), broadcast (255.255.255.255).
  if (value >>> 24 >= 224) return true;
  return IPV4_FORBIDDEN_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

/**
 * Hand-rolled, not a library: parses an IPv6 literal (with "::" compression and a
 * trailing IPv4-mapped dotted-quad, e.g. "::ffff:10.0.0.1") into its 128-bit value, so
 * the range checks below can compare against it directly rather than string-matching.
 */
function parseIpv6(address: string): bigint {
  let addr = address;
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const sides = addr.split('::');
  const head = sides[0] ? sides[0].split(':').filter(Boolean) : [];
  const tailGroups = sides.length > 1 && sides[1] ? sides[1].split(':').filter(Boolean) : [];
  const missing = Math.max(8 - head.length - tailGroups.length, 0);
  const groups = [...head, ...Array(missing).fill('0'), ...tailGroups];

  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(parseInt(group || '0', 16));
  }
  return value;
}

function bigintToIpv4(value: bigint): string {
  const v = Number(value & 0xffffffffn);
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.');
}

// Prefix constants are derived through parseIpv6 itself, not hand-computed hex/shift
// arithmetic — a manually computed shift constant for fe80::/10 was wrong in an earlier
// version (1002 instead of 1018) and only the exhaustive range tests below caught it.
// Deriving every prefix the same way the real input is parsed removes that whole class
// of mistake.
const UNIQUE_LOCAL_PREFIX = parseIpv6('fc00::') >> 121n; // fc00::/7
const LINK_LOCAL_PREFIX = parseIpv6('fe80::') >> 118n; // fe80::/10
const IPV4_MAPPED_PREFIX = parseIpv6('::ffff:0:0') >> 32n; // ::ffff:0:0/96
const MULTICAST_PREFIX = parseIpv6('ff00::') >> 120n; // ff00::/8
const SITE_LOCAL_PREFIX = parseIpv6('fec0::') >> 118n; // fec0::/10 (deprecated, still routable on-link)
const TEREDO_PREFIX = parseIpv6('2001::') >> 96n; // 2001::/32
const DISCARD_PREFIX = parseIpv6('100::') >> 64n; // 100::/64 (RFC 6666)
const NAT64_PREFIX = parseIpv6('64:ff9b::') >> 32n; // 64:ff9b::/96 — embeds an IPv4 address
const LOCAL_NAT64_PREFIX = parseIpv6('64:ff9b:1::') >> 80n; // 64:ff9b:1::/48 (RFC 8215, local-use) — embeds an IPv4 address
const SIXTOFOUR_PREFIX = parseIpv6('2002::') >> 112n; // 2002::/16 — embeds an IPv4 address
const TRANSLATED_PREFIX = parseIpv6('::ffff:0:0:0') >> 32n; // ::ffff:0:0:0/96 ("IPv4-translated") — note the extra
// zero group vs. ::ffff:0:0/96 (IPv4-mapped): FFFF sits one group earlier, a genuinely
// different, non-overlapping /96 from IPV4_MAPPED_PREFIX above.

function isForbiddenIpv6(address: string): boolean {
  const value = parseIpv6(address);

  // ::/96 — includes :: itself and the deprecated "IPv4-compatible" form (::a.b.c.d for
  // any a.b.c.d, including public ones: always forbidden, not range-checked, same
  // reasoning as the IPv4-mapped case below).
  if (value >> 32n === 0n) return true;
  if (value >> 121n === UNIQUE_LOCAL_PREFIX) return true;
  if (value >> 118n === LINK_LOCAL_PREFIX) return true;
  if (value >> 118n === SITE_LOCAL_PREFIX) return true;
  if (value >> 120n === MULTICAST_PREFIX) return true;
  if (value >> 96n === TEREDO_PREFIX) return true;
  if (value >> 64n === DISCARD_PREFIX) return true;
  // ::ffff:0:0/96 (IPv4-mapped) and ::ffff:0:0:0/96 (IPv4-translated) — always forbidden
  // regardless of the embedded IPv4, to avoid either encoding being usable as a bypass.
  if (value >> 32n === IPV4_MAPPED_PREFIX) return true;
  if (value >> 32n === TRANSLATED_PREFIX) return true;

  // NAT64 (global and RFC 8215 local-use) and 6to4 embed a real IPv4 address — extract
  // it and defer to the IPv4 rules, rather than either trusting it unconditionally or
  // banning the whole prefix outright.
  if (value >> 32n === NAT64_PREFIX) return isForbiddenIpv4(bigintToIpv4(value));
  if (value >> 80n === LOCAL_NAT64_PREFIX) return isForbiddenIpv4(bigintToIpv4(value));
  if (value >> 112n === SIXTOFOUR_PREFIX) return isForbiddenIpv4(bigintToIpv4(value >> 80n));

  return false;
}

/** True if `ip` must never be connected to from the server (loopback, private, link-local, etc.). */
export function isForbiddenIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isForbiddenIpv4(ip);
  if (version === 6) return isForbiddenIpv6(ip);
  return true; // not a valid literal IP at all — treat as unsafe rather than guessing.
}
