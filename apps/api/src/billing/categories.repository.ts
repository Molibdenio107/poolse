import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Why one person pays a different price from the person in the next lane —
 * POOLSE-23 AC4.
 *
 * "Sénior", "Estudante", "Família numerosa", "Funcionário". A club invents its
 * own, which is why this is a table rather than an enum: a bombeiros discount
 * started in March should not wait for a deploy.
 *
 * **A reference, never a percentage.** What a category is *worth* belongs to the
 * pricing engine, which is explicitly not this ticket. A number typed into a
 * form here would be a discount nobody can report on and nobody can change in
 * one place — and it would sit beside `fee_plan` pretending to be a price.
 *
 * **Set on the turma or on the enrolment, and the enrolment wins.** A senior
 * turma carries the category so nobody types it forty times; the one member of
 * it who is staff carries their own. `enrolment_fee_category` in SQL is the
 * single definition of that precedence.
 */
export interface FeeCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** How many turmas and enrolments name it — what makes archiving a decision. */
  usedByGroups: number;
  usedByEnrollments: number;
}

export async function listCategories(organizationId: string): Promise<FeeCategory[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      sort_order: number;
      used_by_groups: number;
      used_by_enrollments: number;
    }>(
      `SELECT c.id, c.name, c.sort_order,
              (SELECT count(*)::int FROM class_group cg
                WHERE cg.fee_category_id = c.id
                  AND cg.organization_id = c.organization_id
                  AND cg.archived_at IS NULL) AS used_by_groups,
              (SELECT count(*)::int FROM enrollment e
                WHERE e.fee_category_id = c.id
                  AND e.organization_id = c.organization_id
                  AND e.ended_on IS NULL) AS used_by_enrollments
         FROM fee_category c
        WHERE c.archived_at IS NULL
        -- The club's own order, then alphabetical: a list somebody arranged
        -- reads the way they arranged it.
        ORDER BY c.sort_order, lower(strip_accents(c.name))`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      usedByGroups: row.used_by_groups,
      usedByEnrollments: row.used_by_enrollments,
    }));
  });
}

/** Raised when the club already has a category by that name. */
export class DuplicateCategoryError extends Error {
  // `override`: Error already has a `name`, and this one is the category's.
  constructor(override readonly name: string) {
    super(`A category called ${name} already exists`);
  }
}

function duplicateFrom(error: unknown, name: string): unknown {
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (code === '23505' && constraint === 'fee_category_name_uq') {
    return new DuplicateCategoryError(name);
  }
  return error;
}

export async function createCategory(
  organizationId: string,
  name: string,
  sortOrder: number,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        `INSERT INTO fee_category (organization_id, name, sort_order)
         VALUES ($1, $2, $3) RETURNING id`,
        [organizationId, name, sortOrder],
      ));
    } catch (error) {
      throw duplicateFrom(error, name);
    }

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not create the category');

    await recordAudit(tx, {
      action: 'fee_category.created',
      entityType: 'fee_category',
      entityId: id,
      data: { name },
    });
    return id;
  });
}

export async function renameCategory(
  organizationId: string,
  categoryId: string,
  name: string,
  sortOrder: number,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        `UPDATE fee_category SET name = $2, sort_order = $3
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [categoryId, name, sortOrder],
      ));
    } catch (error) {
      throw duplicateFrom(error, name);
    }
    if (rows[0] === undefined) return false;

    /*
     * Renaming does not re-point anything, and it does not need to.
     *
     * A turma and an enrolment hold the category's *id*, so correcting
     * "Senior" to "Sénior" reaches every one of them without touching a row —
     * which is the whole reason this is a reference rather than a word copied
     * onto each enrolment.
     */
    await recordAudit(tx, {
      action: 'fee_category.renamed',
      entityType: 'fee_category',
      entityId: categoryId,
      data: { name },
    });
    return true;
  });
}

/** Raised when turmas or enrolments still name the category. */
export class CategoryInUseError extends Error {
  constructor(readonly groups: number, readonly enrollments: number) {
    super(`${groups} turmas and ${enrollments} enrolments still use this category`);
  }
}

export async function archiveCategory(
  organizationId: string,
  categoryId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    /*
     * A category something still names is not filed away by accident.
     *
     * Archiving it would leave turmas pointing at a category no list shows,
     * which reads on a screen as a concession that came from nowhere — and the
     * pricing engine that arrives later would find a reference it cannot
     * resolve. Refused with both numbers, so the operator knows the size of what
     * they are about to undo rather than only that they may not.
     */
    const { rows: used } = await tx.query<{ groups: number; enrollments: number }>(
      `SELECT (SELECT count(*)::int FROM class_group cg
                WHERE cg.fee_category_id = $1 AND cg.archived_at IS NULL) AS groups,
              (SELECT count(*)::int FROM enrollment e
                WHERE e.fee_category_id = $1 AND e.ended_on IS NULL) AS enrollments`,
      [categoryId],
    );
    const groups = used[0]?.groups ?? 0;
    const enrollments = used[0]?.enrollments ?? 0;
    if (groups > 0 || enrollments > 0) throw new CategoryInUseError(groups, enrollments);

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE fee_category SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [categoryId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'fee_category.archived',
      entityType: 'fee_category',
      entityId: categoryId,
    });
    return true;
  });
}

/**
 * Which category applies to one enrolment — its own, else its turma's, else none.
 *
 * Answered by `enrolment_fee_category` in SQL rather than by a `coalesce`
 * written here, so the pricing engine that reads this next cannot spell the
 * precedence differently. Null is "the club has said nothing", which is not a
 * category called "normal" and must never become one.
 */
export async function categoryForEnrollment(
  organizationId: string,
  enrollmentId: string,
): Promise<{ id: string; name: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT c.id, c.name
         FROM fee_category c
        WHERE c.id = enrolment_fee_category($1, $2)`,
      [organizationId, enrollmentId],
    );
    return rows[0] ?? null;
  });
}

/*
 * There is deliberately no `setGroupCategory` here.
 *
 * A turma's category is part of `ClassGroupInput` and is written by the form
 * that owns every other fact about the turma. A function here would be a second
 * write path for one field, and two write paths are how two screens end up
 * disagreeing about what was saved.
 */

/**
 * Set or clear one person's own category, which beats their turma's.
 *
 * Null here does **not** mean "no category" — it means "whatever the turma
 * says", which is the useful thing to be able to go back to. A club that wants
 * somebody genuinely outside every concession takes the category off the turma
 * or moves them.
 */
export async function setEnrollmentCategory(
  organizationId: string,
  enrollmentId: string,
  categoryId: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE enrollment SET fee_category_id = $2
        WHERE id = $1 AND ended_on IS NULL
      RETURNING id`,
      [enrollmentId, categoryId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'enrollment.fee_category_set',
      entityType: 'enrollment',
      entityId: enrollmentId,
      data: { categoryId },
    });
    return true;
  });
}
