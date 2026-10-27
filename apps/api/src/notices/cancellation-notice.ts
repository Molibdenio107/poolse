import { withOrg, type Tx } from '@poolse/db';
import { NoRecipientsError, sendSessionNoticeIn } from '../messages/messages.repository.js';
import { deliverMessage } from '../messages/delivery.js';
import { pushTo } from '../push/push.js';

/**
 * A cancelled lesson tells its families — POOLSE-90 slice 4, Rui 27-10-2026:
 * always and automatically, exempt from the daily ceiling, in the club's
 * language.
 *
 * **A record first, then the channels.** The notice is a `message` (audience
 * `session`) written inside the cancelling transaction, so a cancel that rolls
 * back tells nobody and one that commits cannot forget to. After the commit the
 * email leaves through `deliverMessage` (retried like every email) and a push
 * goes once to the same people's phones — the recipients of the record, so the
 * two channels cannot disagree about who was told.
 *
 * **Undoing a cancel says so.** The toast's *Anular* puts the lesson back after
 * the email may already have left; a lesson that was announced as cancelled
 * gets a second notice that it is on after all, rather than a silence that
 * leaves the families believing the first.
 *
 * Only a turma's lesson has families: a parceria or free-swim block records
 * nothing, and a lesson nobody is reachable for records nothing either.
 */

export type NoticeKind = 'cancelled' | 'reinstated';

const COPY = {
  'pt-PT': {
    cancelled: {
      subject: (turma: string, date: string) => `Aula cancelada: ${turma}, ${date}`,
      body: (turma: string, date: string, time: string, reason: string | null) =>
        `A aula de ${turma} de ${date}, às ${time}, foi cancelada.` + (reason === null ? '' : `\n\nMotivo: ${reason}`),
      push: (turma: string, date: string, time: string) => `${turma}, ${date} às ${time}.`,
    },
    reinstated: {
      subject: (turma: string, date: string) => `A aula mantém-se: ${turma}, ${date}`,
      body: (turma: string, date: string, time: string) =>
        `Afinal, a aula de ${turma} de ${date}, às ${time}, mantém-se. Pedimos desculpa pelo aviso anterior.`,
      push: (turma: string, date: string, time: string) => `${turma}, ${date} às ${time}.`,
    },
  },
  en: {
    cancelled: {
      subject: (turma: string, date: string) => `Lesson cancelled: ${turma}, ${date}`,
      body: (turma: string, date: string, time: string, reason: string | null) =>
        `The ${turma} lesson on ${date} at ${time} has been cancelled.` +
        (reason === null ? '' : `\n\nReason: ${reason}`),
      push: (turma: string, date: string, time: string) => `${turma}, ${date} at ${time}.`,
    },
    reinstated: {
      subject: (turma: string, date: string) => `The lesson is on: ${turma}, ${date}`,
      body: (turma: string, date: string, time: string) =>
        `The ${turma} lesson on ${date} at ${time} is going ahead after all. Sorry for the earlier notice.`,
      push: (turma: string, date: string, time: string) => `${turma}, ${date} at ${time}.`,
    },
  },
} as const;

export interface RecordedNotice {
  messageId: string;
  sessionId: string;
  push: { title: string; body: string };
}

/**
 * Writes the notice inside `tx`. Null when there is nobody to tell: a lesson
 * with no turma, or a turma no family can be reached for.
 */
export async function recordNoticeIn(
  tx: Tx,
  organizationId: string,
  membershipId: string,
  sessionId: string,
  kind: NoticeKind,
  reason: string | null,
): Promise<RecordedNotice | null> {
  const { rows } = await tx.query<{
    class_group_id: string;
    turma: string;
    local_date: string;
    local_time: string;
    locale: string;
  }>(
    `SELECT cg.id AS class_group_id, cg.name AS turma,
            to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'), 'DD-MM-YYYY') AS local_date,
            to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'), 'HH24:MI')    AS local_time,
            o.locale
       FROM class_session cs
       JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
       JOIN organization o ON o.id = cs.organization_id
       LEFT JOIN pool p ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
       LEFT JOIN facility f
              ON f.id = coalesce(p.facility_id, cg.facility_id) AND f.organization_id = cs.organization_id
      WHERE cs.id = $1`,
    [sessionId],
  );
  const lesson = rows[0];
  if (lesson === undefined) return null;

  const copy = (lesson.locale === 'en' ? COPY.en : COPY['pt-PT'])[kind];
  const subject = copy.subject(lesson.turma, lesson.local_date);
  const body = copy.body(lesson.turma, lesson.local_date, lesson.local_time, reason);

  await tx.query('SAVEPOINT session_notice');
  try {
    const sent = await sendSessionNoticeIn(
      tx,
      organizationId,
      membershipId,
      sessionId,
      lesson.class_group_id,
      subject,
      body,
    );
    await tx.query('RELEASE SAVEPOINT session_notice');
    return {
      messageId: sent.id,
      sessionId,
      push: { title: subject, body: copy.push(lesson.turma, lesson.local_date, lesson.local_time) },
    };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT session_notice');
    if (error instanceof NoRecipientsError) return null;
    throw error;
  }
}

/** Whether this lesson's cancellation was announced — so putting it back is announced too. */
export async function wasAnnouncedIn(tx: Tx, sessionId: string): Promise<boolean> {
  const { rows } = await tx.query<{ announced: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM message WHERE class_session_id = $1 AND archived_at IS NULL) AS announced`,
    [sessionId],
  );
  return rows[0]?.announced ?? false;
}

/**
 * After the commit: the email (retried by `DeliveryRetryService` if it does not
 * leave) and one push to the same people. Never awaited by the request.
 */
export function deliverNotice(organizationId: string, notice: RecordedNotice): void {
  void deliverMessage(organizationId, notice.messageId);
  void pushNotice(organizationId, notice).catch(() => undefined);
}

async function pushNotice(organizationId: string, notice: RecordedNotice): Promise<number> {
  const people = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ membership_id: string }>(
      `SELECT DISTINCT coalesce(mr.guardian_membership_id, s.membership_id) AS membership_id
         FROM message_recipient mr
         LEFT JOIN student s ON s.id = mr.student_id AND s.organization_id = mr.organization_id
        WHERE mr.message_id = $1
          AND coalesce(mr.guardian_membership_id, s.membership_id) IS NOT NULL`,
      [notice.messageId],
    );
    return rows.map((row) => row.membership_id);
  });
  return pushTo(organizationId, people, {
    title: notice.push.title,
    body: notice.push.body,
    url: `/app/familia/aulas/${notice.sessionId}`,
  });
}
