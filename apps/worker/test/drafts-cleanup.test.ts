import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@mobilio/db';
import type { ObjectStorage } from '@mobilio/storage';
import { cleanupExpiredDrafts } from '../src/drafts-cleanup';

function fakeDb(rows: Array<{ id: string }>): Db {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const del = vi.fn().mockReturnValue({ where });
  return { delete: del } as unknown as Db;
}

function fakeStorage(deleteImpl: (key: string) => Promise<void>): ObjectStorage {
  return { delete: vi.fn(deleteImpl) } as unknown as ObjectStorage;
}

describe('cleanupExpiredDrafts', () => {
  it('deletes nothing and reports zero when no draft has expired', async () => {
    const db = fakeDb([]);
    const storage = fakeStorage(() => Promise.resolve());

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result).toEqual({ deletedCount: 0, iconDeleteFailures: 0 });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  const DRAFT_ID_1 = '01a16033-3d3b-718f-b2f4-9508ec870bab';
  const DRAFT_ID_2 = '01a16033-3d3b-718f-b2f4-9508ec870bac';

  it('deletes the icon object for each expired draft row returned by the DB delete', async () => {
    const db = fakeDb([{ id: DRAFT_ID_1 }, { id: DRAFT_ID_2 }]);
    const storage = fakeStorage(() => Promise.resolve());

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result).toEqual({ deletedCount: 2, iconDeleteFailures: 0 });
    expect(storage.delete).toHaveBeenCalledWith(`drafts/${DRAFT_ID_1}/icon.png`);
    expect(storage.delete).toHaveBeenCalledWith(`drafts/${DRAFT_ID_2}/icon.png`);
  });

  it('counts icon-delete failures without throwing, and still reports the full deletedCount', async () => {
    const db = fakeDb([{ id: DRAFT_ID_1 }, { id: DRAFT_ID_2 }]);
    const storage = fakeStorage((key) =>
      key === `drafts/${DRAFT_ID_1}/icon.png` ? Promise.reject(new Error('not found')) : Promise.resolve(),
    );

    const result = await cleanupExpiredDrafts(db, storage);

    expect(result).toEqual({ deletedCount: 2, iconDeleteFailures: 1 });
  });
});
