import { Test } from '@nestjs/testing';
import { MailModule } from './mail.module.js';
import { MAIL_SENDER } from './mail-sender.js';
import { LogMailSender } from './log-mail-sender.js';
import { ResendMailSender } from './resend-mail-sender.js';

describe('MailModule', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('provides LogMailSender when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [MailModule] }).compile();
    expect(moduleRef.get(MAIL_SENDER)).toBeInstanceOf(LogMailSender);
  });

  it('provides ResendMailSender when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 'key-123';
    const moduleRef = await Test.createTestingModule({ imports: [MailModule] }).compile();
    expect(moduleRef.get(MAIL_SENDER)).toBeInstanceOf(ResendMailSender);
  });
});
