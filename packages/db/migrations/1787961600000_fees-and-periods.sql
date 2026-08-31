-- Up Migration
--
-- What a student pays — POOLSE-42.
--
-- The office cannot answer "what does this student pay?" without opening a
-- spreadsheet. This is the records half of billing: the facility holds the
-- agreement — a price list and the periodicities it offers — and the student
-- holds the lines that say which of those apply to them.
--
-- Charging is not here. No invoices, no numbering, no VAT computation, no
-- collection. Knowing who owes what is most of the value and all of the risk;
-- taking the money is an optimisation on top of a record that already exists.
--
-- Four decisions worth not re-deriving:
--
-- **The facility is where prices live**, not the season and not the turma. A
-- club's agreement with a family is an agreement with the site: the same turma
-- name at two pools can cost different money, and a price attached to a season
-- has to be copied forward every September by somebody who remembers.
--
-- **One periodicity list, shared by both kinds of plan.** A quota is not
-- inherently annual and a mensalidade is not inherently monthly. A plan may name
-- its own default within that one list, which is what lets the quota default to
-- Anual and the mensalidades to Mensal without a second table or a rule in code.
--
-- **A line snapshots what it agreed to.** Editing the price list must never
-- rewrite an existing family's agreement — that is a bill changing retroactively,
-- which is the single worst thing a billing record can do. The snapshot is the
-- agreement; the plan is only where new lines start from.
--
-- **The total is rounded once, at the period.** €35,00 × 3 months at 5 % is
-- 99,75 €. Rounding each month and summing gives 99,76 € and an argument with a
-- parent. One IMMUTABLE function is the definition, and every caller — SQL,
-- API, screen — goes through it rather than reimplementing three lines of
-- arithmetic slightly differently.

CREATE TYPE fee_plan_kind AS ENUM ('mensalidade', 'quota');

COMMENT ON TYPE fee_plan_kind IS
  'A recurring tuition fee, or a membership subscription. Closed set: adding to '
  'it is a product decision, not something an operator does.';

-- ---------------------------------------------------------------------------
-- fee_period — how often, and what that frequency is worth
-- ---------------------------------------------------------------------------

CREATE TABLE fee_period (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  facility_id      uuid NOT NULL,

  name             text NOT NULL,

  -- 1, 3, 6, 12 — or anything up to two years, because clubs invent their own.
  -- Bounded so a typo cannot create a ninety-nine-month agreement.
  months           smallint NOT NULL,

  -- A rate, not an amount: the minor-units rule is about money, and this is a
  -- percentage. Paying further ahead is cheaper, which is the whole point of
  -- offering the choice.
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,

  is_default       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- What `fee_plan.default_fee_period_id` points at, so a plan cannot default to
  -- another site's periodicity.
  UNIQUE (organization_id, facility_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CONSTRAINT fee_period_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT fee_period_months_sane CHECK (months BETWEEN 1 AND 24),
  CONSTRAINT fee_period_discount_sane CHECK (discount_percent BETWEEN 0 AND 100)
);

COMMENT ON TABLE fee_period IS
  'A periodicity a facility offers — months and the discount for paying that far '
  'ahead. Shared by mensalidades and quotas alike.';

CREATE TRIGGER fee_period_updated_at BEFORE UPDATE ON fee_period
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Partial, per the standing rule: archiving "Trimestral" and adding it back next
-- season must not collide with a row nobody can see.
CREATE UNIQUE INDEX fee_period_months_uq
  ON fee_period (organization_id, facility_id, months)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX fee_period_name_uq
  ON fee_period (organization_id, facility_id, lower(name))
  WHERE archived_at IS NULL;

-- Exactly one default per facility. A second one would make "which period does a
-- new line start on" depend on row order.
CREATE UNIQUE INDEX fee_period_one_default_uq
  ON fee_period (organization_id, facility_id)
  WHERE archived_at IS NULL AND is_default;

-- ---------------------------------------------------------------------------
-- fee_plan — the price list
-- ---------------------------------------------------------------------------

CREATE TABLE fee_plan (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organization (id),
  facility_id            uuid NOT NULL,

  kind                   fee_plan_kind NOT NULL,
  name                   text NOT NULL,

  /*
   * A suggestion, never a constraint.
   *
   * Price varies by frequency as much as by level — "Natação 2x/semana" is a
   * price and not a level — so a level link that *restricted* assignment would
   * make half a real price list unrepresentable. It only pre-selects the plan
   * when a fee is assigned from a turma at that level.
   */
  level_id               uuid,

  -- The price the family pays, IVA included, in integer cents.
  --
  -- There is no VAT rate anywhere in this schema, and that is a decision rather
  -- than an omission: a club's prices are advertised with the tax in them, so a
  -- rate column would be a second number nobody maintains, always null, and
  -- eventually trusted by something. Art. 9.º CIVA exempts most sports tuition
  -- in any case. If reporting ever needs the split, it needs a rate *per
  -- period* — tax rates change — which is a different table, not this column.
  amount_cents           integer NOT NULL,

  -- Falls back to the facility default when null. This is what lets the quota
  -- default to Anual while mensalidades default to Mensal, with one list.
  default_fee_period_id  uuid,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  archived_at            timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),
  -- Three columns, so the period a plan defaults to belongs to the plan's own
  -- site. A two-column reference would have allowed another facility's.
  FOREIGN KEY (organization_id, facility_id, default_fee_period_id)
    REFERENCES fee_period (organization_id, facility_id, id),

  CONSTRAINT fee_plan_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT fee_plan_amount_sane CHECK (amount_cents >= 0)
);

COMMENT ON TABLE fee_plan IS
  'A named price at a facility — a mensalidade or a quota de sócio. Gross cents.';
COMMENT ON COLUMN fee_plan.level_id IS
  'Suggests the plan when assigning from a turma at this level. Never restricts.';

CREATE TRIGGER fee_plan_updated_at BEFORE UPDATE ON fee_plan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX fee_plan_name_uq
  ON fee_plan (organization_id, facility_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX fee_plan_facility_idx
  ON fee_plan (organization_id, facility_id, kind)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- The one definition of a total
-- ---------------------------------------------------------------------------

/*
 * Rounded once, at the period — never per month.
 *
 * €35,00 × 3 at 5 % is 99,75 €. Rounding each month first gives 99,76 €, and the
 * difference is the sort of cent that turns into a telephone call. IMMUTABLE so
 * it can be used in a generated column or an index if that is ever wanted, and
 * so the planner is free to fold it.
 *
 * Postgres `round(numeric)` is half-away-from-zero, which is the half-up the
 * ticket asks for on the non-negative amounts this takes.
 */
CREATE FUNCTION fee_total_cents(
  p_amount_cents   integer,
  p_months         smallint,
  p_discount_percent numeric
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    p_amount_cents::numeric * p_months * (1 - coalesce(p_discount_percent, 0) / 100)
  )::integer;
$$;

/*
 * The same total with the line's own negotiated discount taken off.
 *
 * A wrapper rather than a second formula: the period arithmetic stays defined in
 * exactly one place, and this only says what a manual discount does to it. AC7
 * is still satisfied — every total in the app reaches `fee_total_cents`, some of
 * them through here.
 *
 * A fixed discount larger than the total floors at zero rather than going
 * negative. A line that pays a family money is not a case anybody meant; it is a
 * typo in the euros field.
 */
CREATE FUNCTION fee_payable_cents(
  p_amount_cents            integer,
  p_months                  smallint,
  p_discount_percent        numeric,
  p_manual_discount_percent numeric,
  p_manual_discount_cents   integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_manual_discount_percent IS NOT NULL THEN
      round(fee_total_cents(p_amount_cents, p_months, p_discount_percent)::numeric
            * (1 - p_manual_discount_percent / 100))::integer
    WHEN p_manual_discount_cents IS NOT NULL THEN
      greatest(fee_total_cents(p_amount_cents, p_months, p_discount_percent)
               - p_manual_discount_cents, 0)
    ELSE fee_total_cents(p_amount_cents, p_months, p_discount_percent)
  END;
$$;

COMMENT ON FUNCTION fee_payable_cents(integer, smallint, numeric, numeric, integer) IS
  'The period total with the line''s manual discount applied. Wraps '
  'fee_total_cents rather than restating it.';

COMMENT ON FUNCTION fee_total_cents(integer, smallint, numeric) IS
  'The single definition of a period total — POOLSE-42 AC7. Rounded once, at the '
  'period. The API calls this rather than reimplementing the arithmetic.';

-- ---------------------------------------------------------------------------
-- student_fee — what one student actually pays
-- ---------------------------------------------------------------------------

/*
 * A fee line's enrolment has to belong to the same student.
 *
 * Said with a composite foreign key rather than a CHECK, because a CHECK cannot
 * see another table and a trigger can be raced. `enrollment` needs the matching
 * unique for it to point at.
 */
ALTER TABLE enrollment ADD CONSTRAINT enrollment_student_id_uq
  UNIQUE (organization_id, student_id, id);

CREATE TABLE student_fee (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization (id),
  student_id               uuid NOT NULL,

  fee_plan_id              uuid NOT NULL,
  -- Null for a quota, and for a mensalidade agreed outside any turma. When set,
  -- ending the enrolment ends the line.
  enrollment_id            uuid,
  fee_period_id            uuid NOT NULL,

  /*
   * The snapshot. This is the agreement.
   *
   * Copied from the plan and the period when the line is created, and never
   * rewritten by an edit to either. A line that recomputed from the plan would
   * change a family's bill retroactively the moment somebody corrected a typo in
   * the price list — the failure POOLSE-24 AC5 exists to prevent, and the single
   * most likely thing to be got wrong here.
   */
  amount_cents             integer NOT NULL,
  discount_percent         numeric(5,2) NOT NULL DEFAULT 0,

  -- The negotiated case: siblings, staff children, a family in difficulty. One
  -- or the other, never both, and never without saying why.
  manual_discount_percent  numeric(5,2),
  manual_discount_cents    integer,
  discount_reason          text,

  starts_on                date NOT NULL DEFAULT current_date,
  ends_on                  date,

  /*
   * Paid — marked by a person, and nothing else touches it.
   *
   * **This says "settled", not "settled for March".** A recurring line has no
   * single answer to "is it paid", and a boolean cannot carry one: next period it
   * is wrong, and nothing here knows when to clear it. That is the honest limit
   * of a manual flag, and it is written down here so the next slice knows what it
   * is replacing rather than inheriting it as though it meant more.
   *
   * `paid_on` is the date somebody says the money arrived, not the moment the box
   * was ticked — the office marks Friday's payments on Monday. Real billing will
   * supersede both with a row per charge; until then this is what the office has
   * instead of a spreadsheet, and it is at least auditable.
   */
  is_paid                  boolean NOT NULL DEFAULT false,
  paid_on                  date,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, fee_plan_id) REFERENCES fee_plan (organization_id, id),
  FOREIGN KEY (organization_id, fee_period_id) REFERENCES fee_period (organization_id, id),
  FOREIGN KEY (organization_id, student_id, enrollment_id)
    REFERENCES enrollment (organization_id, student_id, id),

  CONSTRAINT student_fee_amount_sane CHECK (amount_cents >= 0),
  CONSTRAINT student_fee_discount_sane CHECK (discount_percent BETWEEN 0 AND 100),
  CONSTRAINT student_fee_manual_discount_sane CHECK (
    manual_discount_percent IS NULL OR manual_discount_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT student_fee_manual_discount_cents_sane CHECK (
    manual_discount_cents IS NULL OR manual_discount_cents >= 0
  ),
  -- One kind of manual discount or the other. Both would make the order they are
  -- applied in matter, and nobody would agree on it.
  CONSTRAINT student_fee_one_manual_discount CHECK (
    manual_discount_percent IS NULL OR manual_discount_cents IS NULL
  ),
  -- A discount nobody explained is a discount nobody can defend later.
  CONSTRAINT student_fee_discount_needs_reason CHECK (
    (manual_discount_percent IS NULL AND manual_discount_cents IS NULL)
    OR (discount_reason IS NOT NULL AND btrim(discount_reason) <> '')
  ),
  CONSTRAINT student_fee_dates_ordered CHECK (ends_on IS NULL OR ends_on >= starts_on),
  -- A date on a line nobody marked paid is a contradiction, and unticking must
  -- take the date with it rather than leaving a stale one behind.
  CONSTRAINT student_fee_paid_date_needs_paid CHECK (is_paid OR paid_on IS NULL)
);

COMMENT ON TABLE student_fee IS
  'One thing a student pays. Snapshots the plan amount and the period discount at '
  'the moment it is agreed — editing the price list never rewrites it.';
COMMENT ON COLUMN student_fee.amount_cents IS
  'The agreed amount, not the plan''s current one. POOLSE-42 AC4.';

CREATE TRIGGER student_fee_updated_at BEFORE UPDATE ON student_fee
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/*
 * A quota is not attached to a turma.
 *
 * A trigger rather than a CHECK, because the rule spans two tables: the kind
 * lives on `fee_plan` and the enrolment on the line. Deferred to the statement's
 * end so a caller may insert in either order.
 */
CREATE FUNCTION quota_has_no_enrollment() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_kind fee_plan_kind;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kind INTO v_kind FROM fee_plan WHERE id = NEW.fee_plan_id;

  IF v_kind = 'quota' THEN
    RAISE EXCEPTION 'A quota de sócio is not attached to an enrolment'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE CONSTRAINT TRIGGER student_fee_quota_has_no_enrollment
  AFTER INSERT OR UPDATE ON student_fee
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION quota_has_no_enrollment();

/*
 * A line ends when its enrolment ends — POOLSE-42, and QA 42.7.
 *
 * In the schema rather than in the code that ends enrolments, because there are
 * already two such places (archiving a turma, removing one student from it) and
 * a third will be written by somebody who has never read this ticket. "Ending an
 * enrolment must not silently keep charging" is not a rule any call site should
 * be able to forget.
 *
 * Ended, not deleted: the line stays visible as history, which is what an office
 * needs when a parent asks what they were charged in March.
 */
CREATE FUNCTION end_fees_with_enrollment() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE student_fee
     SET ends_on = coalesce(NEW.ended_on, current_date)
   WHERE enrollment_id = NEW.id
     AND archived_at IS NULL
     -- Only lines still running. One already ended keeps the date it ended on.
     AND ends_on IS NULL;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER enrollment_ends_its_fees
  AFTER UPDATE OF status ON enrollment
  FOR EACH ROW
  WHEN (NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended')
  EXECUTE FUNCTION end_fees_with_enrollment();

-- The student page's own question: everything this person pays, live first.
CREATE INDEX student_fee_student_idx
  ON student_fee (organization_id, student_id)
  WHERE archived_at IS NULL;

-- "Which lines does ending this enrolment end?"
CREATE INDEX student_fee_enrollment_idx
  ON student_fee (organization_id, enrollment_id)
  WHERE archived_at IS NULL AND enrollment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Sócio, on the student
-- ---------------------------------------------------------------------------

/*
 * Being a sócio and paying a quota are related, not identical.
 *
 * A waived quota is a real case — honorary members, staff children — and
 * modelling the boolean as "has an active quota line" makes it unrepresentable.
 * So the membership is a fact about the person and the quota is a line they may
 * or may not have.
 */
ALTER TABLE student
  ADD COLUMN is_socio    boolean NOT NULL DEFAULT false,
  ADD COLUMN socio_number text,
  ADD COLUMN socio_since  date;

COMMENT ON COLUMN student.is_socio IS
  'Membership is a fact about the person; the quota is a fee line they may not have.';

ALTER TABLE student
  ADD CONSTRAINT student_socio_number_not_blank
  CHECK (socio_number IS NULL OR btrim(socio_number) <> '');

-- Two members cannot share a number. Partial, like every unique here.
CREATE UNIQUE INDEX student_socio_number_uq
  ON student (organization_id, socio_number)
  WHERE archived_at IS NULL AND socio_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE fee_period ENABLE ROW LEVEL SECURITY;
CREATE POLICY fee_period_tenant ON fee_period
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

ALTER TABLE fee_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY fee_plan_tenant ON fee_plan
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

ALTER TABLE student_fee ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_fee_tenant ON student_fee
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON fee_period TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON fee_plan TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON student_fee TO poolse_app;

-- Down Migration

DROP INDEX IF EXISTS student_socio_number_uq;
ALTER TABLE student DROP CONSTRAINT IF EXISTS student_socio_number_not_blank;
ALTER TABLE student
  DROP COLUMN IF EXISTS socio_since,
  DROP COLUMN IF EXISTS socio_number,
  DROP COLUMN IF EXISTS is_socio;

DROP TRIGGER IF EXISTS enrollment_ends_its_fees ON enrollment;
DROP FUNCTION IF EXISTS end_fees_with_enrollment();

DROP POLICY IF EXISTS student_fee_tenant ON student_fee;
DROP TABLE IF EXISTS student_fee;
DROP FUNCTION IF EXISTS quota_has_no_enrollment();

ALTER TABLE enrollment DROP CONSTRAINT IF EXISTS enrollment_student_id_uq;

DROP FUNCTION IF EXISTS fee_payable_cents(integer, smallint, numeric, numeric, integer);
DROP FUNCTION IF EXISTS fee_total_cents(integer, smallint, numeric);

DROP POLICY IF EXISTS fee_plan_tenant ON fee_plan;
DROP TABLE IF EXISTS fee_plan;

DROP POLICY IF EXISTS fee_period_tenant ON fee_period;
DROP TABLE IF EXISTS fee_period;

DROP TYPE IF EXISTS fee_plan_kind;
