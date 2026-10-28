import { isUrlHostAllowed, type HostAllowlist } from './host-allowlist.js';

/**
 * Query key the proxy uses to remember which (non-primary, but allowed) host a rewritten
 * link actually points at — e.g. a subdomain's asset. Deliberately obscure/namespaced so
 * it can never collide with a real site's own query parameter.
 */
export const HOST_OVERRIDE_QUERY_KEY = '__mobilio_host';

/**
 * `targetUrl.hostname === primaryHost` → the proxy's bare `/s/:slug/<path>` form (no
 * override needed, that's what a request with no override query param already resolves
 * to). Any other allowed host — a subdomain, the www-variant if source.url omitted it,
 * … — carries HOST_OVERRIDE_QUERY_KEY explicitly, since the proxy path alone can't
 * otherwise distinguish "this project's primary host" from "this project's cdn
 * subdomain": both would otherwise look identical past `/s/:slug/`.
 */
export function buildProxyPath(slug: string, targetUrl: URL, primaryHost: string): string {
  const suffix = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  if (targetUrl.hostname === primaryHost) {
    return `/s/${slug}${suffix}`;
  }
  const separator = targetUrl.search ? '&' : '?';
  return `/s/${slug}${suffix}${separator}${HOST_OVERRIDE_QUERY_KEY}=${encodeURIComponent(targetUrl.hostname)}`;
}

/**
 * Rewrites one URL reference found in HTML/CSS (an href/src attribute, a CSS url(...)) —
 * resolved against the real page it came from, not the proxy's own URL, so relative and
 * absolute-path references both resolve the same way a real browser loading the actual
 * site would. Three outcomes: malformed or a non-http(s) scheme (mailto:, tel:,
 * javascript:, data:, …) → left completely untouched; host outside the allowlist →
 * also left untouched (an absolute link to the real external host) so the click-
 * interceptor script injected by html-rewriter.ts can still find and target=_blank it at
 * runtime, and so a disallowed *resource* reference (rare, but possible) just fails to
 * load exactly as it would without this proxy, rather than being silently redirected
 * somewhere; host allowed → rewritten into the proxy-relative scheme.
 */
export function rewriteReferencedUrl(
  raw: string,
  currentPageUrl: URL,
  allowlist: HostAllowlist,
  slug: string,
  primaryHost: string,
): string {
  let absolute: URL;
  try {
    absolute = new URL(raw, currentPageUrl);
  } catch {
    return raw;
  }
  if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
    return raw;
  }
  if (!isUrlHostAllowed(absolute, allowlist)) {
    return raw;
  }
  return buildProxyPath(slug, absolute, primaryHost);
}
