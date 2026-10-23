import { Client } from 'pg';

/**
 * Two pending proposals on the advancement queue — POOLSE-113.
 *
 * *Avança Fila* finished *E2E · Avanço 1* and has three candidates in
 * *E2E · Avanço 2*: one on her own Monday 17:00, one with her own instructor,
 * one merely with a seat — the three rank reasons. *Semvaga Fila* is going to
 * *E2E · Avanço 3*, which has no turma: ready, no seat.
 *
 * Everything sits in its own **draft** season, so no calendar, register or
 * timetable another spec reads ever draws it. Idempotent: what a previous run
 * made is reused, and a proposal is created only when none is pending.
 * Development database only, owner login.
 */

export const QUEUE_STUDENT = 'Avança Fila';
export const NO_SEAT_STUDENT = 'Semvaga Fila';
export const SAME_SLOT = 'E2E · Avanço Segunda';
export const SAME_INSTRUCTOR = 'E2E · Avanço Treinador';
export const AVAILABLE = 'E2E · Avanço Sexta';

export async function advancementFixture(email: string): Promise<void> {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query('BEGIN');
    const org = (
      await db.query<{ organization_id: string }>(
        `SELECT m.organization_id FROM app_user u
           JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
           JOIN membership_role r ON r.membership_id = m.id AND r.role = 'owner' AND r.archived_at IS NULL
          WHERE u.cached_email = $1 LIMIT 1`,
        [email],
      )
    ).rows[0]!.organization_id;
    const facility = (
      await db.query<{ id: string }>(
        `SELECT id FROM facility WHERE organization_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 1`,
        [org],
      )
    ).rows[0]!.id;

    const one = async (select: string, params: unknown[], insert: string, insertParams: unknown[]): Promise<string> =>
      (await db.query<{ id: string }>(select, params)).rows[0]?.id ??
      (await db.query<{ id: string }>(insert, insertParams)).rows[0]!.id;

    const season = await one(
      `SELECT id FROM season WHERE organization_id = $1 AND name = 'E2E · Avanço' AND archived_at IS NULL`,
      [org],
      `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
       VALUES ($1, 'E2E · Avanço', DATE '2026-09-01', DATE '2027-08-31', 'draft') RETURNING id`,
      [org],
    );
    const level = (name: string, order: number): Promise<string> =>
      one(
        `SELECT id FROM student_level WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, name],
        `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id`,
        [org, name, order],
      );
    const first = await level('E2E · Avanço 1', 901);
    const second = await level('E2E · Avanço 2', 902);
    const third = await level('E2E · Avanço 3', 903);

    const coach = await one(
      `SELECT id FROM membership WHERE organization_id = $1 AND first_name = 'Treinador' AND last_name = 'Avanço E2E'`,
      [org],
      `INSERT INTO membership (organization_id, status, first_name, last_name) VALUES ($1, 'active', 'Treinador', 'Avanço E2E') RETURNING id`,
      [org],
    );
    await db.query(
      `INSERT INTO membership_role (organization_id, membership_id, role)
       SELECT $1, $2, 'instructor'
        WHERE NOT EXISTS (SELECT 1 FROM membership_role WHERE membership_id = $2 AND role = 'instructor' AND archived_at IS NULL)`,
      [org, coach],
    );

    const turma = async (name: string, levelId: string, instructor: string | null, weekday: number, at: string) => {
      const id = await one(
        `SELECT id FROM class_group WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, name],
        `INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id, instructor_membership_id)
         VALUES ($1, $2, $3, $4, 8, $5, $6) RETURNING id`,
        [org, facility, season, name, levelId, instructor],
      );
      await db.query(
        `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
         SELECT $1, $2, $3, $4::time, 45
          WHERE NOT EXISTS (SELECT 1 FROM class_schedule WHERE class_group_id = $2 AND archived_at IS NULL)`,
        [org, id, weekday, at],
      );
      return id;
    };
    const current = await turma('E2E · Avanço Atual', first, coach, 1, '17:00');
    await turma(SAME_SLOT, second, null, 1, '17:00');
    await turma(SAME_INSTRUCTOR, second, coach, 3, '18:00');
    await turma(AVAILABLE, second, null, 5, '10:00');

    const student = async (first_name: string, levelId: string): Promise<string> => {
      const id = await one(
        `SELECT id FROM student WHERE organization_id = $1 AND first_name = $2 AND last_name = 'Fila' AND archived_at IS NULL`,
        [org, first_name],
        `INSERT INTO student (organization_id, first_name, last_name, level_id) VALUES ($1, $2, 'Fila', $3) RETURNING id`,
        [org, first_name, levelId],
      );
      await db.query(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
         SELECT $1, $2, $3, 'active'
          WHERE NOT EXISTS (SELECT 1 FROM enrollment WHERE student_id = $3 AND status = 'active')`,
        [org, current, id],
      );
      return id;
    };
    const proposal = async (studentId: string, from: string, to: string): Promise<void> => {
      await db.query(
        `INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id)
         SELECT $1, $2, $3, $4
          WHERE NOT EXISTS (SELECT 1 FROM transfer_proposal
                             WHERE student_id = $2 AND status = 'pending' AND archived_at IS NULL)`,
        [org, studentId, from, to],
      );
    };
    await proposal(await student('Avança', first), first, second);
    // Ready to move on, with nowhere to go: a level with no turma at all.
    await proposal(await student('Semvaga', second), second, third);

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
