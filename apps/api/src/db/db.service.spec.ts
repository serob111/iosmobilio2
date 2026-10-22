import { Test } from '@nestjs/testing';
import { DbService } from './db.service.js';

const { poolEndMock, createDbMock } = vi.hoisted(() => ({
  poolEndMock: vi.fn(),
  createDbMock: vi.fn(),
}));

vi.mock('@mobilio/db', () => ({
  createDb: createDbMock,
}));

describe('DbService', () => {
  beforeEach(() => {
    poolEndMock.mockReset().mockResolvedValue(undefined);
    createDbMock.mockReset().mockReturnValue({ pool: { end: poolEndMock }, db: {} });
  });

  it('creates the connection once and exposes db', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [DbService] }).compile();
    const service = moduleRef.get(DbService);
    expect(createDbMock).toHaveBeenCalledTimes(1);
    expect(service.db).toBeDefined();
  });

  it('closes the pool on module destroy', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [DbService] }).compile();
    const service = moduleRef.get(DbService);
    await service.onModuleDestroy();
    expect(poolEndMock).toHaveBeenCalledTimes(1);
  });
});
