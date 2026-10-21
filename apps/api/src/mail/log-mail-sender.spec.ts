import { LogMailSender } from './log-mail-sender.js';

describe('LogMailSender', () => {
  it('resolves without throwing', async () => {
    const sender = new LogMailSender();
    await expect(
      sender.send({ to: 'a@example.com', subject: 'hi', body: 'body' }),
    ).resolves.toBeUndefined();
  });
});
