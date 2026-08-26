import { Logger } from '@nestjs/common';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const logger = new Logger('Notifier');

/**
 * Transactional email, behind one function.
 *
 * The provider is still an open phase 0 decision, and this is the shape that
 * stops that decision from blocking anything: everything above this line writes
 * an `Email` and calls `sendEmail`, and swapping Resend for Postmark, SES or
 * plain SMTP is one adapter below it. Slice 3.0 builds the full notification
 * subsystem — records, preferences, push — on top of the same seam.
 *
 * Defaults to `console`, which logs the message instead of sending it. That is
 * the right default for local development, where there is no key and no domain,
 * and it means the invitation flow works end to end on a laptop: the link is on
 * screen and in the log.
 */
export type Provider = 'console' | 'resend';

export function provider(): Provider {
  const configured = (process.env['EMAIL_PROVIDER'] ?? 'console').toLowerCase();
  if (configured === 'resend') return 'resend';
  if (configured !== 'console') {
    logger.warn(`Unknown EMAIL_PROVIDER "${configured}"; falling back to console`);
  }
  return 'console';
}

/** True when mail will actually leave the building, so callers can say so. */
export function emailIsConfigured(): boolean {
  return provider() === 'resend' && Boolean(process.env['RESEND_API_KEY']);
}

function sender(): string {
  // Resend hands every account `onboarding@resend.dev`, which can send to the
  // address that owns the account without verifying a domain. Good enough to
  // test the whole flow; a real domain is required before sending to customers.
  return process.env['EMAIL_FROM'] ?? 'Poolse <onboarding@resend.dev>';
}

/**
 * Never throws.
 *
 * A failed email must not fail the thing it was announcing — an invitation that
 * exists but was not delivered is recoverable in one click ("New link"), while
 * an invitation that was rolled back because a mail server was briefly down is
 * just confusing. The caller is told whether it went, and the link stays on
 * screen either way.
 */
export async function sendEmail(email: Email): Promise<boolean> {
  if (provider() === 'console') {
    logger.log(
      `[console] would send to ${email.to}\n  subject: ${email.subject}\n  ${email.text.replace(/\n/g, '\n  ')}`,
    );
    return false;
  }

  const key = process.env['RESEND_API_KEY'];
  if (!key) {
    logger.warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set; nothing sent');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: sender(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    if (!response.ok) {
      // The body carries the reason — an unverified domain, a bad key, a
      // recipient the sandbox sender is not allowed to reach. Worth logging in
      // full, because every one of those is a configuration mistake with a
      // different fix.
      logger.error(`Resend refused the message (${response.status}): ${await response.text()}`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Could not reach Resend: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}
