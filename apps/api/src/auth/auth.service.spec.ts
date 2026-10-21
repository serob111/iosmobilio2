import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { DbService } from '../db/db.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { MAIL_SENDER } from '../mail/mail-sender.js';

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function Redis() {
    return { disconnect: vi.fn() };
  }),
}));

describe('AuthService', () => {
  it('builds a betterAuth instance wired to the app db, redis, and mail sender', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DbService, useValue: { db: {} } },
        { provide: OrganizationsService, useValue: { createPersonalOrganization: vi.fn() } },
        { provide: MAIL_SENDER, useValue: { send: vi.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(AuthService);
    expect(service.auth).toBeDefined();
    expect(service.auth.api.getSession).toBeInstanceOf(Function);

    await service.onModuleDestroy();
  });
});
