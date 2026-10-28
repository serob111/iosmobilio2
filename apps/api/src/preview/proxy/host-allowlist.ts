/**
 * Which hosts the preview proxy may fetch from for a given project/draft — deliberately
 * derived from the project's own source.url, never from config.allowedDomains: that
 * field is client-editable (PUT /orgs/:orgId/projects/:projectId), so trusting it here
 * would let a project owner point the proxy at an arbitrary third-party site under their
 * own preview URL.
 *
 * Only `new URL(...).hostname` is ever used to extract a hostname — never a regex or
 * string split — specifically because WHATWG URL parsing already does the hard parts
 * correctly: it lowercases, applies IDNA/punycode conversion for Unicode hostnames, drops
 * the port (`.hostname`, not `.host`), and critically separates userinfo from the host
 * (`new URL('https://evil.com@site.com/').hostname === 'site.com'`, not 'evil.com') — a
 * hand-rolled parser re-deriving any of this is exactly how this class of bug gets
 * reintroduced.
 */
export type HostAllowlist = { baseHost: string };

function stripTrailingDot(hostname: string): string {
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
}

/**
 * The "base" is the exact hostname from source.url, with one leading "www." stripped if
 * present — not a guessed registrable/eTLD+1 domain. source.url for "shop.example.com"
 * allows "shop.example.com" and its subdomains, never bare "example.com" or a sibling
 * like "cdn.example.com": least privilege, scoped to exactly what the site owner's own
 * URL names, not a wider domain we'd have to guess at without a public-suffix list.
 */
export function deriveHostAllowlist(sourceUrl: string): HostAllowlist | null {
  let hostname: string;
  try {
    hostname = stripTrailingDot(new URL(sourceUrl).hostname.toLowerCase());
  } catch {
    return null;
  }
  if (!hostname) {
    return null;
  }
  const baseHost = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  return { baseHost };
}

/**
 * True for baseHost itself, any subdomain of it, AND (structurally, not as a special
 * case) its www-variant — "www.example.com".endsWith(".example.com") is already true, so
 * a separate www branch would be redundant, not a second rule.
 */
export function isHostAllowed(hostname: string, allowlist: HostAllowlist): boolean {
  const candidate = stripTrailingDot(hostname.toLowerCase());
  return candidate === allowlist.baseHost || candidate.endsWith(`.${allowlist.baseHost}`);
}

/** Convenience wrapper for checking a full URL (e.g. a redirect's Location) in one call. */
export function isUrlHostAllowed(url: URL, allowlist: HostAllowlist): boolean {
  return isHostAllowed(url.hostname, allowlist);
}
