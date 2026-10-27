import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { personShortName } from '../people/names.js';

/**
 * *Vou / Não vou* — POOLSE-90 slice 2. A family's notice to the club about one
 * lesson, **never attendance**: nothing here reads or writes a register mark.
 *
 * The database decides the rest. `session_notice_admissible` refuses a lesson
 * that has started, a cancelled one and one with no turma, each with its code in
 * DETAIL; `family_may_answer()` is who answers, the same rule lesson feedback
 * reads. This file decides only whose child and which lesson: a session of a
 * turma the child was enrolled in that day, the predicate `familyMayReadPlan`
 * and the agenda share.
 */

export interface SessionNotice {
  studentId: string;
  /** true *Vou*, false *Não vou*. */
  going: boolean;
  answeredAt: string;
  answeredByName: string | null;
}

/** Where a write stands before it is tried: the child's lesson, and whether this reader answers. */
export type NoticeTarget = 'notFound' | 'notYours' | 'ok';

/** A trigger refusal, named: the controller answers it as a 409. */
export class NoticeRefusedError extends Error {
  constructor(
    readonly code: 'notice_closed' | 'notice_not_offered',
    readonly value: string | null,
  ) {
    super(code);
  }
}

/** The child is in this lesson that day, and whether `membershipId` answers for them. */
export async function noticeTarget(
  organizationId: string,
  membershipId: string,
  sessionId: string,
  studentId: string,
): Promise<NoticeTarget> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ may_answer: boolean }>(
      `SELECT family_may_answer(s.organization_id, s.id, $3) AS may_answer
         FROM class_session cs
         JOIN student s ON s.id = $2 AND s.organization_id = cs.organization_id AND s.archived_at IS NULL
        WHERE cs.id = $1
          AND EXISTS (
                SELECT 1 FROM enrollment e
                 WHERE e.organization_id = cs.organization_id AND e.student_id = s.id
                   AND e.class_group_id = cs.class_group_id AND e.status <> 'waiting'
                   AND e.joined_on <= cs.occurs_on AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on))`,
      [sessionId, studentId, membershipId],
    );
    const row = rows[0];
    if (row === undefined) return 'notFound';
    return row.may_answer ? 'ok' : 'notYours';
  });
}

/**
 * Records the answer, or changes it, with an audit entry of what it was and is.
 * The last answer wins; who gave it and when travel with it.
 */
export async function saveNotice(
  organizationId: string,
  membershipId: string,
  sessionId: string,
  studentId: string,
  going: boolean,
): Promise<{ going: boolean }> {
  return withOrg(organizationId, async (tx) => {
    const { rows: before } = await tx.query<{ going: boolean }>(
      `SELECT going FROM session_notice WHERE class_session_id = $1 AND student_id = $2 FOR UPDATE`,
      [sessionId, studentId],
    );
    await tx.query('SAVEPOINT notice_write');
    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, class_session_id, student_id)
         DO UPDATE SET going = excluded.going,
                       answered_by_membership_id = excluded.answered_by_membership_id,
                       answered_at = now()
         RETURNING id`,
        [organizationId, sessionId, studentId, going, membershipId],
      );
      id = rows[0]!.id;
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT notice_write');
      throw refusalOf(error);
    }
    await recordAudit(tx, {
      action: 'session_notice.answered',
      entityType: 'session_notice',
      entityId: id,
      data: { sessionId, studentId, before: before[0]?.going ?? null, after: going },
    });
    return { going };
  });
}

function refusalOf(error: unknown): unknown {
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'string') return error;
  const [code, value] = detail.split('|');
  if (code === 'notice_closed' || code === 'notice_not_offered') return new NoticeRefusedError(code, value ?? null);
  return error;
}

/** Every answer on one lesson, for its register — staff only, decided by the caller. */
export async function sessionNotices(organizationId: string, sessionId: string): Promise<SessionNotice[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<SessionNotice>(
      `SELECT sn.student_id AS "studentId", sn.going,
              to_char(sn.answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "answeredAt",
              ${personShortName('sn.answered_by_membership_id')} AS "answeredByName"
         FROM session_notice sn
        WHERE sn.class_session_id = $1
        ORDER BY sn.answered_at`,
      [sessionId],
    );
    return rows;
  });
}
