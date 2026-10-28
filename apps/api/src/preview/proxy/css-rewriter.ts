import type { HostAllowlist } from './host-allowlist.js';
import { rewriteReferencedUrl } from './rewrite-url.js';

// Matches url(...) with an optional quote (', ", or none) around the reference, capturing
// the quote char (or empty) and the raw reference separately so the replacement can
// re-wrap with the exact same quoting style it found. CSS <url-token> values can't
// contain unescaped parens/quotes/whitespace unless quoted, so this is adequate for the
// real-world stylesheets this proxy serves (data: URIs are left alone by
// rewriteReferencedUrl itself, since it only rewrites allowlisted http(s) hosts).
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

export type CssRewriterOptions = {
  allowlist: HostAllowlist;
  currentPageUrl: URL;
  primaryHost: string;
};

/**
 * Rewrites every `url(...)` reference in a CSS text (stylesheet file, or an inline
 * `<style>` block) that points at an allowlisted host into the proxy-relative form —
 * same rule as HTML's href/src rewriting, via the shared `rewriteReferencedUrl` helper.
 * Not a streaming transform like the HTML rewriter: CSS files are comparatively small and
 * `proxy-fetch.ts`'s own 10MB cap already bounds the buffered size, so a single
 * synchronous regex pass is simpler and equally safe here.
 */
export function rewriteCss(css: string, options: CssRewriterOptions): string {
  return css.replace(CSS_URL_PATTERN, (match, quote: string, raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return match;
    }
    const rewritten = rewriteReferencedUrl(trimmed, options.currentPageUrl, options.allowlist, options.primaryHost);
    if (rewritten === trimmed) {
      return match;
    }
    const q = quote || '"';
    return `url(${q}${rewritten}${q})`;
  });
}
