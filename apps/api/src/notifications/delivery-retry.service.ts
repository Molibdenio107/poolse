import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withOrg, withPlatform } from '@poolse/db';
import { deliverLabAlert, deliverWaterAlert } from '../facilities/alert-delivery.js';
import { deliverInvoiceReminder } from '../billing/reminder-delivery.js';
import { deliverMessage } from '../messages/delivery.js';
import { deliverSupportNotice, deliverTrialNotice } from '../platform/owner-notices.js';
import { alertRecipients, redeliverAlert } from '../platform/platform-alert.js';
import { redeliverQualificationAlert } from '../staff/qualification-alerts.js';
import { emailIsConfigured, sendEmail, type Email } from './notifier.js';

type Send = (email: Email) => Promise<boolean>;

/**
 * The hourly retry — POOLSE-86, slice 3.0a.
 *
 * Every sender here sends once, after its commit, and stamps when mail left. A
 * provider outage at that minute used to leave the row "recorded, not sent" for
 * ever. This finds what is still unsent and **recent**, and calls the sender's
 * own by-id function again — so a retried email is rendered from the row exactly
 * as the first attempt was, and no wording exists twice.
 *
 * **The window, and why.** A row raised in the last 48 hours, at least ten
 * minutes old (the first send is not over yet before that), retried at most
 * once an hour and five times in all. Older than 48 hours, an alert about water
 * or a lapsed trial is no longer news — and the first night after this ships it
 * must not email a club everything that was recorded since September.
 *
 * **Nothing at all while email is console.** Nothing could leave, and spending
 * attempts would leave real mail unsendable once a key is set.
 *
 * **Invitations are not here.** The join link is stored as a hash, so a retry
 * could not rebuild the email; *Novo link* re-sends one in a click.
 *
 * One instance at a time, by `pg_try_advisory_xact_lock` on the platform
 * connection held for the pass — a second instance is a no-op, as the trial
 * clock's is.
 */

export const RETRY_WINDOW = '48 hours';
export const RETRY_MAX = 5;

/** The shared "due for another try" condition, for a table with these columns. */
const due = (raised: string, attempts = 'delivery_attempts', last = 'last_attempt_at'): string => `
  ${raised} > now() - interval '${RETRY_WINDOW}'
  AND ${raised} < now() - interval '10 minutes'
  AND ${attempts} < ${RETRY_MAX}
  AND (${last} IS NULL OR ${last} < now() - interval '50 minutes')`;

interface TenantKind {
  key: string;
  /** Ids of rows due another try, inside the tenant's own policy. */
  pending: string;
  /** Count the attempt before sending, so a crash mid-send still counts it. */
  bump: string;
  deliver: (organizationId: string, id: string, send: Send) => Promise<boolean>;
}

const TENANT_KINDS: TenantKind[] = [
  {
    key: 'water',
    // Not for a reading archived since (sweep 19-10b): it no longer happened.
    pending: `SELECT a.id FROM pool_analysis_alert a
               JOIN pool_analysis pa ON pa.id = a.analysis_id AND pa.organization_id = a.organization_id
              WHERE a.delivered_at IS NULL AND pa.archived_at IS NULL AND ${due('a.raised_at', 'a.delivery_attempts', 'a.last_attempt_at')}`,
    bump: `UPDATE pool_analysis_alert SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now() WHERE id = $1`,
    deliver: deliverWaterAlert,
  },
  {
    key: 'lab',
    pending: `SELECT a.id FROM lab_result_alert a
               JOIN lab_result lr ON lr.id = a.lab_result_id AND lr.organization_id = a.organization_id
              WHERE a.delivered_at IS NULL AND lr.archived_at IS NULL AND ${due('a.raised_at', 'a.delivery_attempts', 'a.last_attempt_at')}`,
    bump: `UPDATE lab_result_alert SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now() WHERE id = $1`,
    deliver: deliverLabAlert,
  },
  {
    key: 'qualification',
    pending: `SELECT id FROM qualification_alert
               WHERE delivered_at IS NULL AND cardinality(recipients) > 0 AND ${due('raised_at')}`,
    bump: `UPDATE qualification_alert SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now() WHERE id = $1`,
    deliver: redeliverQualificationAlert,
  },
  {
    // Per message: `deliverMessage` sends to every recipient of it still unsent.
    key: 'message',
    pending: `SELECT DISTINCT message_id AS id FROM message_recipient
               WHERE delivered_at IS NULL AND email IS NOT NULL AND ${due('created_at')}`,
    bump: `UPDATE message_recipient SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now()
            WHERE message_id = $1 AND delivered_at IS NULL AND email IS NOT NULL`,
    deliver: async (organizationId, messageId, send) => (await deliverMessage(organizationId, messageId, send)) > 0,
  },
  {
    // POOLSE-86 3.0b: one invoice reminder, as snapshotted when it was sent.
    key: 'invoice_reminder',
    pending: `SELECT id FROM invoice_reminder WHERE delivered_at IS NULL AND ${due('created_at')}`,
    bump: `UPDATE invoice_reminder SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now() WHERE id = $1`,
    deliver: deliverInvoiceReminder,
  },
];

interface PlatformKind {
  key: string;
  /** `$1` is a tenant to narrow to, or null for all of them. */
  pending: string;
  bump: string;
  deliver: (id: string, send: Send) => Promise<boolean>;
  /** False when there is nobody this kind could be sent to at all. */
  enabled?: () => boolean;
}

const PLATFORM_KINDS: PlatformKind[] = [
  {
    key: 'trial_notice',
    pending: `SELECT id FROM trial_notice
               WHERE delivered_at IS NULL AND cardinality(recipients) > 0
                 AND ($1::uuid IS NULL OR organization_id = $1) AND ${due('created_at')}`,
    bump: `UPDATE trial_notice SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now() WHERE id = $1`,
    deliver: deliverTrialNotice,
  },
  {
    key: 'support_notice',
    pending: `SELECT id FROM support_grant
               WHERE source = 'override' AND notice_delivered_at IS NULL
                 AND cardinality(notice_recipients) > 0
                 AND ($1::uuid IS NULL OR organization_id = $1)
                 AND ${due('starts_at', 'notice_delivery_attempts', 'notice_last_attempt_at')}`,
    bump: `UPDATE support_grant
              SET notice_delivery_attempts = notice_delivery_attempts + 1, notice_last_attempt_at = now()
            WHERE id = $1 AND source = 'override'`,
    deliver: deliverSupportNotice,
  },
  {
    key: 'platform_alert',
    pending: `SELECT id FROM platform_alert
               WHERE delivered_at IS NULL
                 AND coalesce(detail ->> 'delivery', '') <> 'suppressed_repeat'
                 AND ($1::uuid IS NULL OR organization_id = $1)
                 AND ${due('raised_at')}`,
    bump: `UPDATE platform_alert SET delivery_attempts = delivery_attempts + 1, last_attempt_at = now() WHERE id = $1`,
    deliver: (id, send) => redeliverAlert(id, send),
    enabled: () => alertRecipients().length > 0,
  },
];

export interface RetryResult {
  locked: boolean;
  /** False when email is console and nothing was attempted. */
  configured: boolean;
  attempted: number;
  delivered: number;
}

@Injectable()
export class DeliveryRetryService {
  private readonly log = new Logger(DeliveryRetryService.name);
  private static readonly LOCK_KEY = 86_2026_10_19;

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    try {
      const result = await this.run();
      if (result.attempted > 0) {
        this.log.log(`Delivery retry: ${result.delivered} of ${result.attempted} sent`);
      }
    } catch (error) {
      // Swallowed like every cron here: an unhandled rejection takes the API down.
      this.log.error('The delivery retry failed this hour', error as Error);
    }
  }

  /**
   * One pass. `organizationId` narrows every kind to one tenant, which is what
   * lets an integration test run it without reaching into another test's
   * scratch tenant — the trial clock's reason, the same seam. `send` stands in
   * for the provider in a test, and only there is the console check skipped.
   */
  async run(options: { organizationId?: string; send?: Send } = {}): Promise<RetryResult> {
    const { organizationId } = options;
    const send = options.send ?? sendEmail;
    if (options.send === undefined && !emailIsConfigured()) {
      return { locked: false, configured: false, attempted: 0, delivered: 0 };
    }

    return withPlatform(async (platform) => {
      // The whole estate takes one lock; a pass narrowed to one club takes its
      // own, so a test of one club never waits on — or blocks — another.
      const { rows: lock } = await platform.query<{ taken: boolean }>(
        organizationId === undefined
          ? 'SELECT pg_try_advisory_xact_lock($1) AS taken'
          : `SELECT pg_try_advisory_xact_lock(hashtextextended('delivery_retry:' || $1, 0)) AS taken`,
        [organizationId ?? DeliveryRetryService.LOCK_KEY],
      );
      if (lock[0]?.taken !== true) return { locked: false, configured: true, attempted: 0, delivered: 0 };

      let attempted = 0;
      let delivered = 0;
      const attempt = async (bump: () => Promise<unknown>, send: () => Promise<boolean>): Promise<void> => {
        attempted += 1;
        await bump();
        if (await send()) delivered += 1;
      };

      const tenants =
        organizationId !== undefined
          ? [organizationId]
          : (
              await platform.query<{ id: string }>(
                'SELECT id FROM organization WHERE archived_at IS NULL ORDER BY id',
              )
            ).rows.map((row) => row.id);

      for (const tenant of tenants) {
        for (const kind of TENANT_KINDS) {
          try {
            const ids = await withOrg(tenant, async (tx) => (await tx.query<{ id: string }>(kind.pending)).rows);
            for (const { id } of ids) {
              await attempt(
                () => withOrg(tenant, (tx) => tx.query(kind.bump, [id])),
                () => kind.deliver(tenant, id, send),
              );
            }
          } catch (error) {
            // One club's failure is not every club's.
            this.log.warn(`Retry of ${kind.key} failed for ${tenant}: ${String(error)}`);
          }
        }
      }

      for (const kind of PLATFORM_KINDS) {
        if (kind.enabled !== undefined && !kind.enabled()) continue;
        try {
          const ids = await withPlatform(
            async (tx) => (await tx.query<{ id: string }>(kind.pending, [organizationId ?? null])).rows,
          );
          for (const { id } of ids) {
            await attempt(
              () => withPlatform((tx) => tx.query(kind.bump, [id])),
              () => kind.deliver(id, send),
            );
          }
        } catch (error) {
          this.log.warn(`Retry of ${kind.key} failed: ${String(error)}`);
        }
      }

      return { locked: true, configured: true, attempted, delivered };
    });
  }
}
