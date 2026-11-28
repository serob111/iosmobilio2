import { selectBuildRunner } from './builds.module.js';
import type { BuildRunner } from './build-runner.js';

describe('selectBuildRunner', () => {
  const github = { dispatch: vi.fn() } as unknown as BuildRunner;
  const fake = { dispatch: vi.fn() } as unknown as BuildRunner;
  const repack = { dispatch: vi.fn() } as unknown as BuildRunner;

  it('picks github when the env var is unset (the real default)', () => {
    expect(selectBuildRunner(undefined, { github, fake, repack })).toBe(github);
  });

  it('picks github when explicitly set to "github"', () => {
    expect(selectBuildRunner('github', { github, fake, repack })).toBe(github);
  });

  it('picks repack when set to "repack"', () => {
    expect(selectBuildRunner('repack', { github, fake, repack })).toBe(repack);
  });

  it('picks fake when set to "fake"', () => {
    expect(selectBuildRunner('fake', { github, fake, repack })).toBe(fake);
  });

  it('falls back to github for an unrecognized value', () => {
    expect(selectBuildRunner('something-else', { github, fake, repack })).toBe(github);
  });
});
