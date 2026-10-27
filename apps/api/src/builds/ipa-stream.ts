import { Transform, type TransformCallback } from 'node:stream';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
const MAX_IPA_BYTES = 300 * 1024 * 1024;

export class IpaValidationError extends Error {
  constructor(
    public readonly code: 'INVALID_IPA' | 'IPA_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'IpaValidationError';
  }
}

/**
 * Checks the ZIP magic on the very first chunk and enforces a byte cap, both while the
 * upload is still streaming to object storage — not after buffering the whole (up to
 * 300MB) body first. Piping the raw request body through this before putStream() means a
 * bad upload fails fast without ever reaching storage.
 */
export function createIpaValidationStream(): Transform {
  let seenBytes = 0;
  let checkedMagic = false;

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      seenBytes += chunk.length;
      if (seenBytes > MAX_IPA_BYTES) {
        callback(new IpaValidationError('IPA_TOO_LARGE', 'File is too large'));
        return;
      }
      if (!checkedMagic) {
        checkedMagic = true;
        if (chunk.length < 4 || !chunk.subarray(0, 4).equals(ZIP_MAGIC)) {
          callback(new IpaValidationError('INVALID_IPA', 'Not a valid .ipa (zip) file'));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}
