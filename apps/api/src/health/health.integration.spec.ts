import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

// Only runs when real Postgres/Redis are reachable (CI sets DATABASE_URL/REDIS_URL from
// its services: containers — see .github/workflows/ci.yml). Locally this just skips,
// since vitest doesn't load .env files and plain `npm test` shouldn't require live
// services. Unlike health.controller.spec.ts, this file does NOT mock 'pg'/'ioredis'.
const hasLiveServices = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

describe.skipIf(!hasLiveServices)('HealthController (live services)', () => {
  it('reports both postgres and redis up against real services', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    const controller = moduleRef.get(HealthController);
    const result = await controller.check();
    expect(result).toEqual({ postgres: { status: 'up' }, redis: { status: 'up' } });
  });
});
