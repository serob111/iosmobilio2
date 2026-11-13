import { isUrlHostAllowed, type HostAllowlist } from './host-allowlist.js';

/**
 * Query key the proxy uses to remember which (non-primary, but allowed) host a rewritten
 * link actually points at — e.g. a subdomain's asset. Deliberately obscure/namespaced so
 * it can never collide with a real site's own query parameter.
 */
export const HOST_OVERRIDE_QUERY_KEY = '__mobilio_host';

/**
 * Every preview now has its own real origin (`https://<slug>.<PREVIEW_PROXY_DOMAIN>`),
 * so a reference to the project's *primary* host (or its www-variant — both fold to the
 * same `primaryHost` via host-allowlist.ts) rewrites to a bare path-absolute reference:
 * it already resolves correctly against the current page's own origin, no slug prefix or
 * `<base>` override needed at all. Any OTHER allowed host — a subdomain, a CDN — still
 * needs HOST_OVERRIDE_QUERY_KEY, since the bare path alone can't otherwise distinguish
 * "this preview's primary host" from "this preview's cdn subdomain": both would
 * otherwise look identical past the shared origin.
 */
export function buildProxyPath(targetUrl: URL, primaryHost: string): string {
  const suffix = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  if (targetUrl.hostname === primaryHost) {
    return suffix;
  }
  const separator = targetUrl.search ? '&' : '?';
  return `${suffix}${separator}${HOST_OVERRIDE_QUERY_KEY}=${encodeURIComponent(targetUrl.hostname)}`;
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
 * somewhere; host allowed → rewritten into the path-absolute, same-origin scheme.
 */
export function rewriteReferencedUrl(
  raw: string,
  currentPageUrl: URL,
  allowlist: HostAllowlist,
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
  return buildProxyPath(absolute, primaryHost);
}
