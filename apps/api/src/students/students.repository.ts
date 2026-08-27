import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

export interface StudentLevel {
  id: string;
  name: string;
  sortOrder: number;
  /**
   * Months, both optional and independent — backlog round 4 ticket 2, and
   * POOLSE-06.
   *
   * Months rather than years because a baby class starts at six months, and one
   * unit rather than a value-plus-unit pair because the pair means every
   * comparison first agreeing on the unit. "Adultos" has a minimum and no
   * maximum; "Livre" has neither and behaves exactly as every level did before
   * ranges existed.
   */
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  /** So the UI can warn before archiving a level people are in. */
  studentCount: number;
}


/**
 * The encarregado de educação, as fields on the student — POOLSE-04.
 *
 * Not a linked account: a club enrolling a seven-year-old needs somewhere to
 * write their mother's phone number now, not an invitation flow before the
 * record can be saved. Linking to a real account is its own ticket.
 */
export interface Guardian {
  name: string | null;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  /** NIF. Text, not a number — it can carry a leading zero and is never arithmetic. */
  taxNumber: string | null;
  address: string | null;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  /** Whole years, computed by the database so no timezone can shift a birthday. */
  age: number | null;
  levelId: string | null;
  levelName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  /**
   * Present only when a `photo` consent is granted and not withdrawn. The query
   * decides that, not the caller — see the note on PHOTO_KEY below.
   */
  photoStorageKey: string | null;
  /** So the interface can explain why there is no photograph, without implying there is one. */
  photoConsent: boolean;
  /**
   * Kept whatever the student's age — POOLSE-04, criterion 5.
   *
   * Nothing clears these when somebody turns eighteen. The block collapses in
   * the interface and the data stays, because "who was your guardian" remains
   * true about the years it covered.
   */
  guardian: Guardian;
}

export class DuplicateNameError extends Error {}

/**
 * The consent gate, written once and used by every query that reads a student.
 *
 * A student's photograph may be shown only where a `photo` consent record is
 * granted and not withdrawn. Enforcing that here — in the SQL that produces the
 * key — rather than in the components that render it is the whole design: a
 * caller who has never heard of consent receives NULL and has nothing to show,
 * and withdrawing consent takes effect everywhere at once because there is only
 * one place it is decided.
 *
 * These are photographs of children. A club that collected consent, saw it
 * withdrawn, and kept displaying the picture has a real problem, not a cosmetic
 * one.
 */
const PHOTO_CONSENT = `
  EXISTS (
    SELECT 1 FROM consent c
     WHERE c.organization_id = s.organization_id
       AND c.student_id = s.id
       AND c.kind = 'photo'
       AND c.granted
       AND c.withdrawn_at IS NULL
  )`;

const PHOTO_KEY = `CASE WHEN ${PHOTO_CONSENT} THEN s.photo_storage_key ELSE NULL END`;

function asDuplicate(error: unknown, name: string): never {
  if (error instanceof Error && (error as { code?: string }).code === '23505') {
    throw new DuplicateNameError(name);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export async function listLevels(organizationId: string): Promise<StudentLevel[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      sort_order: number;
      min_age_months: number | null;
      max_age_months: number | null;
      student_count: string;
    }>(`
      SELECT l.id,
             l.name,
             l.sort_order,
             l.min_age_months,
             l.max_age_months,
             (
               SELECT count(*)
                 FROM student s
                WHERE s.organization_id = l.organization_id
                  AND s.level_id = l.id
                  AND s.archived_at IS NULL
             ) AS student_count
        FROM student_level l
       WHERE l.archived_at IS NULL
       ORDER BY l.sort_order, l.name
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      minAgeMonths: row.min_age_months,
      maxAgeMonths: row.max_age_months,
      // count() comes back as a string from node-pg; bigint does not fit a JS
      // number in general, and the driver refuses to guess.
      studentCount: Number(row.student_count),
    }));
  });
}

export interface AgeRange {
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
}

/**
 * How many students in a level would fall outside a proposed age range —
 * backlog round 4, ticket 4.
 *
 * Shown before saving, and saving removes nobody. Age drifts: a child correctly
 * enrolled in "3–5 anos" turns six mid-season, and a system that quietly moved
 * them would be making a decision that belongs to the club.
 *
 * Students with no birth date are never counted. Missing dates are the normal
 * case, not the exception — the spreadsheets waiting to be imported have a
 * half-empty column, and counting them as "outside" would report a scary number
 * that means nothing.
 */
export async function countOutsideRange(
  organizationId: string,
  levelId: string,
  range: AgeRange,
): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ outside: string }>(
      `
      SELECT count(*) AS outside
        FROM student s
       WHERE s.level_id = $1
         AND s.archived_at IS NULL
         AND s.birth_date IS NOT NULL
         -- Compared in months, matching the interface. age() returns an
         -- interval, so the months are the years times twelve plus the months
         -- part; extracting only the year would call a five-month-old zero and
         -- let them into a level starting at six months.
         AND (
              ($2::smallint IS NOT NULL
                 AND (extract(year FROM age(s.birth_date)) * 12
                      + extract(month FROM age(s.birth_date)))::int < $2)
           OR ($3::smallint IS NOT NULL
                 AND (extract(year FROM age(s.birth_date)) * 12
                      + extract(month FROM age(s.birth_date)))::int > $3)
         )
      `,
      [levelId, range.minAgeMonths, range.maxAgeMonths],
    );
    return Number(rows[0]?.outside ?? 0);
  });
}

export async function createLevel(
  organizationId: string,
  name: string,
  range: AgeRange = { minAgeMonths: null, maxAgeMonths: null },
): Promise<string> {
  try {
    return await withOrg(organizationId, async (tx) => {
      // Appended to the end of the progression. Reordering is a separate,
      // deliberate action — a new level silently landing in the middle of
      // somebody's Adaptação → Iniciação → Aperfeiçoamento would be worse.
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO student_level (organization_id, name, sort_order,
                                    min_age_months, max_age_months)
         VALUES (
           $1, $2,
           coalesce((SELECT max(sort_order) + 1 FROM student_level WHERE archived_at IS NULL), 0),
           $3, $4
         )
         RETURNING id`,
        [organizationId, name, range.minAgeMonths, range.maxAgeMonths],
      );

      const id = rows[0]?.id;
      if (!id) throw new Error('Could not create the level');

      await recordAudit(tx, {
        action: 'student_level.created',
        entityType: 'student_level',
        entityId: id,
        data: { name, ...range },
      });

      return id;
    });
  } catch (error) {
    return asDuplicate(error, name);
  }
}

/**
 * Renames a level and sets its age range.
 *
 * One call rather than two, because the level form submits both together and a
 * half-applied edit is the kind of state nobody can explain. The range is always
 * written, so clearing a bound is a real action — the opposite of a PATCH that
 * would leave "Adultos, 18+" stuck at 18 forever.
 *
 * Narrowing removes nobody. `countOutsideRange` tells the interface how many
 * students would fall outside so it can say so before saving; what happens to
 * them afterwards is the club's decision, not the calendar's.
 */
export async function renameLevel(
  organizationId: string,
  levelId: string,
  name: string,
  range: AgeRange = { minAgeMonths: null, maxAgeMonths: null },
): Promise<boolean> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE student_level
            SET name = $2, min_age_months = $3, max_age_months = $4
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [levelId, name, range.minAgeMonths, range.maxAgeMonths],
      );
      if (!rows[0]) return false;

      await recordAudit(tx, {
        action: 'student_level.renamed',
        entityType: 'student_level',
        entityId: levelId,
        data: { name, ...range },
      });
      return true;
    });
  } catch (error) {
    return asDuplicate(error, name);
  }
}

/**
 * Swaps a level with its neighbour.
 *
 * Two rows change, so it happens in one transaction — a half-applied swap leaves
 * two levels claiming the same position, and the list order becomes whatever the
 * tie-break says.
 */
/**
 * The whole progression, reordered in one statement — POOLSE-05.
 *
 * Drag and drop moves a row past several others at once, so the swap-with-your-
 * neighbour shape the arrows used cannot express it: dragging the fifth level to
 * the top is four swaps, four round trips, and four chances to end up half
 * applied. The client sends the order it wants and this writes it.
 *
 * Positions come from the array index rather than from arithmetic on the old
 * values, so the sequence is always 0..n-1 with no gaps to drift. Any level the
 * caller left out keeps its place after the ones named — a list that raced with
 * somebody else's insert is reordered as far as it can be rather than refused.
 */
export async function reorderLevels(
  organizationId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student_level AS l
          SET sort_order = ordered.position
         FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
        WHERE l.id = ordered.id
          AND l.archived_at IS NULL
      RETURNING l.id`,
      [ids],
    );

    // Nothing matched: every id was archived, or belonged to another tenant and
    // RLS hid it. Either way the caller is working from a stale list.
    if (rows.length === 0) return false;

    await recordAudit(tx, {
      action: 'student_level.reordered',
      entityType: 'student_level',
      entityId: null,
      data: { order: ids },
    });

    return true;
  });
}


/**
 * Archiving a level leaves the students who were in it without one.
 *
 * `student.level_id` is nullable and the foreign key points at a row that still
 * exists, so nothing breaks — but the students quietly become unlevelled, which
 * the caller is told about so the UI can say so before it happens.
 */
export async function archiveLevel(
  organizationId: string,
  levelId: string,
): Promise<{ archived: boolean; unlevelled: number }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `UPDATE student_level SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, name`,
      [levelId],
    );
    const level = rows[0];
    if (!level) return { archived: false, unlevelled: 0 };

    const cleared = await tx.query(
      `UPDATE student SET level_id = NULL
        WHERE level_id = $1 AND archived_at IS NULL`,
      [levelId],
    );

    await recordAudit(tx, {
      action: 'student_level.archived',
      entityType: 'student_level',
      entityId: levelId,
      data: { name: level.name, unlevelled: cleared.rowCount ?? 0 },
    });

    return { archived: true, unlevelled: cleared.rowCount ?? 0 };
  });
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export interface StudentQuery {
  search: string | null;
  levelId: string | null;
}

export async function listStudents(
  organizationId: string,
  query: StudentQuery,
): Promise<Student[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      first_name: string;
      last_name: string;
      birth_date: Date | null;
      age: number | null;
      level_id: string | null;
      level_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      notes: string | null;
      guardian_name: string | null;
      guardian_relationship: string | null;
      guardian_phone: string | null;
      guardian_email: string | null;
      guardian_tax_number: string | null;
      guardian_address: string | null;
      photo_storage_key: string | null;
      photo_consent: boolean;
    }>(
      `
      SELECT s.id,
             s.first_name,
             s.last_name,
             s.birth_date,
             CASE WHEN s.birth_date IS NULL THEN NULL
                  ELSE extract(YEAR FROM age(s.birth_date))::int
             END AS age,
             s.level_id,
             l.name AS level_name,
             s.contact_email::text AS contact_email,
             s.contact_phone,
             s.notes,
             s.guardian_name,
             s.guardian_relationship,
             s.guardian_phone,
             s.guardian_email::text AS guardian_email,
             s.guardian_tax_number,
             s.guardian_address,
             ${PHOTO_KEY} AS photo_storage_key,
             ${PHOTO_CONSENT} AS photo_consent
        FROM student s
        LEFT JOIN student_level l
               ON l.id = s.level_id
              AND l.organization_id = s.organization_id
       WHERE s.archived_at IS NULL
         AND (
           $1::text IS NULL
           OR lower(strip_accents(s.first_name || ' ' || s.last_name))
              LIKE '%' || lower(strip_accents($1::text)) || '%'
         )
         AND ($2::uuid IS NULL OR s.level_id = $2::uuid)
       ORDER BY s.last_name, s.first_name
      `,
      [query.search, query.levelId],
    );

    return rows.map(toStudent);
  });
}

export async function findStudent(
  organizationId: string,
  studentId: string,
): Promise<Student | null> {
  const [student] = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `
      SELECT s.id, s.first_name, s.last_name, s.birth_date,
             CASE WHEN s.birth_date IS NULL THEN NULL
                  ELSE extract(YEAR FROM age(s.birth_date))::int
             END AS age,
             s.level_id, l.name AS level_name,
             s.contact_email::text AS contact_email, s.contact_phone, s.notes,
             s.guardian_name,
             s.guardian_relationship,
             s.guardian_phone,
             s.guardian_email::text AS guardian_email,
             s.guardian_tax_number,
             s.guardian_address,
             ${PHOTO_KEY} AS photo_storage_key,
             ${PHOTO_CONSENT} AS photo_consent
        FROM student s
        LEFT JOIN student_level l
               ON l.id = s.level_id AND l.organization_id = s.organization_id
       WHERE s.id = $1 AND s.archived_at IS NULL
      `,
      [studentId],
    );
    return rows;
  });

  return student ? toStudent(student as never) : null;
}

export interface StudentInput {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  levelId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  guardian: Guardian;
}

/** Null when the level id does not belong to this organization — or at all. */
export async function createStudent(
  organizationId: string,
  input: StudentInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    if (!(await levelExists(tx, input.levelId))) return null;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student (
         organization_id, first_name, last_name, birth_date, level_id,
         contact_email, contact_phone, notes,
         guardian_name, guardian_relationship, guardian_phone,
         guardian_email, guardian_tax_number, guardian_address
       )
       VALUES ($1, $2, $3, $4::date, $5, $6::citext, $7, $8,
               $9, $10, $11, $12::citext, $13, $14)
       RETURNING id`,
      [
        organizationId,
        input.firstName,
        input.lastName,
        input.birthDate,
        input.levelId,
        input.contactEmail,
        input.contactPhone,
        input.notes,
        input.guardian.name,
        input.guardian.relationship,
        input.guardian.phone,
        input.guardian.email,
        input.guardian.taxNumber,
        input.guardian.address,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the student');

    // Deliberately records the name and nothing else. An audit entry is readable
    // by every admin, and a child's contact details do not need to be in it
    // twice — the student row is the record, this is the trail to it.
    await recordAudit(tx, {
      action: 'student.created',
      entityType: 'student',
      entityId: id,
      data: { name: `${input.firstName} ${input.lastName}` },
    });

    return id;
  });
}

export async function updateStudent(
  organizationId: string,
  studentId: string,
  input: StudentInput,
): Promise<'updated' | 'not_found' | 'bad_level'> {
  return withOrg(organizationId, async (tx) => {
    if (!(await levelExists(tx, input.levelId))) return 'bad_level';

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student
          SET first_name = $2, last_name = $3, birth_date = $4::date, level_id = $5,
              contact_email = $6::citext, contact_phone = $7, notes = $8,
              guardian_name = $9, guardian_relationship = $10, guardian_phone = $11,
              guardian_email = $12::citext, guardian_tax_number = $13,
              guardian_address = $14
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [
        studentId,
        input.firstName,
        input.lastName,
        input.birthDate,
        input.levelId,
        input.contactEmail,
        input.contactPhone,
        input.notes,
        input.guardian.name,
        input.guardian.relationship,
        input.guardian.phone,
        input.guardian.email,
        input.guardian.taxNumber,
        input.guardian.address,
      ],
    );
    if (!rows[0]) return 'not_found';

    await recordAudit(tx, {
      action: 'student.updated',
      entityType: 'student',
      entityId: studentId,
      data: { name: `${input.firstName} ${input.lastName}` },
    });

    return 'updated';
  });
}

export async function archiveStudent(
  organizationId: string,
  studentId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; first_name: string; last_name: string }>(
      `UPDATE student SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, first_name, last_name`,
      [studentId],
    );
    const student = rows[0];
    if (!student) return false;

    await recordAudit(tx, {
      action: 'student.archived',
      entityType: 'student',
      entityId: studentId,
      data: { name: `${student.first_name} ${student.last_name}` },
    });

    return true;
  });
}

/**
 * Checked before the insert rather than relying on the foreign key.
 *
 * The composite key would refuse another organization's level anyway — that is
 * the guarantee, and it is tested — but it refuses with a constraint violation,
 * which reaches the operator as a 500. This turns the same case into "no such
 * level", which is both true and actionable.
 */
async function levelExists(
  tx: { query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }> },
  levelId: string | null,
): Promise<boolean> {
  if (levelId === null) return true;
  const { rows } = await tx.query(
    'SELECT 1 FROM student_level WHERE id = $1 AND archived_at IS NULL',
    [levelId],
  );
  return rows.length > 0;
}

function toStudent(row: {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: Date | null;
  age: number | null;
  level_id: string | null;
  level_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  guardian_name: string | null;
  guardian_relationship: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  guardian_tax_number: string | null;
  guardian_address: string | null;
  photo_storage_key: string | null;
  photo_consent: boolean;
}): Student {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    // A date column, not a timestamp — formatted as a plain calendar date so no
    // timezone can move somebody's birthday across midnight.
    birthDate: row.birth_date === null ? null : toIsoDate(row.birth_date),
    age: row.age,
    levelId: row.level_id,
    levelName: row.level_name,
    contactEmail: row.contact_email,
    guardian: {
      name: row.guardian_name,
      relationship: row.guardian_relationship,
      phone: row.guardian_phone,
      email: row.guardian_email,
      taxNumber: row.guardian_tax_number,
      address: row.guardian_address,
    },
    contactPhone: row.contact_phone,
    notes: row.notes,
    photoStorageKey: row.photo_storage_key,
    photoConsent: row.photo_consent,
  };
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
