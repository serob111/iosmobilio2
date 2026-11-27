import { magicLinkEmail } from './magic-link-email.js';

describe('magicLinkEmail', () => {
  it('renders stable HTML and plain-text sign-in content', () => {
    process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME = 'Mobilio LLC';
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = '42 App Street';
    const message = magicLinkEmail('anna@example.com', 'https://mobilio.app/auth/verify?token=abc&next=/workspace');

    expect(message).toMatchSnapshot();
    expect(message.html).toContain('token=abc&amp;next=/workspace');
    expect(message.body).toContain('https://mobilio.app/auth/verify?token=abc&next=/workspace');
  });

  it('escapes user-controlled values in HTML', () => {
    const message = magicLinkEmail('a<script>@example.com', 'https://example.com/?x=<script>');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});
