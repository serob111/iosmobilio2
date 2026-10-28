import { buildProxyResponseHeaders } from './header-filter.js';

const WEB_ORIGIN = 'https://app.mobilio.example';

describe('buildProxyResponseHeaders', () => {
  it('strips Set-Cookie', () => {
    const upstream = new Headers({ 'set-cookie': 'session=abc; Path=/', 'content-type': 'text/html' });
    const result = buildProxyResponseHeaders(upstream, WEB_ORIGIN);
    expect(result.has('set-cookie')).toBe(false);
    expect(result.get('content-type')).toBe('text/html');
  });

  it('strips X-Frame-Options', () => {
    const upstream = new Headers({ 'x-frame-options': 'DENY' });
    const result = buildProxyResponseHeaders(upstream, WEB_ORIGIN);
    expect(result.has('x-frame-options')).toBe(false);
  });

  it('strips Content-Security-Policy and Content-Security-Policy-Report-Only', () => {
    const upstream = new Headers({
      'content-security-policy': "frame-ancestors 'none'",
      'content-security-policy-report-only': "default-src 'self'",
    });
    const result = buildProxyResponseHeaders(upstream, WEB_ORIGIN);
    // Both are stripped, then replaced with exactly our own CSP — count stays at one.
    expect(result.get('content-security-policy')).toBe(`frame-ancestors ${WEB_ORIGIN}`);
    expect(result.has('content-security-policy-report-only')).toBe(false);
  });

  it('strips Strict-Transport-Security', () => {
    const upstream = new Headers({ 'strict-transport-security': 'max-age=63072000' });
    const result = buildProxyResponseHeaders(upstream, WEB_ORIGIN);
    expect(result.has('strict-transport-security')).toBe(false);
  });

  it('strips Clear-Site-Data', () => {
    const upstream = new Headers({ 'clear-site-data': '"cache","cookies"' });
    const result = buildProxyResponseHeaders(upstream, WEB_ORIGIN);
    expect(result.has('clear-site-data')).toBe(false);
  });

  it('always sets our own CSP/X-Robots-Tag/Referrer-Policy/Cross-Origin-Resource-Policy, even when upstream set none', () => {
    const result = buildProxyResponseHeaders(new Headers(), WEB_ORIGIN);
    expect(result.get('content-security-policy')).toBe(`frame-ancestors ${WEB_ORIGIN}`);
    expect(result.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(result.get('referrer-policy')).toBe('no-referrer');
    expect(result.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('passes through ordinary content headers untouched', () => {
    const upstream = new Headers({ 'content-type': 'image/png', 'cache-control': 'max-age=60' });
    const result = buildProxyResponseHeaders(upstream, WEB_ORIGIN);
    expect(result.get('content-type')).toBe('image/png');
    expect(result.get('cache-control')).toBe('max-age=60');
  });
});
