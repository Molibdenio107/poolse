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
 * **It carries what it is worth** — round 19, reversing POOLSE-23's "a
 * reference, never a percentage". Nothing consulted the reference, so the
 * concession was typed by hand onto every line with the word "sénior" in a
 * free-text box: forty authors for one decision, which is the failure the
 * original rule was written to prevent. The category is now the single author,
 * and `docs/decisions.md` carries the argument.
 *
 * **The value is read by the write, never by the reader.** A line snapshots the
 * figure when it is agreed; correcting a percentage here reaches every line
 * agreed *afterwards* and none agreed before, exactly as the price list does.
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
  /**
   * What it takes off — one or the other, and often neither.
   *
   * Both null is a category that is purely a label, which stays a legitimate
   * thing to want: a club may keep "Funcionário" to count them. Null is not
   * zero, and a screen must not print 0 % for it.
   *
   * Null for anybody who may not see the club's amounts, which is why the
   * endpoint sends `canSeeValues` beside them rather than leaving a reader to
   * read "no discount" off a blank.
   */
  discountPercent: number | null;
  discountCents: number | null;
  /** How many turmas and enrolments name it — what makes archiving a decision. */
  usedByGroups: number;
  usedByEnrollments: number;
}

/** The writable half. Fee lines already agreed are never touched by an edit. */
export interface FeeCategoryInput {
  name: string;
  sortOrder: number;
  discountPercent: number | null;
  discountCents: number | null;
}

export async function listCategories(organizationId: string): Promise<FeeCategory[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      sort_order: number;
      discount_percent: string | null;
      discount_cents: number | null;
      used_by_groups: number;
      used_by_enrollments: number;
    }>(
      `SELECT c.id, c.name, c.sort_order, c.discount_percent, c.discount_cents,
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
      // `numeric` arrives as a string from pg, which refuses to lose digits for
      // us. A rate this small is safe as a number; the amount beside it is an
      // integer already, for the reason every amount here is.
      discountPercent: row.discount_percent === null ? null : Number(row.discount_percent),
      discountCents: row.discount_cents,
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
  input: FeeCategoryInput,
): Promise<string> {
  const { name } = input;
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        `INSERT INTO fee_category (organization_id, name, sort_order,
                                   discount_percent, discount_cents)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [organizationId, name, input.sortOrder, input.discountPercent, input.discountCents],
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
      // The figure travels with it. A concession is a price the club decided,
      // and `audit_log` is where "who decided this" is answered — the rule that
      // keeps amounts out of the trail is the salaries one, and a person's pay
      // is not what this is.
      data: { name, discountPercent: input.discountPercent, discountCents: input.discountCents },
    });
    return id;
  });
}

export async function renameCategory(
  organizationId: string,
  categoryId: string,
  input: FeeCategoryInput,
): Promise<boolean> {
  const { name } = input;
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        `UPDATE fee_category SET name = $2, sort_order = $3,
                discount_percent = $4, discount_cents = $5
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [categoryId, name, input.sortOrder, input.discountPercent, input.discountCents],
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
     *
     * **Changing what it is worth does not re-price anything either**, and that
     * is the more important half now. Every line already agreed keeps the figure
     * it snapshotted; the new percentage applies to lines agreed from here on.
     * A club correcting a typo would otherwise rewrite what forty families were
     * told they owed — the failure `student_fee.amount_cents` is a snapshot to
     * prevent, arriving by a second door.
     */
    await recordAudit(tx, {
      action: 'fee_category.renamed',
      entityType: 'fee_category',
      entityId: categoryId,
      data: { name, discountPercent: input.discountPercent, discountCents: input.discountCents },
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
     * next fee agreed on one of those turmas would be discounted by something
     * the operator can no longer see. Refused with both numbers, so they know
     * the size of what they are about to undo rather than only that they may not.
     *
     * **Fee lines are deliberately not counted.** A line holds the figure it
     * snapshotted, not a live reference, so an old line naming an archived
     * category is history reading correctly — and counting them would make a
     * category unarchivable for ever the first time it was used.
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
