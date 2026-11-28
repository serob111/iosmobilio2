import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256File } from './checksum.js';
import { RepackError, type RepackErrorCode } from './errors.js';

export type RcodesignConfig = {
  /** Path to the pinned rcodesign (apple-codesign) binary — one fixed version baked into the worker's Docker image, never whatever happens to be on $PATH. */
  binaryPath: string;
  /** sha256 of that exact binary, checked before every invocation — see assertPinnedBinary's own doc comment for why. */
  expectedSha256: string;
};

export type SigningCredentials = {
  p12Path: string;
  p12Password: string;
};

/**
 * A compromised or merely-upgraded-out-from-under-us rcodesign binary is a code-
 * signing supply-chain risk, not just a "did the CLI flags change" risk — this is
 * checked on every call, not just once at startup, so a binary swapped mid-process
 * (a hostile write to the same path) still gets caught before it ever signs anything.
 */
async function assertPinnedBinary(rcodesign: RcodesignConfig): Promise<void> {
  const actual = await sha256File(rcodesign.binaryPath);
  if (actual !== rcodesign.expectedSha256) {
    throw new RepackError(
      'SIGNING_FAILED',
      `rcodesign binary at ${rcodesign.binaryPath} has sha256 ${actual}, expected the pinned ${rcodesign.expectedSha256}`,
    );
  }
}

function runRcodesign(binaryPath: string, args: string[], errorCode: RepackErrorCode): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(new RepackError(errorCode, `failed to spawn rcodesign: ${error.message}`, error));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new RepackError(errorCode, `rcodesign exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Writes the p12 password to a short-lived 0600 temp file and passes
 * --p12-password-file, never --p12-password — the latter would put the plaintext
 * password directly into this process's own argv, visible to anything able to list
 * processes on the same host for as long as rcodesign runs (/proc/<pid>/cmdline,
 * `ps`). Deleted in a finally block regardless of outcome.
 */
async function withPasswordFile<T>(password: string, fn: (passwordFilePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'repacker-signing-'));
  const passwordFilePath = join(dir, 'p12-password');
  try {
    await writeFile(passwordFilePath, password, { mode: 0o600 });
    await chmod(passwordFilePath, 0o600);
    return await fn(passwordFilePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Signs appDir — and every nested bundle/framework inside it — in one rcodesign
 * invocation. rcodesign's own bundle-signing mode already walks innermost-first
 * (each nested .framework, then other nested bundles, then the main .app last),
 * confirmed against a real base .app with 8 real frameworks — exactly the order the
 * original plan called for doing manually, so there's no separate per-framework
 * signing step to orchestrate here. Must run after every other edit (Info.plist,
 * icons, mobilio/config.json, entitlements, embedded.mobileprovision) — signing
 * covers the bundle's contents as they exist at the moment it runs, not whatever they
 * end up as afterward.
 */
export async function signBundle(
  appDir: string,
  entitlementsPath: string,
  credentials: SigningCredentials,
  rcodesign: RcodesignConfig,
): Promise<void> {
  await assertPinnedBinary(rcodesign);
  await withPasswordFile(credentials.p12Password, (passwordFilePath) =>
    runRcodesign(
      rcodesign.binaryPath,
      [
        'sign',
        '--p12-file',
        credentials.p12Path,
        '--p12-password-file',
        passwordFilePath,
        '--entitlements-xml-file',
        entitlementsPath,
        // rcodesign's default (http://timestamp.apple.com/ts01) is only meaningful for
        // Developer ID signatures headed for notarization — irrelevant for this
        // ad-hoc/enterprise provisioning-profile flow — and turns every repack into a
        // dependency on an external network call that can time out or fail, for no
        // benefit. Confirmed by hitting a real "Time-Stamp Protocol error" against the
        // real base.ipa fixture before adding this flag.
        '--timestamp-url',
        'none',
        appDir,
      ],
      'SIGNING_FAILED',
    ),
  );
}

/**
 * Mandatory, not advisory — a signature rcodesign itself can't verify must never ship.
 * Its exit code is the only thing this treats as authoritative; rcodesign's own stdout
 * ships a caveat that verify "is known to be buggy" and its exact wording isn't
 * something to string-match against.
 */
export async function verifyBundle(executablePath: string, rcodesign: RcodesignConfig): Promise<void> {
  await assertPinnedBinary(rcodesign);
  await runRcodesign(rcodesign.binaryPath, ['verify', executablePath], 'VERIFY_FAILED');
}
