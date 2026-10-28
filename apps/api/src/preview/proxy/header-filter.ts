const STRIPPED_RESPONSE_HEADER_NAMES = new Set([
  'set-cookie',
  'x-frame-options',
  'strict-transport-security',
  'clear-site-data',
  // `fetch()` (undici) transparently decompresses gzip/br/deflate bodies, but leaves
  // Content-Encoding and Content-Length on the Headers object exactly as the upstream
  // sent them — i.e. describing the *compressed* bytes, which is no longer what's
  // actually being sent (proxy.controller.ts always forwards the already-decoded body).
  // Passing either through verbatim would make the browser try to gunzip/brotli-decode
  // plain text a second time (broken/garbled page) or mismatch the real body length.
  'content-encoding',
  'content-length',
  // Hop-by-hop headers (RFC 7230 §6.1) — meaningful only for the single connection
  // between this proxy and the upstream site, never for the one between the browser and
  // this proxy. Forwarding them verbatim is a protocol-correctness bug independent of
  // the Content-Encoding one above (e.g. a stray `Connection: close` or
  // `Transfer-Encoding: chunked` from the upstream hop has no business reaching the
  // browser, which has its own, unrelated connection to *this* proxy).
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
]);

/** Prefix match for Content-Security-Policy, not an exact set — also catches Content-Security-Policy-Report-Only and any future directive variant. */
function shouldStripResponseHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return STRIPPED_RESPONSE_HEADER_NAMES.has(lower) || lower.startsWith('content-security-policy');
}

/**
 * The upstream site's own Set-Cookie/XFO/CSP/HSTS/Clear-Site-Data are stripped — a real
 * site's own frame-busting (X-Frame-Options, CSP's frame-ancestors) would otherwise
 * defeat the whole point of this proxy, and its own cookies/HSTS/Clear-Site-Data have no
 * business reaching a browser that's looking at usercontent-preview.example, not the real
 * site's origin. Our own replacements are then set unconditionally: a CSP that allows
 * *only* webOrigin to frame this response (not the upstream site's own, now-removed,
 * policy), noindex/nofollow (this is someone else's content, served from our domain —
 * search engines must never index it as ours), no-referrer (the preview viewer's
 * navigation history is not this proxy's to leak to the upstream site), and
 * Cross-Origin-Resource-Policy: cross-origin (the shell page on WEB_ORIGIN needs to be
 * able to load these responses into its <iframe> at all).
 *
 * The *request* side has no corresponding "strip the client's Cookie header" step because
 * there's nothing to strip: the proxy never reads/forwards the incoming request's headers
 * in the first place (see proxy.controller.ts) — not forwarding by construction, rather
 * than filtering out what was never collected.
 */
export function buildProxyResponseHeaders(upstreamHeaders: Headers, webOrigin: string): Headers {
  const result = new Headers();
  for (const [name, value] of upstreamHeaders) {
    if (shouldStripResponseHeader(name)) continue;
    result.set(name, value);
  }
  result.set('Content-Security-Policy', `frame-ancestors ${webOrigin}`);
  result.set('X-Robots-Tag', 'noindex, nofollow');
  result.set('Referrer-Policy', 'no-referrer');
  result.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return result;
}
