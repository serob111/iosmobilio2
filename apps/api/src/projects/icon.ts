import sharp from 'sharp';

// Explicit, not relying on sharp's own default (~268 megapixels) — this buffer is
// untrusted input (a site's favicon/og:image, or a user-uploaded icon), and a crafted
// image declaring a much larger pixel count than its compressed size suggests is a
// classic decompression-bomb DoS. 40 megapixels (6324x6324) is far beyond anything a
// real favicon/app-icon source would legitimately be.
const MAX_INPUT_PIXELS = 40_000_000;

/** 1024×1024, no transparency — matches what apps/shell's native build pipeline expects for an app icon. */
export async function processIconImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(1024, 1024, { fit: 'cover' })
    .flatten({ background: '#FFFFFF' })
    .png()
    .toBuffer();
}

export async function computeDominantColor(buffer: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).stats();
    const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
    return `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`.toUpperCase();
  } catch {
    return null;
  }
}

function escapeXml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function generateLetterAvatar(letter: string, color: string): Promise<Buffer> {
  const safeLetter = escapeXml(letter.toUpperCase());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="${color}" />
    <text x="512" y="650" font-size="560" font-family="sans-serif" fill="#FFFFFF" text-anchor="middle">${safeLetter}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
