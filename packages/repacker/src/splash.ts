import sharp from 'sharp';
import { RepackError } from './errors.js';

const MAX_SPLASH_DIMENSION = 1024;

/**
 * Caps splash.png at 1024px on its longer side, preserving aspect ratio and never
 * upscaling a smaller source — BrandSplash.tsx only ever needs enough resolution to
 * fill a phone screen, and alpha is left intact (unlike icons.ts's generateIcons):
 * a transparent splash composites over theme.background (ProjectConfig's own, already
 * validated), which is a legitimate design, not a format Apple rejects the way it
 * does for app icons.
 */
export async function generateSplash(splashPng: Buffer, destPath: string): Promise<void> {
  try {
    await sharp(splashPng)
      .resize(MAX_SPLASH_DIMENSION, MAX_SPLASH_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(destPath);
  } catch (error) {
    throw new RepackError('ICON_INVALID', 'splash image is not a valid image', error);
  }
}
