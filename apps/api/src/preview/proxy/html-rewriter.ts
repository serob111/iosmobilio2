import { RewritingStream } from 'parse5-html-rewriting-stream';
import type { HostAllowlist } from './host-allowlist.js';
import { rewriteReferencedUrl } from './rewrite-url.js';

const URL_ATTRS_BY_TAG: Record<string, string[]> = {
  a: ['href'],
  img: ['src'],
  link: ['href'],
  script: ['src'],
  source: ['src'],
  iframe: ['src'],
  form: ['action'],
  video: ['src', 'poster'],
  audio: ['src'],
};

/**
 * Fixed banner ("Preview · Mobilio") + the external-link click interceptor, injected as
 * the first child of <body>. The interceptor compares the clicked link's *resolved*
 * origin against window.location.origin rather than re-deriving the allowlist client-side
 * — every link this rewriter already decided was allowed is now proxy-relative (same
 * origin as the page itself); every link it left untouched is a real, different-origin
 * absolute URL. That's already exactly "internal vs external", with no need to duplicate
 * host-allowlist.ts's logic in a client-side script.
 */
function bannerAndInterceptorHtml(): string {
  return `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;font:12px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:4px 8px;pointer-events:none;">Preview · Mobilio</div><script>(function(){document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var href=a.getAttribute('href');if(!href)return;try{var url=new URL(href,document.baseURI);if(url.origin!==window.location.origin){e.preventDefault();window.open(url.href,'_blank','noopener,noreferrer');}}catch(err){}},true);})();</script>`;
}

// header-filter.ts already strips the *HTTP-header* forms of these — a page can also
// declare them via a <meta http-equiv="..."> tag, which headers alone can't touch and
// which browsers honor exactly like the real header. Left in place, a restrictive
// meta-CSP (no X-Frame-Options meta equivalent actually exists in the HTML spec, but
// some sites set it anyway as a defensive no-op; stripped here too, just in case some
// browser ever did honor it) would block the inline <script> this rewriter injects for
// the banner/click-interceptor below — the one piece of this proxy's own content that
// MUST run unconditionally, regardless of what the real page's own policy says.
const BLOCKED_META_HTTP_EQUIV = new Set(['content-security-policy', 'x-frame-options']);

function isBlockedMetaTag(tagName: string, attrs: { name: string; value: string }[]): boolean {
  if (tagName !== 'meta') {
    return false;
  }
  const httpEquiv = attrs.find((attr) => attr.name === 'http-equiv');
  return httpEquiv !== undefined && BLOCKED_META_HTTP_EQUIV.has(httpEquiv.value.toLowerCase());
}

export type HtmlRewriterOptions = {
  allowlist: HostAllowlist;
  /** The real upstream URL this page was actually fetched from — relative URLs in its markup resolve against this, not the proxy's own URL. */
  currentPageUrl: URL;
  primaryHost: string;
};

/**
 * A parse5-html-rewriting-stream RewritingStream, pre-wired for this proxy's rewrites.
 * Its *input* must already be a string stream (call `.setEncoding('utf8')` on whatever
 * Buffer-emitting stream feeds it — parse5-sax-parser refuses raw Buffer chunks outright
 * rather than silently mis-decoding multi-byte characters split across chunk boundaries).
 * Its *output* is also strings, which Node's http response can write directly.
 *
 * No <base> is inserted — every preview now has its own real origin
 * (`https://<slug>.<PREVIEW_PROXY_DOMAIN>`), so relative/path-absolute references in the
 * page's own markup already resolve correctly against it with no override needed; only
 * ABSOLUTE references to an allowed host go through rewriteReferencedUrl at all.
 *
 * Only href/src/action/poster attributes on a fixed, known set of tags are touched —
 * never inline event handlers or <script> *contents* (JS is never rewritten at all, see
 * README's "Неподписанный .ipa"-style caveat section for why: a partially-working preview
 * beats a rewriter subtly breaking a site's own JavaScript).
 */
export function createHtmlRewriteStream(options: HtmlRewriterOptions): RewritingStream {
  const rewriter = new RewritingStream();

  function rewriteUrl(raw: string): string {
    return rewriteReferencedUrl(raw, options.currentPageUrl, options.allowlist, options.primaryHost);
  }

  rewriter.on('startTag', (startTag) => {
    if (isBlockedMetaTag(startTag.tagName, startTag.attrs)) {
      // Omitted entirely — <meta> is a void element (no end tag, no children), so
      // simply not emitting this start tag removes it from the output completely.
      return;
    }
    const urlAttrs = URL_ATTRS_BY_TAG[startTag.tagName];
    if (urlAttrs) {
      for (const attr of startTag.attrs) {
        if (urlAttrs.includes(attr.name)) {
          attr.value = rewriteUrl(attr.value);
        }
      }
    }
    rewriter.emitStartTag(startTag);
    // Emitted right after <body>'s own start tag, so the banner is the first child of
    // <body> (not the last, which emitting on body's *end* tag would produce).
    if (startTag.tagName === 'body') {
      rewriter.emitRaw(bannerAndInterceptorHtml());
    }
  });

  return rewriter;
}
