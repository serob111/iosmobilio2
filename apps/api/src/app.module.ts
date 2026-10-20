import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => {
          const header = req.headers['x-request-id'];
          return typeof header === 'string' && header.length > 0 ? header : randomUUID();
        },
      },
    }),
    DbModule,
    HealthModule,
    QueueModule,
  ],
})
export class AppModule {}
