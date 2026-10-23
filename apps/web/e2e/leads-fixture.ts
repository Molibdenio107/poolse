import { Client } from 'pg';
import { E2E_INSTRUCTOR_EMAIL } from './session';

/**
 * Pedidos' turma picker — POOLSE-110.
 *
 * A request for *Iniciação* in the E2E user's club, and two Iniciação turmas
 * beside the club's eighteen others: *E2E · Golfinhos*, with two weekly slots,
 * the E2E instructor and three of twelve places taken, and *E2E · Cheia*, one
 * place and one swimmer in it. Found again by name, so a run reuses them; the
 * request is put back to `new` each run, since a test that answered it would
 * otherwise take it off the list. Development database only, owner login.
 */

export const REQUEST_SWIMMER = { first: 'Pedido', last: 'Seletor' };
export const LEVEL = 'Iniciação';
export const OPEN_TURMA = 'E2E · Golfinhos';
export const FULL_TURMA = 'E2E · Cheia';

export async function leadsFixture(email: string): Promise<{ leadId: string }> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set — run with --env-file=../../.env');
  const db = new Client({ connectionString: url });
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

    const place = (
      await db.query<{ season_id: string; facility_id: string; pool_id: string }>(
        `SELECT s.id AS season_id, f.id AS facility_id, p.id AS pool_id
           FROM season s
           JOIN facility f ON f.organization_id = s.organization_id AND f.archived_at IS NULL
           JOIN pool p ON p.organization_id = f.organization_id AND p.facility_id = f.id AND p.archived_at IS NULL
          WHERE s.organization_id = $1 AND s.status = 'published'
          ORDER BY p.created_at LIMIT 1`,
        [org],
      )
    ).rows[0]!;

    const instructor =
      E2E_INSTRUCTOR_EMAIL === undefined
        ? null
        : ((
            await db.query<{ id: string }>(
              `SELECT m.id FROM app_user u JOIN membership m ON m.app_user_id = u.id AND m.archived_at IS NULL
                WHERE u.cached_email = $1 AND m.organization_id = $2 LIMIT 1`,
              [E2E_INSTRUCTOR_EMAIL, org],
            )
          ).rows[0]?.id ?? null);

    let levelId = (
      await db.query<{ id: string }>(
        `SELECT id FROM student_level WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, LEVEL],
      )
    ).rows[0]?.id;
    if (levelId === undefined) {
      levelId = (
        await db.query<{ id: string }>(
          `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, $2, 0) RETURNING id`,
          [org, LEVEL],
        )
      ).rows[0]!.id;
    }

    async function turma(name: string, capacity: number, swimmers: number, slots: [number, string][]): Promise<void> {
      let groupId = (
        await db.query<{ id: string }>(
          `SELECT id FROM class_group WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
          [org, name],
        )
      ).rows[0]?.id;
      if (groupId !== undefined) return;
      groupId = (
        await db.query<{ id: string }>(
          `INSERT INTO class_group (organization_id, season_id, facility_id, pool_id, name, level_id, capacity, instructor_membership_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [org, place.season_id, place.facility_id, place.pool_id, name, levelId, capacity, instructor],
        )
      ).rows[0]!.id;
      for (const [weekday, start] of slots) {
        await db.query(
          // A turma's slot takes its season from the turma (class_schedule_season_source).
          `INSERT INTO class_schedule (organization_id, facility_id, class_group_id, weekday, start_time, duration_minutes)
           VALUES ($1, $2, $3, $4, $5::time, 45)`,
          [org, place.facility_id, groupId, weekday, start],
        );
      }
      for (let n = 1; n <= swimmers; n += 1) {
        const student = (
          await db.query<{ id: string }>(
            `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Seletor') RETURNING id`,
            [org, `Lugar${n}`],
          )
        ).rows[0]!.id;
        await db.query(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
          [org, groupId, student],
        );
      }
    }

    await turma(OPEN_TURMA, 12, 3, [
      [1, '18:00'],
      [3, '18:00'],
    ]);
    await turma(FULL_TURMA, 1, 1, [[5, '17:00']]);

    // Golfinhos' next three Mondays at 18:00, Lisbon — what *Aula experimental*
    // offers once the turma is picked. Added only when missing.
    const golfinhos = (
      await db.query<{ id: string }>(
        `SELECT id FROM class_group WHERE organization_id = $1 AND name = $2 AND archived_at IS NULL`,
        [org, OPEN_TURMA],
      )
    ).rows[0]!.id;
    await db.query(
      `INSERT INTO class_session
         (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
       SELECT $1, $2, $3, $4, d, (d + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45
         FROM (SELECT ((now() AT TIME ZONE 'Europe/Lisbon')::date
                       + ((8 - extract(isodow FROM now() AT TIME ZONE 'Europe/Lisbon')::int) % 7 + 7 * w)::int) AS d
                 FROM generate_series(0, 2) AS w) mondays
        WHERE NOT EXISTS (SELECT 1 FROM class_session s WHERE s.class_group_id = $2 AND s.occurs_on = mondays.d)`,
      [org, golfinhos, place.pool_id, instructor],
    );

    let leadId = (
      await db.query<{ id: string }>(
        `SELECT id FROM lead WHERE organization_id = $1 AND swimmer_first_name = $2 AND swimmer_last_name = $3`,
        [org, REQUEST_SWIMMER.first, REQUEST_SWIMMER.last],
      )
    ).rows[0]?.id;
    if (leadId === undefined) {
      leadId = (
        await db.query<{ id: string }>(
          `INSERT INTO lead (organization_id, facility_id, level_id, swimmer_first_name, swimmer_last_name,
                             swimmer_birth_date, email, consent_text_version, consented_at)
           VALUES ($1, $2, $3, $4, $5, DATE '2018-05-01', 'pedido.seletor@example.test', 'e2e', now())
           RETURNING id`,
          [org, place.facility_id, levelId, REQUEST_SWIMMER.first, REQUEST_SWIMMER.last],
        )
      ).rows[0]!.id;
    } else {
      await db.query(
        `UPDATE lead SET status = 'new', student_id = NULL, trial_session_id = NULL, decided_at = NULL,
                         decided_by_membership_id = NULL, archived_at = NULL, level_id = $2
          WHERE id = $1`,
        [leadId, levelId],
      );
    }
    await db.query('COMMIT');
    return { leadId };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}
