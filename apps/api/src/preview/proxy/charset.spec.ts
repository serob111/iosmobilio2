import { detectCharset, decodeToUtf8, withCharset } from './charset.js';

// "Привет, мир! Курсы валют сегодня хорошие." encoded as windows-1251 — independently
// verified via `iconv-lite`'s `encode(text, 'win1251')` and round-tripped through
// `new TextDecoder('windows-1251').decode(...)` before being hardcoded here, so this
// fixture needs no runtime dependency on any charset-encoding library at all.
const WINDOWS_1251_BYTES = Buffer.from([
  207, 240, 232, 226, 229, 242, 44, 32, 236, 232, 240, 33, 32, 202, 243, 240, 241, 251, 32, 226, 224, 235, 254, 242,
  32, 241, 229, 227, 238, 228, 237, 255, 32, 245, 238, 240, 238, 248, 232, 229, 46,
]);
const WINDOWS_1251_TEXT = 'Привет, мир! Курсы валют сегодня хорошие.';

describe('detectCharset', () => {
  it('reads the charset from the Content-Type header', () => {
    expect(detectCharset('text/html; charset=windows-1251', Buffer.from('<html></html>'))).toBe('windows-1251');
  });

  it('is case-insensitive and lowercases the result', () => {
    expect(detectCharset('text/html; Charset=WINDOWS-1251', Buffer.from('x'))).toBe('windows-1251');
  });

  it('handles a quoted charset value in the header', () => {
    expect(detectCharset('text/html; charset="windows-1251"', Buffer.from('x'))).toBe('windows-1251');
  });

  it('falls back to a <meta charset> tag when the header has none', () => {
    const body = Buffer.from('<html><head><meta charset="windows-1251"></head></html>');
    expect(detectCharset('text/html', body)).toBe('windows-1251');
  });

  it('falls back to a legacy <meta http-equiv="Content-Type"> tag', () => {
    const body = Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=koi8-r"></head></html>');
    expect(detectCharset('text/html', body)).toBe('koi8-r');
  });

  it('only sniffs the first 1024 bytes of the body', () => {
    const padding = 'x'.repeat(1100);
    const body = Buffer.from(`<html><!-- ${padding} --><meta charset="windows-1251"></html>`);
    expect(detectCharset('text/html', body)).toBeNull();
  });

  it('returns null when neither the header nor the body declares a charset', () => {
    expect(detectCharset('text/html', Buffer.from('<html><body>hi</body></html>'))).toBeNull();
  });

  it('returns null when there is no Content-Type header and no meta tag', () => {
    expect(detectCharset(null, Buffer.from('<html></html>'))).toBeNull();
  });
});

describe('decodeToUtf8', () => {
  it('correctly decodes a real windows-1251-encoded page into UTF-8', () => {
    const decoded = decodeToUtf8(WINDOWS_1251_BYTES, 'windows-1251');
    expect(decoded).not.toBeNull();
    expect(decoded!.toString('utf8')).toBe(WINDOWS_1251_TEXT);
  });

  it('is case-insensitive for the label', () => {
    const decoded = decodeToUtf8(WINDOWS_1251_BYTES, 'WINDOWS-1251');
    expect(decoded!.toString('utf8')).toBe(WINDOWS_1251_TEXT);
  });

  it('returns null for an unrecognized charset label', () => {
    expect(decodeToUtf8(Buffer.from('hello'), 'totally-bogus-label')).toBeNull();
  });

  it('round-trips plain UTF-8 bytes unchanged when the label is utf-8', () => {
    const original = Buffer.from('héllo wörld 你好', 'utf8');
    const decoded = decodeToUtf8(original, 'utf-8');
    expect(decoded!.toString('utf8')).toBe('héllo wörld 你好');
  });
});

describe('withCharset', () => {
  it('replaces an existing unquoted charset parameter', () => {
    expect(withCharset('text/html; charset=windows-1251', 'utf-8')).toBe('text/html; charset=utf-8');
  });

  it('replaces an existing quoted charset parameter without leaving a stray quote', () => {
    expect(withCharset('text/html; charset="windows-1251"', 'utf-8')).toBe('text/html; charset=utf-8');
  });

  it('appends a charset parameter when none exists', () => {
    expect(withCharset('text/html', 'utf-8')).toBe('text/html; charset=utf-8');
  });
});
