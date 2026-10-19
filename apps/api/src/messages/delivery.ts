import { Logger } from '@nestjs/common';
import { clubMessageEmail } from '../notifications/club-message-email.js';
import { sendEmail, type Email } from '../notifications/notifier.js';
import { findDelivery, markDelivered } from './messages.repository.js';
import { optOutUrl } from '../notifications/email-preferences.js';

const logger = new Logger('Messages');

/**
 * Send a recorded message — POOLSE-67.
 *
 * **After the commit, never inside it**, and it cannot fail the request that
 * wrote the record: `sendEmail` never throws and this catches everything else.
 * The record is the fact; an email that did not leave is a row with a null
 * `delivered_at`, which the message page says in words.
 *
 * **One email per address**, never one with everybody in To: families' addresses
 * are not something Poolse shows to each other, and a provider refusing one must
 * not take the rest with it. Each success is stamped at once, so a process that
 * dies half-way leaves an honest record of who was reached.
 *
 * Only addresses not yet delivered are read, so calling this twice sends nothing
 * twice. `send` is injectable for the tests.
 */
export async function deliverMessage(
  organizationId: string,
  messageId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<number> {
  try {
    const delivery = await findDelivery(organizationId, messageId);
    if (delivery === null) return 0;

    // The tokens came with the delivery, in one read (sweep 19-10b); keyed without
    // case, as citext compares them. A message from before tokens existed has none.
    const tokens = new Map(Object.entries(delivery.tokens).map(([email, token]) => [email.toLowerCase(), token]));
    const link = (to: string): string | null => {
      if (!delivery.optOutAllowed) return null;
      const token = tokens.get(to.toLowerCase());
      return token === undefined ? null : optOutUrl(token);
    };

    let delivered = 0;
    for (const to of delivery.pending) {
      const sent = await send(
        clubMessageEmail({
          to,
          organizationName: delivery.organizationName,
          subject: delivery.subject,
          body: delivery.body,
          locale: delivery.organizationLocale,
          // POOLSE-86: a general message carries the way out; a closure warning does not.
          optOutLink: link(to),
        }),
      );
      if (sent) {
        await markDelivered(organizationId, messageId, to);
        delivered += 1;
      }
    }
    return delivered;
  } catch (error) {
    logger.warn(`Could not deliver message ${messageId}: ${String(error)}`);
    return 0;
  }
}
