import { Client } from 'pg';
import { E2E_INSTRUCTOR_EMAIL } from './session';

/**
 * The poolside spec's own class — POOLSE-88 slice 2.
 *
 * A turma of fifteen (the ticket's QA 5) taught by the E2E instructor in the
 * E2E user's club, and today's lesson of it. Made once and found again by name,
 * so a second run reuses it rather than piling up turmas; the reference seed's
 * classes are never marked, because a register written by a test would then
 * read as somebody's real attendance.
 *
 * Written through `DATABASE_URL`, the owner login, because there is no API for
 * "make me a class with fifteen people in it" and there should not be one.
 * Development database only: the spec skips without the instructor test user,
 * and that user exists on the dev Clerk instance alone.
 */

export const POOLSIDE_TURMA = 'E2E · Poolside';

/**
 * Fifteen distinct first names, because the register shows a short name — the
 * first word and the surname — and "Aluno 03 Poolside" fifteen times reads as
 * one child on a phone. `student(n)` in the spec finds row n by this list.
 */
export const POOLSIDE_NAMES = [
  'Ana', 'Bruno', 'Carla', 'Duarte', 'Eva', 'Filipe', 'Gonçalo', 'Helena',
  'Inês', 'João', 'Leonor', 'Miguel', 'Nuno', 'Olívia', 'Pedro',
] as const;
export const POOLSIDE_STUDENTS = POOLSIDE_NAMES.length;

/** Ana's mother's number, as typed — the card dials it without the spaces. */
export const POOLSIDE_GUARDIAN_PHONE = '912 345 678';

export interface PoolsideLesson {
  sessionId: string;
  studentIds: string[];
  /** The tank the lesson is in — the water reading's page. */
  poolId: string;
}

async function connect(): Promise<Client> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/**
 * Today's poolside lesson, with an empty register and `scheduled` — whatever
 * the previous run left behind. Clearing the marks is a DELETE of rows this
 * fixture owns and nothing else: the session is the spec's, never a club's.
 */
export async function poolsideLesson(): Promise<PoolsideLesson> {
  const db = await connect();
  try {
    await db.query('BEGIN');

    const instructor = await db.query<{ membership_id: string; organization_id: string }>(
      `SELECT m.id AS membership_id, m.organization_id
         FROM app_user u
         JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
         JOIN membership_role r ON r.membership_id = m.id AND r.role = 'instructor' AND r.archived_at IS NULL
        WHERE u.cached_email = $1
        LIMIT 1`,
      [E2E_INSTRUCTOR_EMAIL],
    );
    const who = instructor.rows[0];
    if (who === undefined) throw new Error(`No instructor membership for ${E2E_INSTRUCTOR_EMAIL}`);
    const org = who.organization_id;

    const place = await db.query<{ season_id: string; facility_id: string; pool_id: string }>(
      `SELECT s.id AS season_id, f.id AS facility_id, p.id AS pool_id
         FROM season s
         JOIN facility f ON f.organization_id = s.organization_id AND f.archived_at IS NULL
         JOIN pool p ON p.organization_id = f.organization_id AND p.facility_id = f.id AND p.archived_at IS NULL
        WHERE s.organization_id = $1 AND s.status = 'published'
        ORDER BY p.created_at
        LIMIT 1`,
      [org],
    );
    const at = place.rows[0];
    if (at === undefined) throw new Error('The E2E club has no published season, site and pool');

    let groupId = (
      await db.query<{ id: string }>(
        `SELECT id FROM class_group WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, POOLSIDE_TURMA],
      )
    ).rows[0]?.id;
    if (groupId === undefined) {
      groupId = (
        await db.query<{ id: string }>(
          `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [org, at.season_id, at.facility_id, POOLSIDE_TURMA, at.pool_id, who.membership_id],
        )
      ).rows[0]!.id;
    }

    const enrolled = await db.query<{ student_id: string }>(
      `SELECT student_id FROM enrollment
        WHERE organization_id = $1 AND class_group_id = $2 AND status = 'active'
        ORDER BY created_at`,
      [org, groupId],
    );
    const studentIds = enrolled.rows.map((row) => row.student_id);
    for (let n = studentIds.length + 1; n <= POOLSIDE_STUDENTS; n += 1) {
      const student = await db.query<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Poolside') RETURNING id`,
        [org, POOLSIDE_NAMES[n - 1]],
      );
      await db.query(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
        [org, groupId, student.rows[0]!.id],
      );
      studentIds.push(student.rows[0]!.id);
    }

    // Names follow the list whatever an earlier run called them.
    for (const [i, id] of studentIds.entries()) {
      await db.query(`UPDATE student SET first_name = $3 WHERE organization_id = $1 AND id = $2`, [
        org,
        id,
        POOLSIDE_NAMES[i],
      ]);
    }

    // Today in the club's own day, at 18:00 Lisbon — never `current_date`.
    let sessionId = (
      await db.query<{ id: string }>(
        `SELECT id FROM class_session
          WHERE organization_id = $1 AND class_group_id = $2
            AND occurs_on = (now() AT TIME ZONE 'Europe/Lisbon')::date`,
        [org, groupId],
      )
    ).rows[0]?.id;
    if (sessionId === undefined) {
      sessionId = (
        await db.query<{ id: string }>(
          `INSERT INTO class_session
             (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
           SELECT $1, $2, $3, $4, d, (d + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45
             FROM (SELECT (now() AT TIME ZONE 'Europe/Lisbon')::date AS d) today
           RETURNING id`,
          [org, groupId, at.pool_id, who.membership_id],
        )
      ).rows[0]!.id;
    }

    // Ana's mother, with a phone — the contact an instructor taps (QA 7).
    const ana = studentIds[0]!;
    const hasGuardian = await db.query(
      `SELECT 1 FROM guardian_link WHERE organization_id = $1 AND student_id = $2 AND archived_at IS NULL`,
      [org, ana],
    );
    if (hasGuardian.rowCount === 0) {
      const mother = await db.query<{ id: string }>(
        `INSERT INTO membership (organization_id, status, first_name, last_name, phone, email)
         VALUES ($1, 'active', 'Rita', 'Poolside', $2, 'rita.poolside@example.com') RETURNING id`,
        [org, POOLSIDE_GUARDIAN_PHONE],
      );
      await db.query(
        `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'guardian')`,
        [org, mother.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
         VALUES ($1, $2, $3, 'Mãe', true)`,
        [org, ana, mother.rows[0]!.id],
      );
    }

    // Ana's mensalidade, from the first of this month, monthly — the line flow 9 marks paid.
    const hasFee = await db.query(
      `SELECT 1 FROM student_fee WHERE organization_id = $1 AND student_id = $2 AND archived_at IS NULL`,
      [org, ana],
    );
    if (hasFee.rowCount === 0) {
      await db.query(
        `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, kind, starts_on)
         SELECT $1, $2, plan.id, period.id, plan.amount_cents, 'mensalidade',
                date_trunc('month', (now() AT TIME ZONE 'Europe/Lisbon'))::date
           FROM (SELECT id, amount_cents FROM fee_plan
                  WHERE organization_id = $1 AND kind = 'mensalidade' AND archived_at IS NULL
                  ORDER BY amount_cents LIMIT 1) plan,
                (SELECT id FROM fee_period
                  WHERE organization_id = $1 AND months = 1 AND archived_at IS NULL LIMIT 1) period`,
        [org, ana],
      );
    }

    await db.query(`DELETE FROM attendance WHERE organization_id = $1 AND class_session_id = $2`, [org, sessionId]);
    await db.query(
      `UPDATE class_session
          SET status = 'scheduled', cancellation_reason = NULL,
              instructor_membership_id = $3, substitute_instructor_membership_id = NULL
        WHERE organization_id = $1 AND id = $2`,
      [org, sessionId, who.membership_id],
    );

    await db.query('COMMIT');
    return { sessionId, studentIds, poolId: at.pool_id };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

/**
 * Cancel the lesson behind the screen's back — what the office does while an
 * instructor is mid-register, and the refusal QA 6 asks about.
 */
export async function cancelBehindTheScreen(sessionId: string): Promise<void> {
  const db = await connect();
  try {
    await db.query(
      `UPDATE class_session SET status = 'cancelled', cancellation_reason = 'E2E' WHERE id = $1`,
      [sessionId],
    );
  } finally {
    await db.end();
  }
}

/** The marks the database holds for the lesson, by student. */
export async function storedMarks(sessionId: string): Promise<Record<string, string>> {
  const db = await connect();
  try {
    const rows = await db.query<{ student_id: string; status: string }>(
      `SELECT student_id, status::text AS status FROM attendance WHERE class_session_id = $1`,
      [sessionId],
    );
    return Object.fromEntries(rows.rows.map((row) => [row.student_id, row.status]));
  } finally {
    await db.end();
  }
}
