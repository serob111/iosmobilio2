import { getDomain } from 'tldts';

/**
 * Called once at app bootstrap, same timing/rationale as validateBuildEnv() — a
 * misconfigured PREVIEW_PROXY_ORIGIN should fail to start the app outright, not boot
 * successfully and silently let the proxy run on a cookie-sharing origin.
 *
 * PREVIEW_PROXY_ORIGIN must be on a *different registrable domain* from WEB_ORIGIN, not
 * merely a different subdomain — the whole point of the separate-domain requirement is
 * that cookies/same-site policy must not cross between the main app and the sandboxed
 * proxied content, and browsers scope "site" by registrable domain (eTLD+1), not by
 * origin or hostname. `preview.mobilio.app` vs `app.mobilio.app` would still be the same
 * site; `tldts`'s `getDomain` (PSL-aware, handles multi-label TLDs like co.uk correctly)
 * is used instead of a naive "last two labels" split for that reason.
 */
export function validatePreviewEnv(): void {
  const proxyOriginRaw = process.env.PREVIEW_PROXY_ORIGIN;
  if (!proxyOriginRaw) {
    throw new Error('PREVIEW_PROXY_ORIGIN must be set');
  }

  let proxyOrigin: URL;
  try {
    proxyOrigin = new URL(proxyOriginRaw);
  } catch {
    throw new Error('PREVIEW_PROXY_ORIGIN must be a valid absolute URL');
  }
  if (proxyOrigin.protocol !== 'http:' && proxyOrigin.protocol !== 'https:') {
    throw new Error('PREVIEW_PROXY_ORIGIN must use http:// or https://');
  }

  const webOriginRaw = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  let webOrigin: URL;
  try {
    webOrigin = new URL(webOriginRaw);
  } catch {
    throw new Error('WEB_ORIGIN must be a valid absolute URL');
  }

  // Identical hostnames (e.g. two ports on the same `localhost`) are the same site
  // regardless of the public suffix list — browsers scope "site" by host, ignoring port.
  // tldts' getDomain() returns null for hosts it can't place on the PSL at all (bare
  // "localhost", raw IP literals, custom dev TLDs) — for those there's no eTLD+1 to
  // compare, so two DIFFERENT such hostnames (e.g. "localhost" vs "127.0.0.1", or two
  // distinct /etc/hosts entries) are correctly treated as different sites, not forced
  // into a false "both unresolvable, so same" match.
  if (proxyOrigin.hostname === webOrigin.hostname) {
    throw new Error(
      'PREVIEW_PROXY_ORIGIN must be on a different host from WEB_ORIGIN — ' +
        `both are "${webOrigin.hostname}", cookies/same-site must not cross`,
    );
  }
  const proxyDomain = getDomain(proxyOrigin.hostname);
  const webDomain = getDomain(webOrigin.hostname);
  if (proxyDomain !== null && webDomain !== null && proxyDomain === webDomain) {
    throw new Error(
      'PREVIEW_PROXY_ORIGIN must be on a different registrable domain from WEB_ORIGIN ' +
        `(both resolve to "${proxyDomain}") — a subdomain is not enough, cookies/same-site must not cross`,
    );
  }
}
