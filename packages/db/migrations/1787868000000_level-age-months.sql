-- Up Migration
--
-- Level ages in months — POOLSE-06.
--
-- Whole years cannot say "from six months", and a baby class is exactly where
-- the distinction matters: "Natação para Bebés, 0–2 anos" is the difference
-- between a newborn and a toddler who can walk, and a club needs to be able to
-- say which.
--
-- Months throughout rather than a second unit column. A `value` plus a `unit`
-- would mean every comparison first agreeing on the unit, and the first query
-- that forgot would silently compare six months against six years.
--
-- The maximum gets the same treatment as the minimum. The ticket left that open
-- and recommended it, and asymmetry here would be its own bug: a level with a
-- minimum in months and a maximum in years is two mental conversions every time
-- somebody reads it.

ALTER TABLE student_level
  ADD COLUMN min_age_months smallint,
  ADD COLUMN max_age_months smallint;

-- Existing values are whole years, so the conversion is exact and total. Done
-- before the old columns go, so nothing is inferred later from a lost value.
UPDATE student_level
   SET min_age_months = min_age_years * 12,
       max_age_months = max_age_years * 12;

ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_age_plausible;
ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_age_range;

ALTER TABLE student_level
  DROP COLUMN min_age_years,
  DROP COLUMN max_age_years;

COMMENT ON COLUMN student_level.min_age_months IS
  'Months, not years — a baby class starts at 6 months, not at 0 or 1 year.';
COMMENT ON COLUMN student_level.max_age_months IS
  'Months. Symmetrical with the minimum on purpose: one unit, no conversions.';

-- A range nobody can be in is a typo, not a policy.
ALTER TABLE student_level
  ADD CONSTRAINT student_level_age_range
  CHECK (
    max_age_months IS NULL
    OR min_age_months IS NULL
    OR max_age_months >= min_age_months
  );

-- 1440 months is 120 years. Generous on purpose: a masters club with a "90+"
-- level is a real thing and this must not be why it cannot be entered.
ALTER TABLE student_level
  ADD CONSTRAINT student_level_age_plausible
  CHECK (
    (min_age_months IS NULL OR (min_age_months >= 0 AND min_age_months <= 1440))
    AND (max_age_months IS NULL OR (max_age_months >= 0 AND max_age_months <= 1440))
  );

-- Down Migration
--
-- Converts back, and loses any precision below a year — a level that said "6
-- months" comes back saying "0 years". That is inherent in the older shape
-- rather than a fault in this migration, and it is the reason the round trip is
-- not symmetrical.

ALTER TABLE student_level
  ADD COLUMN min_age_years smallint,
  ADD COLUMN max_age_years smallint;

UPDATE student_level
   SET min_age_years = min_age_months / 12,
       max_age_years = max_age_months / 12;

ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_age_plausible;
ALTER TABLE student_level DROP CONSTRAINT IF EXISTS student_level_age_range;

ALTER TABLE student_level
  DROP COLUMN min_age_months,
  DROP COLUMN max_age_months;

ALTER TABLE student_level
  ADD CONSTRAINT student_level_age_range
  CHECK (
    max_age_years IS NULL
    OR min_age_years IS NULL
    OR max_age_years >= min_age_years
  );

ALTER TABLE student_level
  ADD CONSTRAINT student_level_age_plausible
  CHECK (
    (min_age_years IS NULL OR (min_age_years >= 0 AND min_age_years <= 120))
    AND (max_age_years IS NULL OR (max_age_years >= 0 AND max_age_years <= 120))
  );
