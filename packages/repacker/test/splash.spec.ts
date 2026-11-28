import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSplash } from '../src/splash';
import { RepackError } from '../src/errors';

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

describe('generateSplash', () => {
  let destPath: string;

  beforeEach(() => {
    destPath = join(mkdtempSync(join(tmpdir(), 'repacker-splash-')), 'splash.png');
  });

  afterEach(() => {
    rmSync(join(destPath, '..'), { recursive: true, force: true });
  });

  it('caps the longer dimension at 1024px, preserving aspect ratio', async () => {
    const source = await makePng(2000, 1000);
    await generateSplash(source, destPath);
    const metadata = await sharp(destPath).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(512);
  });

  it('does not upscale a source already smaller than 1024px', async () => {
    const source = await makePng(200, 150);
    await generateSplash(source, destPath);
    const metadata = await sharp(destPath).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(150);
  });

  it('preserves the alpha channel, unlike generateIcons', async () => {
    const source = await makePng(400, 400);
    await generateSplash(source, destPath);
    const metadata = await sharp(destPath).metadata();
    expect(metadata.hasAlpha).toBe(true);
  });

  it('throws ICON_INVALID for a buffer that is not a real image at all', async () => {
    await expect(generateSplash(Buffer.from('not an image'), destPath)).rejects.toBeInstanceOf(RepackError);
    await expect(generateSplash(Buffer.from('not an image'), destPath)).rejects.toMatchObject({ code: 'ICON_INVALID' });
  });
});
