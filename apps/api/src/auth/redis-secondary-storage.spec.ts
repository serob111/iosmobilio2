import { createRedisSecondaryStorage } from './redis-secondary-storage.js';

function fakeRedis() {
  return {
    get: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    set: vi.fn(),
  };
}

describe('createRedisSecondaryStorage', () => {
  it('get delegates to redis.get', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue('value');
    const storage = createRedisSecondaryStorage(redis as never);
    await expect(storage.get('k')).resolves.toBe('value');
    expect(redis.get).toHaveBeenCalledWith('k');
  });

  it('getAndDelete deletes only when a value exists', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue('value');
    const storage = createRedisSecondaryStorage(redis as never);
    await expect(storage.getAndDelete('k')).resolves.toBe('value');
    expect(redis.del).toHaveBeenCalledWith('k');
  });

  it('getAndDelete skips delete when there is nothing to delete', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue(null);
    const storage = createRedisSecondaryStorage(redis as never);
    await expect(storage.getAndDelete('k')).resolves.toBeNull();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('increment sets ttl only on the first increment', async () => {
    const redis = fakeRedis();
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const storage = createRedisSecondaryStorage(redis as never);

    await storage.increment('k', 60);
    expect(redis.expire).toHaveBeenCalledWith('k', 60);

    redis.expire.mockClear();
    await storage.increment('k', 60);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('set applies a ttl when given one, and omits it otherwise', async () => {
    const redis = fakeRedis();
    const storage = createRedisSecondaryStorage(redis as never);

    await storage.set('k', 'v', 60);
    expect(redis.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);

    redis.set.mockClear();
    await storage.set('k', 'v');
    expect(redis.set).toHaveBeenCalledWith('k', 'v');
  });

  it('delete delegates to redis.del', async () => {
    const redis = fakeRedis();
    const storage = createRedisSecondaryStorage(redis as never);
    await storage.delete('k');
    expect(redis.del).toHaveBeenCalledWith('k');
  });
});
