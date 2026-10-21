import { Global, Module } from '@nestjs/common';
import { MAIL_SENDER } from './mail-sender.js';
import { LogMailSender } from './log-mail-sender.js';
import { ResendMailSender } from './resend-mail-sender.js';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      useFactory: () => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          return new LogMailSender();
        }
        return new ResendMailSender(apiKey, process.env.MAIL_FROM ?? 'Mobilio <noreply@mobilio.app>');
      },
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}
