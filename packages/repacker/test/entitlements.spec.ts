import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'plist';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEntitlements, writeEntitlements } from '../src/entitlements';
import { RepackError } from '../src/errors';

const VALID_TEAM_ID = 'ABCDE12345';

describe('buildEntitlements', () => {
  it('builds application-identifier from teamId + bundleId', () => {
    const result = buildEntitlements({ teamId: VALID_TEAM_ID, bundleId: 'am.mobilio.t.cafe', associatedDomains: [] });
    expect(result['application-identifier']).toBe('ABCDE12345.am.mobilio.t.cafe');
    expect(result['com.apple.developer.team-identifier']).toBe(VALID_TEAM_ID);
  });

  it('always sets aps-environment to production and get-task-allow to false', () => {
    const result = buildEntitlements({ teamId: VALID_TEAM_ID, bundleId: 'am.mobilio.t.cafe', associatedDomains: [] });
    expect(result['aps-environment']).toBe('production');
    expect(result['get-task-allow']).toBe(false);
  });

  it('maps associatedDomains to the applinks: scheme', () => {
    const result = buildEntitlements({
      teamId: VALID_TEAM_ID,
      bundleId: 'am.mobilio.t.cafe',
      associatedDomains: ['cafe-mobilio.example', 'www.cafe-mobilio.example'],
    });
    expect(result['com.apple.developer.associated-domains']).toEqual([
      'applinks:cafe-mobilio.example',
      'applinks:www.cafe-mobilio.example',
    ]);
  });

  it('writes an empty associated-domains array when there are no domains, matching app.config.ts\'s own template baseline', () => {
    const result = buildEntitlements({ teamId: VALID_TEAM_ID, bundleId: 'am.mobilio.t.cafe', associatedDomains: [] });
    expect(result['com.apple.developer.associated-domains']).toEqual([]);
  });

  it('throws INVALID_CONFIG for a malformed teamId', () => {
    expect(() => buildEntitlements({ teamId: 'too-short', bundleId: 'am.mobilio.t.cafe', associatedDomains: [] })).toThrow(
      RepackError,
    );
  });

  it('throws INVALID_CONFIG for a malformed bundleId', () => {
    expect(() => buildEntitlements({ teamId: VALID_TEAM_ID, bundleId: 'not valid!', associatedDomains: [] })).toThrow(RepackError);
  });
});

describe('writeEntitlements', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repacker-entitlements-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes an XML plist that round-trips through plist.parse', async () => {
    const entitlements = buildEntitlements({
      teamId: VALID_TEAM_ID,
      bundleId: 'am.mobilio.t.cafe',
      associatedDomains: ['cafe-mobilio.example'],
    });
    const path = join(dir, 'entitlements.plist');
    await writeEntitlements(path, entitlements);

    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('<?xml');
    const reparsed = parse(raw) as Record<string, unknown>;
    expect(reparsed).toEqual(entitlements);
  });
});
