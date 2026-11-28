import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AscCredentials } from './jwt.js';

export type AppleEnvCredentials = {
  ascCredentials: AscCredentials;
  signingP12Base64: string;
  signingP12Password: string;
  /** The ASC certificates resource id matching SIGNING_P12_BASE64's own certificate — ensureAdHocProfile's certificateId. */
  distributionCertId: string;
  /** Our one shared Apple Developer Team ID — not secret (already visible inside every signed .ipa's own entitlements); needed for entitlements' application-identifier/team-identifier. */
  teamId: string;
};

const REQUIRED_VARS = [
  'ASC_ISSUER_ID',
  'ASC_KEY_ID',
  'ASC_PRIVATE_KEY',
  'SIGNING_P12_BASE64',
  'SIGNING_P12_PASSWORD',
  'ASC_DISTRIBUTION_CERT_ID',
  'APPLE_TEAM_ID',
] as const;

/**
 * Some secret stores can't hold a real multi-line value and round-trip a PEM's
 * newlines as the two literal characters "\n" instead — normalize that back to real
 * newlines so createAscJwt's node:crypto call gets a PEM it can actually parse,
 * regardless of which form the var arrives in.
 */
function normalizePem(value: string): string {
  return value.includes('\\n') ? value.split('\\n').join('\n') : value;
}

/**
 * Reads and validates every env var this phase introduces (App Store Connect API
 * credentials plus the signing certificate), in one place, so a deployment missing one
 * fails with a clear error naming which var — never the value itself, matching this
 * repo's existing secret-handling discipline (apps/api's validateBuildEnv/
 * validateProductionSecretsEnv never echo a secret's value either).
 *
 * Deliberately not NODE_ENV-gated here, unlike apps/api's validateBuildEnv's
 * `runner === 'fake'` early return — apps/worker has no equivalent "repack disabled"
 * mode yet (that's phase 5's RepackRunner), so whether/when this gets called at all is
 * that call site's decision, not this function's.
 */
export function validateAppleEnv(env: Record<string, string | undefined> = process.env): AppleEnvCredentials {
  const missing = REQUIRED_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required App Store Connect / signing env var(s): ${missing.join(', ')}`);
  }
  return {
    ascCredentials: {
      issuerId: env.ASC_ISSUER_ID!,
      keyId: env.ASC_KEY_ID!,
      privateKeyPem: normalizePem(env.ASC_PRIVATE_KEY!),
    },
    signingP12Base64: env.SIGNING_P12_BASE64!,
    signingP12Password: env.SIGNING_P12_PASSWORD!,
    distributionCertId: env.ASC_DISTRIBUTION_CERT_ID!,
    teamId: env.APPLE_TEAM_ID!,
  };
}

/**
 * Writes SIGNING_P12_BASE64's decoded bytes to a 0600 temp file for the duration of
 * `fn`, then deletes it — the certificate itself never touches disk outside this
 * window, mirroring packages/repacker/sign.ts's withPasswordFile for the password half
 * of the same credential pair. Not shared code between the two packages: packages/apple
 * and packages/repacker have no dependency relationship, and this is a ~10 line helper,
 * not worth introducing one just to avoid the duplication.
 */
export async function withP12FromBase64<T>(base64: string, fn: (p12Path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'mobilio-signing-p12-'));
  const p12Path = join(dir, 'cert.p12');
  try {
    await writeFile(p12Path, Buffer.from(base64, 'base64'), { mode: 0o600 });
    await chmod(p12Path, 0o600);
    return await fn(p12Path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
