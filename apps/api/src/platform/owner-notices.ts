import { Logger } from '@nestjs/common';
import { withPlatform } from '@poolse/db';
import { sendEmail, type Email } from '../notifications/notifier.js';
import { supportNoticeEmail } from '../notifications/support-notice-email.js';
import { suspensionNoticeEmail } from '../notifications/suspension-notice-email.js';
import { trialNoticeEmail, type TrialNoticeKind } from '../notifications/trial-notice-email.js';

/**
 * The two notices the platform owes a club's Owners — POOLSE-86, slice 3.0a.
 *
 * `trial_notice` (the trial clock, POOLSE-61) and the support override's notice
 * (POOLSE-79) were recorded with their recipients and never sent. Both are now
 * emailed **after** the transaction that recorded them commits, and stamped when
 * mail left — the division every sender here makes, so a provider having a bad
 * minute never rolls back a transition or an override.
 *
 * Each email is rendered **from the row**, which is what lets the hourly retry
 * (`delivery-retry.service.ts`) call the very same function: a retried notice is
 * the notice that would have gone the first time.
 */

const logger = new Logger('OwnerNotices');

function webLink(path: string): string {
  const origin = (process.env['WEB_ORIGIN'] ?? 'http://localhost:3000').split(',')[0]!.trim();
  return `${origin.replace(/\/$/, '')}${path}`;
}

/**
 * The one date each kind is about, in Lisbon, `dd-MM-yyyy`. The notice's own
 * `due_on` is when it fell due, not what it says — "access closes on X" is the
 * deletion date, read from the club as it stands now, so an operator who
 * extended the trial since is not contradicted by the email.
 */
const DATE_OF = `
  to_char(CASE n.kind
    WHEN 'trial_ending_soon'   THEN o.trial_ends_at
    WHEN 'trial_last_day'      THEN o.trial_ends_at
    WHEN 'trial_ended'         THEN o.pending_delete_at
    WHEN 'access_closing_soon' THEN o.pending_delete_at
    WHEN 'access_closed'       THEN o.suspended_at + trial_closed_period()
    WHEN 'deletion_soon'       THEN o.suspended_at + trial_closed_period()
    WHEN 'payment_overdue'     THEN o.paid_through::timestamp AT TIME ZONE 'Europe/Lisbon'
    WHEN 'payment_read_only'   THEN o.read_only_at
  END AT TIME ZONE 'Europe/Lisbon', 'DD-MM-YYYY')`;

/** Send one trial notice to the owners on its row; stamp it if any copy left. Never throws. */
export async function deliverTrialNotice(
  noticeId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await withPlatform(async (tx) => {
      const { rows } = await tx.query<{
        kind: TrialNoticeKind;
        recipients: string[];
        delivered: boolean;
        name: string;
        locale: string;
        date: string | null;
      }>(
        `SELECT n.kind, n.recipients, n.delivered_at IS NOT NULL AS delivered,
                o.name, o.locale, ${DATE_OF} AS date
           FROM trial_notice n
           JOIN organization o ON o.id = n.organization_id
          WHERE n.id = $1`,
        [noticeId],
      );
      return rows[0] ?? null;
    });
    if (notice === null || notice.delivered || notice.recipients.length === 0) return false;
    // The state it describes was undone since (an operator lifted read-only, the
    // club was restored): the date it is about is gone, and so is the notice.
    if (notice.date === null) return false;

    let delivered = false;
    for (const to of notice.recipients) {
      const sent = await send(
        trialNoticeEmail({
          to,
          kind: notice.kind,
          organizationName: notice.name,
          date: notice.date,
          link: webLink('/dashboard/profile/subscription'),
          supportEmail: process.env['SUPPORT_EMAIL'] ?? process.env['NEXT_PUBLIC_SUPPORT_EMAIL'] ?? null,
          locale: notice.locale,
        }),
      );
      // One owner reached is the notice delivered; the list stays whole either way.
      delivered = delivered || sent;
    }
    if (delivered) {
      await withPlatform((tx) => tx.query('UPDATE trial_notice SET delivered_at = now() WHERE id = $1', [noticeId]));
    }
    return delivered;
  } catch (error) {
    logger.warn(`Could not send trial notice ${noticeId}: ${String(error)}`);
    return false;
  }
}

/** Send a support override's notice to the Owners it recorded. Never throws. */
export async function deliverSupportNotice(
  grantId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const grant = await withPlatform(async (tx) => {
      const { rows } = await tx.query<{
        recipients: string[] | null;
        delivered: boolean;
        reason: string | null;
        name: string;
        locale: string;
        starts_at: string;
        expires_at: string;
      }>(
        `SELECT g.notice_recipients AS recipients, g.notice_delivered_at IS NOT NULL AS delivered,
                g.reason, o.name, o.locale,
                to_char(g.starts_at AT TIME ZONE 'Europe/Lisbon', 'DD-MM-YYYY HH24:MI') AS starts_at,
                to_char(g.expires_at AT TIME ZONE 'Europe/Lisbon', 'DD-MM-YYYY HH24:MI') AS expires_at
           FROM support_grant g
           JOIN organization o ON o.id = g.organization_id
          WHERE g.id = $1 AND g.source = 'override'`,
        [grantId],
      );
      return rows[0] ?? null;
    });
    if (grant === null || grant.delivered || (grant.recipients ?? []).length === 0) return false;

    let delivered = false;
    for (const to of grant.recipients ?? []) {
      const sent = await send(
        supportNoticeEmail({
          to,
          organizationName: grant.name,
          reason: grant.reason ?? '',
          startsAt: grant.starts_at,
          expiresAt: grant.expires_at,
          link: webLink('/dashboard/profile?tab=support'),
          locale: grant.locale,
        }),
      );
      delivered = delivered || sent;
    }
    if (delivered) {
      await withPlatform((tx) =>
        tx.query(`UPDATE support_grant SET notice_delivered_at = now() WHERE id = $1 AND source = 'override'`, [grantId]),
      );
    }
    return delivered;
  } catch (error) {
    logger.warn(`Could not send support notice ${grantId}: ${String(error)}`);
    return false;
  }
}

/**
 * Where a club writes when its door is shut — the suspended screen's fallback
 * (decided 12-09-2026), so the email and the screen never name two addresses.
 */
export function supportAddress(): string {
  const configured = (process.env['SUPPORT_EMAIL'] ?? process.env['NEXT_PUBLIC_SUPPORT_EMAIL'] ?? '').trim();
  return configured === '' ? 'suporte@poolse.pt' : configured;
}

/**
 * Tell a club's Owners it was suspended or restored — POOLSE-225.
 *
 * Rendered from the row, which snapshots the reason (a restore clears it from
 * the club) and the recipients, so the hourly retry sends exactly what the first
 * attempt would have. Never throws.
 */
export async function deliverSuspensionNotice(
  noticeId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await withPlatform(async (tx) => {
      const { rows } = await tx.query<{
        kind: 'suspended' | 'restored';
        reason: string | null;
        recipients: string[];
        delivered: boolean;
        name: string;
        locale: string;
        occurred_at: string;
      }>(
        `SELECT n.kind::text AS kind, n.reason, n.recipients, n.delivered_at IS NOT NULL AS delivered,
                o.name, o.locale,
                to_char(n.occurred_at AT TIME ZONE 'Europe/Lisbon', 'DD-MM-YYYY HH24:MI') AS occurred_at
           FROM suspension_notice n
           JOIN organization o ON o.id = n.organization_id
          WHERE n.id = $1`,
        [noticeId],
      );
      return rows[0] ?? null;
    });
    if (notice === null || notice.delivered || notice.recipients.length === 0) return false;

    let delivered = false;
    for (const to of notice.recipients) {
      const sent = await send(
        suspensionNoticeEmail({
          to,
          kind: notice.kind,
          organizationName: notice.name,
          reason: notice.reason,
          occurredAt: notice.occurred_at,
          supportEmail: supportAddress(),
          link: webLink('/dashboard'),
          locale: notice.locale,
        }),
      );
      delivered = delivered || sent;
    }
    if (delivered) {
      await withPlatform((tx) => tx.query('UPDATE suspension_notice SET delivered_at = now() WHERE id = $1', [noticeId]));
    }
    return delivered;
  } catch (error) {
    logger.warn(`Could not send suspension notice ${noticeId}: ${String(error)}`);
    return false;
  }
}
