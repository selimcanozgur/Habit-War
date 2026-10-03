/**
 * Transactional mail for the two email flows.
 *
 * Resend over the HTTP API rather than SMTP: no connection pool to manage, no port
 * 25 blocked by a host, and a single fetch is easier to reason about than a mail
 * client's state machine.
 *
 * Without an API key the sender logs instead of sending. That is what makes local
 * work possible with no mail account at all — the verification link appears in the
 * API's own output — and `env.ts` refuses to start in production without the key,
 * so the fallback cannot quietly become the production behaviour.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { MailSender } from './service.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface MailOptions {
  readonly apiKey: string | undefined;
  readonly from: string;
  /** Base URL the links point at. */
  readonly appUrl: string;
  readonly logger: FastifyBaseLogger;
}

interface Letter {
  readonly subject: string;
  readonly html: string;
}

export function createMailSender(options: MailOptions): MailSender {
  return async ({ to, kind, token }) => {
    const letter =
      kind === 'EMAIL_VERIFICATION'
        ? verificationLetter(options.appUrl, token)
        : resetLetter(options.appUrl, token);

    if (!options.apiKey) {
      // The token itself goes to the log, deliberately: in development the log is
      // the inbox. This branch cannot run in production — env.ts requires the key
      // there — which is what keeps a live reset token out of a real log file.
      options.logger.warn(
        { to, kind, token },
        'no RESEND_API_KEY: mail not sent, token logged for local use',
      );
      return;
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: options.from,
        to: [to],
        subject: letter.subject,
        html: letter.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // Thrown rather than swallowed. A silent failure here means the user waits
      // forever for a mail nobody is going to send, with no sign anything is wrong.
      throw new Error(`Resend refused the message (${response.status}): ${detail.slice(0, 200)}`);
    }
  };
}

function verificationLetter(appUrl: string, token: string): Letter {
  const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Habit War — e-posta adresini doğrula',
    html: layout(
      'Hoş geldin!',
      `<p>Habit War hesabını kullanmaya başlamak için e-posta adresini doğrula.</p>
       ${button(link, 'E-postamı doğrula')}
       <p class="muted">Bu bağlantı 1 saat geçerli. Bu hesabı sen oluşturmadıysan bu e-postayı yok sayabilirsin.</p>`,
    ),
  };
}

function resetLetter(appUrl: string, token: string): Letter {
  const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Habit War — şifre sıfırlama',
    html: layout(
      'Şifreni sıfırla',
      `<p>Yeni bir şifre belirlemek için aşağıdaki bağlantıya tıkla.</p>
       ${button(link, 'Yeni şifre belirle')}
       <p class="muted">Bu bağlantı 1 saat geçerli ve yalnızca bir kez kullanılabilir.
       Şifre sıfırlama talebinde bulunmadıysan bu e-postayı yok say — hesabın güvende.</p>`,
    ),
  };
}

/**
 * The shared frame.
 *
 * Inline styles and a table-free single column, because mail clients strip
 * stylesheets and Outlook's renderer is not a browser. The parchment palette is
 * written out literally rather than imported from the app's theme: that theme is a
 * React Native module, and this string has to survive a mail client that supports
 * roughly the CSS of 2005.
 */
function layout(heading: string, body: string): string {
  return `<!doctype html>
<html lang="tr">
  <body style="margin:0;padding:24px;background:#1D2A35;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#F8E3C2;border:2px solid #D9B681;border-radius:18px;padding:28px;color:#3A2E1F;">
      <h1 style="margin:0 0 16px;font-size:22px;color:#1E1E1C;">${heading}</h1>
      ${body}
    </div>
    <style>
      p { line-height: 1.5; margin: 0 0 14px; }
      .muted { color: #6B5744; font-size: 13px; }
    </style>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:22px 0;">
    <a href="${href}" style="display:inline-block;background:#2072BB;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">${label}</a>
  </p>
  <p class="muted">Buton çalışmazsa bu adresi tarayıcına yapıştır:<br>${href}</p>`;
}
