-- Up Migration
--
-- Two membership rates, and a penalty per kind of charge — POOLSE-42, third pass.
--
-- **A quota can have an age band.** Most clubs charge a child less than an
-- adult. That is one price list with two rows in it, not two price lists: the
-- band is a property of the quota, and the club that charges everybody the same
-- keeps writing one row with no band at all.
--
-- Which band a student is in is decided by their age **today**, re-read every
-- period. A line already agreed keeps its price — the snapshot rule has not
-- moved — so a child who turns eighteen is flagged on their record and somebody
-- applies the adult rate, exactly as they would after any other price change.
--
-- **A penalty belongs to a kind of charge.** A club may fine a late mensalidade
-- and not a late quota, or the reverse, and the two amounts are rarely the same
-- number. Two switches and two amounts, each of which may be a flat sum or a
-- percentage. A percentage is always of the student's monthly mensalidade —
-- the figure a family recognises as "what I pay a month".

-- ---------------------------------------------------------------------------
-- The quota's age band
-- ---------------------------------------------------------------------------

/*
 * Closed set, so an enum: a developer adds a band, never an operator. `any` is
 * the club that charges one rate — the common case, and the default, so nothing
 * existing has to be edited to keep working.
 */
CREATE TYPE fee_age_band AS ENUM ('any', 'under_18', 'adult');

ALTER TABLE fee_plan
  ADD COLUMN age_band fee_age_band NOT NULL DEFAULT 'any';

/*
 * Only a quota is banded. A mensalidade is priced by level and frequency, and a
 * level already implies an age far better than a birth date does — "3–5 anos"
 * is the club's own answer to the same question.
 */
ALTER TABLE fee_plan
  ADD CONSTRAINT fee_plan_band_only_on_quota
  CHECK (kind = 'mensalidade' AND age_band = 'any' OR kind = 'quota');

COMMENT ON COLUMN fee_plan.age_band IS
  'Which members this quota is for. `any` is a club with one rate; a banded row '
  'beats `any` when both exist, which is what makes adding a child rate to an '
  'existing list safe.';

-- One quota per band per site, rather than one quota per site.
DROP INDEX IF EXISTS fee_plan_one_quota_uq;
CREATE UNIQUE INDEX fee_plan_one_quota_uq
  ON fee_plan (organization_id, facility_id, age_band)
  WHERE archived_at IS NULL AND kind = 'quota';

/*
 * The band a person is in today.
 *
 * STABLE, not IMMUTABLE: it reads `current_date`, and marking it immutable would
 * let Postgres cache an answer that stops being true on somebody's birthday.
 *
 * A student with no birth date recorded is treated as an adult — the club's
 * ordinary rate — rather than as a child, because guessing the cheaper rate for
 * missing data is the guess that has to be explained to a treasurer.
 */
CREATE FUNCTION quota_band_for(p_birth_date date) RETURNS fee_age_band
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_birth_date IS NOT NULL
     AND p_birth_date > (current_date - INTERVAL '18 years') THEN 'under_18'::fee_age_band
    ELSE 'adult'::fee_age_band
  END;
$$;

COMMENT ON FUNCTION quota_band_for(date) IS
  'Which quota band a birth date falls in today. Adult when no date is recorded.';

-- ---------------------------------------------------------------------------
-- A penalty per kind of charge
-- ---------------------------------------------------------------------------

/*
 * How a penalty is worked out. `none` rather than a separate boolean: "the club
 * charges nothing for a late quota" is a value of this question, not a second
 * question, and a boolean beside an amount can disagree with it.
 */
CREATE TYPE fee_penalty_kind AS ENUM ('none', 'amount', 'percent');

ALTER TABLE facility
  -- A late mensalidade. `late_penalty_cents` already existed and stays as this
  -- one's flat amount.
  ADD COLUMN late_penalty_kind fee_penalty_kind NOT NULL DEFAULT 'none',
  ADD COLUMN late_penalty_percent numeric(5,2) NOT NULL DEFAULT 0,
  -- A late quota, which is a different decision and usually a different number.
  ADD COLUMN quota_penalty_kind fee_penalty_kind NOT NULL DEFAULT 'none',
  ADD COLUMN quota_penalty_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN quota_penalty_percent numeric(5,2) NOT NULL DEFAULT 0;

-- A site that already charged a flat penalty keeps charging it. Without this
-- the new `kind` column would silently switch every existing penalty off.
UPDATE facility SET late_penalty_kind = 'amount' WHERE late_penalty_cents > 0;

ALTER TABLE facility
  ADD CONSTRAINT facility_quota_penalty_sane CHECK (quota_penalty_cents >= 0),
  ADD CONSTRAINT facility_penalty_percent_sane
    CHECK (late_penalty_percent BETWEEN 0 AND 100
           AND quota_penalty_percent BETWEEN 0 AND 100);

COMMENT ON COLUMN facility.late_penalty_kind IS
  'Whether a late mensalidade costs a flat amount, a percentage of the monthly '
  'mensalidade, or nothing.';
COMMENT ON COLUMN facility.quota_penalty_kind IS
  'The same question for a late quota, answered separately: a club may fine one '
  'and not the other.';

/*
 * What a penalty comes to.
 *
 * One definition, in SQL, for the same reason `fee_total_cents` is: a second one
 * in TypeScript would agree until the first rounding case and then produce the
 * cent that turns into a telephone call. The base is the student's monthly
 * mensalidade; a percentage of nothing is nothing, which is the right answer for
 * a member who pays only a quota.
 */
CREATE FUNCTION fee_penalty_cents(
  p_kind fee_penalty_kind,
  p_cents integer,
  p_percent numeric,
  p_monthly_base_cents integer
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'amount' THEN greatest(p_cents, 0)
    WHEN 'percent' THEN greatest(round(p_monthly_base_cents * p_percent / 100), 0)::integer
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION fee_penalty_cents(fee_penalty_kind, integer, numeric, integer) IS
  'One late payment''s penalty. Percentages are of the monthly mensalidade, by '
  'decision — the figure a family recognises as what they pay a month.';

-- Down Migration

DROP FUNCTION IF EXISTS fee_penalty_cents(fee_penalty_kind, integer, numeric, integer);

ALTER TABLE facility
  DROP CONSTRAINT IF EXISTS facility_penalty_percent_sane,
  DROP CONSTRAINT IF EXISTS facility_quota_penalty_sane;

ALTER TABLE facility
  DROP COLUMN IF EXISTS quota_penalty_percent,
  DROP COLUMN IF EXISTS quota_penalty_cents,
  DROP COLUMN IF EXISTS quota_penalty_kind,
  DROP COLUMN IF EXISTS late_penalty_percent,
  DROP COLUMN IF EXISTS late_penalty_kind;

DROP TYPE IF EXISTS fee_penalty_kind;

DROP FUNCTION IF EXISTS quota_band_for(date);

/*
 * One quota per site again — so a club that added a child rate has two rows
 * where the old index allows one. The banded rows go; the unbanded one stays,
 * which leaves every member paying the club's single rate exactly as they did
 * before this migration ran.
 */
DELETE FROM student_fee sf
 USING fee_plan p
 WHERE p.id = sf.fee_plan_id AND p.kind = 'quota' AND p.age_band <> 'any';
DELETE FROM fee_plan WHERE kind = 'quota' AND age_band <> 'any';

DROP INDEX IF EXISTS fee_plan_one_quota_uq;

ALTER TABLE fee_plan DROP CONSTRAINT IF EXISTS fee_plan_band_only_on_quota;
ALTER TABLE fee_plan DROP COLUMN IF EXISTS age_band;

DROP TYPE IF EXISTS fee_age_band;

CREATE UNIQUE INDEX fee_plan_one_quota_uq
  ON fee_plan (organization_id, facility_id)
  WHERE archived_at IS NULL AND kind = 'quota';
