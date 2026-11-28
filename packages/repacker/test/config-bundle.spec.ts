import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '@mobilio/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateProjectConfig, writeConfigJson } from '../src/config-bundle';
import { RepackError } from '../src/errors';

function validRawConfig(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'p1',
    name: 'Cafe Mobilio',
    slug: 'cafe-mobilio',
    bundleId: 'am.mobilio.t.cafe',
    source: { type: 'url', url: 'https://cafe-mobilio.example' },
    theme: { primary: '#2563EB', background: '#FFFFFF', statusBar: 'dark' },
    tabs: [{ title: 'Home', icon: 'home', path: '/' }],
    features: { offline: true, share: true, deepLinks: false, pullToRefresh: true, push: false },
    allowedDomains: ['cafe-mobilio.example'],
    trial: true,
    ...overrides,
  };
}

describe('validateProjectConfig', () => {
  it('returns the parsed config for a valid input', () => {
    const result = validateProjectConfig(validRawConfig());
    expect(result.bundleId).toBe('am.mobilio.t.cafe');
  });

  it('throws INVALID_CONFIG for an input missing required fields', () => {
    expect(() => validateProjectConfig({ id: 'p1' })).toThrow(RepackError);
    try {
      validateProjectConfig({ id: 'p1' });
    } catch (error) {
      expect((error as RepackError).code).toBe('INVALID_CONFIG');
    }
  });

  it('throws INVALID_CONFIG for a config with an invalid theme color', () => {
    expect(() => validateProjectConfig(validRawConfig({ theme: { primary: 'not-a-color', background: '#FFFFFF', statusBar: 'dark' } }))).toThrow(
      RepackError,
    );
  });
});

describe('writeConfigJson', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repacker-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a valid config as JSON that round-trips', async () => {
    const config = validateProjectConfig(validRawConfig()) as ProjectConfig;
    await writeConfigJson(dir, config);
    const written = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(written.bundleId).toBe('am.mobilio.t.cafe');
  });

  it('throws INVALID_CONFIG when the serialized config exceeds 256KB', async () => {
    // allowedDomains has no max-length cap in ProjectConfigSchema (unlike tabs, capped
    // at 5) — the one field that lets a schema-valid config still balloon past 256KB.
    const hugeDomainList = Array.from({ length: 10000 }, (_, i) => `subdomain-number-${i}.example-domain-${i}.com`);
    const config = validateProjectConfig(validRawConfig({ allowedDomains: hugeDomainList })) as ProjectConfig;
    await expect(writeConfigJson(dir, config)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
