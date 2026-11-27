import type { MailMessage } from './mail-sender.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function magicLinkEmail(email: string, url: string): MailMessage {
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(url);
  const company = process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME ?? 'Mobilio';
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? 'Yerevan, Armenia';
  const subject = 'Your Mobilio sign-in link';
  const body = [
    'Sign in to Mobilio', '',
    `Open this one-time link to sign in as ${email}. It works for 15 minutes:`,
    url, '',
    "Didn't ask for this? Ignore this email and no one gets in.", '',
    `Mobilio · ${company}, ${address}`,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F3F0FF;color:#17112E;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">Tap to sign in. The link works for 15 minutes.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3F0FF"><tr><td align="center" style="padding:40px 20px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:24px"><tr><td style="padding:40px"><div style="font-size:20px;font-weight:800;letter-spacing:-.02em">mobilio</div><h1 style="margin:22px 0 14px;font-size:28px;line-height:1.15;letter-spacing:-.03em">Sign in to Mobilio</h1><p style="margin:0 0 22px;font-size:16px;line-height:1.55">Tap the button to sign in as ${safeEmail}. The link works once, for 15 minutes.</p><a href="${safeUrl}" style="display:inline-block;padding:16px 28px;border-radius:999px;background:#4B2BE0;color:#FFFFFF;font-size:16px;font-weight:700;text-decoration:none">Sign in</a><p style="margin:22px 0 0;font-size:14px;line-height:1.55;color:#55506A">Button not working? Paste this into your browser:<br><a href="${safeUrl}" style="color:#4B2BE0;word-break:break-all">${safeUrl}</a></p><div style="height:1px;background:#EFEBFA;margin:22px 0"></div><p style="margin:0;font-size:13px;line-height:1.55;color:#55506A">Didn't ask for this? Ignore this email and no one gets in.</p></td></tr></table><p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#55506A">Mobilio · ${escapeHtml(company)}, ${escapeHtml(address)}</p></td></tr></table></body></html>`;
  return { to: email, subject, body, html };
}
