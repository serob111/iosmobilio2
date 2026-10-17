import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';

const connectMock = vi.fn();
const queryMock = vi.fn();
const endMock = vi.fn();
const redisConnectMock = vi.fn();
const pingMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return { connect: connectMock, query: queryMock, end: endMock };
  }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function Redis() {
    return { connect: redisConnectMock, ping: pingMock, disconnect: disconnectMock };
  }),
}));

describe('HealthController', () => {
  beforeEach(() => {
    connectMock.mockReset().mockResolvedValue(undefined);
    queryMock.mockReset().mockResolvedValue(undefined);
    endMock.mockReset().mockResolvedValue(undefined);
    redisConnectMock.mockReset().mockResolvedValue(undefined);
    pingMock.mockReset().mockResolvedValue('PONG');
    disconnectMock.mockReset();
  });

  async function buildController(): Promise<HealthController> {
    const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    return moduleRef.get(HealthController);
  }

  it('returns up for both when postgres and redis are reachable', async () => {
    const controller = await buildController();
    const result = await controller.check();
    expect(result).toEqual({ postgres: { status: 'up' }, redis: { status: 'up' } });
  });

  it('throws ServiceUnavailableException when postgres is down', async () => {
    connectMock.mockRejectedValue(new Error('connection refused'));
    const controller = await buildController();
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when redis is down', async () => {
    pingMock.mockRejectedValue(new Error('redis unreachable'));
    const controller = await buildController();
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
