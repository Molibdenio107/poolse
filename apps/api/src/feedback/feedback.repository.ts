import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { cascadeAt, restorableKind } from '../archive/restorable.js';
import { displayName, personShortName, shortName } from '../people/names.js';
import { TOTAL_COUNT, windowed, type PageQuery, type Paginated } from '../common/pagination.js';

/**
 * A student's feedback after a lesson — POOLSE-116.
 *
 * **The database decides whether a feedback may exist**: the trigger on
 * `lesson_feedback` refuses a cancelled lesson, one not yet ended, a student
 * not marked present and a closed window, each with its code in DETAIL. This
 * file reads the same facts to say *why* before anybody types — the state a
 * family's lesson page shows — and turns a refusal into a code the controller
 * answers as a 409. The window is `lesson_feedback_window()`, read from SQL.
 *
 * **Who answers** is the family's own child (the controller's
 * `familyStudents`), and of those whoever `family_may_answer()` admits: a live
 * guardian, or the student's own login from 12 or on the adult path — POOLSE-90's
 * Decided 2, one SQL definition for this and *Vou / Não vou*.
 *
 * **Who reads** — owner and admin everything; an instructor the lessons they
 * taught, by `resolved_instructor_id`, so the stand-in reads the night they
 * covered and the regular instructor does not. Decided per row here.
 */

export type AuthoredBy = 'student' | 'guardian';

export interface LessonFeedback {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  /** 1 (muito mal) to 5 (muito bem). */
  mood: number;
  comment: string | null;
  /** Derived from the author's relation to the student; null once anonymised. */
  authoredBy: AuthoredBy | null;
  authorName: string | null;
  /** The lesson: its day on the site's clock, and its turma. */
  lessonDate: string;
  className: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where a family's feedback on one lesson stands. `open` takes the form;
 * `closed` shows the answer read-only; the rest say in words why there is none.
 */
export type FeedbackState =
  | 'open'
  | 'closed'
  | 'cancelled'
  | 'notEnded'
  | 'notMarked'
  | 'absent'
  | 'excused';

export interface FamilyFeedback {
  studentId: string;
  /** The child's short name — the page names them when siblings share a lesson. */
  studentName: string;
  state: FeedbackState;
  /** The last day it may be written or changed — the lesson's day plus the window. */
  closesOn: string;
  /** This reader may answer for this child (rule 2). */
  mayAnswer: boolean;
  feedback: LessonFeedback | null;
}

/** A trigger refusal, named: the controller answers it as a 409. */
export class FeedbackRefusedError extends Error {
  constructor(
    readonly code: 'feedback_cancelled' | 'feedback_too_early' | 'feedback_not_present' | 'feedback_window_closed',
    readonly value: string | null,
  ) {
    super(code);
  }
}

const TZ = `coalesce(f.timezone, 'Europe/Lisbon')`;

/**
 * Whether the reader (`membership`, a SQL expression) answers for the student
 * aliased `student`: `family_may_answer()`, the one definition, shared with
 * POOLSE-90's *Vou / Não vou*. Read by the lesson page and by *Últimas aulas*,
 * so the list never offers what the page will not take.
 */
export const mayAnswer = (student: string, membership: string): string =>
  `family_may_answer(${student}.organization_id, ${student}.id, ${membership})`;

/** The columns of a `LessonFeedback`, over `lesson_feedback fb` joined as `FROM_FEEDBACK` joins it. */
const FEEDBACK_COLUMNS = `
  fb.id, fb.class_session_id AS "sessionId", fb.student_id AS "studentId",
  ${displayName('s')} AS "studentName",
  fb.mood, fb.comment,
  CASE
    WHEN fb.author_membership_id IS NULL THEN NULL
    WHEN fb.author_membership_id = s.membership_id THEN 'student'
    WHEN EXISTS (SELECT 1 FROM guardian_link gl
                  WHERE gl.organization_id = fb.organization_id
                    AND gl.student_id = fb.student_id
                    AND gl.guardian_membership_id = fb.author_membership_id) THEN 'guardian'
    ELSE NULL
  END AS "authoredBy",
  CASE WHEN fb.author_membership_id IS NULL THEN NULL
       ELSE ${personShortName('fb.author_membership_id')} END AS "authorName",
  to_char(cs.starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS "lessonDate",
  cg.name AS "className",
  to_char(fb.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
  to_char(fb.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"`;

const FROM_FEEDBACK = `
  FROM lesson_feedback fb
  JOIN student s ON s.id = fb.student_id AND s.organization_id = fb.organization_id
  JOIN class_session cs ON cs.id = fb.class_session_id AND cs.organization_id = fb.organization_id
  LEFT JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
  LEFT JOIN pool p ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
  LEFT JOIN facility f ON f.id = coalesce(p.facility_id, cg.facility_id) AND f.organization_id = cs.organization_id`;

/**
 * Each of `studentIds`' standing on one lesson, for the family's lesson page.
 * A child not enrolled in it that day is simply absent from the answer — the
 * controller has already decided whose children these are.
 */
export async function familyFeedback(
  organizationId: string,
  membershipId: string,
  sessionId: string,
  studentIds: string[],
): Promise<FamilyFeedback[]> {
  if (studentIds.length === 0) return [];
  return withOrg(organizationId, (tx) => familyFeedbackIn(tx, membershipId, sessionId, studentIds));
}

async function familyFeedbackIn(
  tx: Tx,
  membershipId: string,
  sessionId: string,
  studentIds: string[],
): Promise<FamilyFeedback[]> {
  const { rows } = await tx.query<{
    student_id: string;
    student_name: string;
    status: string;
    ended: boolean;
    mark: string | null;
    closes_on: string;
    open: boolean;
    may_answer: boolean;
    feedback_id: string | null;
  }>(
    `SELECT s.id AS student_id, ${shortName('s')} AS student_name, cs.status::text AS status, cs.ends_at <= now() AS ended,
            a.status::text AS mark,
            to_char(lesson_feedback_closes_on(cs.organization_id, cs.pool_id, cs.starts_at), 'YYYY-MM-DD') AS closes_on,
            club_today() <= lesson_feedback_closes_on(cs.organization_id, cs.pool_id, cs.starts_at) AS open,
            ${mayAnswer('s', '$1')} AS may_answer,
            fb.id AS feedback_id
       FROM unnest($3::uuid[]) AS chosen(id)
       JOIN student s ON s.id = chosen.id AND s.archived_at IS NULL
       JOIN class_session cs ON cs.id = $2 AND cs.organization_id = s.organization_id
       LEFT JOIN attendance a
              ON a.organization_id = cs.organization_id AND a.class_session_id = cs.id AND a.student_id = s.id
       LEFT JOIN lesson_feedback fb
              ON fb.organization_id = cs.organization_id AND fb.class_session_id = cs.id
             AND fb.student_id = s.id AND fb.archived_at IS NULL
       -- EXISTS, not a join: an enrolment ended and restarted on the lesson's
       -- day is two rows, and the child would get two panels (sweep 27-10).
       WHERE EXISTS (
              SELECT 1 FROM enrollment e
               WHERE e.organization_id = s.organization_id AND e.student_id = s.id
                 AND e.class_group_id = cs.class_group_id AND e.status <> 'waiting'
                 AND e.joined_on <= cs.occurs_on AND (e.ended_on IS NULL OR e.ended_on >= cs.occurs_on))`,
    [membershipId, sessionId, studentIds],
  );

  const ids = rows.map((row) => row.feedback_id).filter((id): id is string => id !== null);
  const found = new Map((await feedbackByIds(tx, ids)).map((one) => [one.id, one]));

  return rows.map((row) => ({
    studentId: row.student_id,
    studentName: row.student_name,
    state: stateOf(row),
    closesOn: row.closes_on,
    mayAnswer: row.may_answer,
    feedback: row.feedback_id === null ? null : (found.get(row.feedback_id) ?? null),
  }));
}

function stateOf(row: { status: string; ended: boolean; mark: string | null; open: boolean }): FeedbackState {
  if (row.status === 'cancelled') return 'cancelled';
  if (!row.ended) return 'notEnded';
  if (row.mark === null) return 'notMarked';
  if (row.mark === 'absent') return 'absent';
  if (row.mark === 'excused') return 'excused';
  return row.open ? 'open' : 'closed';
}

async function feedbackByIds(tx: Tx, ids: string[]): Promise<LessonFeedback[]> {
  if (ids.length === 0) return [];
  const { rows } = await tx.query<LessonFeedback>(
    `SELECT ${FEEDBACK_COLUMNS} ${FROM_FEEDBACK} WHERE fb.id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/**
 * Writes one child's feedback on one lesson, or rewrites it inside the window.
 * The caller has checked the child is the reader's and `mayAnswer`; the
 * trigger checks the lesson. Answers the saved row.
 */
export async function saveFeedback(
  organizationId: string,
  membershipId: string,
  sessionId: string,
  studentId: string,
  input: { mood: number; comment: string | null },
): Promise<LessonFeedback> {
  return withOrg(organizationId, async (tx) => {
    await tx.query('SAVEPOINT feedback_write');
    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, comment, author_membership_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, class_session_id, student_id) WHERE archived_at IS NULL
         DO UPDATE SET mood = excluded.mood, comment = excluded.comment,
                       author_membership_id = excluded.author_membership_id
         RETURNING id`,
        [organizationId, sessionId, studentId, input.mood, input.comment, membershipId],
      );
      id = rows[0]!.id;
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT feedback_write');
      throw refusalOf(error);
    }
    const [saved] = await feedbackByIds(tx, [id]);
    return saved!;
  });
}

function refusalOf(error: unknown): unknown {
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'string') return error;
  const [code, value] = detail.split('|');
  switch (code) {
    case 'feedback_cancelled':
    case 'feedback_too_early':
    case 'feedback_not_present':
    case 'feedback_window_closed':
      return new FeedbackRefusedError(code, value ?? null);
    default:
      return error;
  }
}

/**
 * One lesson's feedback for its register. `instructorMembershipId` set means
 * the reader is an instructor, who reads it only for a lesson they taught —
 * the stand-in's night is the stand-in's.
 */
export async function sessionFeedback(
  organizationId: string,
  sessionId: string,
  instructorMembershipId: string | null,
): Promise<LessonFeedback[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<LessonFeedback>(
      `SELECT ${FEEDBACK_COLUMNS} ${FROM_FEEDBACK}
        WHERE fb.class_session_id = $1 AND fb.archived_at IS NULL
          AND ($2::uuid IS NULL OR cs.resolved_instructor_id = $2::uuid)
        ORDER BY ${displayName('s')}, fb.id`,
      [sessionId, instructorMembershipId],
    );
    return rows;
  });
}

/** One student's feedback, newest lesson first — the record's list, under the same rule. */
export async function studentFeedback(
  organizationId: string,
  studentId: string,
  instructorMembershipId: string | null,
  page: PageQuery,
): Promise<Paginated<LessonFeedback>> {
  return withOrg(organizationId, (tx) =>
    windowed(
      page,
      (limit, offset) =>
        tx.query<LessonFeedback & { total_count: number }>(
          `SELECT ${TOTAL_COUNT}, ${FEEDBACK_COLUMNS} ${FROM_FEEDBACK}
            WHERE fb.student_id = $1 AND fb.archived_at IS NULL
              AND ($2::uuid IS NULL OR cs.resolved_instructor_id = $2::uuid)
            ORDER BY cs.starts_at DESC, fb.id
            LIMIT $3 OFFSET $4`,
          [studentId, instructorMembershipId, limit, offset],
        ),
      ({ total_count: _total, ...row }) => row,
    ),
  );
}

/** Archived by the office — POOLSE-78's path, so the bin brings it back. */
export async function archiveFeedback(
  organizationId: string,
  feedbackId: string,
): Promise<{ archiveEntryId: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      `UPDATE lesson_feedback SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL RETURNING student_id`,
      [feedbackId],
    );
    if (!rows[0]) return null;
    const entryId = await recordAudit(tx, {
      action: 'lesson_feedback.archived',
      entityType: 'lesson_feedback',
      entityId: feedbackId,
      data: {
        studentId: rows[0].student_id,
        cascade: await cascadeAt(tx, restorableKind('lesson_feedback'), feedbackId),
      },
    });
    return { archiveEntryId: entryId };
  });
}

/** A live student of this club — else the staff list is a 404, never an empty page about nobody. */
export async function studentIsLive(organizationId: string, studentId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ live: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL) AS live`,
      [studentId],
    );
    return rows[0]?.live ?? false;
  });
}
