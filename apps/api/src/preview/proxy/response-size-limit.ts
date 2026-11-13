import { Transform, type TransformCallback } from 'node:stream';

export class ResponseTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Response exceeds ${maxBytes} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Enforces a byte cap while a response streams through — mirrors
 * builds/ipa-stream.ts's size check (stream destroyed, not just stopped-reading, once
 * exceeded), minus the magic-byte validation since this isn't checking a known file
 * format, just capping an arbitrary proxied resource at 10MB.
 */
export function createSizeLimitStream(maxBytes: number): Transform {
  let seenBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      seenBytes += chunk.length;
      if (seenBytes > maxBytes) {
        callback(new ResponseTooLargeError(maxBytes));
        return;
      }
      callback(null, chunk);
    },
  });
}
