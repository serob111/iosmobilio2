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

function isForbiddenIpv6(address: string): boolean {
  const value = parseIpv6(address);
  if (value === 1n) return true; // ::1 (loopback)
  if (value >> 121n === 126n) return true; // fc00::/7 (unique local)
  if (value >> 118n === 1018n) return true; // fe80::/10 (link-local)
  if (value >> 32n === 0xffffn) return true; // ::ffff:0:0/96 (IPv4-mapped) — always forbidden,
  // regardless of the embedded IPv4, to avoid this encoding being usable as a bypass at all.
  return false;
}

/** True if `ip` must never be connected to from the server (loopback, private, link-local, etc.). */
export function isForbiddenIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isForbiddenIpv4(ip);
  if (version === 6) return isForbiddenIpv6(ip);
  return true; // not a valid literal IP at all — treat as unsafe rather than guessing.
}
