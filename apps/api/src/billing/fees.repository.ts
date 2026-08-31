import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * What a student pays — POOLSE-42.
 *
 * **Every total in here is computed by Postgres, never by TypeScript.**
 * `fee_total_cents` is the single definition the ticket asks for (AC7), and
 * `fee_payable_cents` wraps it for a line's own negotiated discount. Doing the
 * arithmetic here as well would be a second definition that agrees right up to
 * the first rounding case nobody thought about — which is precisely the cent
 * that turns into a telephone call from a parent.
 *
 * The other rule worth stating: creating a line **snapshots** the plan's amount
 * and the period's discount. Nothing here ever recomputes a live line from the
 * price list. Editing prices must not rewrite an agreement somebody already
 * made, and a query that joined its way to the current amount would do exactly
 * that, silently, for every family at once.
 */

export interface FeePeriod {
  id: string;
  name: string;
  months: number;
  discountPercent: number;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * Which members a quota is for — round 5.
 *
 * `any` is a club with one rate, and stays the default. A banded row beats `any`
 * when both exist, which is what makes adding a child rate to a list that
 * already has an unbanded quota safe: nothing has to be edited or deleted first.
 */
export type FeeAgeBand = 'any' | 'under_18' | 'adult';

/** How a late payment is charged. `none` is most clubs, and the default. */
export type FeePenaltyKind = 'none' | 'amount' | 'percent';

export interface FeePlan {
  id: string;
  kind: 'mensalidade' | 'quota';
  /**
   * What this price is for. A mensalidade always has both; a quota has neither.
   *
   * There is no name: the ladder already says what a level is called, and a
   * second label beside it would be a second thing to keep in step.
   */
  levelId: string | null;
  levelName: string | null;
  lessonsPerWeek: number | null;
  amountCents: number;
  defaultFeePeriodId: string | null;
  /** Quotas only. A mensalidade is banded by its level, which says it better. */
  ageBand: FeeAgeBand;
  /**
   * The turmas this price governs, matched by level and weekly sessions.
   *
   * Empty on a quota, and on a mensalidade nothing is timetabled for yet — a
   * price with no turmas is usually a frequency the club stopped running.
   */
  classGroups: { id: string; name: string }[];
}

export interface StudentFeeLine {
  id: string;
  facilityId: string;
  facilityName: string;
  planId: string;
  /** Composed from the level and the frequency by the client — see `levelName`. */
  levelName: string | null;
  lessonsPerWeek: number | null;
  kind: 'mensalidade' | 'quota';
  enrollmentId: string | null;
  classGroupName: string | null;
  periodId: string;
  periodName: string;
  months: number;
  /** The agreed amount, per month. Never the plan's current one. */
  amountCents: number;
  discountPercent: number;
  manualDiscountPercent: number | null;
  manualDiscountCents: number | null;
  discountReason: string | null;
  /** Amount x months, with the period discount, rounded once. From SQL. */
  periodTotalCents: number;
  /** The same with this line's manual discount taken off. From SQL. */
  payableCents: number;
  startsOn: string;
  endsOn: string | null;
  /**
   * The occurrence this line is currently being asked to pay, and whether it is
   * settled. Null on an ended line — an ended line is not asking for anything.
   *
   * An *occurrence*, not a calendar month: a trimestral line has four a year.
   * Computed in SQL by `current_period_start` so the same walk is not written
   * twice, differently.
   */
  currentPeriodStart: string | null;
  dueOn: string | null;
  isPaid: boolean;
  paidOn: string | null;
  /** Past its due date and unsettled. What the list column and the penalty read. */
  isOverdue: boolean;
  /**
   * What the plan costs *today*, when that differs from the snapshot — AC5.
   *
   * Null when they agree, so the interface has nothing to decide: a value here
   * means "show the marker and offer to update", and that is the whole rule.
   */
  planAmountCentsNow: number | null;
  /**
   * True when a quota line is on the wrong side of eighteen — round 5.
   *
   * The band is read from the student's age *today*, so this appears on the
   * period after a birthday. The line keeps its agreed amount either way: the
   * snapshot rule does not bend for a birthday, and applying the adult rate is
   * the same one-click decision as applying any other price change.
   */
  bandChanged: boolean;
}

/**
 * The plan a student's classes imply — POOLSE-42, third pass.
 *
 * Not something anybody picks. A student in Iniciação twice a week is on the
 * Iniciação-twice-a-week price, and asking an operator to choose it from a list
 * was asking them to restate what the timetable already says.
 *
 * One entry per site and level they attend, because a child at two levels is on
 * two prices and a single answer would have to pick one.
 */
export interface CurrentPlan {
  facilityId: string;
  facilityName: string;
  levelId: string | null;
  levelName: string | null;
  /** Their weekly sessions at this level, counted from the turmas' schedules. */
  lessonsPerWeek: number;
  /** The matching price, or null when the site prices no such combination. */
  planId: string | null;
  amountCents: number | null;
  /** The periodicity that price prefers, so the screen need not guess one. */
  defaultFeePeriodId: string | null;
  /** Whether a fee line already exists for it — what tells the screen to offer one. */
  hasLine: boolean;
}

export interface StudentFees {
  currentPlans: CurrentPlan[];
  lines: StudentFeeLine[];
  socio: { isSocio: boolean; socioNumber: string | null; socioSince: string | null };
  /**
   * What being late costs, split by what is late — round 5.
   *
   * One penalty per kind of charge, not one per line: a student late on three
   * mensalidades pays one mensalidade penalty, and the quota is a separate
   * decision the club may not charge for at all.
   *
   * Shown and added to what is outstanding; nothing writes it as a charge. An
   * automatic fee with nobody's name against it has to be defensible at a
   * counter, and there is no invoice to attach it to yet.
   */
  penalties: { mensalidadeCents: number; quotaCents: number };
  /** The two above, summed — what the outstanding line adds. */
  penaltyCents: number;
}

const PERIOD_COLUMNS = `
  id, name, months, discount_percent, is_default, sort_order`;

function toPeriod(row: {
  id: string;
  name: string;
  months: number;
  discount_percent: string;
  is_default: boolean;
  sort_order: number;
}): FeePeriod {
  return {
    id: row.id,
    name: row.name,
    months: row.months,
    // `numeric` arrives as a string from pg — it is arbitrary precision and the
    // driver refuses to lose digits for us. A rate this small is safe as a
    // number; an amount would not be, which is why amounts are integers.
    discountPercent: Number(row.discount_percent),
    isDefault: row.is_default,
    sortOrder: row.sort_order,
  };
}

export async function listFeePeriods(
  organizationId: string,
  facilityId: string,
): Promise<FeePeriod[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<never>(
      `SELECT ${PERIOD_COLUMNS}
         FROM fee_period
        WHERE facility_id = $1 AND archived_at IS NULL
        ORDER BY sort_order, months`,
      [facilityId],
    );
    return rows.map((row) => toPeriod(row as never));
  });
}

export interface FeePeriodInput {
  name: string;
  months: number;
  discountPercent: number;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * Exactly one default periodicity per facility.
 *
 * Cleared first, in the same transaction, because the partial unique index
 * refuses a second one — and the operator's intent when they tick "default" is
 * that this one becomes it, not that the save fails.
 */
async function clearOtherDefaults(
  tx: Tx,
  facilityId: string,
  exceptId: string | null,
): Promise<void> {
  await tx.query(
    `UPDATE fee_period SET is_default = false
      WHERE facility_id = $1 AND archived_at IS NULL AND is_default
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [facilityId, exceptId],
  );
}

export async function createFeePeriod(
  organizationId: string,
  facilityId: string,
  input: FeePeriodInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    if (input.isDefault) await clearOtherDefaults(tx, facilityId, null);

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO fee_period (organization_id, facility_id, name, months,
                               discount_percent, is_default, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        organizationId,
        facilityId,
        input.name,
        input.months,
        input.discountPercent,
        input.isDefault,
        input.sortOrder,
      ],
    );

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not create the periodicity');

    await recordAudit(tx, {
      action: 'fee_period.created',
      entityType: 'fee_period',
      entityId: id,
      data: { name: input.name, months: input.months },
    });
    return id;
  });
}

export async function updateFeePeriod(
  organizationId: string,
  facilityId: string,
  periodId: string,
  input: FeePeriodInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    if (input.isDefault) await clearOtherDefaults(tx, facilityId, periodId);

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE fee_period
          SET name = $3, months = $4, discount_percent = $5,
              is_default = $6, sort_order = $7
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL
      RETURNING id`,
      [
        facilityId,
        periodId,
        input.name,
        input.months,
        input.discountPercent,
        input.isDefault,
        input.sortOrder,
      ],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'fee_period.updated',
      entityType: 'fee_period',
      entityId: periodId,
      data: { name: input.name, months: input.months },
    });
    return true;
  });
}

/**
 * Archived, never deleted — the standing rule.
 *
 * Existing lines keep pointing at it: they snapshotted their discount and the
 * period is only there to say what it was called. Removing the row would break
 * a history the office still has to be able to read.
 */
export async function archiveFeePeriod(
  organizationId: string,
  facilityId: string,
  periodId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE fee_period SET archived_at = now(), is_default = false
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL
      RETURNING id`,
      [facilityId, periodId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'fee_period.archived',
      entityType: 'fee_period',
      entityId: periodId,
    });
    return true;
  });
}

export async function listFeePlans(
  organizationId: string,
  facilityId: string,
): Promise<FeePlan[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: 'mensalidade' | 'quota';
      level_id: string | null;
      level_name: string | null;
      lessons_per_week: number | null;
      amount_cents: number;
      default_fee_period_id: string | null;
      age_band: FeeAgeBand;
      class_groups: { id: string; name: string }[];
    }>(
      `SELECT p.id, p.kind, p.level_id, l.name AS level_name, p.lessons_per_week,
              p.amount_cents, p.default_fee_period_id, p.age_band,
              /*
               * Which turmas this price actually governs.
               *
               * Counted from the timetable, the same way the student's own plan
               * is: a price for "Iniciação, 2x/semana" applies to every turma at
               * that level with two sessions a week, and nothing links them but
               * that. Shown on the list so an operator editing a number can see
               * whose fee it moves.
               */
              coalesce(g.groups, '[]'::json) AS class_groups
         FROM fee_plan p
         LEFT JOIN student_level l
                ON l.id = p.level_id AND l.organization_id = p.organization_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('id', cg.id, 'name', cg.name)
                           ORDER BY cg.name) AS groups
             FROM class_group cg
            WHERE p.kind = 'mensalidade'
              AND cg.facility_id = p.facility_id AND cg.archived_at IS NULL
              AND cg.level_id IS NOT DISTINCT FROM p.level_id
              AND (SELECT count(*) FROM class_schedule cs
                    WHERE cs.class_group_id = cg.id AND cs.archived_at IS NULL)
                  = p.lessons_per_week
         ) g ON true
        WHERE p.facility_id = $1 AND p.archived_at IS NULL
        -- The club's own ladder order, then frequency: the price list reads the
        -- way the programme does rather than alphabetically.
        ORDER BY p.kind, l.sort_order NULLS FIRST, p.lessons_per_week`,
      [facilityId],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      levelId: row.level_id,
      levelName: row.level_name,
      lessonsPerWeek: row.lessons_per_week,
      amountCents: row.amount_cents,
      defaultFeePeriodId: row.default_fee_period_id,
      ageBand: row.age_band,
      classGroups: row.class_groups,
    }));
  });
}

export interface FeePlanInput {
  kind: 'mensalidade' | 'quota';
  levelId: string | null;
  lessonsPerWeek: number | null;
  amountCents: number;
  defaultFeePeriodId: string | null;
  ageBand: FeeAgeBand;
}

export async function createFeePlan(
  organizationId: string,
  facilityId: string,
  input: FeePlanInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id,
                             lessons_per_week, amount_cents, default_fee_period_id,
                             age_band)
       VALUES ($1, $2, $3::fee_plan_kind, $4, $5, $6, $7, $8::fee_age_band) RETURNING id`,
      [
        organizationId,
        facilityId,
        input.kind,
        input.levelId,
        input.lessonsPerWeek,
        input.amountCents,
        input.defaultFeePeriodId,
        input.ageBand,
      ],
    );

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not create the plan');

    await recordAudit(tx, {
      action: 'fee_plan.created',
      entityType: 'fee_plan',
      entityId: id,
      data: {
        kind: input.kind,
        levelId: input.levelId,
        lessonsPerWeek: input.lessonsPerWeek,
        amountCents: input.amountCents,
      },
    });
    return id;
  });
}

export async function updateFeePlan(
  organizationId: string,
  facilityId: string,
  planId: string,
  input: FeePlanInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE fee_plan
          SET kind = $3::fee_plan_kind, level_id = $4, lessons_per_week = $5,
              amount_cents = $6, default_fee_period_id = $7, age_band = $8::fee_age_band
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL
      RETURNING id`,
      [
        facilityId,
        planId,
        input.kind,
        input.levelId,
        input.lessonsPerWeek,
        input.amountCents,
        input.defaultFeePeriodId,
        input.ageBand,
      ],
    );
    if (rows[0] === undefined) return false;

    /*
     * Nothing here touches `student_fee`.
     *
     * That is the point of AC4, and the single most likely thing to be got wrong
     * in this ticket: a well-meaning "keep the students in step" update here
     * would rewrite every family's agreed price the moment somebody corrected a
     * typo. The lines carry their own amount and are updated one at a time, by a
     * person, from the marker on the student page.
     */
    await recordAudit(tx, {
      action: 'fee_plan.updated',
      entityType: 'fee_plan',
      entityId: planId,
      data: { levelId: input.levelId, amountCents: input.amountCents },
    });
    return true;
  });
}

export async function archiveFeePlan(
  organizationId: string,
  facilityId: string,
  planId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE fee_plan SET archived_at = now()
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL
      RETURNING id`,
      [facilityId, planId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'fee_plan.archived',
      entityType: 'fee_plan',
      entityId: planId,
    });
    return true;
  });
}

/**
 * Everything one student pays, and whether they are a sócio.
 *
 * Grouped by facility on the client, ordered by facility here — a student
 * enrolled at two sites has lines from two price lists, and reading them
 * interleaved tells nobody which agreement is which.
 *
 * Ended lines are included. "What were we charging in March" is a question the
 * office gets, and a line that vanished when the enrolment ended cannot answer
 * it.
 */
export async function studentFees(
  organizationId: string,
  studentId: string,
): Promise<StudentFees> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      facility_id: string;
      facility_name: string;
      plan_id: string;
      level_name: string | null;
      lessons_per_week: number | null;
      kind: 'mensalidade' | 'quota';
      enrollment_id: string | null;
      class_group_name: string | null;
      period_id: string;
      period_name: string;
      months: number;
      amount_cents: number;
      discount_percent: string;
      manual_discount_percent: string | null;
      manual_discount_cents: number | null;
      discount_reason: string | null;
      period_total_cents: number;
      payable_cents: number;
      starts_on: string;
      ends_on: string | null;
      current_period_start: string | null;
      due_on: string | null;
      is_paid: boolean;
      paid_on: string | null;
      is_overdue: boolean;
      plan_amount_cents_now: number | null;
      band_changed: boolean;
    }>(
      `SELECT sf.id,
              f.id AS facility_id, f.name AS facility_name,
              p.id AS plan_id, l.name AS level_name, p.lessons_per_week, p.kind,
              sf.enrollment_id, cg.name AS class_group_name,
              fp.id AS period_id, fp.name AS period_name, fp.months,
              sf.amount_cents, sf.discount_percent,
              sf.manual_discount_percent, sf.manual_discount_cents, sf.discount_reason,
              -- The one definition, in SQL. QA 42.3.
              fee_total_cents(sf.amount_cents, fp.months, sf.discount_percent)
                AS period_total_cents,
              fee_payable_cents(sf.amount_cents, fp.months, sf.discount_percent,
                                sf.manual_discount_percent, sf.manual_discount_cents)
                AS payable_cents,
              to_char(sf.starts_on, 'YYYY-MM-DD') AS starts_on,
              to_char(sf.ends_on, 'YYYY-MM-DD') AS ends_on,
              to_char(cur.period_start, 'YYYY-MM-DD') AS current_period_start,
              to_char(fee_due_on(cur.period_start, f.payment_due_day), 'YYYY-MM-DD') AS due_on,
              (pay.id IS NOT NULL) AS is_paid,
              to_char(pay.paid_on, 'YYYY-MM-DD') AS paid_on,
              -- Overdue is a fact about today, so it is decided here rather than
              -- on the client, where a stale page would age into a wrong answer.
              (pay.id IS NULL
               AND cur.period_start IS NOT NULL
               AND fee_due_on(cur.period_start, f.payment_due_day) < current_date) AS is_overdue,
              -- Only when it differs. Null is "no marker", decided here so the
              -- interface has no rule of its own to get wrong — AC5.
              --
              -- For a quota the comparison is against the price that applies to
              -- this student *today*, which after their eighteenth birthday is a
              -- different row of the list rather than a different number in the
              -- same one.
              CASE WHEN coalesce(band.amount_cents, p.amount_cents) <> sf.amount_cents
                   THEN coalesce(band.amount_cents, p.amount_cents) END
                AS plan_amount_cents_now,
              (band.id IS NOT NULL AND band.id <> p.id) AS band_changed
         FROM student_fee sf
         JOIN fee_plan p ON p.id = sf.fee_plan_id
         JOIN fee_period fp ON fp.id = sf.fee_period_id
         JOIN facility f ON f.id = p.facility_id
         LEFT JOIN student_level l
                ON l.id = p.level_id AND l.organization_id = p.organization_id
         LEFT JOIN enrollment e ON e.id = sf.enrollment_id
         LEFT JOIN class_group cg ON cg.id = e.class_group_id
         LEFT JOIN LATERAL (
           SELECT current_period_start(sf.starts_on, sf.ends_on, fp.months) AS period_start
         ) cur ON true
         LEFT JOIN student_fee_payment pay
                ON pay.student_fee_id = sf.id AND pay.period_start = cur.period_start
         JOIN student st ON st.id = sf.student_id
         /*
          * The quota that applies to this student today.
          *
          * A banded row beats an unbanded one (false sorts first), so a club
          * that adds a child rate beside its existing quota gets the child rate
          * for children and the old row for everybody else, with nothing to
          * migrate.
          */
         LEFT JOIN LATERAL (
           SELECT q.id, q.amount_cents
             FROM fee_plan q
            WHERE p.kind = 'quota' AND q.kind = 'quota' AND q.archived_at IS NULL
              AND q.facility_id = p.facility_id
              AND q.age_band IN ('any', quota_band_for(st.birth_date))
            ORDER BY (q.age_band = 'any'), q.id
            LIMIT 1
         ) band ON true
        WHERE sf.student_id = $1 AND sf.archived_at IS NULL
        ORDER BY f.name, p.kind, l.sort_order NULLS FIRST, sf.starts_on, sf.id`,
      [studentId],
    );

    const { rows: socioRows } = await tx.query<{
      is_socio: boolean;
      socio_number: string | null;
      socio_since: string | null;
    }>(
      `SELECT is_socio, socio_number, to_char(socio_since, 'YYYY-MM-DD') AS socio_since
         FROM student WHERE id = $1 AND archived_at IS NULL`,
      [studentId],
    );

    /*
     * The penalty is a property of the site the overdue line belongs to, and it
     * is charged once however many lines are late. Taking the largest keeps a
     * student overdue at two sites from being quietly forgiven the bigger one.
     */
    const { rows: penaltyRows } = await tx.query<{ mensalidade: number; quota: number }>(
      /*
       * The base a percentage is taken of: what this student pays a month in
       * mensalidades, whatever they are late on. By decision — it is the figure
       * a family recognises, and a percentage of a quota nobody disputes would
       * be a number nobody could check.
       *
       * A member who pays only a quota therefore has a base of zero, so a
       * percentage penalty comes to nothing. That is said on the facility form
       * rather than worked around here.
       */
      `WITH base AS (
         SELECT coalesce(sum(round(
                  fee_payable_cents(sf.amount_cents, fp.months, sf.discount_percent,
                                    sf.manual_discount_percent, sf.manual_discount_cents)::numeric
                  / fp.months)), 0)::int AS monthly
           FROM student_fee sf
           JOIN fee_plan p ON p.id = sf.fee_plan_id
           JOIN fee_period fp ON fp.id = sf.fee_period_id
          WHERE sf.student_id = $1 AND sf.archived_at IS NULL AND sf.ends_on IS NULL
            AND p.kind = 'mensalidade'
       ),
       late AS (
         SELECT p.kind, f.late_penalty_kind, f.late_penalty_cents, f.late_penalty_percent,
                f.quota_penalty_kind, f.quota_penalty_cents, f.quota_penalty_percent
           FROM student_fee sf
           JOIN fee_plan p ON p.id = sf.fee_plan_id
           JOIN fee_period fp ON fp.id = sf.fee_period_id
           JOIN facility f ON f.id = p.facility_id
           CROSS JOIN LATERAL (
             SELECT current_period_start(sf.starts_on, sf.ends_on, fp.months) AS period_start
           ) cur
           LEFT JOIN student_fee_payment pay
                  ON pay.student_fee_id = sf.id AND pay.period_start = cur.period_start
          WHERE sf.student_id = $1 AND sf.archived_at IS NULL
            AND pay.id IS NULL AND cur.period_start IS NOT NULL
            AND fee_due_on(cur.period_start, f.payment_due_day) < current_date
       )
       /*
        * The largest of each kind, so a student late at two sites is not quietly
        * forgiven the bigger penalty — and still pays one of each, not one per
        * late line.
        */
       SELECT coalesce(max(CASE WHEN late.kind = 'mensalidade'
                THEN fee_penalty_cents(late.late_penalty_kind, late.late_penalty_cents,
                                       late.late_penalty_percent, base.monthly) END), 0)
                AS mensalidade,
              coalesce(max(CASE WHEN late.kind = 'quota'
                THEN fee_penalty_cents(late.quota_penalty_kind, late.quota_penalty_cents,
                                       late.quota_penalty_percent, base.monthly) END), 0)
                AS quota
         FROM late CROSS JOIN base`,
      [studentId],
    );

    const penalties = {
      mensalidadeCents: penaltyRows[0]?.mensalidade ?? 0,
      quotaCents: penaltyRows[0]?.quota ?? 0,
    };

    /*
     * What their classes add up to, per site and level.
     *
     * Counted from `class_schedule` rather than from anything stored, so it
     * cannot drift from the timetable — the same rule the turma's own price
     * display follows.
     */
    const { rows: planRows } = await tx.query<{
      facility_id: string;
      facility_name: string;
      level_id: string | null;
      level_name: string | null;
      lessons_per_week: number;
      plan_id: string | null;
      amount_cents: number | null;
      default_fee_period_id: string | null;
      has_line: boolean;
    }>(
      `WITH attending AS (
         SELECT cg.facility_id, cg.level_id,
                sum((
                  SELECT count(*) FROM class_schedule cs
                   WHERE cs.class_group_id = cg.id AND cs.archived_at IS NULL
                ))::int AS lessons_per_week
           FROM enrollment e
           JOIN class_group cg ON cg.id = e.class_group_id
          WHERE e.student_id = $1 AND e.status = 'active' AND cg.archived_at IS NULL
          GROUP BY cg.facility_id, cg.level_id
       )
       SELECT a.facility_id, f.name AS facility_name,
              a.level_id, l.name AS level_name, a.lessons_per_week,
              p.id AS plan_id, p.amount_cents, p.default_fee_period_id,
              EXISTS (
                SELECT 1 FROM student_fee sf
                 WHERE sf.student_id = $1 AND sf.archived_at IS NULL
                   AND sf.ends_on IS NULL AND sf.fee_plan_id = p.id
              ) AS has_line
         FROM attending a
         JOIN facility f ON f.id = a.facility_id
         LEFT JOIN student_level l ON l.id = a.level_id
         LEFT JOIN fee_plan p
                ON p.facility_id = a.facility_id
               AND p.kind = 'mensalidade'
               AND p.archived_at IS NULL
               AND p.level_id = a.level_id
               AND p.lessons_per_week = a.lessons_per_week
        ORDER BY f.name, l.sort_order NULLS FIRST`,
      [studentId],
    );

    return {
      currentPlans: planRows.map((row) => ({
        facilityId: row.facility_id,
        facilityName: row.facility_name,
        levelId: row.level_id,
        levelName: row.level_name,
        lessonsPerWeek: row.lessons_per_week,
        planId: row.plan_id,
        amountCents: row.amount_cents,
        defaultFeePeriodId: row.default_fee_period_id,
        hasLine: row.has_line,
      })),
      penalties,
      penaltyCents: penalties.mensalidadeCents + penalties.quotaCents,
      lines: rows.map((row) => ({
        id: row.id,
        facilityId: row.facility_id,
        facilityName: row.facility_name,
        planId: row.plan_id,
        levelName: row.level_name,
        lessonsPerWeek: row.lessons_per_week,
        kind: row.kind,
        enrollmentId: row.enrollment_id,
        classGroupName: row.class_group_name,
        periodId: row.period_id,
        periodName: row.period_name,
        months: row.months,
        amountCents: row.amount_cents,
        discountPercent: Number(row.discount_percent),
        manualDiscountPercent:
          row.manual_discount_percent === null ? null : Number(row.manual_discount_percent),
        manualDiscountCents: row.manual_discount_cents,
        discountReason: row.discount_reason,
        periodTotalCents: row.period_total_cents,
        payableCents: row.payable_cents,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        currentPeriodStart: row.current_period_start,
        dueOn: row.due_on,
        isPaid: row.is_paid,
        paidOn: row.paid_on,
        isOverdue: row.is_overdue,
        planAmountCentsNow: row.plan_amount_cents_now,
        bandChanged: row.band_changed,
      })),
      socio: {
        isSocio: socioRows[0]?.is_socio ?? false,
        socioNumber: socioRows[0]?.socio_number ?? null,
        socioSince: socioRows[0]?.socio_since ?? null,
      },
    };
  });
}

export interface StudentFeeInput {
  feePlanId: string;
  feePeriodId: string;
  enrollmentId: string | null;
  manualDiscountPercent: number | null;
  manualDiscountCents: number | null;
  discountReason: string | null;
  startsOn: string | null;
}

export type FeeOutcome = 'created' | 'not_found';

/**
 * Assigning a fee — the snapshot happens here, and only here.
 *
 * The amount and the discount are read from the plan and the period *in the same
 * statement that writes the line*, rather than passed in by the caller. A client
 * that sent its own numbers could agree a price the club never offered, and a
 * two-step read-then-write could snapshot a price that changed in between.
 */
export async function createStudentFee(
  organizationId: string,
  studentId: string,
  input: StudentFeeInput,
): Promise<FeeOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, enrollment_id,
                                fee_period_id, amount_cents, discount_percent,
                                manual_discount_percent, manual_discount_cents,
                                discount_reason, starts_on)
       SELECT $1, $2, p.id, $4, fp.id, p.amount_cents, fp.discount_percent,
              $5, $6, $7, coalesce($8::date, current_date)
         FROM fee_plan p
         JOIN fee_period fp ON fp.id = $9 AND fp.archived_at IS NULL
        WHERE p.id = $3 AND p.archived_at IS NULL
          -- The plan and the period belong to the same site, or the line would
          -- pair one club's price with another site's frequency.
          AND fp.facility_id = p.facility_id
       RETURNING id`,
      [
        organizationId,
        studentId,
        input.feePlanId,
        input.enrollmentId,
        input.manualDiscountPercent,
        input.manualDiscountCents,
        input.discountReason,
        input.startsOn,
        input.feePeriodId,
      ],
    );

    const id = rows[0]?.id;
    if (id === undefined) return 'not_found';

    await recordAudit(tx, {
      action: 'student_fee.created',
      entityType: 'student_fee',
      entityId: id,
      data: { studentId, feePlanId: input.feePlanId, feePeriodId: input.feePeriodId },
    });
    return 'created';
  });
}

export interface StudentFeeChanges {
  feePeriodId: string;
  manualDiscountPercent: number | null;
  manualDiscountCents: number | null;
  discountReason: string | null;
  endsOn: string | null;
}

export async function updateStudentFee(
  organizationId: string,
  studentId: string,
  feeId: string,
  changes: StudentFeeChanges,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    /*
     * Changing the period changes the *discount* the line agreed to, because the
     * discount is a property of the frequency. The amount is not touched: that
     * is the price agreed with this family and it survives everything except the
     * explicit "update to the current price" action below.
     */
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student_fee sf
          SET fee_period_id = fp.id,
              discount_percent = fp.discount_percent,
              manual_discount_percent = $4,
              manual_discount_cents = $5,
              discount_reason = $6,
              ends_on = $7::date
         FROM fee_period fp
        WHERE sf.id = $2 AND sf.student_id = $1 AND sf.archived_at IS NULL
          AND fp.id = $3 AND fp.archived_at IS NULL
      RETURNING sf.id`,
      [
        studentId,
        feeId,
        changes.feePeriodId,
        changes.manualDiscountPercent,
        changes.manualDiscountCents,
        changes.discountReason,
        changes.endsOn,
      ],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'student_fee.updated',
      entityType: 'student_fee',
      entityId: feeId,
      data: { studentId, feePeriodId: changes.feePeriodId },
    });
    return true;
  });
}

/**
 * "Atualizar para o preço atual" — AC5, one line at a time.
 *
 * Deliberately per line and never in bulk. Re-pricing every student at once is a
 * decision with a letter to parents attached to it, not a button; the ticket
 * puts bulk re-pricing out of scope and this is where that line is drawn.
 */
export async function repriceStudentFee(
  organizationId: string,
  studentId: string,
  feeId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    /*
     * A quota may move to a different row of the price list rather than to a
     * different number in the same one — the student turned eighteen. So the
     * plan is re-resolved here, not just its amount re-read; a mensalidade
     * resolves to the plan it already has, which is the old behaviour.
     */
    const { rows } = await tx.query<{ id: string; amount_cents: number }>(
      `WITH line AS (
         SELECT sf.id, sf.student_id, p.id AS plan_id, p.kind,
                p.facility_id, p.amount_cents
           FROM student_fee sf
           JOIN fee_plan p ON p.id = sf.fee_plan_id AND p.archived_at IS NULL
          WHERE sf.id = $2 AND sf.student_id = $1 AND sf.archived_at IS NULL
       ),
       want AS (
         SELECT line.id,
                coalesce(band.id, line.plan_id) AS plan_id,
                coalesce(band.amount_cents, line.amount_cents) AS amount_cents
           FROM line
           JOIN student st ON st.id = line.student_id
           LEFT JOIN LATERAL (
             SELECT q.id, q.amount_cents
               FROM fee_plan q
              WHERE line.kind = 'quota' AND q.kind = 'quota' AND q.archived_at IS NULL
                AND q.facility_id = line.facility_id
                AND q.age_band IN ('any', quota_band_for(st.birth_date))
              ORDER BY (q.age_band = 'any'), q.id
              LIMIT 1
           ) band ON true
       )
       UPDATE student_fee sf
          SET fee_plan_id = want.plan_id, amount_cents = want.amount_cents
         FROM want
        WHERE sf.id = want.id
      RETURNING sf.id, sf.amount_cents`,
      [studentId, feeId],
    );

    const row = rows[0];
    if (row === undefined) return false;

    await recordAudit(tx, {
      action: 'student_fee.repriced',
      entityType: 'student_fee',
      entityId: feeId,
      data: { studentId, amountCents: row.amount_cents },
    });
    return true;
  });
}

export async function archiveStudentFee(
  organizationId: string,
  studentId: string,
  feeId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student_fee SET archived_at = now()
        WHERE id = $2 AND student_id = $1 AND archived_at IS NULL
      RETURNING id`,
      [studentId, feeId],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'student_fee.archived',
      entityType: 'student_fee',
      entityId: feeId,
      data: { studentId },
    });
    return true;
  });
}

/**
 * Settling one occurrence — the whole of billing, for now.
 *
 * A row per occurrence rather than a flag on the line, so "paid" can say *which*
 * period it means. Absence is unpaid, so nothing has to write rows in advance or
 * tidy them up when a line ends.
 *
 * Marking is idempotent: ticking twice keeps one row and moves the date, because
 * two settlements of the same occurrence would double every total built from
 * them.
 */
export async function setOccurrencePaid(
  organizationId: string,
  studentId: string,
  feeId: string,
  periodStart: string,
  isPaid: boolean,
  paidOn: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    // Through the student, so a fee id from another child's record answers "no
    // such line" rather than quietly settling somebody else's month.
    const { rows: line } = await tx.query<{ id: string }>(
      `SELECT id FROM student_fee
        WHERE id = $2 AND student_id = $1 AND archived_at IS NULL`,
      [studentId, feeId],
    );
    if (line[0] === undefined) return false;

    if (isPaid) {
      await tx.query(
        `INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start,
                                          paid_on, recorded_by)
         VALUES ($1, $2, $3::date, coalesce($4::date, current_date), $5)
         ON CONFLICT (student_fee_id, period_start)
           DO UPDATE SET paid_on = EXCLUDED.paid_on, recorded_by = EXCLUDED.recorded_by`,
        [organizationId, feeId, periodStart, paidOn, currentTenant().membershipId],
      );
    } else {
      await tx.query(
        `DELETE FROM student_fee_payment
          WHERE student_fee_id = $1 AND period_start = $2::date`,
        [feeId, periodStart],
      );
    }

    await recordAudit(tx, {
      action: isPaid ? 'student_fee.paid' : 'student_fee.unpaid',
      entityType: 'student_fee',
      entityId: feeId,
      data: { studentId, periodStart, paidOn },
    });
    return true;
  });
}

/**
 * Everything a student currently owes, settled in one go.
 *
 * What the tick on the register means: "this family paid this month". A student
 * with a mensalidade and a quota has two lines and one payment, and asking the
 * office to open the record and tick twice is how it ends up in a spreadsheet.
 */
export async function setStudentPaid(
  organizationId: string,
  studentId: string,
  isPaid: boolean,
): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; period_start: string }>(
      `SELECT sf.id, to_char(cur.period_start, 'YYYY-MM-DD') AS period_start
         FROM student_fee sf
         JOIN fee_period fp ON fp.id = sf.fee_period_id
         CROSS JOIN LATERAL (
           SELECT current_period_start(sf.starts_on, sf.ends_on, fp.months) AS period_start
         ) cur
        WHERE sf.student_id = $1 AND sf.archived_at IS NULL
          AND cur.period_start IS NOT NULL`,
      [studentId],
    );

    for (const row of rows) {
      if (isPaid) {
        await tx.query(
          `INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start,
                                            recorded_by)
           VALUES ($1, $2, $3::date, $4)
           ON CONFLICT (student_fee_id, period_start) DO NOTHING`,
          [organizationId, row.id, row.period_start, currentTenant().membershipId],
        );
      } else {
        await tx.query(
          `DELETE FROM student_fee_payment
            WHERE student_fee_id = $1 AND period_start = $2::date`,
          [row.id, row.period_start],
        );
      }
    }

    if (rows.length > 0) {
      await recordAudit(tx, {
        action: isPaid ? 'student.paid' : 'student.unpaid',
        entityType: 'student',
        entityId: studentId,
        data: { lines: rows.length },
      });
    }
    return rows.length;
  });
}

/**
 * When a payment is due, and what being late costs — both per facility.
 *
 * On the facility rather than the organization because a club with two sites can
 * genuinely run them differently, and because everything else about how a site
 * charges already lives there.
 */
export interface BillingSettings {
  paymentDueDay: number;
  /** A late mensalidade: how it is charged, and both possible amounts. */
  latePenaltyKind: FeePenaltyKind;
  latePenaltyCents: number;
  latePenaltyPercent: number;
  /** A late quota, asked separately: a club may fine one and not the other. */
  quotaPenaltyKind: FeePenaltyKind;
  quotaPenaltyCents: number;
  quotaPenaltyPercent: number;
}

export async function billingSettings(
  organizationId: string,
  facilityId: string,
): Promise<BillingSettings | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      payment_due_day: number;
      late_penalty_kind: FeePenaltyKind;
      late_penalty_cents: number;
      late_penalty_percent: string;
      quota_penalty_kind: FeePenaltyKind;
      quota_penalty_cents: number;
      quota_penalty_percent: string;
    }>(
      `SELECT payment_due_day, late_penalty_kind, late_penalty_cents, late_penalty_percent,
              quota_penalty_kind, quota_penalty_cents, quota_penalty_percent
         FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      paymentDueDay: row.payment_due_day,
      latePenaltyKind: row.late_penalty_kind,
      latePenaltyCents: row.late_penalty_cents,
      // `numeric` arrives as a string, like every other rate here.
      latePenaltyPercent: Number(row.late_penalty_percent),
      quotaPenaltyKind: row.quota_penalty_kind,
      quotaPenaltyCents: row.quota_penalty_cents,
      quotaPenaltyPercent: Number(row.quota_penalty_percent),
    };
  });
}

export async function setBillingSettings(
  organizationId: string,
  facilityId: string,
  input: BillingSettings,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE facility
          SET payment_due_day = $2,
              late_penalty_kind = $3::fee_penalty_kind,
              late_penalty_cents = $4,
              late_penalty_percent = $5,
              quota_penalty_kind = $6::fee_penalty_kind,
              quota_penalty_cents = $7,
              quota_penalty_percent = $8
        WHERE id = $1 AND archived_at IS NULL RETURNING id`,
      [
        facilityId,
        input.paymentDueDay,
        input.latePenaltyKind,
        input.latePenaltyCents,
        input.latePenaltyPercent,
        input.quotaPenaltyKind,
        input.quotaPenaltyCents,
        input.quotaPenaltyPercent,
      ],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'facility.billing_changed',
      entityType: 'facility',
      entityId: facilityId,
      data: {
        paymentDueDay: input.paymentDueDay,
        latePenaltyKind: input.latePenaltyKind,
        latePenaltyCents: input.latePenaltyCents,
        latePenaltyPercent: input.latePenaltyPercent,
        quotaPenaltyKind: input.quotaPenaltyKind,
        quotaPenaltyCents: input.quotaPenaltyCents,
        quotaPenaltyPercent: input.quotaPenaltyPercent,
      },
    });
    return true;
  });
}

/** Raised when another student already holds that membership number. */
export class DuplicateSocioNumberError extends Error {}

export interface SocioInput {
  isSocio: boolean;
  socioNumber: string | null;
  socioSince: string | null;
}

/**
 * The membership itself, which is a fact about the person.
 *
 * Turning it off keeps the number and the date. Somebody who lapses and rejoins
 * is the same member, and throwing the number away would make the club invent a
 * new one — AC6's "related but not identical" cuts both ways.
 */
export interface SocioResult {
  updated: boolean;
  /** The quota line this attached, when it attached one. */
  quotaAdded: boolean;
  /**
   * True when the club has no quota plan to attach, or more than one site and no
   * way to tell which. The screen says so rather than silently doing nothing.
   */
  quotaUnavailable: boolean;
}

export async function setSocio(
  organizationId: string,
  studentId: string,
  input: SocioInput,
): Promise<SocioResult> {
  return withOrg(organizationId, async (tx) => {
    let rows: { id: string }[];
    try {
      // 23505 is student_socio_number_uq: a membership number identifies one
      // member, and two records holding it is the state that makes a payment
      // impossible to attribute.
      ({ rows } = await tx.query<{ id: string }>(
        `UPDATE student
            SET is_socio = $2,
                socio_number = $3,
                socio_since = $4::date
          WHERE id = $1 AND archived_at IS NULL
        RETURNING id`,
        [studentId, input.isSocio, input.socioNumber, input.socioSince],
      ));
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        throw new DuplicateSocioNumberError(input.socioNumber ?? '');
      }
      throw error;
    }
    if (rows[0] === undefined) {
      return { updated: false, quotaAdded: false, quotaUnavailable: false };
    }

    await recordAudit(tx, {
      action: 'student.socio_changed',
      entityType: 'student',
      entityId: studentId,
      data: { isSocio: input.isSocio, socioNumber: input.socioNumber },
    });

    /*
     * Becoming a sócio attaches the quota; it is not offered.
     *
     * POOLSE-42 AC8 had this as an offer the operator could decline. It is now
     * automatic, by decision — "if a student is sócio it should apply an extra
     * fee". AC6 still holds and is what makes that safe: the line is an ordinary
     * fee line, so a waived quota is the operator removing it afterwards while
     * the membership stays. Nothing here can un-represent an honorary member.
     *
     * Which site's quota: the one the student already pays at. Failing that, the
     * club's only site. A club with several sites and a student with no lines
     * yet gets nothing attached and is told why — guessing would put another
     * pool's price on their record.
     */
    if (!input.isSocio) return { updated: true, quotaAdded: false, quotaUnavailable: false };

    const { rows: existing } = await tx.query<{ id: string }>(
      `SELECT sf.id FROM student_fee sf
         JOIN fee_plan p ON p.id = sf.fee_plan_id
        WHERE sf.student_id = $1 AND sf.archived_at IS NULL AND sf.ends_on IS NULL
          AND p.kind = 'quota'`,
      [studentId],
    );
    // Already paying one. Turning the toggle on twice must not create a second.
    if (existing.length > 0) return { updated: true, quotaAdded: false, quotaUnavailable: false };

    const { rows: added } = await tx.query<{ id: string }>(
      `WITH site AS (
         SELECT coalesce(
           -- Where they already pay.
           (SELECT p.facility_id
              FROM student_fee sf JOIN fee_plan p ON p.id = sf.fee_plan_id
             WHERE sf.student_id = $2 AND sf.archived_at IS NULL AND sf.ends_on IS NULL
             ORDER BY sf.starts_on, sf.id LIMIT 1),
           -- Otherwise the club's site, but only when it has exactly one. A
           -- scalar subquery rather than a window function, which Postgres
           -- refuses in HAVING — and which said this less plainly anyway.
           (SELECT f.id FROM facility f
             WHERE f.archived_at IS NULL
               AND (SELECT count(*) FROM facility WHERE archived_at IS NULL) = 1)
         ) AS facility_id
       ),
       chosen AS (
         /*
          * The quota for this member's age today. A banded row beats an unbanded
          * one, so a club that charges children less gets the child rate without
          * anything else on the list having to change.
          */
         SELECT p.id AS plan_id, p.amount_cents,
                coalesce(p.default_fee_period_id, d.id) AS period_id
           FROM fee_plan p
           JOIN site ON site.facility_id = p.facility_id
           JOIN student s ON s.id = $2
           LEFT JOIN fee_period d
                  ON d.facility_id = p.facility_id AND d.archived_at IS NULL AND d.is_default
          WHERE p.kind = 'quota' AND p.archived_at IS NULL
            AND p.age_band IN ('any', quota_band_for(s.birth_date))
          ORDER BY (p.age_band = 'any'), p.id
          LIMIT 1
       )
       INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                                amount_cents, discount_percent)
       SELECT $1, $2, chosen.plan_id, fp.id, chosen.amount_cents, fp.discount_percent
         FROM chosen JOIN fee_period fp ON fp.id = chosen.period_id
       RETURNING id`,
      [organizationId, studentId],
    );

    const quotaId = added[0]?.id;
    if (quotaId !== undefined) {
      await recordAudit(tx, {
        action: 'student_fee.created',
        entityType: 'student_fee',
        entityId: quotaId,
        data: { studentId, reason: 'socio' },
      });
    }

    return {
      updated: true,
      quotaAdded: quotaId !== undefined,
      quotaUnavailable: quotaId === undefined,
    };
  });
}
