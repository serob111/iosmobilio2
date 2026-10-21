import { LogMailSender } from './log-mail-sender.js';

const { appendFileSyncMock } = vi.hoisted(() => ({ appendFileSyncMock: vi.fn() }));

vi.mock('node:fs', () => ({ appendFileSync: appendFileSyncMock }));

describe('LogMailSender', () => {
  const originalEnv = process.env.MAIL_LOG_FILE;

  afterEach(() => {
    appendFileSyncMock.mockClear();
    if (originalEnv === undefined) {
      delete process.env.MAIL_LOG_FILE;
    } else {
      process.env.MAIL_LOG_FILE = originalEnv;
    }
  });

  it('resolves without throwing', async () => {
    delete process.env.MAIL_LOG_FILE;
    const sender = new LogMailSender();
    await expect(
      sender.send({ to: 'a@example.com', subject: 'hi', body: 'body' }),
    ).resolves.toBeUndefined();
  });

  it('does not write a file when MAIL_LOG_FILE is unset', async () => {
    delete process.env.MAIL_LOG_FILE;
    const sender = new LogMailSender();
    await sender.send({ to: 'a@example.com', subject: 'hi', body: 'body' });
    expect(appendFileSyncMock).not.toHaveBeenCalled();
  });

  it('appends a JSON line to MAIL_LOG_FILE when set', async () => {
    process.env.MAIL_LOG_FILE = 'C:/tmp/mail.log';
    const sender = new LogMailSender();
    const message = { to: 'a@example.com', subject: 'hi', body: 'body' };
    await sender.send(message);

    expect(appendFileSyncMock).toHaveBeenCalledWith('C:/tmp/mail.log', `${JSON.stringify(message)}\n`);
  });
});
