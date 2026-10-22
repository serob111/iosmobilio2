import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DbService } from '../db/db.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { MAIL_SENDER, type MailSender } from '../mail/mail-sender.js';
import { createRedisSecondaryStorage } from './redis-secondary-storage.js';
import { buildAuth } from './build-auth.js';

@Injectable()
export class AuthService implements OnModuleDestroy {
  readonly auth: ReturnType<typeof buildAuth>;
  private readonly redis: Redis;

  constructor(
    private readonly dbService: DbService,
    private readonly organizationsService: OrganizationsService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

    this.auth = buildAuth({
      db: this.dbService.db,
      secondaryStorage: createRedisSecondaryStorage(this.redis),
      mailSender: this.mailSender,
      onUserCreated: (userId, name, email) =>
        this.organizationsService.createPersonalOrganization(userId, name, email).then(() => undefined),
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
