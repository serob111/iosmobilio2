import sharp from 'sharp';

/** 1024×1024, no transparency — matches what apps/shell's native build pipeline expects for an app icon. */
export async function processIconImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(1024, 1024, { fit: 'cover' })
    .flatten({ background: '#FFFFFF' })
    .png()
    .toBuffer();
}

export async function computeDominantColor(buffer: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(buffer).stats();
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
