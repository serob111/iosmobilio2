export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** MailSender is an interface, not a class — DI needs a concrete token to bind it to. */
export const MAIL_SENDER = Symbol('MAIL_SENDER');
