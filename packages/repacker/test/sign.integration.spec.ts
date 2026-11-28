import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signBundle, verifyBundle } from '../src/sign';

const execFileAsync = promisify(execFile);

// Only runs with a real rcodesign binary available — set REPACKER_RCODESIGN_PATH to
// its path (and REPACKER_RCODESIGN_SHA256 to its sha256, matching production's own
// pinned-binary check). Deliberately NOT named RCODESIGN_* — rcodesign itself reads
// any RCODESIGN_<FIELD> env var as a signing-profile config override (confirmed: it
// rejected a run with RCODESIGN_PATH set, "UnknownField(\"path\", [...])" — the real
// binary feeding our own test env var back into its config parser), so this package's
// own env vars for the same binary need a non-colliding prefix. Also needs `openssl`
// on $PATH to build a throwaway self-signed p12 for the test — both are standard
// tooling on any CI Linux image, just not guaranteed on a bare local dev machine.
// REQUIRE_RCODESIGN=true turns a missing env var into a hard failure instead of a
// silent skip, same convention as REQUIRE_LIVE_SERVICES elsewhere in this repo.
const rcodesignPath = process.env.REPACKER_RCODESIGN_PATH;
const rcodesignSha256 = process.env.REPACKER_RCODESIGN_SHA256;
const hasRcodesign = Boolean(rcodesignPath) && Boolean(rcodesignSha256);
if (!hasRcodesign && process.env.REQUIRE_RCODESIGN === 'true') {
  throw new Error('REQUIRE_RCODESIGN=true but REPACKER_RCODESIGN_PATH/REPACKER_RCODESIGN_SHA256 are not set');
}

// Optional: point this at a real extracted .app directory (e.g. from the base.ipa
// fixture Phase 6 publishes) to also exercise the true success path — sign followed
// by verify against a real Mach-O. Without it, the tests below still spawn the real
// rcodesign binary for every other code path (pinned-binary check, password-file
// handling, argv construction, non-zero exit-code mapping); they just can't assert a
// successful signature without a real bundle to sign.
const fixtureAppDir = process.env.REPACKER_FIXTURE_APP_DIR;

describe.skipIf(!hasRcodesign)('signBundle / verifyBundle (real rcodesign)', () => {
  let dir: string;
  let p12Path: string;
  const p12Password = 'repacker-test-only-password';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'repacker-sign-itest-'));
    const certPath = join(dir, 'test.crt');
    const keyPath = join(dir, 'test.key');
    p12Path = join(dir, 'test.p12');

    await execFileAsync(rcodesignPath!, [
      'generate-self-signed-certificate',
      '--person-name',
      'Repacker Integration Test',
      '--pem-filename',
      join(dir, 'test'),
    ]);
    // OpenSSL 3.x's default PKCS12 encryption isn't readable by rcodesign's own p12
    // parser — -legacy (RC2/3DES) is what actually round-trips, confirmed directly
    // against a real signing attempt, not assumed from documentation.
    await execFileAsync('openssl', [
      'pkcs12',
      '-export',
      '-legacy',
      '-out',
      p12Path,
      '-inkey',
      keyPath,
      '-in',
      certPath,
      '-passout',
      `pass:${p12Password}`,
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function rcodesignConfig() {
    return { binaryPath: rcodesignPath!, expectedSha256: rcodesignSha256! };
  }

  it('the pinned sha256 check accepts the real configured binary (sanity check the env vars themselves are correct)', async () => {
    const actual = createHash('sha256').update(readFileSync(rcodesignPath!)).digest('hex');
    expect(actual).toBe(rcodesignSha256);
  });

  it('signBundle spawns the real binary and surfaces its real failure when there is nothing signable', async () => {
    const emptyDir = join(dir, 'not-a-bundle');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(emptyDir, { recursive: true });
    const entitlementsPath = join(dir, 'entitlements.plist');
    writeFileSync(
      entitlementsPath,
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict></dict></plist>',
    );

    // rcodesign itself rejects an empty directory as nothing to sign — this proves the
    // full real plumbing (password-file write, argv construction, real spawn, stderr
    // capture, non-zero exit mapped to SIGNING_FAILED) against the actual binary,
    // without needing a fabricated Mach-O whose validity we can't vouch for.
    await expect(signBundle(emptyDir, entitlementsPath, { p12Path, p12Password }, rcodesignConfig())).rejects.toMatchObject({
      code: 'SIGNING_FAILED',
    });
  });

  it('verifyBundle spawns the real binary and rejects a path that is not a signable binary at all', async () => {
    const unsignedPath = join(dir, 'unsigned-binary');
    writeFileSync(unsignedPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await expect(verifyBundle(unsignedPath, rcodesignConfig())).rejects.toMatchObject({ code: 'VERIFY_FAILED' });
  });

  describe.skipIf(!fixtureAppDir)('against a real extracted .app fixture', () => {
    it(
      'signs and then verifies the real bundle successfully',
      async () => {
        if (!fixtureAppDir || !existsSync(fixtureAppDir)) {
          throw new Error(`REPACKER_FIXTURE_APP_DIR is set to ${String(fixtureAppDir)} but it does not exist`);
        }
        const entitlementsPath = join(dir, 'fixture-entitlements.plist');
        writeFileSync(
          entitlementsPath,
          '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict></dict></plist>',
        );

        await signBundle(fixtureAppDir, entitlementsPath, { p12Path, p12Password }, rcodesignConfig());

        const executableName = fixtureAppDir.split(/[/\\]/).pop()?.replace(/\.app$/, '');
        await verifyBundle(join(fixtureAppDir, executableName ?? ''), rcodesignConfig());
      },
      // Signing every nested framework in a real multi-framework .app genuinely takes
      // ~30s on this machine — confirmed by timing the same rcodesign invocation run
      // directly outside the test, not a hang.
      60_000,
    );
  });
});
