const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, argName: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${argName} must be a uuid, got: ${value}`);
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
