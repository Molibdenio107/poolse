import { Logger } from '@nestjs/common';
import { withOrg } from '@poolse/db';
import { levelChangeEmail } from '../notifications/level-change-email.js';
import { sendEmail, type Email } from '../notifications/notifier.js';

const logger = new Logger('LevelChangeNotice');

/**
 * Tell a child's family their level changed — POOLSE-112 BA 4. The
 * `deliverPaymentChangeNotice` shape: rendered from its row, called by the
 * request after the commit and by the hourly retry, delivered once every
 * recipient took it. Never throws.
 */
export async function deliverLevelChangeNotice(
  organizationId: string,
  noticeId: string,
  send: (email: Email) => Promise<boolean> = sendEmail,
): Promise<boolean> {
  try {
    const notice = await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{
        recipients: string[];
        delivered: boolean;
        student_name: string;
        from_level: string;
        to_level: string;
        reason: 'skills' | 'age';
        name: string;
        locale: string;
      }>(
        `SELECT n.recipients::text[] AS recipients, n.delivered_at IS NOT NULL AS delivered,
                btrim(s.first_name || ' ' || s.last_name) AS student_name,
                n.from_level_name AS from_level, n.to_level_name AS to_level,
                n.reason::text AS reason,
                o.name, o.locale
           FROM level_change_notice n
           JOIN student s ON s.id = n.student_id AND s.organization_id = n.organization_id
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
        levelChangeEmail({
          to,
          organizationName: notice.name,
          studentName: notice.student_name,
          fromLevel: notice.from_level,
          toLevel: notice.to_level,
          reason: notice.reason,
          locale: notice.locale,
        }),
      );
      all &&= sent;
    }
    if (all) {
      await withOrg(organizationId, (tx) =>
        tx.query('UPDATE level_change_notice SET delivered_at = now() WHERE id = $1', [noticeId]),
      );
    }
    return all;
  } catch (error) {
    logger.warn(`Could not send level change notice ${noticeId}: ${String(error)}`);
    return false;
  }
}
