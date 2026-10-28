import { renderExternalLinkPage } from './external-link-page.js';

describe('renderExternalLinkPage', () => {
  it('renders a target=_blank link to the given location', () => {
    const html = renderExternalLinkPage('https://checkout.stripe.com/pay/abc');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://checkout.stripe.com/pay/abc"');
  });

  it('escapes HTML-significant characters in the location to prevent injection', () => {
    const html = renderExternalLinkPage('https://evil.com/"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
