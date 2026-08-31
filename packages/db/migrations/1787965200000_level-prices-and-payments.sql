-- Up Migration
--
-- Prices by level and frequency, and payments that know which period they are
-- for — POOLSE-42, second pass.
--
-- Three changes, each undoing something the first pass got wrong in practice:
--
-- **A price is a level and a frequency, not a name.** The first pass made
-- `fee_plan.name` the identity and hung an optional level off it, on the
-- reasoning that "a level alone cannot express twice a week". True — so the
-- answer is to say twice a week, not to fall back to free text. A club's price
-- list is a grid of level × lessons-per-week, and naming each cell was asking
-- an operator to invent labels for something the ladder already names.
--
-- **A payment belongs to a period occurrence.** The first pass put `is_paid` on
-- the line, which cannot say *which* month was paid: ticked in March it still
-- reads paid in October, and "overdue" degenerates into "nobody has touched
-- this". A row per occurrence fixes that, and it is the shape real billing wants
-- anyway — one charge, one due date, one settlement.
--
-- **Occurrence, not calendar month.** A trimestral line has four occurrences a
-- year and a monthly one has twelve. Storing per calendar month would bill a
-- quarterly payer monthly, which is the arithmetic error this whole ticket has
-- been avoiding since `fee_total_cents`.

-- ---------------------------------------------------------------------------
-- A plan is a level and a frequency
-- ---------------------------------------------------------------------------

ALTER TABLE fee_plan
  /*
   * Lessons per week. Null for a quota, which has no frequency and no level.
   *
   * Bounded at seven: a club running eight sessions a week for one level has a
   * data-entry slip, not a timetable.
   */
  ADD COLUMN lessons_per_week smallint;

ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_lessons_sane
  CHECK (lessons_per_week IS NULL OR lessons_per_week BETWEEN 1 AND 7);

/*
 * A mensalidade is a level and a frequency; a quota is neither.
 *
 * Said as a CHECK rather than left to the application, because a mensalidade
 * with no level is a price nothing can ever match to a turma — it would sit on
 * the list looking real and never be offered.
 */
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_shape_matches_kind
  CHECK (
    (kind = 'mensalidade' AND level_id IS NOT NULL AND lessons_per_week IS NOT NULL)
    OR (kind = 'quota' AND level_id IS NULL AND lessons_per_week IS NULL)
  );

-- Existing rows predate the rule. There are none outside development, and any
-- there are cannot satisfy a NOT NULL that did not exist when they were written.
DELETE FROM student_fee WHERE fee_plan_id IN (SELECT id FROM fee_plan);
DELETE FROM fee_plan;

/*
 * The name goes.
 *
 * A price is now identified by what it is for — "Nível C1 Iniciação, 2x/semana"
 * — which the ladder already says. Keeping a name beside that would be a second
 * label to maintain and a second thing to disagree with the first.
 */
ALTER TABLE fee_plan DROP CONSTRAINT IF EXISTS fee_plan_name_not_blank;
DROP INDEX IF EXISTS fee_plan_name_uq;
ALTER TABLE fee_plan DROP COLUMN name;

COMMENT ON COLUMN fee_plan.lessons_per_week IS
  'How many sessions a week this price is for. Null on a quota. With level_id it '
  'is the plan''s identity, which is why fee_plan has no name.';

-- One price per level per frequency. Partial, per the standing rule.
CREATE UNIQUE INDEX fee_plan_level_frequency_uq
  ON fee_plan (organization_id, facility_id, level_id, lessons_per_week)
  WHERE archived_at IS NULL AND kind = 'mensalidade';

-- And one quota per site: "the quota" is a thing a club has, singular.
CREATE UNIQUE INDEX fee_plan_one_quota_uq
  ON fee_plan (organization_id, facility_id)
  WHERE archived_at IS NULL AND kind = 'quota';

-- ---------------------------------------------------------------------------
-- When a payment is late, and what that costs
-- ---------------------------------------------------------------------------

ALTER TABLE facility
  /*
   * The day of the month a payment is expected by.
   *
   * 1–31, and a day past the end of a short month means its last day — see
   * `fee_due_on`. Refusing 31 would be refusing a club that genuinely bills on
   * the last day, and clamping is what everybody means by it.
   */
  ADD COLUMN payment_due_day smallint NOT NULL DEFAULT 8,
  -- What a late payment costs, in cents. Zero is "no penalty", which is most
  -- clubs and so is the default.
  ADD COLUMN late_penalty_cents integer NOT NULL DEFAULT 0;

ALTER TABLE facility
  ADD CONSTRAINT facility_due_day_sane CHECK (payment_due_day BETWEEN 1 AND 31),
  ADD CONSTRAINT facility_penalty_sane CHECK (late_penalty_cents >= 0);

COMMENT ON COLUMN facility.payment_due_day IS
  'Day of the month a payment is due by. 29-31 mean the last day of a short month.';
COMMENT ON COLUMN facility.late_penalty_cents IS
  'Shown against an overdue payment and added to what is outstanding. Nothing '
  'writes a charge on its own — an automatic fee with nobody''s name on it has '
  'to be defensible at a counter, and there is no invoice to attach it to yet.';

/*
 * The date one occurrence is due.
 *
 * `least(day, days in that month)` is the clamp: a club billing on the 31st is
 * due on the 28th in February, which is what "the last day" means to them.
 * IMMUTABLE so it can be indexed or used in a generated column later.
 */
CREATE FUNCTION fee_due_on(p_period_start date, p_due_day smallint) RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', p_period_start)::date
         + (least(p_due_day, extract(day FROM (date_trunc('month', p_period_start)
                                               + interval '1 month - 1 day'))::int) - 1);
$$;

COMMENT ON FUNCTION fee_due_on(date, smallint) IS
  'The date an occurrence beginning in this month is due, clamping a due day past '
  'the end of a short month to its last day.';

-- ---------------------------------------------------------------------------
-- A payment, per period occurrence
-- ---------------------------------------------------------------------------

/*
 * Only settled occurrences are stored.
 *
 * The alternative — writing a row per occurrence in advance — needs a job that
 * generates them, a rule for how far ahead, and a decision about what happens to
 * unpaid rows when a line ends. Absence meaning "not paid" needs none of that,
 * and the set of occurrences is computable from the line's own dates whenever
 * anybody asks.
 */
CREATE TABLE student_fee_payment (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  student_fee_id  uuid NOT NULL,

  /*
   * The first day of the occurrence this settles.
   *
   * A monthly line's occurrences are the first of each month; a trimestral
   * line's are every three months from where the line started. Storing the start
   * rather than a month number keeps the two the same shape.
   */
  period_start    date NOT NULL,

  -- The date the money arrived, as the office knows it. Friday's payments get
  -- marked on Monday, and the record should say Friday.
  paid_on         date NOT NULL DEFAULT current_date,

  recorded_by     uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, student_fee_id)
    REFERENCES student_fee (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),

  -- One settlement per occurrence. Two would make "is this paid" have two
  -- answers and double any total built from them.
  UNIQUE (student_fee_id, period_start)
);

COMMENT ON TABLE student_fee_payment IS
  'One settled occurrence of a fee line. Absence means unpaid — no row is written '
  'in advance, so nothing has to generate or clean them up.';

CREATE TRIGGER student_fee_payment_updated_at BEFORE UPDATE ON student_fee_payment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX student_fee_payment_line_idx
  ON student_fee_payment (organization_id, student_fee_id, period_start DESC);

ALTER TABLE student_fee_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_fee_payment_tenant ON student_fee_payment
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON student_fee_payment TO poolse_app;

-- The flag it replaces. A boolean that could not say which month is worse than
-- nothing once a due date exists, so it goes rather than lingering as a second
-- answer to the same question.
ALTER TABLE student_fee DROP CONSTRAINT IF EXISTS student_fee_paid_date_needs_paid;
ALTER TABLE student_fee DROP COLUMN IF EXISTS is_paid;
ALTER TABLE student_fee DROP COLUMN IF EXISTS paid_on;

/*
 * The occurrence a line is currently being asked to pay.
 *
 * Walks forward from the line's start in steps of its own periodicity and stops
 * at the one containing today — so a monthly line lands on this month and a
 * trimestral line on whichever quarter today sits in. Null once the line has
 * ended, because an ended line is not asking for anything.
 */
CREATE FUNCTION current_period_start(
  p_starts_on date,
  p_ends_on   date,
  p_months    smallint
) RETURNS date
-- STABLE, not IMMUTABLE: it reads `current_date`, so its answer changes with the
-- day. Declaring it immutable would let the planner cache an answer across a
-- midnight and quietly bill yesterday's occurrence.
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_ends_on IS NOT NULL AND p_ends_on < current_date THEN NULL
    WHEN current_date < p_starts_on THEN p_starts_on
    ELSE (
      p_starts_on
      + (
          -- Whole periods elapsed since the line began, in months.
          floor(
            (extract(YEAR FROM age(current_date, p_starts_on)) * 12
             + extract(MONTH FROM age(current_date, p_starts_on)))::numeric / p_months
          )::int * p_months
        ) * interval '1 month'
    )::date
  END;
$$;

COMMENT ON FUNCTION current_period_start(date, date, smallint) IS
  'The occurrence a line is being asked to pay today. Null for an ended line.';

-- Down Migration

DROP FUNCTION IF EXISTS current_period_start(date, date, smallint);

ALTER TABLE student_fee
  ADD COLUMN is_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN paid_on date;
ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_paid_date_needs_paid CHECK (is_paid OR paid_on IS NULL);

DROP POLICY IF EXISTS student_fee_payment_tenant ON student_fee_payment;
DROP TABLE IF EXISTS student_fee_payment;

DROP FUNCTION IF EXISTS fee_due_on(date, smallint);

ALTER TABLE facility
  DROP CONSTRAINT IF EXISTS facility_penalty_sane,
  DROP CONSTRAINT IF EXISTS facility_due_day_sane;
ALTER TABLE facility
  DROP COLUMN IF EXISTS late_penalty_cents,
  DROP COLUMN IF EXISTS payment_due_day;

DROP INDEX IF EXISTS fee_plan_one_quota_uq;
DROP INDEX IF EXISTS fee_plan_level_frequency_uq;

/*
 * Symmetric with the Up, which cleared these for the same reason.
 *
 * A plan that lost its name cannot get one back: there is nothing to derive it
 * from that would not be invented. Rolling back therefore restores an empty
 * price list, exactly as rolling forward emptied it — and a rollback that
 * silently named every plan "" would fail the not-blank check anyway.
 */
-- The payments table is already gone by this point in the rollback; its rows
-- went with it.
DELETE FROM student_fee;
DELETE FROM fee_plan;

ALTER TABLE fee_plan ADD COLUMN name text NOT NULL DEFAULT '';
ALTER TABLE fee_plan ALTER COLUMN name DROP DEFAULT;
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_name_not_blank CHECK (btrim(name) <> '');
CREATE UNIQUE INDEX fee_plan_name_uq
  ON fee_plan (organization_id, facility_id, lower(name))
  WHERE archived_at IS NULL;

ALTER TABLE fee_plan
  DROP CONSTRAINT IF EXISTS fee_plan_shape_matches_kind,
  DROP CONSTRAINT IF EXISTS fee_plan_lessons_sane;
ALTER TABLE fee_plan DROP COLUMN IF EXISTS lessons_per_week;
