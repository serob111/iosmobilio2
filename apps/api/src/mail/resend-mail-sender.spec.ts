import { ResendMailSender } from './resend-mail-sender.js';

const fetchMock = vi.fn();

describe('ResendMailSender', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends via the Resend API', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const sender = new ResendMailSender('key-123', 'Mobilio <noreply@mobilio.app>');

    await sender.send({ to: 'a@example.com', subject: 'hi', body: 'body' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer key-123' }),
      }),
    );
  });

  it('throws when Resend responds with a non-ok status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const sender = new ResendMailSender('key-123', 'Mobilio <noreply@mobilio.app>');

    await expect(sender.send({ to: 'a@example.com', subject: 'hi', body: 'body' })).rejects.toThrow(
      'Resend send failed with status 500',
    );
  });
});
