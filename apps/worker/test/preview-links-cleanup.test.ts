import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@mobilio/db';
import { cleanupExpiredEditorPreviewLinks } from '../src/preview-links-cleanup';

function fakeDb(batches: Array<Array<{ id: string }>>): Db & { execute: ReturnType<typeof vi.fn> } {
  let call = 0;
  const execute = vi.fn().mockImplementation(async () => {
    const rows = batches[call] ?? [];
    call += 1;
    return { rows };
  });
  return { execute } as unknown as Db & { execute: ReturnType<typeof vi.fn> };
}

describe('cleanupExpiredEditorPreviewLinks', () => {
  it('deletes nothing and reports zero when the function returns no rows', async () => {
    const db = fakeDb([[]]);

    const result = await cleanupExpiredEditorPreviewLinks(db);

    expect(result).toEqual({ deletedCount: 0 });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('reports the deleted count for a single short batch', async () => {
    const db = fakeDb([[{ id: randomUUID() }, { id: randomUUID() }]]);

    const result = await cleanupExpiredEditorPreviewLinks(db);

    expect(result).toEqual({ deletedCount: 2 });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps calling the function in batches of 500 until a short batch signals the end', async () => {
    const fullBatch = Array.from({ length: 500 }, () => ({ id: randomUUID() }));
    const shortBatch = [{ id: randomUUID() }];
    const db = fakeDb([fullBatch, shortBatch]);

    const result = await cleanupExpiredEditorPreviewLinks(db);

    expect(result.deletedCount).toBe(501);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
