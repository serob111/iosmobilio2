import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertBaseChecksum, sha256File } from '../src/checksum';
import { RepackError } from '../src/errors';

describe('sha256File / assertBaseChecksum', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repacker-checksum-'));
    filePath = join(dir, `${randomUUID()}.bin`);
    writeFileSync(filePath, Buffer.from('hello mobilio repack'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sha256File matches a direct in-memory hash of the same content', async () => {
    const expected = createHash('sha256').update(Buffer.from('hello mobilio repack')).digest('hex');
    await expect(sha256File(filePath)).resolves.toBe(expected);
  });

  it('assertBaseChecksum resolves without throwing when the hash matches', async () => {
    const correct = await sha256File(filePath);
    await expect(assertBaseChecksum(filePath, correct)).resolves.toBeUndefined();
  });

  it('assertBaseChecksum throws BASE_CHECKSUM_MISMATCH when the hash does not match', async () => {
    await expect(assertBaseChecksum(filePath, 'f'.repeat(64))).rejects.toMatchObject({
      code: 'BASE_CHECKSUM_MISMATCH',
    });
  });

  it('assertBaseChecksum throws an instance of RepackError', async () => {
    await expect(assertBaseChecksum(filePath, 'f'.repeat(64))).rejects.toBeInstanceOf(RepackError);
  });
});
