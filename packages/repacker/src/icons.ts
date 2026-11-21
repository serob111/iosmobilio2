import { join } from 'node:path';
import sharp from 'sharp';
import { RepackError } from './errors.js';

/**
 * Mirrors apps/shell/plugins/withMobilioIcons.js's own ICON_FILES exactly — these are
 * the four files CFBundleIcons/CFBundleIcons~ipad (see info-plist.ts) reference by
 * name. A mismatch here would silently produce icons that don't match what
 * Info.plist actually points at.
 */
export const ICON_FILES: ReadonlyArray<readonly [string, number]> = [
  ['AppIcon60x60@2x.png', 120],
  ['AppIcon60x60@3x.png', 180],
  ['AppIcon76x76@2x~ipad.png', 152],
  ['AppIcon83.5x83.5@2x~ipad.png', 167],
];

const REQUIRED_SOURCE_SIZE = 1024;

/** Fails fast (ICON_INVALID) before generating anything — four wrong-looking icons from a bad source is worse than one clear upfront rejection. */
async function assertValidSourceIcon(iconPng1024: Buffer): Promise<void> {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(iconPng1024).metadata();
  } catch (error) {
    throw new RepackError('ICON_INVALID', 'icon is not a valid image', error);
  }
  if (metadata.width !== REQUIRED_SOURCE_SIZE || metadata.height !== REQUIRED_SOURCE_SIZE) {
    throw new RepackError(
      'ICON_INVALID',
      `icon must be exactly ${REQUIRED_SOURCE_SIZE}x${REQUIRED_SOURCE_SIZE}, got ${metadata.width}x${metadata.height}`,
    );
  }
}

/**
 * Generates the four CFBundleIconFiles images from a 1024x1024 source into destDir,
 * flattening away any alpha channel against backgroundColor first — Apple rejects
 * icons with transparency outright, and a client-uploaded logo exported with a
 * transparent background is the common case, not the exception.
 */
export async function generateIcons(iconPng1024: Buffer, destDir: string, backgroundColor: string): Promise<void> {
  await assertValidSourceIcon(iconPng1024);

  await Promise.all(
    ICON_FILES.map(async ([filename, size]) => {
      try {
        await sharp(iconPng1024)
          .resize(size, size)
          .flatten({ background: backgroundColor })
          .png()
          .toFile(join(destDir, filename));
      } catch (error) {
        throw new RepackError('ICON_INVALID', `failed to generate ${filename}`, error);
      }
    }),
  );
}
