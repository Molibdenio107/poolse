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

export type NoticeKind = 'cancelled' | 'reinstated' | 'moved';

/** Where a moved lesson was, on the site's clock — the "de … para …" of its notice. */
export interface LessonMoment {
  date: string;
  time: string;
}

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
    moved: {
      subject: (turma: string, date: string) => `Aula mudou: ${turma}, ${date}`,
      body: (turma: string, date: string, time: string, from: LessonMoment) =>
        `A aula de ${turma} de ${from.date}, às ${from.time}, passa para ${date}, às ${time}, só nesta semana.`,
      push: (turma: string, date: string, time: string) => `${turma}: passa para ${date} às ${time}.`,
    },
    standIn: {
      title: 'É o professor substituto',
      body: (turma: string, date: string, time: string) => `${turma}, ${date} às ${time}.`,
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
    moved: {
      subject: (turma: string, date: string) => `Lesson moved: ${turma}, ${date}`,
      body: (turma: string, date: string, time: string, from: LessonMoment) =>
        `The ${turma} lesson on ${from.date} at ${from.time} moves to ${date} at ${time}, this week only.`,
      push: (turma: string, date: string, time: string) => `${turma}: now ${date} at ${time}.`,
    },
    standIn: {
      title: 'You are the stand-in',
      body: (turma: string, date: string, time: string) => `${turma}, ${date} at ${time}.`,
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
  from: LessonMoment | null = null,
): Promise<RecordedNotice | null> {
  const lesson = await lessonIn(tx, sessionId);
  if (lesson === null) return null;

  const words = lesson.locale === 'en' ? COPY.en : COPY['pt-PT'];
  const subject = words[kind].subject(lesson.turma, lesson.local_date);
  const body =
    kind === 'moved'
      ? words.moved.body(lesson.turma, lesson.local_date, lesson.local_time, from ?? { date: '?', time: '?' })
      : kind === 'cancelled'
        ? words.cancelled.body(lesson.turma, lesson.local_date, lesson.local_time, reason)
        : words.reinstated.body(lesson.turma, lesson.local_date, lesson.local_time);
  const pushBody = words[kind].push(lesson.turma, lesson.local_date, lesson.local_time);

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
    return { messageId: sent.id, sessionId, push: { title: subject, body: pushBody } };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT session_notice');
    if (error instanceof NoRecipientsError) return null;
    throw error;
  }
}

/** A turma lesson's name, day and hour on its site's clock, and the club's language. Null for a parceria. */
async function lessonIn(
  tx: Tx,
  sessionId: string,
): Promise<{ class_group_id: string; turma: string; local_date: string; local_time: string; locale: string } | null> {
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
  return rows[0] ?? null;
}

/** Where a lesson is now, on its site's clock — read before a move, for its notice's "de". */
export async function lessonMoment(organizationId: string, sessionId: string): Promise<LessonMoment | null> {
  return withOrg(organizationId, async (tx) => {
    const lesson = await lessonIn(tx, sessionId);
    return lesson === null ? null : { date: lesson.local_date, time: lesson.local_time };
  });
}

/**
 * Whether a one-week move is worth telling families about (Rui, 27-10-2026): the
 * lesson was, or now is, within the club's next seven days. Further ahead is
 * planning, which the agenda already shows as *Mudou*.
 */
export async function moveIsNearIn(tx: Tx, sessionId: string, from: LessonMoment): Promise<boolean> {
  const { rows } = await tx.query<{ near: boolean }>(
    `SELECT (session_local_date(cs.organization_id, cs.pool_id, cs.starts_at) BETWEEN club_today() AND club_today() + 7)
         OR (to_date($2, 'DD-MM-YYYY') BETWEEN club_today() AND club_today() + 7) AS near
       FROM class_session cs WHERE cs.id = $1`,
    [sessionId, from.date],
  );
  return rows[0]?.near ?? false;
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
  return pushMessage(organizationId, notice.messageId, {
    title: notice.push.title,
    body: notice.push.body,
    url: `/app/familia/aulas/${notice.sessionId}`,
  });
}

/**
 * One push to the people a recorded message reached — its guardians, or the
 * student's own login — so the push and the email cannot disagree about who
 * was told. A closure's warning is pushed through this too (slice 4b).
 */
export async function pushMessage(
  organizationId: string,
  messageId: string,
  payload: { title: string; body: string; url: string },
): Promise<number> {
  const people = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ membership_id: string }>(
      `SELECT DISTINCT coalesce(mr.guardian_membership_id, s.membership_id) AS membership_id
         FROM message_recipient mr
         LEFT JOIN student s ON s.id = mr.student_id AND s.organization_id = mr.organization_id
        WHERE mr.message_id = $1
          AND coalesce(mr.guardian_membership_id, s.membership_id) IS NOT NULL`,
      [messageId],
    );
    return rows.map((row) => row.membership_id);
  });
  return pushTo(organizationId, people, payload);
}

/**
 * *You are the stand-in* — slice 4b, push only (Rui, 27-10-2026): the record is
 * the assignment on the session and its audit entry; the stand-in also sees it
 * on their home. Opens the lesson's page.
 */
export async function pushStandIn(organizationId: string, sessionId: string, standInMembershipId: string): Promise<number> {
  const lesson = await withOrg(organizationId, (tx) => lessonIn(tx, sessionId));
  if (lesson === null) return 0;
  const words = (lesson.locale === 'en' ? COPY.en : COPY['pt-PT']).standIn;
  return pushTo(organizationId, [standInMembershipId], {
    title: words.title,
    body: words.body(lesson.turma, lesson.local_date, lesson.local_time),
    url: `/dashboard/calendar/sessions/${sessionId}?from=${encodeURIComponent('/app/aulas')}`,
  });
}
