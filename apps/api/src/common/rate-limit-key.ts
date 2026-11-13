import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

function expandIpv6Groups(ip: string): string[] {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  if (!ip.includes('::')) {
    return headGroups;
  }
  const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
  const zeroCount = Math.max(8 - headGroups.length - tailGroups.length, 0);
  return [...headGroups, ...Array(zeroCount).fill('0'), ...tailGroups];
}

/**
 * IPv6 clients commonly rotate through many addresses within the same /64 (SLAAC privacy
 * extensions, or simply a provider-assigned /64 per customer) — keying by the full
 * address would hand out a fresh rate-limit budget on every request. IPv4 has no such
 * rotation, so it's keyed by the exact address.
 */
function rateLimitKeyForIp(ip: string): string {
  const ipv4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (ipv4Mapped) {
    return ipv4Mapped[1]!;
  }
  if (!ip.includes(':')) {
    return ip;
  }
  return `${expandIpv6Groups(ip).slice(0, 4).join(':')}::/64`;
}

/**
 * request.ip is Express's own trust-proxy-aware resolution (see create-app.ts's
 * app.set('trust proxy', ...)) — never read X-Forwarded-For directly here, or a client
 * can simply send a different fake value on every request and dodge the limit entirely.
 * Shared by every IP-keyed rate limiter in apps/api (drafts creation, the preview-link
 * reader, the preview proxy) — originally lived in drafts/draft-rate-limit.ts, moved here
 * once a second feature needed the exact same IPv6-collapsing logic.
 */
export function getClientRateLimitKey(request: Request): string {
  if (!request.ip) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Could not determine client IP' });
  }
  return rateLimitKeyForIp(request.ip);
}
