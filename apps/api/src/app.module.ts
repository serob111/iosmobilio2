import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { QueueModule } from './queue/queue.module.js';
import { StorageModule } from './storage/storage.module.js';

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
    StorageModule,
    OrganizationsModule,
    ProjectsModule,
    AuthModule,
    HealthModule,
    QueueModule,
  ],
  // Global: every route requires a session unless marked @Public() (see
  // auth/public.decorator.ts) — secure by default, rather than relying on every new
  // controller remembering to add @UseGuards(AuthGuard) itself.
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
