import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { computeDominantColor, generateLetterAvatar, processIconImage } from './icon.js';

async function makeTransparentPng(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0 } } })
    .png()
    .toBuffer();
}

describe('processIconImage', () => {
  it('resizes to 1024x1024 and flattens away any transparency', async () => {
    const input = await makeTransparentPng();
    const output = await processIconImage(input);
    const meta = await sharp(output).metadata();

    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(meta.hasAlpha).toBe(false);
  });
});

describe('computeDominantColor', () => {
  it('returns a hex color for a valid image', async () => {
    const input = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    const color = await computeDominantColor(input);
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('returns null for invalid image bytes instead of throwing', async () => {
    const color = await computeDominantColor(Buffer.from('not an image'));
    expect(color).toBeNull();
  });
});

describe('generateLetterAvatar', () => {
  it('produces a 1024x1024 png', async () => {
    const buffer = await generateLetterAvatar('m', '#2563EB');
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(meta.format).toBe('png');
  });

  it('escapes xml-special characters in the letter so the svg stays well-formed', async () => {
    await expect(generateLetterAvatar('<&>', '#2563EB')).resolves.toBeInstanceOf(Buffer);
  });
});
