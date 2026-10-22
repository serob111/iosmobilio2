import { appendFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import type { MailSender, MailMessage } from './mail-sender.js';

/**
 * Dev/test default — logs instead of sending, so magic links are usable without a
 * Resend key. When MAIL_LOG_FILE is set, also appends each message as a JSON line —
 * a test-only hook so Playwright E2E can retrieve a real magic-link URL without a real
 * inbox (see apps/web/e2e/auth.spec.ts). Harmless/unused when the env var is unset.
 */
@Injectable()
export class LogMailSender implements MailSender {
  private readonly logger = new Logger(LogMailSender.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.log({ ...message, note: 'mail not actually sent (no RESEND_API_KEY set)' });

    const logFile = process.env.MAIL_LOG_FILE;
    if (logFile) {
      appendFileSync(logFile, `${JSON.stringify(message)}\n`);
    }
  }
}
