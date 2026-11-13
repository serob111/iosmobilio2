import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createIpaValidationStream, IpaValidationError } from './ipa-stream.js';

async function collect(source: Readable): Promise<Buffer> {
  const validated = createIpaValidationStream();
  const chunks: Buffer[] = [];
  await pipeline(source, validated, async (iterable) => {
    for await (const chunk of iterable) {
      chunks.push(chunk as Buffer);
    }
  });
  return Buffer.concat(chunks);
}

const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe('createIpaValidationStream', () => {
  it('passes through a stream that starts with the zip magic bytes, unchanged', async () => {
    const payload = Buffer.concat([ZIP_HEADER, Buffer.from('rest of the archive')]);
    const result = await collect(Readable.from([payload]));
    expect(result.equals(payload)).toBe(true);
  });

  it('rejects a stream that does not start with the zip magic bytes', async () => {
    const payload = Buffer.from('not a zip file at all');
    await expect(collect(Readable.from([payload]))).rejects.toThrow(IpaValidationError);
    await expect(collect(Readable.from([payload]))).rejects.toMatchObject({ code: 'INVALID_IPA' });
  });

  it('rejects a stream shorter than 4 bytes', async () => {
    await expect(collect(Readable.from([Buffer.from([0x50, 0x4b])]))).rejects.toMatchObject({ code: 'INVALID_IPA' });
  });

  it('rejects a stream over the 300MB cap even when it starts with valid magic bytes', async () => {
    const chunkSize = 10 * 1024 * 1024;
    const chunk = Buffer.alloc(chunkSize, 1);
    chunk.set(ZIP_HEADER, 0);

    async function* chunks() {
      for (let i = 0; i < 31; i++) {
        yield i === 0 ? chunk : Buffer.alloc(chunkSize, 1);
      }
    }

    await expect(collect(Readable.from(chunks()))).rejects.toMatchObject({ code: 'IPA_TOO_LARGE' });
  });

  it('accepts a stream right at the boundary without the magic-byte check misfiring on later chunks', async () => {
    const payload = Buffer.concat([ZIP_HEADER, Buffer.alloc(1024, 2)]);
    const result = await collect(Readable.from([payload.subarray(0, 4), payload.subarray(4)]));
    expect(result.equals(payload)).toBe(true);
  });
});
