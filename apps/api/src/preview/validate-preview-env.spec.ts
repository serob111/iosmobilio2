import { validatePreviewEnv } from './validate-preview-env.js';

describe('validatePreviewEnv', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes when PREVIEW_PROXY_ORIGIN is a different registrable domain from WEB_ORIGIN', () => {
    process.env.WEB_ORIGIN = 'https://app.mobilio.example';
    process.env.PREVIEW_PROXY_ORIGIN = 'https://mobilio-preview.example';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('throws when PREVIEW_PROXY_ORIGIN is missing', () => {
    delete process.env.PREVIEW_PROXY_ORIGIN;
    expect(() => validatePreviewEnv()).toThrow(/PREVIEW_PROXY_ORIGIN must be set/);
  });

  it('throws when PREVIEW_PROXY_ORIGIN is not a valid URL', () => {
    process.env.PREVIEW_PROXY_ORIGIN = 'not a url';
    expect(() => validatePreviewEnv()).toThrow(/valid absolute URL/);
  });

  it('throws when PREVIEW_PROXY_ORIGIN uses a non-http(s) scheme', () => {
    process.env.PREVIEW_PROXY_ORIGIN = 'ftp://mobilio-preview.example';
    expect(() => validatePreviewEnv()).toThrow(/http/);
  });

  it('throws when PREVIEW_PROXY_ORIGIN is a subdomain of WEB_ORIGIN (same registrable domain)', () => {
    process.env.WEB_ORIGIN = 'https://app.mobilio.example';
    process.env.PREVIEW_PROXY_ORIGIN = 'https://preview.mobilio.example';
    expect(() => validatePreviewEnv()).toThrow(/different registrable domain/);
  });

  it('throws when PREVIEW_PROXY_ORIGIN and WEB_ORIGIN share the exact same host (different ports)', () => {
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.PREVIEW_PROXY_ORIGIN = 'http://localhost:3012';
    expect(() => validatePreviewEnv()).toThrow(/different host/);
  });

  it('allows two different non-PSL hostnames (e.g. localhost vs 127.0.0.1) even though neither resolves on the PSL', () => {
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.PREVIEW_PROXY_ORIGIN = 'http://127.0.0.1:3012';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('defaults WEB_ORIGIN to http://localhost:3000 when unset', () => {
    delete process.env.WEB_ORIGIN;
    process.env.PREVIEW_PROXY_ORIGIN = 'http://127.0.0.1:3012';
    expect(() => validatePreviewEnv()).not.toThrow();
  });

  it('correctly handles multi-label TLDs (co.uk) rather than naive last-two-labels splitting', () => {
    process.env.WEB_ORIGIN = 'https://app.mobilio.co.uk';
    process.env.PREVIEW_PROXY_ORIGIN = 'https://preview.mobilio.co.uk';
    expect(() => validatePreviewEnv()).toThrow(/different registrable domain/);
  });
});
