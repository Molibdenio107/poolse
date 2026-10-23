import { Client } from 'pg';
import { poolsideLesson } from './poolside-fixture';

/**
 * A medical leave on two poolside children — POOLSE-109.
 *
 * Ana is the test guardian's child, Carla is not. Each gets one leave, ended
 * ten days ago so no register today offers *falta justificada* because of it,
 * and every earlier run's leave is archived first (never deleted). One person
 * to find by name for the emergency contact, with a phone. Development
 * database only, owner login.
 */

export const CONTACT_FIRST = 'Marisol';
export const CONTACT_LAST = 'Contacto E2E';
export const CONTACT_PHONE = '913 109 109';

export interface CertificateFixture {
  anaId: string;
  carlaId: string;
  anaLeaveId: string;
  carlaLeaveId: string;
}

export async function certificateFixture(): Promise<CertificateFixture> {
  const lesson = await poolsideLesson();
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query('BEGIN');
    const kids = await db.query<{ id: string; first_name: string; organization_id: string }>(
      `SELECT id, first_name, organization_id FROM student
        WHERE id = ANY($1::uuid[]) AND first_name IN ('Ana', 'Carla') AND last_name = 'Poolside'`,
      [lesson.studentIds],
    );
    const ana = kids.rows.find((row) => row.first_name === 'Ana')!;
    const carla = kids.rows.find((row) => row.first_name === 'Carla')!;
    const org = ana.organization_id;

    await db.query(
      `UPDATE student_medical_leave SET archived_at = now()
        WHERE organization_id = $1 AND student_id = ANY($2::uuid[]) AND archived_at IS NULL`,
      [org, [ana.id, carla.id]],
    );
    await db.query(
      `UPDATE student SET emergency_contact_membership_id = NULL, emergency_contact_name = NULL,
              emergency_contact_phone = NULL, emergency_contact_relationship = NULL
        WHERE id = $1`,
      [ana.id],
    );
    const leave = async (studentId: string): Promise<string> =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO student_medical_leave (organization_id, student_id, starts_on, ends_on, reason)
           VALUES ($1, $2, club_today() - 40, club_today() - 10, 'E2E · Lesão no pulso') RETURNING id`,
          [org, studentId],
        )
      ).rows[0]!.id;

    const contact = await db.query<{ id: string }>(
      `SELECT id FROM membership WHERE organization_id = $1 AND first_name = $2 AND last_name = $3 AND archived_at IS NULL`,
      [org, CONTACT_FIRST, CONTACT_LAST],
    );
    if (contact.rows.length === 0) {
      const made = await db.query<{ id: string }>(
        `INSERT INTO membership (organization_id, status, first_name, last_name, phone, email)
         VALUES ($1, 'active', $2, $3, $4, 'marisol.contacto.e2e@example.test') RETURNING id`,
        [org, CONTACT_FIRST, CONTACT_LAST, CONTACT_PHONE],
      );
      await db.query(
        `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'guardian')`,
        [org, made.rows[0]!.id],
      );
    }

    const fixture = {
      anaId: ana.id,
      carlaId: carla.id,
      anaLeaveId: await leave(ana.id),
      carlaLeaveId: await leave(carla.id),
    };
    await db.query('COMMIT');
    return fixture;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

/** How many audited downloads a file has — QA 4. */
export async function auditedReads(fileId: string): Promise<number> {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = 'file.read' AND entity_id = $1`,
      [fileId],
    );
    return Number(rows[0]!.n);
  } finally {
    await db.end();
  }
}
