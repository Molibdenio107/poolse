import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * A category on the person — POOLSE-202 (Rui, 08-11-2026).
 *
 * The office ticks a category (*Sénior*, *Sócio*, *Munícipe*) on a student
 * record or on somebody reception knows, after seeing proof. Who checked it,
 * when, and until when; never a copy of the document, and the notes never
 * carry its number (a CHECK refuses six digits in a row).
 *
 * **Validity is SQL's.** Every row's state is `person_category_status()` and
 * what applies to a person is `person_categories()`; nothing here compares a
 * date. A membership and the student whose login it is are one person, so a
 * list shows the rows held on either.
 *
 * For passes only (POOLSE-203). Monthly fees keep the enrolment/turma rule and
 * nothing here reads or writes it.
 */

export type PersonRef = { studentId: string } | { membershipId: string };

export type PersonCategoryStatus = 'live' | 'expiring' | 'expired';

export interface PersonCategory {
  id: string;
  categoryId: string;
  name: string;
  rank: number;
  /** Which record the row sits on — a student and their login are one person. */
  heldOn: 'student' | 'membership';
  proofSeenOn: string;
  proofSeenByName: string | null;
  validUntil: string | null;
  notes: string | null;
  status: PersonCategoryStatus;
}

export interface PersonCategoryInput {
  categoryId: string;
  proofSeenOn: string;
  validUntil: string | null;
  notes: string | null;
}

/** A row on *Categorias a expirar*: who, which, until when. */
export interface ExpiringCategory {
  id: string;
  name: string;
  validUntil: string;
  personName: string;
  studentId: string | null;
  membershipId: string | null;
}

/** The person this request names is not one of this club's live people. */
export class NoSuchPersonError extends Error {}
/** The person already holds that category, live. */
export class CategoryAlreadyHeldError extends Error {}
/** The category does not exist in this club, or is archived. */
export class NoSuchCategoryError extends Error {}

/**
 * The rows on a person, from either side. `$2` is the membership, `$3` the
 * student; the match mirrors `person_categories()`.
 */
const PERSON_SQL = `(
     ($2::uuid IS NOT NULL AND pc.membership_id = $2::uuid)
  OR ($3::uuid IS NOT NULL AND pc.student_id = $3::uuid)
  OR ($2::uuid IS NOT NULL AND pc.student_id IN (
        SELECT s.id FROM student s
         WHERE s.organization_id = $1 AND s.membership_id = $2::uuid AND s.archived_at IS NULL))
  OR ($3::uuid IS NOT NULL AND pc.membership_id = (
        SELECT s.membership_id FROM student s WHERE s.organization_id = $1 AND s.id = $3::uuid))
)`;

function ids(person: PersonRef): [string | null, string | null] {
  return 'studentId' in person ? [null, person.studentId] : [person.membershipId, null];
}

async function personExists(tx: Tx, organizationId: string, person: PersonRef): Promise<boolean> {
  const { rows } =
    'studentId' in person
      ? await tx.query(
          `SELECT 1 FROM student WHERE organization_id = $1 AND id = $2::uuid AND archived_at IS NULL`,
          [organizationId, person.studentId],
        )
      : await tx.query(
          `SELECT 1 FROM membership WHERE organization_id = $1 AND id = $2::uuid AND archived_at IS NULL`,
          [organizationId, person.membershipId],
        );
  return rows.length > 0;
}

interface Row {
  id: string;
  category_id: string;
  name: string;
  rank: number;
  held_on: 'student' | 'membership';
  proof_seen_on: string;
  proof_seen_by_name: string | null;
  valid_until: string | null;
  notes: string | null;
  status: PersonCategoryStatus;
}

async function readRows(tx: Tx, organizationId: string, person: PersonRef): Promise<PersonCategory[]> {
  const [membershipId, studentId] = ids(person);
  const { rows } = await tx.query<Row>(
    `SELECT pc.id, c.id AS category_id, c.name, c.rank,
            CASE WHEN pc.student_id IS NOT NULL THEN 'student' ELSE 'membership' END AS held_on,
            to_char(pc.proof_seen_on, 'YYYY-MM-DD') AS proof_seen_on,
            CASE WHEN pc.proof_seen_by IS NULL THEN NULL ELSE person_name(pc.proof_seen_by) END
              AS proof_seen_by_name,
            to_char(pc.valid_until, 'YYYY-MM-DD') AS valid_until,
            pc.notes,
            person_category_status(pc.valid_until) AS status
       FROM person_category pc
       JOIN fee_category c ON c.organization_id = pc.organization_id AND c.id = pc.fee_category_id
      WHERE pc.organization_id = $1
        AND pc.archived_at IS NULL
        AND ${PERSON_SQL}
      ORDER BY c.rank, lower(strip_accents(c.name))`,
    [organizationId, membershipId, studentId],
  );
  return rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    rank: row.rank,
    heldOn: row.held_on,
    proofSeenOn: row.proof_seen_on,
    proofSeenByName: row.proof_seen_by_name,
    validUntil: row.valid_until,
    notes: row.notes,
    status: row.status,
  }));
}

/** Every category row on a person, expired ones included, top rank first. Null: no such person. */
export async function listPersonCategories(
  organizationId: string,
  person: PersonRef,
): Promise<PersonCategory[] | null> {
  return withOrg(organizationId, async (tx) => {
    if (!(await personExists(tx, organizationId, person))) return null;
    return readRows(tx, organizationId, person);
  });
}

export async function addPersonCategory(
  organizationId: string,
  person: PersonRef,
  actorMembershipId: string,
  input: PersonCategoryInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    if (!(await personExists(tx, organizationId, person))) throw new NoSuchPersonError();
    const { rows: category } = await tx.query(
      `SELECT 1 FROM fee_category WHERE organization_id = $1 AND id = $2::uuid AND archived_at IS NULL`,
      [organizationId, input.categoryId],
    );
    if (category.length === 0) throw new NoSuchCategoryError();

    // Held already on the other side of the same person counts too.
    const held = await readRows(tx, organizationId, person);
    if (held.some((one) => one.categoryId === input.categoryId)) throw new CategoryAlreadyHeldError();

    const [membershipId, studentId] = ids(person);
    let id: string | undefined;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO person_category
           (organization_id, membership_id, student_id, fee_category_id,
            proof_seen_on, proof_seen_by, valid_until, notes)
         VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::date, $6::uuid, $7::date, $8)
         RETURNING id`,
        [organizationId, membershipId, studentId, input.categoryId, input.proofSeenOn,
         actorMembershipId === '' ? null : actorMembershipId, input.validUntil, input.notes],
      );
      id = rows[0]?.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new CategoryAlreadyHeldError();
      throw error;
    }
    if (id === undefined) throw new Error('Could not add the category');

    await recordAudit(tx, {
      action: 'person_category.added',
      entityType: 'person_category',
      entityId: id,
      data: {
        categoryId: input.categoryId,
        studentId,
        membershipId,
        proofSeenOn: input.proofSeenOn,
        validUntil: input.validUntil,
      },
    });
    return id;
  });
}

/** New proof, new dates. False: no such live row. */
export async function renewPersonCategory(
  organizationId: string,
  id: string,
  actorMembershipId: string,
  input: Omit<PersonCategoryInput, 'categoryId'>,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE person_category
          SET proof_seen_on = $3::date, proof_seen_by = $4::uuid, valid_until = $5::date, notes = $6
        WHERE organization_id = $1 AND id = $2::uuid AND archived_at IS NULL
      RETURNING id`,
      [organizationId, id, input.proofSeenOn, actorMembershipId === '' ? null : actorMembershipId,
       input.validUntil, input.notes],
    );
    if (rows.length === 0) return false;
    await recordAudit(tx, {
      action: 'person_category.renewed',
      entityType: 'person_category',
      entityId: id,
      data: { proofSeenOn: input.proofSeenOn, validUntil: input.validUntil },
    });
    return true;
  });
}

/** Removal is an archive. False: no such live row. */
export async function removePersonCategory(organizationId: string, id: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE person_category SET archived_at = now()
        WHERE organization_id = $1 AND id = $2::uuid AND archived_at IS NULL
      RETURNING id`,
      [organizationId, id],
    );
    if (rows.length === 0) return false;
    await recordAudit(tx, {
      action: 'person_category.removed',
      entityType: 'person_category',
      entityId: id,
      data: {},
    });
    return true;
  });
}

/**
 * *Categorias a expirar* — every live row whose status is `expiring`, soonest
 * first. Not paginated: a queue the office works down (CONVENTIONS.md).
 */
export async function listExpiringCategories(organizationId: string): Promise<ExpiringCategory[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      valid_until: string;
      person_name: string;
      student_id: string | null;
      membership_id: string | null;
    }>(
      `SELECT pc.id, c.name, to_char(pc.valid_until, 'YYYY-MM-DD') AS valid_until,
              coalesce(
                (SELECT btrim(s.first_name || ' ' || s.last_name) FROM student_person s
                  WHERE s.organization_id = pc.organization_id AND s.id = pc.student_id),
                CASE WHEN pc.membership_id IS NULL THEN NULL ELSE person_name(pc.membership_id) END,
                '') AS person_name,
              pc.student_id, pc.membership_id
         FROM person_category pc
         JOIN fee_category c ON c.organization_id = pc.organization_id AND c.id = pc.fee_category_id
        WHERE pc.organization_id = $1
          AND pc.archived_at IS NULL
          AND c.archived_at IS NULL
          AND person_category_status(pc.valid_until) = 'expiring'
        ORDER BY pc.valid_until, lower(c.name)`,
      [organizationId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      validUntil: row.valid_until,
      personName: row.person_name,
      studentId: row.student_id,
      membershipId: row.membership_id,
    }));
  });
}

/** How many rows are expiring — the attention circle (POOLSE-120). */
export async function countExpiringCategories(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM person_category pc
         JOIN fee_category c ON c.organization_id = pc.organization_id AND c.id = pc.fee_category_id
        WHERE pc.organization_id = $1 AND pc.archived_at IS NULL AND c.archived_at IS NULL
          AND person_category_status(pc.valid_until) = 'expiring'`,
      [organizationId],
    );
    return rows[0]?.n ?? 0;
  });
}

/**
 * The reader's own valid categories for the family app: name and expiry only,
 * never the proof. Straight from `person_categories()`.
 */
export async function myCategories(
  organizationId: string,
  membershipId: string,
): Promise<{ name: string; validUntil: string | null }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string; valid_until: string | null }>(
      `SELECT name, to_char(valid_until, 'YYYY-MM-DD') AS valid_until
         FROM person_categories($1, $2::uuid, NULL)`,
      [organizationId, membershipId],
    );
    return rows.map((row) => ({ name: row.name, validUntil: row.valid_until }));
  });
}
