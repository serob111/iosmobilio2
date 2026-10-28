import { validatePreviewEnv, previewProxyOrigin, previewProxyDomain, previewProxyScheme } from './validate-preview-env.js';

describe('validatePreviewEnv', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes when PREVIEW_PROXY_DOMAIN is a different registrable domain from WEB_ORIGIN', () => {
    process.env.WEB_ORIGIN = 'https://app.mobilio.example';
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('throws when PREVIEW_PROXY_DOMAIN is missing', () => {
    delete process.env.PREVIEW_PROXY_DOMAIN;
    expect(() => validatePreviewEnv()).toThrow(/PREVIEW_PROXY_DOMAIN must be set/);
  });

  it('throws when PREVIEW_PROXY_DOMAIN is not a valid hostname', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'not a hostname';
    expect(() => validatePreviewEnv()).toThrow(/valid hostname/);
  });

  it('throws when PREVIEW_PROXY_DOMAIN is a full URL instead of a bare hostname', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'https://mobilio-preview.example';
    expect(() => validatePreviewEnv()).toThrow(/bare hostname/);
  });

  it('throws when PREVIEW_PROXY_DOMAIN carries a port', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example:3012';
    expect(() => validatePreviewEnv()).toThrow(/bare hostname/);
  });

  it('throws when PREVIEW_PROXY_DOMAIN carries a path', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example/s';
    expect(() => validatePreviewEnv()).toThrow(/bare hostname/);
  });

  it('throws when PREVIEW_PROXY_SCHEME is not http or https', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    process.env.PREVIEW_PROXY_SCHEME = 'ftp';
    expect(() => validatePreviewEnv()).toThrow(/"http" or "https"/);
  });

  it('allows PREVIEW_PROXY_PORT to be unset', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    delete process.env.PREVIEW_PROXY_PORT;
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('allows a valid PREVIEW_PROXY_PORT', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    process.env.PREVIEW_PROXY_PORT = '3011';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('throws when PREVIEW_PROXY_PORT is not numeric', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    process.env.PREVIEW_PROXY_PORT = 'abc';
    expect(() => validatePreviewEnv()).toThrow(/valid port number/);
  });

  it('throws when PREVIEW_PROXY_PORT is out of range', () => {
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    process.env.PREVIEW_PROXY_PORT = '99999';
    expect(() => validatePreviewEnv()).toThrow(/valid port number/);
  });

  it('throws when PREVIEW_PROXY_DOMAIN is a subdomain of WEB_ORIGIN (same registrable domain)', () => {
    process.env.WEB_ORIGIN = 'https://app.mobilio.example';
    process.env.PREVIEW_PROXY_DOMAIN = 'preview.mobilio.example';
    expect(() => validatePreviewEnv()).toThrow(/different registrable domain/);
  });

  it('throws when PREVIEW_PROXY_DOMAIN and WEB_ORIGIN share the exact same host (different ports)', () => {
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.PREVIEW_PROXY_DOMAIN = 'localhost';
    expect(() => validatePreviewEnv()).toThrow(/different host/);
  });

  it('allows two different non-PSL hostnames (e.g. localhost vs 127.0.0.1) even though neither resolves on the PSL', () => {
    process.env.WEB_ORIGIN = 'http://127.0.0.1:3000';
    process.env.PREVIEW_PROXY_DOMAIN = 'localhost';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('defaults WEB_ORIGIN to http://localhost:3000 when unset', () => {
    delete process.env.WEB_ORIGIN;
    process.env.PREVIEW_PROXY_DOMAIN = 'preview.localhost';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('correctly handles multi-label TLDs (co.uk) rather than naive last-two-labels splitting', () => {
    process.env.WEB_ORIGIN = 'https://app.mobilio.co.uk';
    process.env.PREVIEW_PROXY_DOMAIN = 'preview.mobilio.co.uk';
    expect(() => validatePreviewEnv()).toThrow(/different registrable domain/);
  });
});

describe('previewProxyOrigin/previewProxyDomain/previewProxyScheme', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to https', () => {
    delete process.env.PREVIEW_PROXY_SCHEME;
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    expect(previewProxyScheme()).toBe('https');
    expect(previewProxyDomain()).toBe('mobilio-preview.example');
    expect(previewProxyOrigin('abcdefghijklmnopqrstuvwxyz')).toBe('https://abcdefghijklmnopqrstuvwxyz.mobilio-preview.example');
  });

  it('honors PREVIEW_PROXY_SCHEME=http', () => {
    process.env.PREVIEW_PROXY_SCHEME = 'http';
    process.env.PREVIEW_PROXY_DOMAIN = 'preview.localhost';
    expect(previewProxyOrigin('slug1')).toBe('http://slug1.preview.localhost');
  });

  it('includes PREVIEW_PROXY_PORT when set (local dev, where the api answers on a non-default port)', () => {
    process.env.PREVIEW_PROXY_SCHEME = 'http';
    process.env.PREVIEW_PROXY_DOMAIN = 'preview.localhost';
    process.env.PREVIEW_PROXY_PORT = '3011';
    expect(previewProxyOrigin('slug1')).toBe('http://slug1.preview.localhost:3011');
  });

  it('omits the port entirely when PREVIEW_PROXY_PORT is unset (real deployments, default 443)', () => {
    delete process.env.PREVIEW_PROXY_PORT;
    process.env.PREVIEW_PROXY_DOMAIN = 'mobilio-preview.example';
    expect(previewProxyOrigin('slug1')).toBe('https://slug1.mobilio-preview.example');
  });

  it('throws from previewProxyDomain() when PREVIEW_PROXY_DOMAIN is unset', () => {
    delete process.env.PREVIEW_PROXY_DOMAIN;
    expect(() => previewProxyDomain()).toThrow(/PREVIEW_PROXY_DOMAIN must be set/);
  });
});
