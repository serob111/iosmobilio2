import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * embedded.mobileprovision at the .app root — the raw bytes of the profile exactly
 * as issued by Apple (a PKCS#7/CMS-signed blob), copied in verbatim. Neither this
 * package nor its caller needs to parse that envelope: packages/apple (a later
 * phase) already knows the fields entitlements.ts needs (team id, associated
 * domains) from its own App Store Connect API responses, not by decoding this file.
 */
export async function embedProvisioningProfile(appDir: string, profileBytes: Buffer): Promise<void> {
  await writeFile(join(appDir, 'embedded.mobileprovision'), profileBytes);
}
