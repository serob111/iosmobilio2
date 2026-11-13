import { describe, expect, it } from 'vitest';
import { buildIpaKey, draftIconKey, projectIconKey } from '../src/keys';

const ORG_ID = '01a16033-3d3b-718f-b2f4-9508ec870bab';
const PROJECT_ID = '01a16033-3d3b-718f-b2f4-9508ec870bac';
const BUILD_ID = '01a16033-3d3b-718f-b2f4-9508ec870bad';
const DRAFT_ID = '01a16033-3d3b-718f-b2f4-9508ec870bae';

describe('object storage key builders', () => {
  it('projectIconKey nests under orgs/<orgId>/projects/<projectId>', () => {
    expect(projectIconKey(ORG_ID, PROJECT_ID)).toBe(`orgs/${ORG_ID}/projects/${PROJECT_ID}/icon.png`);
  });

  it('buildIpaKey nests under the project, then the specific build', () => {
    expect(buildIpaKey(ORG_ID, PROJECT_ID, BUILD_ID)).toBe(
      `orgs/${ORG_ID}/projects/${PROJECT_ID}/builds/${BUILD_ID}/app.ipa`,
    );
  });

  it('draftIconKey has no org segment — drafts are not tenant-scoped', () => {
    expect(draftIconKey(DRAFT_ID)).toBe(`drafts/${DRAFT_ID}/icon.png`);
  });

  it('rejects a non-uuid orgId — would otherwise let a caller escape its own prefix', () => {
    expect(() => projectIconKey('../../etc', PROJECT_ID)).toThrow(/orgId must be a uuid/);
  });

  it('rejects a non-uuid projectId', () => {
    expect(() => projectIconKey(ORG_ID, 'not-a-uuid')).toThrow(/projectId must be a uuid/);
  });

  it('rejects a non-uuid buildId', () => {
    expect(() => buildIpaKey(ORG_ID, PROJECT_ID, 'not-a-uuid')).toThrow(/buildId must be a uuid/);
  });

  it('rejects a non-uuid draftId', () => {
    expect(() => draftIconKey('not-a-uuid')).toThrow(/draftId must be a uuid/);
  });
});
