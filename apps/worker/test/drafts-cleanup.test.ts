import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@mobilio/db';
import type { ObjectStorage } from '@mobilio/storage';
import { cleanupExpiredDrafts } from '../src/drafts-cleanup';

function fakeDb(batches: Array<Array<{ id: string }>>): Db & { execute: ReturnType<typeof vi.fn> } {
  let call = 0;
  const execute = vi.fn().mockImplementation(async () => {
    const rows = batches[call] ?? [];
    call += 1;
    return { rows };
  });
  return { execute } as unknown as Db & { execute: ReturnType<typeof vi.fn> };
}

function fakeStorage(deleteImpl: (key: string) => Promise<void>): ObjectStorage {
  return { delete: vi.fn(deleteImpl) } as unknown as ObjectStorage;
}

const DRAFT_ID_1 = '01a16033-3d3b-718f-b2f4-9508ec870bab';
const DRAFT_ID_2 = '01a16033-3d3b-718f-b2f4-9508ec870bac';

describe('cleanupExpiredDrafts', () => {
  it('deletes nothing and reports zero when the function returns no rows', async () => {
    const db = fakeDb([[]]);
    const storage = fakeStorage(() => Promise.resolve());

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result).toEqual({ deletedCount: 0, iconDeleteFailures: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('deletes the icon object for each expired draft row returned by the function', async () => {
    const db = fakeDb([[{ id: DRAFT_ID_1 }, { id: DRAFT_ID_2 }]]);
    const storage = fakeStorage(() => Promise.resolve());

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result).toEqual({ deletedCount: 2, iconDeleteFailures: 0 });
    expect(storage.delete).toHaveBeenCalledWith(`drafts/${DRAFT_ID_1}/icon.png`);
    expect(storage.delete).toHaveBeenCalledWith(`drafts/${DRAFT_ID_2}/icon.png`);
  });

  it('counts icon-delete failures without throwing, and still reports the full deletedCount', async () => {
    const db = fakeDb([[{ id: DRAFT_ID_1 }, { id: DRAFT_ID_2 }]]);
    const storage = fakeStorage((key) =>
      key === `drafts/${DRAFT_ID_1}/icon.png` ? Promise.reject(new Error('not found')) : Promise.resolve(),
    );

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result).toEqual({ deletedCount: 2, iconDeleteFailures: 1 });
  });

  it('keeps calling the function in batches of 500 until a short batch signals the end', async () => {
    const fullBatch = Array.from({ length: 500 }, () => ({ id: randomUUID() }));
    const shortBatch = [{ id: randomUUID() }];
    const db = fakeDb([fullBatch, shortBatch]);
    const storage = fakeStorage(() => Promise.resolve());

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result.deletedCount).toBe(501);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
