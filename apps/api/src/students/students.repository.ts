import { withOrg, type Tx } from '@poolse/db';
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
  /** The link between this guardian and this student. */
  linkId: string;
  /** The person. One row per human per club, however many children they bring. */
  membershipId: string;
  name: string;
  email: string | null;
  /**
   * Their relationship *to this student* — POOLSE-04, criterion 4.
   *
   * On the link rather than on the person, because the same woman is "avó" to
   * one child and "tutora legal" to another.
   */
  relationship: string | null;
  phone: string | null;
  /** NIF. Text, not a number — it can carry a leading zero and is never arithmetic. */
  taxNumber: string | null;
  address: string | null;
  /** Who to ring first. At most one per student, enforced by a partial index. */
  isPrimary: boolean;
  /**
   * Whether Clerk owns their name and email.
   *
   * The interface shows those read-only where it is true: writing them here
   * would be reverted by the next webhook, which is the bug decision 3 exists to
   * stop.
   */
  hasLogin: boolean;
}

/**
 * A guardian as the caller asks for one — POOLSE-04, POOLSE-17.
 *
 * Either an existing person by id, or enough to create one. Both carry the
 * relationship, because that belongs to the pairing rather than to either half
 * of it.
 */
export interface GuardianInput {
  membershipId: string | null;
  name: string | null;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  address: string | null;
  isPrimary: boolean;
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
   * Every encarregado de educação, primary first — POOLSE-04, POOLSE-17.
   *
   * Kept whatever the student's age, per criterion 8. Nothing severs a link when
   * somebody turns eighteen: the block collapses in the interface and the
   * relation stays, because "who was your guardian" remains true about the years
   * it covered.
   *
   * A list rather than one, because a child can have two parents and because the
   * same guardian covers their siblings from a single record.
   */
  guardians: Guardian[];
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
      guardians: Guardian[];
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
             (
               SELECT coalesce(jsonb_agg(g ORDER BY g->>'name'), '[]'::jsonb)
                 FROM (
                   SELECT jsonb_build_object(
                            'linkId',       gl.id,
                            'membershipId', gl.guardian_membership_id,
                            'name',         person_name(gl.guardian_membership_id),
                            'email',        person_email(gl.guardian_membership_id)::text,
                            'relationship', gl.relationship,
                            'phone',        m.phone,
                            'taxNumber',    m.tax_number,
                            'address',      m.address,
                            'isPrimary',    gl.is_primary,
                            'hasLogin',     m.app_user_id IS NOT NULL
                          ) AS g
                     FROM guardian_link gl
                     JOIN membership m
                       ON m.id = gl.guardian_membership_id
                      AND m.organization_id = gl.organization_id
                    WHERE gl.student_id = s.id
                      AND gl.organization_id = s.organization_id
                      AND gl.archived_at IS NULL
                 ) links
             ) AS guardians,
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
             (
               SELECT coalesce(jsonb_agg(g ORDER BY g->>'name'), '[]'::jsonb)
                 FROM (
                   SELECT jsonb_build_object(
                            'linkId',       gl.id,
                            'membershipId', gl.guardian_membership_id,
                            'name',         person_name(gl.guardian_membership_id),
                            'email',        person_email(gl.guardian_membership_id)::text,
                            'relationship', gl.relationship,
                            'phone',        m.phone,
                            'taxNumber',    m.tax_number,
                            'address',      m.address,
                            'isPrimary',    gl.is_primary,
                            'hasLogin',     m.app_user_id IS NOT NULL
                          ) AS g
                     FROM guardian_link gl
                     JOIN membership m
                       ON m.id = gl.guardian_membership_id
                      AND m.organization_id = gl.organization_id
                    WHERE gl.student_id = s.id
                      AND gl.organization_id = s.organization_id
                      AND gl.archived_at IS NULL
                 ) links
             ) AS guardians,
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
  /**
   * Every guardian this student should have, as the caller wants them.
   *
   * The whole set, not a delta: the form posts what it is showing, and links no
   * longer in the list are archived. A delta would need the client to track what
   * it removed, which is state a form should not have to keep.
   */
  guardians: GuardianInput[];
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
         contact_email, contact_phone, notes
       )
       VALUES ($1, $2, $3, $4::date, $5, $6::citext, $7, $8)
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
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the student');

    await syncGuardians(tx, organizationId, id, input.guardians);

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
              contact_email = $6::citext, contact_phone = $7, notes = $8
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
      ],
    );
    if (!rows[0]) return 'not_found';

    await syncGuardians(tx, organizationId, studentId, input.guardians);

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
  guardians: Guardian[];
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
    // Primary first — it is the number somebody rings in a hurry. Aggregated by
    // name in SQL, reordered here so the ordering rule sits beside the type it
    // orders rather than inside a jsonb_agg nobody reads.
    guardians: [...row.guardians].sort(
      (a, b) => Number(b.isPrimary) - Number(a.isPrimary),
    ),
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

// ---------------------------------------------------------------------------
// Guardians — POOLSE-04 and POOLSE-17
// ---------------------------------------------------------------------------

/**
 * "Maria Alves Costa" → given name "Maria", surnames "Alves Costa".
 *
 * Crude, and right far more often than any alternative for the names this
 * product sees: Portuguese names put the given name first and carry two or more
 * surnames. A single word becomes both, so "Madalena" is findable rather than
 * half-stored.
 */
function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  const cut = trimmed.indexOf(' ');
  if (cut === -1) return { first: trimmed, last: trimmed };
  return { first: trimmed.slice(0, cut), last: trimmed.slice(cut + 1) };
}

/**
 * Somebody this club already knows — POOLSE-17, criteria 8 and 9.
 *
 * NIF first, then email, which are the stable keys the ticket names. Importing a
 * guardian who is already a student must not create a second them, and the
 * commonest real case is smaller than that: a mother enrolling her second child,
 * typed in again from the same form.
 *
 * Case does not distinguish an email — the column is `citext` — so a guardian
 * found by address is found however it was typed.
 */
async function findPerson(
  tx: Tx,
  taxNumber: string | null,
  email: string | null,
): Promise<string | null> {
  if (taxNumber === null && email === null) return null;

  const { rows } = await tx.query<{ id: string }>(
    `SELECT m.id
       FROM membership m
       LEFT JOIN app_user u ON u.id = m.app_user_id
      WHERE m.archived_at IS NULL
        AND (
          ($1::text IS NOT NULL AND m.tax_number = $1::text)
          OR ($2::citext IS NOT NULL AND coalesce(u.cached_email, m.email) = $2::citext)
        )
      -- A NIF match beats an email match: two people can share a household
      -- address, and only one can have a given tax number.
      ORDER BY (m.tax_number = $1::text) DESC NULLS LAST
      LIMIT 1`,
    [taxNumber, email],
  );

  return rows[0]?.id ?? null;
}

/**
 * Makes the student's guardians match what the caller asked for.
 *
 * The whole set is posted, not a delta, so anything no longer in the list is
 * archived. Archived, never deleted: a link that existed is a fact about the
 * years it covered, and the guardian's own record is untouched either way —
 * removing somebody from one child does not remove them from their siblings.
 *
 * A guardian named by `membershipId` is used as-is. One described by fields is
 * matched against the club's people first and only created if genuinely new,
 * which is what stops the second sibling producing a second mother.
 */
async function syncGuardians(
  tx: Tx,
  organizationId: string,
  studentId: string,
  guardians: GuardianInput[],
): Promise<void> {
  const kept: string[] = [];

  for (const guardian of guardians) {
    let membershipId = guardian.membershipId;

    if (membershipId === null) {
      membershipId = await findPerson(tx, guardian.taxNumber, guardian.email);
    }

    if (membershipId === null) {
      if (guardian.name === null || guardian.name.trim() === '') continue;
      const { first, last } = splitName(guardian.name);

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO membership (organization_id, status, first_name, last_name,
                                 email, phone, tax_number, address)
         VALUES ($1, 'active', $2, $3, $4::citext, $5, $6, $7)
         RETURNING id`,
        [
          organizationId,
          first,
          last,
          guardian.email,
          guardian.phone,
          guardian.taxNumber,
          guardian.address,
        ],
      );
      membershipId = rows[0]!.id;
    } else {
      /*
       * Known already. Their details are theirs, edited on their own page — this
       * fills only what is still blank, so enrolling a second child can add the
       * phone number the first enrolment did not have without overwriting one
       * somebody has since corrected.
       *
       * Never the name or the email of somebody with a login: the check
       * constraint refuses that outright, and this is the layer that should not
       * try.
       */
      await tx.query(
        `UPDATE membership
            SET phone      = coalesce(phone, $2),
                tax_number = coalesce(tax_number, $3),
                address    = coalesce(address, $4),
                email      = CASE WHEN app_user_id IS NULL
                                  THEN coalesce(email, $5::citext)
                                  ELSE email END
          WHERE id = $1 AND archived_at IS NULL`,
        [membershipId, guardian.phone, guardian.taxNumber, guardian.address, guardian.email],
      );
    }

    // They are an encarregado de educação here, whatever else they also are.
    await tx.query(
      `INSERT INTO membership_role (organization_id, membership_id, role)
       SELECT $1, $2, 'guardian'
        WHERE NOT EXISTS (
          SELECT 1 FROM membership_role
           WHERE membership_id = $2 AND role = 'guardian' AND archived_at IS NULL
        )`,
      [organizationId, membershipId],
    );

    /*
     * The primary flag is cleared before it is set, in that order.
     *
     * `guardian_link_one_primary` refuses a second primary contact, so setting
     * the new one first would collide with the old. Clearing everything and then
     * marking one is the same two-step the season reset uses, and for the same
     * reason: the index is doing the work, not the code.
     */
    await tx.query(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                                  relationship, is_primary)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (student_id, guardian_membership_id) WHERE archived_at IS NULL
       DO UPDATE SET relationship = EXCLUDED.relationship, archived_at = NULL`,
      [organizationId, studentId, membershipId, guardian.relationship],
    );

    kept.push(membershipId);
  }

  // Anything no longer listed. Archived rather than deleted.
  await tx.query(
    `UPDATE guardian_link
        SET archived_at = now()
      WHERE student_id = $1
        AND archived_at IS NULL
        AND NOT (guardian_membership_id = ANY ($2::uuid[]))`,
    [studentId, kept],
  );

  const primary = guardians.find((guardian) => guardian.isPrimary);
  await tx.query(
    `UPDATE guardian_link SET is_primary = false
      WHERE student_id = $1 AND archived_at IS NULL AND is_primary`,
    [studentId],
  );

  /*
   * One primary, chosen or assumed.
   *
   * A student with guardians and none marked would leave nobody to ring, and the
   * form does not force the choice — so the first listed becomes primary when
   * nobody said otherwise. Better a defensible default than an empty answer to
   * "who do we call".
   */
  const primaryIndex = primary === undefined ? 0 : guardians.indexOf(primary);
  const primaryMembershipId = kept[primaryIndex] ?? kept[0];

  if (primaryMembershipId !== undefined) {
    await tx.query(
      `UPDATE guardian_link SET is_primary = true
        WHERE student_id = $1 AND guardian_membership_id = $2 AND archived_at IS NULL`,
      [studentId, primaryMembershipId],
    );
  }
}

/**
 * A person the club already knows, for the guardian picker — POOLSE-17.
 *
 * Everybody, not only existing guardians: the point of the ticket is that the
 * grandmother enrolling a child may already be a student, an instructor, or on
 * the committee, and picking her rather than typing her again is what keeps one
 * human as one record.
 */
export interface PersonSummary {
  membershipId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  address: string | null;
  roles: string[];
  hasLogin: boolean;
  /** How many students they are already responsible for. Shown so a pick is confident. */
  guardianOf: number;
}

export async function searchPeople(
  organizationId: string,
  search: string,
  limit = 10,
): Promise<PersonSummary[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      name: string;
      email: string | null;
      phone: string | null;
      tax_number: string | null;
      address: string | null;
      roles: string[];
      has_login: boolean;
      guardian_of: number;
    }>(
      `SELECT m.id AS membership_id,
              person_name(m.id) AS name,
              person_email(m.id)::text AS email,
              m.phone,
              m.tax_number,
              m.address,
              coalesce((
                SELECT array_agg(mr.role::text ORDER BY mr.role)
                  FROM membership_role mr
                 WHERE mr.membership_id = m.id AND mr.archived_at IS NULL
              ), '{}') AS roles,
              m.app_user_id IS NOT NULL AS has_login,
              (
                SELECT count(*) FROM guardian_link gl
                 WHERE gl.guardian_membership_id = m.id AND gl.archived_at IS NULL
              )::int AS guardian_of
         FROM membership m
        WHERE m.archived_at IS NULL
          AND m.status <> 'invited'
          AND (
            -- Accent- and case-insensitive on the name, exact on the keys. A NIF
            -- typed in full is a lookup, not a search; a name is the other way
            -- round.
            lower(strip_accents(person_name(m.id))) LIKE '%' || lower(strip_accents($1::text)) || '%'
            OR person_email(m.id) = $1::citext
            OR m.tax_number = $1::text
          )
        ORDER BY person_name(m.id)
        LIMIT $2`,
      [search, limit],
    );

    return rows.map((row) => ({
      membershipId: row.membership_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      taxNumber: row.tax_number,
      address: row.address,
      roles: row.roles,
      hasLogin: row.has_login,
      guardianOf: row.guardian_of,
    }));
  });
}

/**
 * The students one person is responsible for — POOLSE-04, criterion 9.
 *
 * The guardian's own page answers "which children am I here for", which is the
 * half of the relation the student's page cannot show.
 */
export async function studentsOf(
  organizationId: string,
  membershipId: string,
): Promise<{ id: string; name: string; relationship: string | null }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      relationship: string | null;
    }>(
      `SELECT s.id,
              s.first_name || ' ' || s.last_name AS name,
              gl.relationship
         FROM guardian_link gl
         JOIN student s ON s.id = gl.student_id AND s.organization_id = gl.organization_id
        WHERE gl.guardian_membership_id = $1
          AND gl.archived_at IS NULL
          AND s.archived_at IS NULL
        ORDER BY s.first_name, s.last_name`,
      [membershipId],
    );
    return rows;
  });
}

/**
 * Every encarregado de educação, with the students they are responsible for —
 * POOLSE-35, criterion 5, and POOLSE-04, criterion 9.
 *
 * Lives under Alunos rather than under Pessoas: a guardian is part of the
 * families a club teaches, not part of its staff. Somebody who is both appears
 * in both sections as the same person — the filter is on roles, and roles are a
 * set.
 *
 * One guardian to many students is the shape that matters here. The list is
 * grouped by person so a mother of three is one row with three children under
 * her, which is the fact a free-text guardian column could never express.
 */
export interface GuardianRow {
  membershipId: string;
  name: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  students: { id: string; name: string; relationship: string | null }[];
}

export async function listGuardians(organizationId: string): Promise<GuardianRow[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      name: string;
      email: string | null;
      phone: string | null;
      has_login: boolean;
      students: GuardianRow['students'];
    }>(`
      SELECT m.id AS membership_id,
             person_name(m.id) AS name,
             person_email(m.id)::text AS email,
             m.phone,
             m.app_user_id IS NOT NULL AS has_login,
             coalesce((
               SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', s.id,
                          'name', s.first_name || ' ' || s.last_name,
                          'relationship', gl.relationship
                        )
                        ORDER BY s.first_name, s.last_name
                      )
                 FROM guardian_link gl
                 JOIN student s
                   ON s.id = gl.student_id
                  AND s.organization_id = gl.organization_id
                WHERE gl.guardian_membership_id = m.id
                  AND gl.organization_id = m.organization_id
                  AND gl.archived_at IS NULL
                  AND s.archived_at IS NULL
             ), '[]'::jsonb) AS students
        FROM membership m
       WHERE m.archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM membership_role mr
            WHERE mr.membership_id = m.id
              AND mr.role = 'guardian'
              AND mr.archived_at IS NULL
         )
       ORDER BY person_name(m.id)
    `);

    return rows.map((row) => ({
      membershipId: row.membership_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      hasLogin: row.has_login,
      students: row.students,
    }));
  });
}

/**
 * The club's maioridade, in whole years — POOLSE-22.
 *
 * Read rather than assumed. Eighteen is Portuguese law, not a fact about
 * swimming, and the whole point of the setting is that no code path gets to
 * hardcode it.
 *
 * Falls back to 18 only if the row somehow has no value, which the NOT NULL
 * default makes impossible — the coalesce is there so a caller never receives
 * `null` and quietly compares against it.
 */
export async function ageOfMajority(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ age_of_majority: number }>(
      `SELECT age_of_majority FROM organization WHERE id = $1`,
      [organizationId],
    );
    return rows[0]?.age_of_majority ?? 18;
  });
}
