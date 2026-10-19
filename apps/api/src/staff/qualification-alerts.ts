import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { withOrg, withPlatform } from '@poolse/db';
import { sendEmail, type Email } from '../notifications/notifier.js';
import { qualificationAlertEmail } from '../notifications/qualification-alert-email.js';

/**
 * Telling people a qualification is about to lapse, or has — POOLSE-27, 7b.2.
 *
 * **Records first, email after the commit** — the 4.2 water alert's division.
 * One `qualification_alert` row per (qualification, threshold), inserted with
 * `ON CONFLICT DO NOTHING` against a unique index: the insert that lands *is*
 * the crossing, so a second run the same day, a second instance, or a window
 * widened from 90 to 120 days notifies each person exactly once per threshold.
 * Only the current record per person and type is judged, so a renewal stops the
 * old one alerting without anybody deleting anything.
 *
 * **Recipients**: the person, and the club's owners and admins — resolved by
 * role at the time and written onto the row, because "who was told" is not
 * recoverable from the roles once somebody leaves.
 *
 * **Tenants come from `poolse_platform`, the work happens inside each tenant's
 * own policy** — the climate sweep's shape — under a per-tenant
 * `pg_try_advisory_xact_lock`, so two instances do not both write a tenant's
 * alerts at once.
 */

interface RaisedAlert {
  id: string;
  threshold: 'amber' | 'red';
  recipients: string[];
  personName: string;
  typeName: string;
  expiresOn: string;
}

interface TenantRun {
  organizationName: string;
  locale: string;
  raised: RaisedAlert[];
}

/** Write one tenant's new crossings. Null when another instance holds the lock. */
export async function raiseQualificationAlerts(organizationId: string): Promise<TenantRun | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: lock } = await tx.query<{ got: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('qualification_alerts:' || $1, 0)) AS got`,
      [organizationId],
    );
    if (!lock[0]?.got) return null;

    const { rows: org } = await tx.query<{ name: string; locale: string }>(
      'SELECT name, locale FROM organization WHERE id = $1',
      [organizationId],
    );

    const { rows } = await tx.query<{
      id: string;
      threshold: 'amber' | 'red';
      recipients: string[];
      person_name: string | null;
      type_name: string;
      expires_on: string;
    }>(
      `WITH managers AS (
         SELECT DISTINCT coalesce(u.cached_email::text, m.email::text) AS email
           FROM membership m
           JOIN membership_role r
             ON r.membership_id = m.id AND r.organization_id = m.organization_id
           LEFT JOIN app_user u ON u.id = m.app_user_id
          WHERE m.archived_at IS NULL AND m.status = 'active'
            AND r.archived_at IS NULL AND r.role IN ('owner', 'admin')
            AND btrim(coalesce(u.cached_email::text, m.email::text, '')) <> ''
       ),
       crossing AS (
         SELECT c.id, c.status::qualification_threshold AS threshold, c.membership_id,
                c.qualification_type_id, c.expires_on
           FROM qualification_current c
           JOIN membership m ON m.id = c.membership_id AND m.archived_at IS NULL
          WHERE c.status IN ('amber', 'red')
       ),
       inserted AS (
         INSERT INTO qualification_alert (organization_id, qualification_id, threshold, recipients)
         SELECT $1, x.id, x.threshold,
                ARRAY(
                  SELECT e FROM (
                    SELECT nullif(btrim(person_email(x.membership_id)::text), '') AS e
                    UNION
                    SELECT email FROM managers
                  ) addresses
                  WHERE e IS NOT NULL ORDER BY e)
           FROM crossing x
         ON CONFLICT (organization_id, qualification_id, threshold) DO NOTHING
         RETURNING id, qualification_id, threshold, recipients
       )
       SELECT i.id, i.threshold, i.recipients, person_name(x.membership_id) AS person_name,
              t.name AS type_name, to_char(x.expires_on, 'DD-MM-YYYY') AS expires_on
         FROM inserted i
         JOIN crossing x ON x.id = i.qualification_id
         JOIN qualification_type t ON t.id = x.qualification_type_id`,
      [organizationId],
    );

    return {
      organizationName: org[0]?.name ?? '',
      locale: org[0]?.locale ?? 'pt-PT',
      raised: rows.map((row) => ({
        id: row.id,
        threshold: row.threshold,
        recipients: row.recipients,
        personName: row.person_name ?? '',
        typeName: row.type_name,
        expiresOn: row.expires_on,
      })),
    };
  });
}

/** Send what one run raised. Never throws; stamps each alert that reached somebody. */
export async function deliverQualificationAlerts(
  organizationId: string,
  run: TenantRun,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<number> {
  let delivered = 0;
  for (const alert of run.raised) {
    let sent = false;
    for (const to of alert.recipients) {
      const ok = await send(
        qualificationAlertEmail({
          to,
          organizationName: run.organizationName,
          personName: alert.personName,
          typeName: alert.typeName,
          expiresOn: alert.expiresOn,
          threshold: alert.threshold,
          locale: run.locale,
        }),
      );
      sent = sent || ok;
    }
    if (sent) {
      delivered += 1;
      await withOrg(organizationId, async (tx) => {
        await tx.query('UPDATE qualification_alert SET delivered_at = now() WHERE id = $1', [
          alert.id,
        ]);
      });
    }
  }
  return delivered;
}

/**
 * Send one alert again, rebuilt from its row — POOLSE-86's hourly retry. The
 * recipients are the ones the row recorded when it was raised, and the email is
 * the one `deliverQualificationAlerts` would have sent. False when there is no
 * such undelivered alert.
 */
export async function redeliverQualificationAlert(
  organizationId: string,
  alertId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  const run = await withOrg(organizationId, async (tx): Promise<TenantRun | null> => {
    const { rows } = await tx.query<{
      threshold: 'amber' | 'red';
      recipients: string[];
      person_name: string | null;
      type_name: string;
      expires_on: string;
      org_name: string;
      locale: string;
    }>(
      `SELECT a.threshold, a.recipients, person_name(q.membership_id) AS person_name,
              t.name AS type_name, to_char(q.expires_on, 'DD-MM-YYYY') AS expires_on,
              o.name AS org_name, o.locale
         FROM qualification_alert a
         JOIN qualification q ON q.id = a.qualification_id AND q.organization_id = a.organization_id
         JOIN qualification_type t ON t.id = q.qualification_type_id
         JOIN organization o ON o.id = a.organization_id
        WHERE a.id = $1 AND a.delivered_at IS NULL`,
      [alertId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      organizationName: row.org_name,
      locale: row.locale,
      raised: [
        {
          id: alertId,
          threshold: row.threshold,
          recipients: row.recipients,
          personName: row.person_name ?? '',
          typeName: row.type_name,
          expiresOn: row.expires_on,
        },
      ],
    };
  });
  if (run === null) return false;
  return (await deliverQualificationAlerts(organizationId, run, send)) > 0;
}

@Injectable()
export class QualificationAlertService {
  private readonly log = new Logger(QualificationAlertService.name);

  /** 07:00 Lisbon-ish: before the office opens, after the night. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.log.error('The qualification sweep failed today', error as Error);
    }
  }

  async run(organizationId?: string): Promise<{ tenants: number; raised: number }> {
    const tenants =
      organizationId !== undefined
        ? [organizationId]
        : await withPlatform(async (tx) => {
            const { rows } = await tx.query<{ id: string }>(
              `SELECT id FROM organization
                WHERE archived_at IS NULL AND suspended_at IS NULL AND kind = 'business'
                ORDER BY id`,
            );
            return rows.map((row) => row.id);
          });

    let raised = 0;
    for (const tenant of tenants) {
      try {
        const run = await raiseQualificationAlerts(tenant);
        if (run === null) continue;
        raised += run.raised.length;
        await deliverQualificationAlerts(tenant, run);
      } catch (error) {
        // One club's failure is not every club's.
        this.log.warn(`Qualification sweep failed for ${tenant}: ${String(error)}`);
      }
    }
    return { tenants: tenants.length, raised };
  }
}
