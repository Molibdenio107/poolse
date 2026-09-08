-- Up Migration
--
-- Four kinds of fee on one price list, and the club's insurance policy.
--
-- Invoicing (2.2) will put a kind on every invoice line. Adding the two missing
-- kinds afterwards would mean rewriting lines that have already been sent, which
-- is the expensive version of this change — so the kinds land first, before
-- there is anything to rewrite.
--
-- **One table, four kinds. No parallel table per fee type.** A price list is a
-- price list: a mensalidade, an inscricao, a seguro and a quota are all "a named
-- amount this facility charges", and giving each its own table would mean four
-- read paths, four permission checks and four copies of every bug. `fee_plan`
-- already carries a kind and already varies its shape by it; this widens the set
-- and says what each new shape is.
--
-- **The recurrence is the plan's own, not the kind's.** A quota is not
-- inherently annual and an inscricao is not inherently one-off in every club, so
-- the recurrence is a column with a default per kind rather than a rule in code.
-- One structural rule falls out of it: only a plan that recurs *by the facility's
-- periodicity* may name a `fee_period`. An annual or one-off plan naming a
-- three-month periodicity is a contradiction, and the pair would be read by
-- something eventually.
--
-- **VAT arrives, reversing a written decision.** `fee_plan.amount_cents` carried
-- a comment saying there is no VAT rate in this schema and that this was a
-- decision rather than an omission. It is reversed deliberately: seguro is
-- normally isento under Art. 9.º CIVA and invoicing has to say so, which a
-- schema with nowhere to record it cannot. Amounts stay **gross** — the rate
-- describes what is already inside the amount, and no total changes.
--
-- Isento is its own flag rather than a rate of zero. On a Portuguese invoice an
-- exemption is a different statement from a zero rate, and collapsing them would
-- make the two indistinguishable at exactly the moment invoicing needs to tell
-- them apart. The *reason* for the exemption is invoicing's to add; recording
-- which lines are exempt is what stops that being a retrofit.
--
-- Every existing plan is marked exempt, because that is what the old comment
-- said these prices were: gross, with no VAT in them and none to declare.
--
-- **A season, for the two kinds that have one.** `season` already exists,
-- organization-scoped, with a name, both dates and exactly one published at a
-- time — it is not created here. Inscricao and seguro point at it because a club
-- raises the joining fee each year and insures each season separately; a
-- mensalidade and a quota do not, and the shape check says so rather than
-- leaving a column nobody knows whether to fill.

CREATE TYPE fee_kind AS ENUM ('mensalidade', 'inscricao', 'seguro', 'quota');

COMMENT ON TYPE fee_kind IS
  'What a price is for. Closed set: adding to it is a product decision, not '
  'something an operator does. Replaces fee_plan_kind, which held two of these.';

-- `fee_plan_kind` is deliberately left in place with nothing using it. The Down
-- section needs a type to put the column back into, and recreating one there
-- would risk it differing from the original by a value or an order.

/*
 * A new type rather than two `ALTER TYPE … ADD VALUE`.
 *
 * Postgres will add an enum value inside a transaction but will not let the same
 * transaction *use* it — and this migration uses both new values immediately, in
 * check constraints and partial indexes. A migration that cannot run in one
 * transaction is a migration that can half-apply, so the column is swapped over
 * to a new type instead.
 */
CREATE TYPE fee_recurrence AS ENUM ('periodicity', 'annual', 'one_off');

COMMENT ON TYPE fee_recurrence IS
  'How often a plan is charged: by the facility periodicity list, once a year, '
  'or once ever. Only `periodicity` may name a fee_period.';

-- ---------------------------------------------------------------------------
-- fee_plan — the kind widens, and three new facts about a price
-- ---------------------------------------------------------------------------

-- Everything that names the old type by value has to come off before the column
-- can change under it, and every one of them is put back below.
DROP INDEX fee_plan_facility_idx;
DROP INDEX fee_plan_level_frequency_uq;
DROP INDEX fee_plan_one_quota_uq;

ALTER TABLE fee_plan
  DROP CONSTRAINT fee_plan_band_only_on_quota,
  DROP CONSTRAINT fee_plan_shape_matches_kind;

ALTER TABLE fee_plan
  ALTER COLUMN kind TYPE fee_kind USING kind::text::fee_kind;

ALTER TABLE fee_plan
  ADD COLUMN recurrence  fee_recurrence NOT NULL DEFAULT 'periodicity',
  ADD COLUMN vat_rate    numeric(5,2)   NOT NULL DEFAULT 0,
  ADD COLUMN vat_exempt  boolean        NOT NULL DEFAULT false,
  ADD COLUMN season_id   uuid,
  ADD COLUMN is_renewal  boolean        NOT NULL DEFAULT false;

/*
 * What the club already has, restated rather than re-entered.
 *
 * Every existing plan is charged through the periodicity list — that is what
 * `default_fee_period_id` and `fee_period` are — so `periodicity` is right for
 * all of them and the student page goes on behaving exactly as it did. And every
 * one of them is a gross price with no VAT recorded, which is `isento` said out
 * loud rather than left as an absence.
 */
UPDATE fee_plan SET vat_exempt = true;

COMMENT ON COLUMN fee_plan.recurrence IS
  'How often this price is charged. Only `periodicity` may name a fee_period.';
COMMENT ON COLUMN fee_plan.vat_rate IS
  'The IVA rate already inside amount_cents. Gross, never added on top.';
COMMENT ON COLUMN fee_plan.vat_exempt IS
  'Isento — a different statement from a zero rate, and invoicing has to make it.';
COMMENT ON COLUMN fee_plan.season_id IS
  'The season an inscricao or a seguro belongs to. Null on the other two kinds.';
COMMENT ON COLUMN fee_plan.is_renewal IS
  'The cheaper renovacao price, for a student who paid in an earlier season.';

ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_organization_id_season_id_fkey
    FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id);

/*
 * Each kind's shape, in one constraint.
 *
 * A mensalidade is priced by level and frequency and needs both. Nothing else
 * is: an inscricao, a seguro and a quota are charged to a person rather than to
 * a place in the timetable, and a level on one of them would be a column two
 * screens disagree about.
 */
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_shape_matches_kind CHECK (
    CASE kind
      WHEN 'mensalidade' THEN level_id IS NOT NULL AND lessons_per_week IS NOT NULL
      ELSE level_id IS NULL AND lessons_per_week IS NULL
    END
  );

-- A band is a quota's business. A mensalidade is banded by its level, which says
-- it better; an inscricao and a seguro are the same price for everybody.
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_band_only_on_quota CHECK (
    kind = 'quota' OR age_band = 'any'
  );

/*
 * Which kinds carry a season, and which must not.
 *
 * Both directions, because a nullable column with a rule in only one of them is
 * a column somebody fills on the wrong row and nothing objects.
 */
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_season_matches_kind CHECK (
    (kind IN ('inscricao', 'seguro') AND season_id IS NOT NULL)
    OR (kind IN ('mensalidade', 'quota') AND season_id IS NULL)
  );

-- Renovacao is a second inscricao price, so it is meaningless anywhere else.
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_renewal_only_on_inscricao CHECK (
    NOT is_renewal OR kind = 'inscricao'
  );

-- An annual or one-off plan naming a three-month periodicity is a contradiction,
-- and a contradiction left in two columns is one something will eventually read.
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_period_only_when_recurring CHECK (
    default_fee_period_id IS NULL OR recurrence = 'periodicity'
  );

ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_vat_sane CHECK (vat_rate BETWEEN 0 AND 100),
  ADD CONSTRAINT fee_plan_vat_exempt_is_zero CHECK (NOT vat_exempt OR vat_rate = 0);

-- The three put back unchanged, now over the wider type.
CREATE INDEX fee_plan_facility_idx
  ON fee_plan (organization_id, facility_id, kind)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX fee_plan_level_frequency_uq
  ON fee_plan (organization_id, facility_id, level_id, lessons_per_week)
  WHERE archived_at IS NULL AND kind = 'mensalidade';

CREATE UNIQUE INDEX fee_plan_one_quota_uq
  ON fee_plan (organization_id, facility_id, age_band)
  WHERE archived_at IS NULL AND kind = 'quota';

/*
 * One inscricao price per season, and one renovacao beside it.
 *
 * `is_renewal` is in the key rather than excluded from it, which is exactly what
 * lets the pair coexist: a club with one joining price has one row, a club that
 * charges returning families less has two, and neither can have three.
 */
CREATE UNIQUE INDEX fee_plan_one_inscricao_uq
  ON fee_plan (organization_id, facility_id, season_id, is_renewal)
  WHERE archived_at IS NULL AND kind = 'inscricao';

CREATE UNIQUE INDEX fee_plan_one_seguro_uq
  ON fee_plan (organization_id, facility_id, season_id)
  WHERE archived_at IS NULL AND kind = 'seguro';

/*
 * The enrolment rule, recompiled against the wider type.
 *
 * Same rule, and now it holds for three kinds rather than one: an inscricao and
 * a seguro are charged to a person for a season, not to a place in a turma, so
 * hanging one off an enrolment would end it the day the child changes group.
 */
CREATE OR REPLACE FUNCTION quota_has_no_enrollment() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_kind fee_kind;
BEGIN
  IF NEW.enrollment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kind INTO v_kind FROM fee_plan WHERE id = NEW.fee_plan_id;

  IF v_kind <> 'mensalidade' THEN
    RAISE EXCEPTION 'A % is not attached to an enrolment', v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- insurance_policy — the apolice the club holds
-- ---------------------------------------------------------------------------
--
-- The facility's side of the seguro. `cost_per_person_cents` is what the club
-- pays its insurer per insured swimmer; the seguro `fee_plan` is what the family
-- pays. They are usually the same number and they are not the same fact, and a
-- club that adds a euro of admin to it would have nowhere to put the difference
-- if this table were also the price.
--
-- Money in integer minor units, like every amount in this schema. A per-person
-- cost is an amount and not a unit price: it is charged whole, never multiplied
-- by a fractional quantity, so cents lose nothing.

CREATE TABLE insurance_policy (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization (id),
  facility_id           uuid NOT NULL,

  insurer               text NOT NULL,
  policy_number         text NOT NULL,

  valid_from            date NOT NULL,
  valid_to              date NOT NULL,

  cost_per_person_cents integer NOT NULL,
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  /*
   * Archived, never deleted. Last season's policy is what covered last season's
   * swimmers, and a fee line still points at it — a club asked "who insured my
   * daughter in March" needs the answer to survive this year's renewal.
   */
  archived_at           timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CONSTRAINT insurance_policy_insurer_not_blank CHECK (btrim(insurer) <> ''),
  CONSTRAINT insurance_policy_number_not_blank  CHECK (btrim(policy_number) <> ''),
  CONSTRAINT insurance_policy_dates_ordered     CHECK (valid_to >= valid_from),
  CONSTRAINT insurance_policy_cost_sane         CHECK (cost_per_person_cents >= 0)
);

COMMENT ON TABLE insurance_policy IS
  'An apolice a facility holds — insurer, number, the period it covers and what '
  'it costs per insured person. A seguro fee line points at one.';
COMMENT ON COLUMN insurance_policy.cost_per_person_cents IS
  'What the club pays its insurer per person. What the family pays is the seguro '
  'fee_plan, which is a different fact and usually the same number.';

CREATE TRIGGER insurance_policy_updated_at BEFORE UPDATE ON insurance_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Partial, like every unique on a soft-deletable table: a club that renews with
-- the same number next year must not collide with the row it archived.
CREATE UNIQUE INDEX insurance_policy_number_uq
  ON insurance_policy (organization_id, facility_id, lower(policy_number))
  WHERE archived_at IS NULL;

CREATE INDEX insurance_policy_facility_idx
  ON insurance_policy (organization_id, facility_id, valid_to DESC)
  WHERE archived_at IS NULL;

ALTER TABLE insurance_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_policy_tenant ON insurance_policy
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON insurance_policy TO poolse_app;

-- ---------------------------------------------------------------------------
-- student_fee — a line knows its kind, its season, and what it covers
-- ---------------------------------------------------------------------------
--
-- **The kind is snapshotted onto the line**, like the amount and the discount
-- beside it. Two reasons, and the second is the load-bearing one: a line already
-- records what was agreed rather than what the plan says today, and a partial
-- unique index cannot join to another table — "one inscricao per student per
-- season" is only expressible with the kind on this row. A constraint trigger
-- keeps it equal to the plan's, so the copy cannot drift.

ALTER TABLE student_fee
  ADD COLUMN kind                fee_kind,
  ADD COLUMN season_id           uuid,
  ADD COLUMN insurance_policy_id uuid,
  ADD COLUMN covers_from         date,
  ADD COLUMN covers_to           date;

UPDATE student_fee sf
   SET kind = p.kind
  FROM fee_plan p
 WHERE p.id = sf.fee_plan_id;

ALTER TABLE student_fee ALTER COLUMN kind SET NOT NULL;

COMMENT ON COLUMN student_fee.kind IS
  'The plan''s kind at the moment this was agreed. Held equal to the plan by a '
  'constraint trigger, and here because a partial index cannot join.';
COMMENT ON COLUMN student_fee.covers_from IS
  'The seguro period this line buys. Pro-rata for a mid-season joiner, computed '
  'once on the server and snapshotted here like the amount.';

ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_organization_id_season_id_fkey
    FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  ADD CONSTRAINT student_fee_organization_id_insurance_policy_id_fkey
    FOREIGN KEY (organization_id, insurance_policy_id)
      REFERENCES insurance_policy (organization_id, id);

ALTER TABLE student_fee
  ADD CONSTRAINT student_fee_season_matches_kind CHECK (
    (kind IN ('inscricao', 'seguro') AND season_id IS NOT NULL)
    OR (kind IN ('mensalidade', 'quota') AND season_id IS NULL)
  ),
  -- Cover belongs to a seguro line, and it is all three columns or none of them:
  -- a policy with no dates covers nothing anybody can check.
  ADD CONSTRAINT student_fee_cover_only_on_seguro CHECK (
    CASE kind
      WHEN 'seguro' THEN insurance_policy_id IS NOT NULL
                     AND covers_from IS NOT NULL AND covers_to IS NOT NULL
      ELSE insurance_policy_id IS NULL
       AND covers_from IS NULL AND covers_to IS NULL
    END
  ),
  ADD CONSTRAINT student_fee_cover_dates_ordered CHECK (
    covers_to IS NULL OR covers_to >= covers_from
  );

/*
 * One inscricao and one seguro per student per season.
 *
 * Charged twice is the failure worth a constraint: it is quiet, it reaches a
 * family as a bill, and it is the kind of thing an import or a double-click
 * produces. A mensalidade has no such rule — two turmas are two mensalidades.
 */
CREATE UNIQUE INDEX student_fee_one_inscricao_uq
  ON student_fee (organization_id, student_id, season_id)
  WHERE archived_at IS NULL AND kind = 'inscricao';

CREATE UNIQUE INDEX student_fee_one_seguro_uq
  ON student_fee (organization_id, student_id, season_id)
  WHERE archived_at IS NULL AND kind = 'seguro';

CREATE INDEX student_fee_cover_idx
  ON student_fee (organization_id, student_id, covers_to)
  WHERE archived_at IS NULL AND kind = 'seguro';

/*
 * A line always knows its kind, whether or not its writer knew about the column.
 *
 * `kind` is NOT NULL and every existing caller predates it — the repository, the
 * fixtures, the seed, the import. Each one would otherwise have to learn to
 * restate something the plan already says, and the one that was missed would
 * fail in front of somebody rather than here. So a null means "whatever the plan
 * says", which is what the column means anyway; an explicit value still wins,
 * and the constraint trigger below refuses one that lies.
 *
 * The same shape as `class_session.occurs_on`, and for the same reason.
 */
CREATE FUNCTION student_fee_default_kind() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.kind IS NULL THEN
    SELECT kind INTO NEW.kind FROM fee_plan WHERE id = NEW.fee_plan_id;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER student_fee_default_kind BEFORE INSERT OR UPDATE ON student_fee
  FOR EACH ROW EXECUTE FUNCTION student_fee_default_kind();

/*
 * The snapshot cannot disagree with the plan it was taken from.
 *
 * A trigger rather than a CHECK, for the reason the enrolment rule beside it is
 * one: the kind lives on `fee_plan` and the copy on the line, and a CHECK cannot
 * see another table. Deferrable so a caller may insert in either order.
 */
CREATE FUNCTION student_fee_kind_matches_plan() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_kind fee_kind;
BEGIN
  SELECT kind INTO v_kind FROM fee_plan WHERE id = NEW.fee_plan_id;

  IF v_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'A fee line says % and its plan says %', NEW.kind, v_kind
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE CONSTRAINT TRIGGER student_fee_kind_matches_plan
  AFTER INSERT OR UPDATE ON student_fee
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION student_fee_kind_matches_plan();

-- Down Migration
--
-- The two new kinds cannot be expressed in the old shape, so rows that use them
-- are removed rather than silently reinterpreted as something they are not. A
-- club that has priced an inscricao loses those prices on a rollback; that is
-- recorded here rather than prevented, because the old enum genuinely has no
-- value to put them under. Mensalidades, quotas and every line hanging off them
-- come back untouched.

DROP TRIGGER IF EXISTS student_fee_kind_matches_plan ON student_fee;
DROP FUNCTION IF EXISTS student_fee_kind_matches_plan();
DROP TRIGGER IF EXISTS student_fee_default_kind ON student_fee;
DROP FUNCTION IF EXISTS student_fee_default_kind();

DROP INDEX IF EXISTS student_fee_cover_idx;
DROP INDEX IF EXISTS student_fee_one_seguro_uq;
DROP INDEX IF EXISTS student_fee_one_inscricao_uq;

DELETE FROM student_fee_payment sfp
 USING student_fee sf
 WHERE sf.id = sfp.student_fee_id AND sf.kind IN ('inscricao', 'seguro');
DELETE FROM student_fee WHERE kind IN ('inscricao', 'seguro');

ALTER TABLE student_fee
  DROP CONSTRAINT IF EXISTS student_fee_cover_dates_ordered,
  DROP CONSTRAINT IF EXISTS student_fee_cover_only_on_seguro,
  DROP CONSTRAINT IF EXISTS student_fee_season_matches_kind,
  DROP CONSTRAINT IF EXISTS student_fee_organization_id_insurance_policy_id_fkey,
  DROP CONSTRAINT IF EXISTS student_fee_organization_id_season_id_fkey,
  DROP COLUMN IF EXISTS covers_to,
  DROP COLUMN IF EXISTS covers_from,
  DROP COLUMN IF EXISTS insurance_policy_id,
  DROP COLUMN IF EXISTS season_id,
  DROP COLUMN IF EXISTS kind;

DROP POLICY IF EXISTS insurance_policy_tenant ON insurance_policy;
DROP TABLE IF EXISTS insurance_policy;

DELETE FROM fee_plan WHERE kind IN ('inscricao', 'seguro');

DROP INDEX IF EXISTS fee_plan_one_seguro_uq;
DROP INDEX IF EXISTS fee_plan_one_inscricao_uq;
DROP INDEX IF EXISTS fee_plan_one_quota_uq;
DROP INDEX IF EXISTS fee_plan_level_frequency_uq;
DROP INDEX IF EXISTS fee_plan_facility_idx;

ALTER TABLE fee_plan
  DROP CONSTRAINT IF EXISTS fee_plan_vat_exempt_is_zero,
  DROP CONSTRAINT IF EXISTS fee_plan_vat_sane,
  DROP CONSTRAINT IF EXISTS fee_plan_period_only_when_recurring,
  DROP CONSTRAINT IF EXISTS fee_plan_renewal_only_on_inscricao,
  DROP CONSTRAINT IF EXISTS fee_plan_season_matches_kind,
  DROP CONSTRAINT IF EXISTS fee_plan_band_only_on_quota,
  DROP CONSTRAINT IF EXISTS fee_plan_shape_matches_kind,
  DROP CONSTRAINT IF EXISTS fee_plan_organization_id_season_id_fkey,
  DROP COLUMN IF EXISTS is_renewal,
  DROP COLUMN IF EXISTS season_id,
  DROP COLUMN IF EXISTS vat_exempt,
  DROP COLUMN IF EXISTS vat_rate,
  DROP COLUMN IF EXISTS recurrence;

ALTER TABLE fee_plan
  ALTER COLUMN kind TYPE fee_plan_kind USING kind::text::fee_plan_kind;

ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_shape_matches_kind CHECK (
    kind = 'mensalidade' AND level_id IS NOT NULL AND lessons_per_week IS NOT NULL
    OR kind = 'quota' AND level_id IS NULL AND lessons_per_week IS NULL
  ),
  ADD CONSTRAINT fee_plan_band_only_on_quota CHECK (
    kind = 'mensalidade' AND age_band = 'any' OR kind = 'quota'
  );

CREATE INDEX fee_plan_facility_idx
  ON fee_plan (organization_id, facility_id, kind)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX fee_plan_level_frequency_uq
  ON fee_plan (organization_id, facility_id, level_id, lessons_per_week)
  WHERE archived_at IS NULL AND kind = 'mensalidade';

CREATE UNIQUE INDEX fee_plan_one_quota_uq
  ON fee_plan (organization_id, facility_id, age_band)
  WHERE archived_at IS NULL AND kind = 'quota';

CREATE OR REPLACE FUNCTION quota_has_no_enrollment() RETURNS trigger
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

DROP TYPE IF EXISTS fee_recurrence;
DROP TYPE IF EXISTS fee_kind;
