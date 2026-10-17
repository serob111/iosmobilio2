import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { checkPostgres, checkRedis, type IndicatorResult } from './health.indicators.js';

type HealthResult = { postgres: IndicatorResult; redis: IndicatorResult };

@Controller('health')
export class HealthController {
  @Get()
  async check(): Promise<HealthResult> {
    const [postgres, redis] = await Promise.all([
      checkPostgres(process.env.DATABASE_URL ?? ''),
      checkRedis(process.env.REDIS_URL ?? ''),
    ]);
    const result: HealthResult = { postgres, redis };

    if (postgres.status !== 'up' || redis.status !== 'up') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
