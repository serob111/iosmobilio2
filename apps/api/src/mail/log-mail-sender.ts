import { Injectable, Logger } from '@nestjs/common';
import type { MailSender, MailMessage } from './mail-sender.js';

/** Dev/test default — logs instead of sending, so magic links are usable without a Resend key. */
@Injectable()
export class LogMailSender implements MailSender {
  private readonly logger = new Logger(LogMailSender.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.log({ ...message, note: 'mail not actually sent (no RESEND_API_KEY set)' });
  }
}
