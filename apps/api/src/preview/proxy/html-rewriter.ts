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
 * The external-link click interceptor + a document.cookie / cookieStore.set override,
 * injected as the first element of <head> (or, if the document has no <head> at all,
 * before whatever comes first instead — see where this is called from below) — as early
 * as structurally possible, before any of the real page's own <head> scripts get a chance
 * to run. The previous version injected this at the start of <body>, which runs strictly
 * *after* every synchronous <head> script — a page with an early, synchronous
 * `document.cookie = '...; Domain=...'` in its own <head> would have already set the
 * wide-scoped cookie before this override ever installed.
 *
 * The click interceptor compares the clicked link's *resolved* origin against
 * window.location.origin rather than re-deriving the allowlist client-side — every link
 * this rewriter already decided was allowed is now proxy-relative (same origin as the
 * page itself); every link it left untouched is a real, different-origin absolute URL.
 * That's already exactly "internal vs external", with no need to duplicate
 * host-allowlist.ts's logic in a client-side script. Registering the listener this early
 * (before <body> exists) is fine — `document.addEventListener` doesn't need the target
 * elements to exist yet, only to exist by the time a click actually happens.
 *
 * The cookie override strips any `Domain=...` attribute from cookies the real site's own
 * JS sets, via both the classic `document.cookie = ...` setter and the newer async
 * Cookie Store API (`cookieStore.set(...)`, only the object-options overload can even
 * carry a domain). Each preview already has its own slug subdomain for the scoping that
 * matters (a <slug>.<PREVIEW_PROXY_DOMAIN>-scoped cookie can't be read by a different
 * slug's origin) — but an explicit `Domain=<PREVIEW_PROXY_DOMAIN>` (or any of its parent
 * domains) widens that scope to every OTHER preview sharing the same
 * PREVIEW_PROXY_DOMAIN, defeating the whole point. Server-side `Set-Cookie` is already
 * fully stripped (header-filter.ts), but a cookie set dynamically in the page's own JS
 * never goes through an HTTP response header at all, so it has to be caught here instead.
 * `document.cookie`'s override lives on `Document.prototype` (not the `document`
 * instance) so it still applies even to a page that reassigns `document.cookie` before
 * this script manages to run on some OTHER document reference — there is only one
 * prototype.
 *
 * Honest limits, not actually closed by this script: this is best-effort hardening for
 * the *current document's* globals only. A same-page `<iframe>` has its own `Document`/
 * `window` — a fresh realm this override never touches — so a page that embeds its own
 * cross-origin iframe and sets cookies from inside *that* bypasses this entirely. The
 * actual security boundary two things this is not: (1) the slug subdomain being
 * registered on the Public Suffix List, so browsers really do treat it as its own site
 * rather than a sibling of every other preview under PREVIEW_PROXY_DOMAIN (see README's
 * launch checklist); and (2) this proxy never forwarding the browser's own Cookie header
 * to the upstream site at all (proxy-fetch.ts) — nothing this override fails to catch can
 * turn into the upstream site reading a cookie that was never sent to it in the first
 * place.
 */
function cookieInterceptorScript(): string {
  return `<script>(function(){var d=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');if(d&&d.set){Object.defineProperty(Document.prototype,'cookie',{configurable:true,get:function(){return d.get.call(this);},set:function(v){d.set.call(this,String(v).replace(/;\\s*domain\\s*=[^;]*/gi,''));}});}if(window.cookieStore&&window.cookieStore.set){var originalSet=window.cookieStore.set.bind(window.cookieStore);window.cookieStore.set=function(a,b){if(a&&typeof a==='object'){var opts={};for(var k in a){if(k!=='domain')opts[k]=a[k];}return originalSet(opts);}return originalSet(a,b);};}document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var href=a.getAttribute('href');if(!href)return;try{var url=new URL(href,document.baseURI);if(url.origin!==window.location.origin){e.preventDefault();window.open(url.href,'_blank','noopener,noreferrer');}}catch(err){}},true);})();</script>`;
}

/** Fixed banner ("Preview · Mobilio"), injected as the first child of <body>. */
function bannerHtml(): string {
  return `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#fff;font:12px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:4px 8px;pointer-events:none;">Preview · Mobilio</div>`;
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
  // parse5-sax-parser (which this is built on) reports tags exactly as they appear in the
  // source — it does not synthesize an implied <head>/<body> the way a full tree-building
  // HTML parser would. So "no <head> at all" is a real case to handle, not a hypothetical
  // one: fall back to injecting right before <body> instead (still "first in the
  // document" for any realistic page — every real site's homepage has a <body>, even if
  // it omits <head>). A document with neither tag at all isn't handled specially: there's
  // no reliable "stream is about to end, push one more chunk" hook on this Transform that
  // doesn't risk pushing after the readable side has already signaled completion, and no
  // real website serves a bodyless page, so this is an accepted, narrow gap rather than a
  // realistic one.
  let scriptInjected = false;

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

    if (!scriptInjected && startTag.tagName === 'head') {
      rewriter.emitStartTag(startTag);
      rewriter.emitRaw(cookieInterceptorScript());
      scriptInjected = true;
      return;
    }
    if (!scriptInjected && startTag.tagName === 'body') {
      rewriter.emitRaw(cookieInterceptorScript());
      scriptInjected = true;
    }

    rewriter.emitStartTag(startTag);
    // Emitted right after <body>'s own start tag, so the banner is the first child of
    // <body> (not the last, which emitting on body's *end* tag would produce).
    if (startTag.tagName === 'body') {
      rewriter.emitRaw(bannerHtml());
    }
  });

  return rewriter;
}
