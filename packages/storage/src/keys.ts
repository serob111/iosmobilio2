const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, argName: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${argName} must be a uuid, got: ${value}`);
  }
}

// shell_releases has no org/project id to double as path-traversal protection the way
// orgId/projectId do above — version comes straight off a git tag/workflow input, so
// it gets its own allowlist instead: no "/", no "..", no leading dot, nothing but a
// plain version-ish token.
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function assertSafeVersion(value: string, argName: string): void {
  if (!SAFE_VERSION_PATTERN.test(value)) {
    throw new Error(`${argName} must be a safe version string, got: ${value}`);
  }
}

/**
 * Centralized so every caller (projects, drafts, builds modules) agrees on layout —
 * drift here would mean one module writes to a key another never looks for. Arguments
 * are validated as uuids because these ids end up as path segments in an object key: an
 * unvalidated value could let a caller construct a key outside its own org's/project's
 * prefix (path traversal via "../", or just colliding with another tenant's key).
 */
export function projectIconKey(orgId: string, projectId: string): string {
  assertUuid(orgId, 'orgId');
  assertUuid(projectId, 'projectId');
  return `orgs/${orgId}/projects/${projectId}/icon.png`;
}

export function buildIpaKey(orgId: string, projectId: string, buildId: string): string {
  assertUuid(orgId, 'orgId');
  assertUuid(projectId, 'projectId');
  assertUuid(buildId, 'buildId');
  return `orgs/${orgId}/projects/${projectId}/builds/${buildId}/app.ipa`;
}

export function draftIconKey(draftId: string): string {
  assertUuid(draftId, 'draftId');
  return `drafts/${draftId}/icon.png`;
}

export function shellReleaseIpaKey(version: string): string {
  assertSafeVersion(version, 'version');
  return `shell-base/${version}/base.ipa`;
}

export function shellReleaseManifestKey(version: string): string {
  assertSafeVersion(version, 'version');
  return `shell-base/${version}/manifest.json`;
}
