import { writeFile } from 'node:fs/promises';
import { build, type PlistValue } from 'plist';
import { assertValidBundleId, assertValidTeamId } from './validation.js';

export type EntitlementsInput = {
  teamId: string;
  bundleId: string;
  /** Already resolved by the caller from ProjectConfig.allowedDomains + features.deepLinks — bare domains, no "applinks:" prefix. */
  associatedDomains: string[];
};

/**
 * Mirrors app.config.ts's own entitlements *template* (aps-environment,
 * associated-domains) with this client's real values — 'production' and
 * 'get-task-allow: false' unconditionally, since this is always a real signed
 * build, never a development one. Every build gets aps-environment regardless of
 * config.features.push: the base ships expo-notifications unconditionally too (only
 * the JS-side registration call is gated, see apps/shell's registerPush.ts), matching
 * app.config.ts's own always-present template entry.
 */
export function buildEntitlements(input: EntitlementsInput): Record<string, unknown> {
  assertValidTeamId(input.teamId);
  assertValidBundleId(input.bundleId);

  return {
    'application-identifier': `${input.teamId}.${input.bundleId}`,
    'com.apple.developer.team-identifier': input.teamId,
    'aps-environment': 'production',
    'get-task-allow': false,
    'com.apple.developer.associated-domains': input.associatedDomains.map((domain) => `applinks:${domain}`),
  };
}

/** Entitlements are passed to rcodesign as a plain XML plist file (--entitlements-xml-file), never the binary format Info.plist uses. */
export async function writeEntitlements(path: string, entitlements: Record<string, unknown>): Promise<void> {
  await writeFile(path, build(entitlements as PlistValue), 'utf8');
}
