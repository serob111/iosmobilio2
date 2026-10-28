import { getDomain } from 'tldts';

const VALID_SCHEMES = new Set(['http', 'https']);

/**
 * Called once at app bootstrap, same timing/rationale as validateBuildEnv() — a
 * misconfigured PREVIEW_PROXY_DOMAIN should fail to start the app outright, not boot
 * successfully and silently let the proxy run on a cookie-sharing domain.
 *
 * Every preview gets its own origin, `<slug>.<PREVIEW_PROXY_DOMAIN>` — PREVIEW_PROXY_DOMAIN
 * itself must be on a *different registrable domain* from WEB_ORIGIN, not merely a
 * different subdomain: the whole point is that cookies/same-site policy must not cross
 * between the main app and the sandboxed proxied content, and browsers scope "site" by
 * registrable domain (eTLD+1), not by origin or hostname — true for every subdomain of
 * PREVIEW_PROXY_DOMAIN transitively, so checking the domain itself is sufficient.
 * `tldts`'s `getDomain` (PSL-aware, handles multi-label TLDs like co.uk correctly) is
 * used instead of a naive "last two labels" split for that reason.
 */
export function validatePreviewEnv(): void {
  const proxyDomain = process.env.PREVIEW_PROXY_DOMAIN;
  if (!proxyDomain) {
    throw new Error('PREVIEW_PROXY_DOMAIN must be set');
  }
  // A bare hostname, not a URL — no scheme, no port, no path, no leading/trailing dot.
  // Every preview's own slug subdomain is built by prepending a label to this value
  // directly (`${slug}.${proxyDomain}`), so anything else embedded here would corrupt
  // every preview link and the host-routing split in create-app.ts alike.
  let parsedAsHost: URL;
  try {
    parsedAsHost = new URL(`http://${proxyDomain}/`);
  } catch {
    throw new Error('PREVIEW_PROXY_DOMAIN must be a valid hostname');
  }
  if (parsedAsHost.hostname !== proxyDomain || parsedAsHost.port || parsedAsHost.pathname !== '/') {
    throw new Error('PREVIEW_PROXY_DOMAIN must be a bare hostname (no scheme, no port, no path)');
  }

  const scheme = process.env.PREVIEW_PROXY_SCHEME ?? 'https';
  if (!VALID_SCHEMES.has(scheme)) {
    throw new Error('PREVIEW_PROXY_SCHEME must be "http" or "https"');
  }

  // Optional — real deployments always answer on the scheme's default port (443 behind
  // a reverse proxy), so every generated preview link just omits it. Local dev is the
  // one case this api's own listen port is ever non-default (see README's *.localhost
  // section), and without this a generated link would silently point at :80/:443 where
  // nothing is actually listening.
  const portRaw = process.env.PREVIEW_PROXY_PORT;
  if (portRaw !== undefined && (!/^\d+$/.test(portRaw) || Number(portRaw) < 1 || Number(portRaw) > 65535)) {
    throw new Error('PREVIEW_PROXY_PORT must be a valid port number (1-65535) if set');
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
  if (proxyDomain === webOrigin.hostname) {
    throw new Error(
      'PREVIEW_PROXY_DOMAIN must be a different host from WEB_ORIGIN — ' +
        `both are "${webOrigin.hostname}", cookies/same-site must not cross`,
    );
  }
  // tldts' getDomain() returns null for hosts it can't place on the PSL at all (bare
  // "localhost", raw IP literals, custom dev TLDs) — for those there's no eTLD+1 to
  // compare, so two DIFFERENT such hostnames are correctly treated as different sites,
  // not forced into a false "both unresolvable, so same" match.
  const proxyRegistrableDomain = getDomain(proxyDomain);
  const webDomain = getDomain(webOrigin.hostname);
  if (proxyRegistrableDomain !== null && webDomain !== null && proxyRegistrableDomain === webDomain) {
    throw new Error(
      'PREVIEW_PROXY_DOMAIN must be on a different registrable domain from WEB_ORIGIN ' +
        `(both resolve to "${proxyRegistrableDomain}") — a subdomain is not enough, cookies/same-site must not cross`,
    );
  }
}

export function previewProxyScheme(): string {
  return process.env.PREVIEW_PROXY_SCHEME ?? 'https';
}

export function previewProxyDomain(): string {
  const domain = process.env.PREVIEW_PROXY_DOMAIN;
  if (!domain) {
    throw new Error('PREVIEW_PROXY_DOMAIN must be set');
  }
  return domain;
}

/** `https://<slug>.<PREVIEW_PROXY_DOMAIN>[:PREVIEW_PROXY_PORT]` — the origin a specific preview link answers on. */
export function previewProxyOrigin(slug: string): string {
  const port = process.env.PREVIEW_PROXY_PORT;
  const authority = port ? `${slug}.${previewProxyDomain()}:${port}` : `${slug}.${previewProxyDomain()}`;
  return `${previewProxyScheme()}://${authority}`;
}
