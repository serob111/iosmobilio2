import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
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
    MailModule,
    OrganizationsModule,
    AuthModule,
    HealthModule,
    QueueModule,
  ],
})
export class AppModule {}
