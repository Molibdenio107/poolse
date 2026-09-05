-- Up Migration
--
-- How many swimmers the water holds — round 5, ticket 4.2.
--
-- The schema could already say how many students *one turma* takes
-- (`class_group.capacity`) and how many one lane holds for a given level
-- (`lane_level_capacity`). What it could not say is the thing a pool actually
-- has: a ceiling on everybody in the water at once, whichever turmas they belong
-- to. Three turmas of twelve in the same tank at the same hour is thirty-six
-- people, and nothing in the database objected.
--
-- **Nullable, and null means unlimited.** Not zero, and not a default of some
-- plausible number. A club that has not measured this has not measured it, and
-- inventing forty on their behalf would start refusing saves they used to make —
-- on a rule they never set, with a number nobody chose. The ticket asks for the
-- same thing from the other end: no ceiling, no enforcement, and a hint on the
-- tank card saying so.
--
-- **A ceiling on the tank, not on the lanes.** `lane_level_capacity` answers a
-- different question — how many of *this level* fit in one lane, which is about
-- teaching, not about safety or licensing. Both stay, and they compose: a class
-- must fit its own capacity, the classes sharing a slot must fit the tank, and
-- the per-lane level caps go on meaning what they meant. Nothing here changes
-- the other two.
--
-- `integer`, not `smallint`: a 50 m municipal tank on a public swim can hold
-- several hundred, and the two bytes saved are worth less than never having to
-- widen it.

ALTER TABLE pool
  ADD COLUMN max_capacity integer;

COMMENT ON COLUMN pool.max_capacity IS
  'Students allowed in the water at one time, across every turma. Null means no ceiling is set, and none is enforced.';

ALTER TABLE pool
  -- Zero is an empty form, not a measurement — the same reading its four
  -- dimension siblings take. A pool nobody may swim in is archived, not capped
  -- at nought, and a stray 0 would silently refuse every class in the tank.
  ADD CONSTRAINT pool_max_capacity_positive
    CHECK (max_capacity IS NULL OR max_capacity > 0);

-- Down Migration

ALTER TABLE pool
  DROP CONSTRAINT IF EXISTS pool_max_capacity_positive;

ALTER TABLE pool
  DROP COLUMN IF EXISTS max_capacity;
