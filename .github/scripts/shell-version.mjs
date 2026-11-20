#!/usr/bin/env node
// Shared by build-shell-base.yml and activate-shell-release.yml. Both read the
// version string from a plain environment variable set via a step/job-level `env:`
// block — never from a `${{ inputs.* }}` expansion templated directly into a `run:`
// script. That distinction matters the same way it does in build-ipa.yml's own
// top-of-file comment: `${{ }}` is substituted into the script's text before the
// shell ever parses it, so a crafted input containing shell metacharacters would
// execute as part of the script itself. Routed through env instead, the value is just
// an opaque string the shell never re-parses as code.
//
// The regex check is a second, independent layer on top of that — this value also
// ends up as an S3 key segment (packages/storage's shellReleaseIpaKey/
// shellReleaseManifestKey) and a shell_releases.version column, so a value containing
// "/", "..", or other structurally meaningful characters must never reach either.
import { appendFileSync } from 'node:fs';

export const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/;

export function isValidShellVersion(version) {
  return typeof version === 'string' && VERSION_PATTERN.test(version);
}

/**
 * build-shell-base.yml's own resolution: the shell-v<version> suffix of a tag push,
 * or INPUT_VERSION for a manual workflow_dispatch run. Throws (never returns an
 * invalid value) either way.
 */
export function resolveShellVersion({ githubRef, inputVersion }) {
  const tagMatch = /^refs\/tags\/shell-v(.+)$/.exec(githubRef ?? '');
  const version = tagMatch ? tagMatch[1] : inputVersion;
  if (!version) {
    throw new Error('version input is required for a manual (non-tag) run');
  }
  if (!isValidShellVersion(version)) {
    throw new Error(`version "${version}" does not match ${VERSION_PATTERN}`);
  }
  return version;
}

/** Validates an already-known version (activate-shell-release.yml's own input) as-is, no tag fallback. */
export function assertValidShellVersion(version) {
  if (!isValidShellVersion(version)) {
    throw new Error(`version "${version}" does not match ${VERSION_PATTERN}`);
  }
}

function runAsCli() {
  const mode = process.argv[2];
  try {
    if (mode === 'resolve') {
      const version = resolveShellVersion({
        githubRef: process.env.GITHUB_REF,
        inputVersion: process.env.INPUT_VERSION,
      });
      const githubEnvPath = process.env.GITHUB_ENV;
      if (githubEnvPath) {
        appendFileSync(githubEnvPath, `VERSION=${version}\n`);
      }
      console.log(`Building shell base version: ${version}`);
    } else if (mode === 'validate') {
      assertValidShellVersion(process.argv[3]);
      console.log(`version "${process.argv[3]}" is valid`);
    } else {
      throw new Error(`Usage: shell-version.mjs resolve|validate [version]`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAsCli();
}
