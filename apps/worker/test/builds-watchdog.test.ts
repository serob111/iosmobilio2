import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@mobilio/db';
import { failStuckBuilds } from '../src/builds-watchdog';

function fakeDb(batches: Array<Array<{ id: string }>>): Db & { execute: ReturnType<typeof vi.fn> } {
  let call = 0;
  const execute = vi.fn().mockImplementation(async () => {
    const rows = batches[call] ?? [];
    call += 1;
    return { rows };
  });
  return { execute } as unknown as Db & { execute: ReturnType<typeof vi.fn> };
}

const BUILD_ID_1 = '01a16033-3d3b-718f-b2f4-9508ec870bad';
const BUILD_ID_2 = '01a16033-3d3b-718f-b2f4-9508ec870bae';

describe('failStuckBuilds', () => {
  it('fails nothing and reports zero when the function returns no rows', async () => {
    const db = fakeDb([[]]);

    const result = await failStuckBuilds(db);

    expect(result).toEqual({ failedCount: 0, failedIds: [] });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('collects the id of every stuck build returned by the function', async () => {
    const db = fakeDb([[{ id: BUILD_ID_1 }, { id: BUILD_ID_2 }]]);

    const result = await failStuckBuilds(db);

    expect(result).toEqual({ failedCount: 2, failedIds: [BUILD_ID_1, BUILD_ID_2] });
  });

  it('keeps calling the function in batches of 200 until a short batch signals the end', async () => {
    const fullBatch = Array.from({ length: 200 }, () => ({ id: randomUUID() }));
    const shortBatch = [{ id: randomUUID() }];
    const db = fakeDb([fullBatch, shortBatch]);

    const result = await failStuckBuilds(db);

    expect(result.failedCount).toBe(201);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('stops the batch loop as soon as an empty result comes back, even mid-sequence', async () => {
    const fullBatch = Array.from({ length: 200 }, () => ({ id: randomUUID() }));
    const db = fakeDb([fullBatch, []]);

    const result = await failStuckBuilds(db);

    expect(result.failedCount).toBe(200);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
