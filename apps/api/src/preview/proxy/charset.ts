// Matches `charset=XXX` wherever it occurs inside a Content-Type header value or inside
// a <meta> tag's attributes — deliberately not anchored to a specific attribute name,
// since `<meta charset="utf-8">` (HTML5) and `<meta http-equiv="Content-Type"
// content="text/html; charset=windows-1251">` (legacy) both just need "charset=" to
// appear somewhere in the relevant string. The backreference (`\1`) requires the closing
// quote to match the opening one (or both absent) — without it, `.replace()` on a
// quoted value like `charset="windows-1251"` would consume only up to the closing quote
// and leave it dangling behind the replacement (`charset=utf-8"`).
const CHARSET_VALUE_PATTERN = /charset\s*=\s*(["']?)([a-zA-Z0-9_-]+)\1/i;
const META_TAG_WITH_CHARSET_PATTERN = /<meta[^>]*charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i;

const SNIFF_WINDOW_BYTES = 1024;

/**
 * Charset label from the Content-Type response header, or (if that header carries none)
 * sniffed from a `<meta charset>`/`<meta http-equiv="Content-Type" content="...charset=...">`
 * tag in the first 1024 bytes of the body — the same window real browsers use for this,
 * since the charset declaration has to appear early enough to matter. The sniff window is
 * read as latin1 (one byte -> one code point, never throws, never substitutes) rather
 * than any multi-byte-aware encoding: the declaration itself is always plain ASCII
 * regardless of the page's real encoding (ASCII is a subset of every encoding this proxy
 * might encounter), so a raw byte-for-byte read is both safe and sufficient to find it.
 * Returns null if neither source declares one at all — the caller treats that as "assume
 * UTF-8", not as "unknown", since UTF-8 is the modern default and SOMETHING without any
 * declaration almost certainly already is UTF-8 rather than some undeclared legacy encoding.
 */
export function detectCharset(contentTypeHeader: string | null, body: Buffer): string | null {
  if (contentTypeHeader) {
    const match = CHARSET_VALUE_PATTERN.exec(contentTypeHeader);
    if (match) {
      return match[2]!.toLowerCase();
    }
  }
  const sniffWindow = body.subarray(0, SNIFF_WINDOW_BYTES).toString('latin1');
  const metaMatch = META_TAG_WITH_CHARSET_PATTERN.exec(sniffWindow);
  return metaMatch ? metaMatch[1]!.toLowerCase() : null;
}

/**
 * Decodes `body` (declared as `label`) into a UTF-8 buffer, or returns null if `label`
 * isn't a charset `TextDecoder` recognizes at all (its constructor throws synchronously
 * for an unsupported label) — the caller's job, not this function's, to decide what to
 * do with an unrecognized label (this proxy serves the original bytes untouched rather
 * than risk running a UTF-8-only HTML parser over text that was never UTF-8 to begin
 * with, which could corrupt the page far worse than leaving it alone).
 */
export function decodeToUtf8(body: Buffer, label: string): Buffer | null {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    return null;
  }
  return Buffer.from(decoder.decode(body), 'utf8');
}

/** Replaces (or appends) the `charset=` parameter in a Content-Type header value. */
export function withCharset(contentType: string, charset: string): string {
  if (CHARSET_VALUE_PATTERN.test(contentType)) {
    return contentType.replace(CHARSET_VALUE_PATTERN, `charset=${charset}`);
  }
  return `${contentType}; charset=${charset}`;
}
