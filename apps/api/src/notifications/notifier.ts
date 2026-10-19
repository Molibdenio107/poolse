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
    /*
     * The body only off production — sweep of 15-10-2026. An invitation's body
     * is a live join link and a message to families is their words, and a
     * hosting log is not where either belongs: a forgotten EMAIL_PROVIDER on
     * Railway would have written them there. In production the log says who and
     * what about, and that nothing went.
     */
    if (process.env['NODE_ENV'] === 'production') {
      logger.warn(`[console] not sent (EMAIL_PROVIDER is not set) — to ${email.to}, subject: ${email.subject}`);
    } else {
      logger.log(
        `[console] would send to ${email.to}\n  subject: ${email.subject}\n  ${email.text.replace(/\n/g, '\n  ')}`,
      );
    }
    return false;
  }

  const key = process.env['RESEND_API_KEY'];
  if (!key) {
    logger.warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set; nothing sent');
    return false;
  }

  try {
    let response = await post(key, email);
    if (response.status === 429) {
      // Rate-limited (sweep 19-10b): wait as asked, once, rather than spending one
      // of the retry job's five attempts on the provider being busy.
      const wait = Math.min(Number(response.headers.get('retry-after') ?? '1') || 1, 10);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      response = await post(key, email);
    }

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

/**
 * One Resend call, paced and bounded — sweep 19-10b. Resend allows a couple of
 * requests a second, and every sender here loops one email per address, so calls
 * are spaced through one in-process queue; a call that hangs is abandoned after
 * 15 s rather than holding a delivery pass open.
 */
const SPACING_MS = 550;
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function post(key: string, email: Email): Promise<Response> {
  const call = queue.then(async () => {
    const wait = lastCall + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: sender(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  });
  queue = call.catch(() => undefined);
  return call;
}
