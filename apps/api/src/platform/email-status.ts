import { withOrg, withPlatform } from '@poolse/db';
import { clerk } from '../auth/clerk.js';
import { emailIsConfigured, provider, sendEmail } from '../notifications/notifier.js';
import { RETRY_MAX, RETRY_WINDOW } from '../notifications/delivery-retry.service.js';

/**
 * The platform's email, at a glance — POOLSE-217 (Rui, 10-11-2026). Whether
 * sending is on, from which address, and per club what is still unsent: waiting
 * for the hourly retry, or given up after `RETRY_MAX` tries, within the retry's
 * own window. Read-only: the key is a server secret and never shown or stored
 * here, and nothing on this card changes how mail is sent.
 *
 * The counts read the same tables, columns and window as
 * `DeliveryRetryService`, so the card and the retry cannot disagree about what
 * is unsent. Invitations are not here: their link is a hash and they are never
 * retried (*Novo link* re-sends).
 */
export interface EmailStatus {
  configured: boolean;
  provider: 'console' | 'resend';
  /** `EMAIL_FROM` as configured — an address, never a secret. */
  from: string;
  /** Clubs with anything unsent, worst first. */
  clubs: { organizationId: string; name: string; waiting: number; failed: number }[];
}

/** Each retried kind's unsent rows: waiting (tries left) and failed (none left). */
const UNSENT: string[] = [
  `SELECT a.delivery_attempts AS tries FROM pool_analysis_alert a
     JOIN pool_analysis pa ON pa.id = a.analysis_id AND pa.organization_id = a.organization_id
    WHERE a.delivered_at IS NULL AND a.archived_at IS NULL AND pa.archived_at IS NULL AND a.raised_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT a.delivery_attempts AS tries FROM lab_result_alert a
     JOIN lab_result lr ON lr.id = a.lab_result_id AND lr.organization_id = a.organization_id
    WHERE a.delivered_at IS NULL AND lr.archived_at IS NULL AND a.raised_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT delivery_attempts AS tries FROM qualification_alert
    WHERE delivered_at IS NULL AND cardinality(recipients) > 0 AND raised_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT delivery_attempts AS tries FROM message_recipient
    WHERE delivered_at IS NULL AND email IS NOT NULL AND created_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT delivery_attempts AS tries FROM invoice_reminder
    WHERE delivered_at IS NULL AND created_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT delivery_attempts AS tries FROM payment_change_notice
    WHERE delivered_at IS NULL AND cardinality(recipients) > 0 AND created_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT delivery_attempts AS tries FROM level_change_notice
    WHERE delivered_at IS NULL AND cardinality(recipients) > 0 AND created_at > now() - interval '${RETRY_WINDOW}'`,
  `SELECT delivery_attempts AS tries FROM majority_notice
    WHERE delivered_at IS NULL AND created_at > now() - interval '${RETRY_WINDOW}'`,
];

export async function readEmailStatus(): Promise<EmailStatus> {
  const orgs = await withPlatform(async (tx) =>
    (
      await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM organization WHERE archived_at IS NULL ORDER BY name',
      )
    ).rows,
  );
  const sql = `SELECT count(*) FILTER (WHERE tries < ${RETRY_MAX})::int AS waiting,
                      count(*) FILTER (WHERE tries >= ${RETRY_MAX})::int AS failed
                 FROM (${UNSENT.join(' UNION ALL ')}) u`;
  const clubs: EmailStatus['clubs'] = [];
  for (const org of orgs) {
    const row = await withOrg(org.id, async (tx) => (await tx.query<{ waiting: number; failed: number }>(sql)).rows[0]);
    if (row !== undefined && row.waiting + row.failed > 0) {
      clubs.push({ organizationId: org.id, name: org.name, waiting: row.waiting, failed: row.failed });
    }
  }
  clubs.sort((a, b) => b.failed - a.failed || b.waiting - a.waiting || a.name.localeCompare(b.name));
  return {
    configured: emailIsConfigured(),
    provider: provider(),
    from: process.env['EMAIL_FROM'] ?? '',
    clubs,
  };
}

/**
 * A test email to the platform admin's own sign-in address — POOLSE-217. As
 * Poolse (no club), so it proves the key, the sending address and delivery, and
 * nothing else. Answers whether it left; a console provider never sends.
 */
export async function sendTestEmail(clerkUserId: string): Promise<{ to: string | null; sent: boolean }> {
  const user = await clerk().users.getUser(clerkUserId);
  const to = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  if (to === null) return { to: null, sent: false };
  const sent = await sendEmail({
    to,
    subject: 'Poolse — email de teste',
    text: 'Este é um email de teste enviado a partir de /admin. Se o recebeu, o envio de emails do Poolse está a funcionar.',
    html: '<p>Este é um email de teste enviado a partir de <code>/admin</code>. Se o recebeu, o envio de emails do Poolse está a funcionar.</p>',
  });
  return { to, sent };
}
