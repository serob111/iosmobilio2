import { describe, expect, it } from 'vitest';
import { buildIpaKey, draftIconKey, projectIconKey } from '../src/keys';

describe('object storage key builders', () => {
  it('projectIconKey nests under orgs/<orgId>/projects/<projectId>', () => {
    expect(projectIconKey('org-1', 'proj-1')).toBe('orgs/org-1/projects/proj-1/icon.png');
  });

  it('buildIpaKey nests under the project, then the specific build', () => {
    expect(buildIpaKey('org-1', 'proj-1', 'build-1')).toBe('orgs/org-1/projects/proj-1/builds/build-1/app.ipa');
  });

  it('draftIconKey has no org segment — drafts are not tenant-scoped', () => {
    expect(draftIconKey('draft-1')).toBe('drafts/draft-1/icon.png');
  });
});
