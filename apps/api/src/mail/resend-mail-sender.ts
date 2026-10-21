import { Logger } from '@nestjs/common';
import type { MailSender, MailMessage } from './mail-sender.js';

export class ResendMailSender implements MailSender {
  private readonly logger = new Logger(ResendMailSender.name);

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      this.logger.error({ status: response.status, body });
      throw new Error(`Resend send failed with status ${response.status}`);
    }
  }
}
