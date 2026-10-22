import { Logger } from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { paymentChangeEmail } from '../notifications/payment-change-email.js';
import { sendEmail, type Email } from '../notifications/notifier.js';

const logger = new Logger('PaymentChangeNotice');

/**
 * Tell every owner the club's IBAN changed — POOLSE-94. Rendered from its row,
 * so the request (after the commit) and the hourly retry send the same email.
 * Delivered once every recipient took it; one that failed leaves the row for
 * the retry, which sends to all of them again rather than guess who missed it.
 * Never throws.
 */
export async function deliverPaymentChangeNotice(
  organizationId: string,
  noticeId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{
        recipients: string[];
        delivered: boolean;
        old_end: string | null;
        new_end: string | null;
        changed_by: string | null;
        changed_at: string;
        name: string;
        locale: string;
      }>(
        `SELECT n.recipients::text[] AS recipients, n.delivered_at IS NOT NULL AS delivered,
                n.old_iban_end AS old_end, n.new_iban_end AS new_end,
                person_name(n.changed_by) AS changed_by,
                to_char(n.changed_at AT TIME ZONE 'Europe/Lisbon', 'DD-MM-YYYY HH24:MI') AS changed_at,
                o.name, o.locale
           FROM payment_change_notice n
           JOIN organization o ON o.id = n.organization_id
          WHERE n.id = $1`,
        [noticeId],
      );
      return rows[0] ?? null;
    });
    if (notice === null || notice.delivered || notice.recipients.length === 0) return false;

    let all = true;
    for (const to of notice.recipients) {
      const sent = await send(
        paymentChangeEmail({
          to,
          organizationName: notice.name,
          changedBy: notice.changed_by ?? '—',
          changedAt: notice.changed_at,
          oldEnd: notice.old_end,
          newEnd: notice.new_end,
          locale: notice.locale,
        }),
      );
      all &&= sent;
    }
    if (all) {
      await withOrg(organizationId, (tx) =>
        tx.query('UPDATE payment_change_notice SET delivered_at = now() WHERE id = $1', [noticeId]),
      );
    }
    return all;
  } catch (error) {
    logger.warn(`Could not send payment change notice ${noticeId}: ${String(error)}`);
    return false;
  }
}
