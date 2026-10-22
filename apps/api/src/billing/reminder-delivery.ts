import { Logger } from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { invoiceReminderEmail } from '../notifications/invoice-reminder-email.js';
import { sendEmail, type Email } from '../notifications/notifier.js';
import type { ReminderDocument } from './reminders.repository.js';
import { readPaymentDestinations } from './payment-destinations.js';

const logger = new Logger('InvoiceReminder');

/**
 * Send one invoice reminder, rendered from its row — POOLSE-86, 3.0b. The
 * request calls it after the commit and the hourly retry calls it again, so the
 * documents and amounts are the ones snapshotted when it was sent. Where to pay
 * (POOLSE-94: the IBAN, MB WAY and *Como pagar*) is read as it stands now: a
 * club correcting its IBAN wants the correction in a retried email. Never throws.
 */
export async function deliverInvoiceReminder(
  organizationId: string,
  reminderId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const row = await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{
        email: string;
        payer_name: string;
        locale: string;
        lines: ReminderDocument[];
        delivered: boolean;
        organization_name: string;
      }>(
        `SELECT r.email::text AS email, r.payer_name, r.locale, r.lines, r.delivered_at IS NOT NULL AS delivered,
                o.name AS organization_name
           FROM invoice_reminder r
           JOIN organization o ON o.id = r.organization_id
          WHERE r.id = $1`,
        [reminderId],
      );
      const found = rows[0];
      return found === undefined ? null : { ...found, payment: await readPaymentDestinations(tx, organizationId) };
    });
    if (row === null || row.delivered) return false;

    const sent = await send(
      invoiceReminderEmail({
        to: row.email,
        organizationName: row.organization_name,
        payerName: row.payer_name,
        documents: row.lines,
        payment: row.payment,
        locale: row.locale,
      }),
    );
    if (sent) {
      await withOrg(organizationId, (tx) =>
        tx.query('UPDATE invoice_reminder SET delivered_at = now() WHERE id = $1', [reminderId]),
      );
    }
    return sent;
  } catch (error) {
    logger.warn(`Could not send invoice reminder ${reminderId}: ${String(error)}`);
    return false;
  }
}
