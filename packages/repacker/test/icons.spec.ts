import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateIcons, ICON_FILES } from '../src/icons';
import { RepackError } from '../src/errors';

async function makeSquarePng(size: number, alpha = true): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: alpha ? 4 : 3, background: { r: 10, g: 20, b: 30, alpha: alpha ? 0.5 : 1 } },
  })
    .png()
    .toBuffer();
}

describe('generateIcons', () => {
  let destDir: string;

  beforeEach(() => {
    destDir = mkdtempSync(join(tmpdir(), 'repacker-icons-'));
  });

  afterEach(() => {
    rmSync(destDir, { recursive: true, force: true });
  });

  it('generates all four expected files at the exact pixel sizes withMobilioIcons.js expects', async () => {
    const source = await makeSquarePng(1024);
    await generateIcons(source, destDir, '#2563EB');

    for (const [filename, size] of ICON_FILES) {
      const metadata = await sharp(join(destDir, filename)).metadata();
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    }
  });

  it('flattens away the alpha channel against the given background color', async () => {
    const source = await makeSquarePng(1024, true);
    await generateIcons(source, destDir, '#2563EB');

    const [firstFile] = ICON_FILES[0];
    const metadata = await sharp(join(destDir, firstFile)).metadata();
    expect(metadata.hasAlpha).toBe(false);
  });

  it('throws ICON_INVALID when the source is not exactly 1024x1024', async () => {
    const source = await makeSquarePng(512);
    await expect(generateIcons(source, destDir, '#2563EB')).rejects.toBeInstanceOf(RepackError);
    await expect(generateIcons(source, destDir, '#2563EB')).rejects.toMatchObject({ code: 'ICON_INVALID' });
  });

  it('throws ICON_INVALID for a buffer that is not a real image at all', async () => {
    await expect(generateIcons(Buffer.from('not an image'), destDir, '#2563EB')).rejects.toMatchObject({
      code: 'ICON_INVALID',
    });
  });
});
