import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { withOrg, withPlatform } from '@poolse/db';
import { asSystem } from '../tenant/tenant.context.js';
import { majorityEmail } from '../notifications/majority-email.js';
import { clubEmail, sendEmail, type Email } from '../notifications/notifier.js';

const logger = new Logger('MajorityNotice');

/**
 * Send one `majority_notice` — POOLSE-208. Rendered from its row, called after
 * the nightly commit and by the hourly retry; delivered once. Never throws.
 */
export async function deliverMajorityNotice(
  organizationId: string,
  noticeId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{
        email: string;
        kind: 'parent' | 'student';
        payer: boolean;
        locale: string;
        delivered: boolean;
        student_name: string;
        club: string;
      }>(
        `SELECT n.email::text AS email, n.kind::text AS kind, n.payer, n.locale,
                n.delivered_at IS NOT NULL AS delivered,
                btrim(s.first_name || ' ' || s.last_name) AS student_name, o.name AS club
           FROM majority_notice n
           JOIN student_person s ON s.id = n.student_id AND s.organization_id = n.organization_id
           JOIN organization o ON o.id = n.organization_id
          WHERE n.id = $1`,
        [noticeId],
      );
      return rows[0] ?? null;
    });
    if (notice === null || notice.delivered) return false;
    const sent = await send(
      clubEmail(
        organizationId,
        majorityEmail({
          to: notice.email,
          organizationName: notice.club,
          studentName: notice.student_name,
          kind: notice.kind,
          payer: notice.payer,
          locale: notice.locale,
        }),
      ),
    );
    if (sent) {
      await withOrg(organizationId, (tx) =>
        tx.query('UPDATE majority_notice SET delivered_at = now() WHERE id = $1', [noticeId]),
      );
    }
    return sent;
  } catch (error) {
    logger.warn(`Could not send majority notice ${noticeId}: ${String(error)}`);
    return false;
  }
}

/**
 * The nightly pass — POOLSE-208. Every club, as the system, writes the
 * notices due (`majority_notices_write`, idempotent by its unique index) and
 * sends the ones still unsent after the commit.
 */
@Injectable()
export class MajorityNoticeService {
  private readonly log = new Logger(MajorityNoticeService.name);

  @Cron('40 7 * * *', { timeZone: 'Europe/Lisbon' })
  async tick(): Promise<void> {
    try {
      const run = await this.run();
      if (run.written > 0) this.log.log(`Majority: ${run.written} notices across ${run.tenants} clubs`);
    } catch (error) {
      this.log.error('The majority pass failed today', error as Error);
    }
  }

  async run(
    organizationId?: string,
    send: (email: Email) => Promise<boolean> = sendEmail,
  ): Promise<{ tenants: number; written: number; sent: number }> {
    const tenants =
      organizationId !== undefined
        ? [organizationId]
        : await withPlatform(async (tx) => {
            const { rows } = await tx.query<{ id: string }>(
              `SELECT id FROM organization WHERE archived_at IS NULL ORDER BY id`,
            );
            return rows.map((row) => row.id);
          });

    let written = 0;
    let sent = 0;
    for (const tenant of tenants) {
      try {
        const ids = await asSystem(tenant, () =>
          withOrg(tenant, async (tx) => {
            const { rows } = await tx.query<{ n: number }>(`SELECT majority_notices_write($1) AS n`, [tenant]);
            written += rows[0]?.n ?? 0;
            const { rows: unsent } = await tx.query<{ id: string }>(
              `SELECT id FROM majority_notice WHERE delivered_at IS NULL AND delivery_attempts = 0`,
            );
            return unsent.map((row) => row.id);
          }),
        );
        for (const id of ids) {
          if (await deliverMajorityNotice(tenant, id, send)) sent += 1;
        }
      } catch (error) {
        this.log.error(`Majority pass failed for ${tenant}`, error as Error);
      }
    }
    return { tenants: tenants.length, written, sent };
  }
}
