/**
 * Centralized so every caller (projects, drafts, builds modules) agrees on layout —
 * drift here would mean one module writes to a key another never looks for.
 */
export function projectIconKey(orgId: string, projectId: string): string {
  return `orgs/${orgId}/projects/${projectId}/icon.png`;
}

export function buildIpaKey(orgId: string, projectId: string, buildId: string): string {
  return `orgs/${orgId}/projects/${projectId}/builds/${buildId}/app.ipa`;
}

export function draftIconKey(draftId: string): string {
  return `drafts/${draftId}/icon.png`;
}
