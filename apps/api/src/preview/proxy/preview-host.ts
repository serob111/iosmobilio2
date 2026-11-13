import { PREVIEW_SLUG_PATTERN } from '../preview-slug.js';

/**
 * Parses an incoming request's raw `Host` header against PREVIEW_PROXY_DOMAIN and
 * returns the slug if (and only if) it's a well-formed preview subdomain —
 * `<slug>.<PREVIEW_PROXY_DOMAIN>`, exactly one extra label, that label matching
 * PREVIEW_SLUG_PATTERN exactly. Returns null for everything else: the bare domain
 * itself, a host entirely outside the domain, a nested subdomain (`a.<slug>.domain`),
 * or a one-label subdomain whose content isn't a valid slug (wrong length, disallowed
 * characters, an IDN/punycode label, …) — every one of those is PREVIEW_PROXY_DOMAIN
 * territory where there is no legitimate "other" route to fall back to, so the caller
 * (create-app.ts's host-routing split) treats null there as "404", never as "let this
 * fall through to the main api's normal routing".
 *
 * Uses `new URL(...)`.hostname — never a hand-rolled split — for the same reason
 * host-allowlist.ts does: it lowercases and punycode-converts Unicode labels and strips
 * the port automatically, so an IDN spoofing attempt or a stray `:port` in the Host
 * header is normalized away before any comparison, not something this function has to
 * special-case itself.
 */
export function extractPreviewSlugFromHost(rawHost: string | undefined, proxyDomain: string): string | null {
  if (!rawHost) {
    return null;
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${rawHost}/`).hostname;
  } catch {
    return null;
  }
  if (hostname === proxyDomain) {
    return null;
  }
  const suffix = `.${proxyDomain}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }
  const label = hostname.slice(0, hostname.length - suffix.length);
  // A dot surviving in `label` means there was more than one extra level of subdomain
  // (e.g. "a.<slug>" for host "a.<slug>.<proxyDomain>") — not a single preview slug.
  if (label.includes('.') || !PREVIEW_SLUG_PATTERN.test(label)) {
    return null;
  }
  return label;
}

/** True for the bare PREVIEW_PROXY_DOMAIN itself or ANY subdomain of it, slug-shaped or not. */
export function isWithinPreviewProxyDomain(rawHost: string | undefined, proxyDomain: string): boolean {
  if (!rawHost) {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${rawHost}/`).hostname;
  } catch {
    return false;
  }
  return hostname === proxyDomain || hostname.endsWith(`.${proxyDomain}`);
}
