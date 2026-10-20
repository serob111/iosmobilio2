import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client';

describe('createDb', () => {
  it('returns a pool and a drizzle instance without connecting', () => {
    const { pool, db } = createDb('postgres://user:pass@localhost:5432/db');
    expect(pool).toBeDefined();
    expect(db).toBeDefined();
    return pool.end();
  });
});
