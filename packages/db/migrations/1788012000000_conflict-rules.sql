-- Up Migration
--
-- One person cannot be in two buildings at once — POOLSE-51.
--
-- The value of a planning grid is that it refuses the mistakes that cost money
-- and embarrassment, and — just as important — does **not** refuse the things
-- that look like mistakes and are not. The reference sheet has Sandra running
-- Cadetes, Infantis and Absolutos at 19:15 simultaneously on three adjacent
-- lanes of one tank. A scheduler that called that a conflict would be wrong
-- about the club's actual practice on its very first screen, and would be turned
-- off before lunch.
--
-- So the rule is precise: **the same instructor, at overlapping times, in
-- different pools** is refused. The same instructor across several lanes of one
-- pool is ordinary and stays ordinary.
--
-- ---------------------------------------------------------------------------
-- The spike, and its answer
-- ---------------------------------------------------------------------------
--
-- BUILD-ORDER flagged this as the riskiest unknown in the ticket: whether an
-- exclusion constraint can express "same instructor, *different* pool,
-- overlapping time", since `WITH <>` needs the operator to belong to an operator
-- class that GiST understands.
--
-- **It can.** `btree_gist` supplies `<>` for uuid, and this was verified against
-- the real Postgres 16 before any of it was designed around:
--
--   * three concurrent bookings in one pool  → accepted
--   * the same instructor in a second pool   → refused
--   * a partial overlap across pools         → refused
--   * back-to-back across pools              → accepted (she walks over)
--   * a cancelled booking                    → frees the instructor
--
-- The trigger fallback the ticket allowed for is therefore not needed, and this
-- comment is the record of why — criterion 2.
--
-- **Two facilities are covered by the same constraint**, because two facilities
-- means two pools. There is no separate `facility_id WITH <>` term and there
-- does not need to be.
--
-- ---------------------------------------------------------------------------
-- This migration LOOSENS a constraint. Read this before changing it back.
-- ---------------------------------------------------------------------------
--
-- `class_session_instructor_free` already existed, and it was stricter than the
-- club's actual practice:
--
--   EXCLUDE USING gist (coalesce(substitute, instructor) WITH =,
--                       tstzrange(starts_at, ends_at) WITH &&)
--   WHERE status <> 'cancelled' AND that coalesce IS NOT NULL
--
-- No pool term at all — so **one instructor could not run two groups at the same
-- time anywhere**, and Sandra taking Cadetes, Infantis and Absolutos on lanes
-- 2, 3 and 4 of one tank at 19:15 was refused by the database. That is the
-- club's ordinary Tuesday, and it is the single thing POOLSE-51's PO section
-- says a scheduler must not get wrong.
--
-- It was correct when it was written: before POOLSE-43 a turma had one lane and
-- concurrency genuinely was a double-booking. Lanes made the old reading wrong,
-- and this is the migration that catches the constraint up.
--
-- The replacement is **not weaker where it matters** — two pools at once is
-- still refused, and now so is the same person at two facilities. What it stops
-- refusing is the case that was never a conflict.

-- ---------------------------------------------------------------------------
-- Who is actually teaching
-- ---------------------------------------------------------------------------
--
-- An exclusion constraint cannot reach into another table or call a function
-- over two columns at index time, so the resolved instructor has to be a real
-- column. **Generated, not copied.** The ticket suggested copying it at session
-- generation; a stored generated column is strictly better because it cannot
-- drift — there is no code path that could write a session whose
-- `resolved_instructor_id` disagrees with the two columns it comes from.
--
-- The substitute wins, which is the whole point of a substitute: on the night
-- Sandra is away, the person who cannot also be in the learner tank is the
-- person actually standing there.

ALTER TABLE class_session
  ADD COLUMN resolved_instructor_id uuid
  GENERATED ALWAYS AS (
    coalesce(substitute_instructor_membership_id, instructor_membership_id)
  ) STORED;

COMMENT ON COLUMN class_session.resolved_instructor_id IS
  'Who is actually teaching: the substitute if there is one, else the turma''s instructor. '
  'Generated rather than copied, so it cannot drift from the two columns behind it.';

-- ---------------------------------------------------------------------------
-- The constraint
-- ---------------------------------------------------------------------------
--
-- `WHERE` matters as much as the terms:
--
--   * a **cancelled** session frees the instructor, because it is not happening
--     — QA 51.3, and the same rule the lane exclusion already follows;
--   * a session with **no instructor** constrains nothing. "Sem professor" is a
--     real and common state, and nulls are not equal to each other anyway, so
--     this is written down rather than left to be inferred;
--   * a session with **no pool** is likewise exempt. A turma that has not been
--     given a tank cannot be said to be in the wrong one.

/*
 * The old constraint goes first — see the header. It had no pool term, so it
 * refused a club's ordinary Tuesday, and the two cannot coexist: the strict one
 * would reject everything the new one is meant to allow.
 */
ALTER TABLE class_session DROP CONSTRAINT class_session_instructor_free;

ALTER TABLE class_session
  ADD CONSTRAINT class_session_instructor_free
  EXCLUDE USING gist (
    organization_id WITH =,
    resolved_instructor_id WITH =,
    -- The whole rule, in one operator: same person, *different* water.
    pool_id WITH <>,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (
    status <> 'cancelled'
    AND resolved_instructor_id IS NOT NULL
    AND pool_id IS NOT NULL
  );

COMMENT ON CONSTRAINT class_session_instructor_free ON class_session IS
  'One person, one building, at any moment — POOLSE-51. Several lanes of one pool stay legal.';

/*
 * `organization_id WITH =` is not redundant beside RLS.
 *
 * Row-level security decides what a *query* can see; an exclusion constraint is
 * enforced over the whole table by the index, with no policy applied. Without
 * this term, tenant A booking an instructor could be refused because of a row in
 * tenant B — which would both leak the existence of B's data and refuse a
 * booking A is entitled to make.
 *
 * This is also criterion 11, made structural: a cross-tenant instructor conflict
 * is **explicitly not detected**, and that is a decision rather than a gap. A
 * person teaching at two clubs that both use Poolse is invisible to both, and
 * making them visible is precisely the cross-tenant leak this schema exists to
 * prevent.
 */

-- ---------------------------------------------------------------------------
-- How many groups one instructor may run at once
-- ---------------------------------------------------------------------------
--
-- A soft limit, and **nullable meaning "no opinion"** — criterion 4. A default
-- of 3 would be this migration inventing a club's staffing policy, and every
-- club that disagreed would meet a warning it never asked for on day one.
--
-- Above the limit is a warning that names the instructor and the count. It is
-- never a block: a club running four groups on one instructor for a fortnight
-- because somebody is ill is making a decision, not an error.

ALTER TABLE facility
  ADD COLUMN max_concurrent_groups_per_instructor integer,
  ADD CONSTRAINT facility_max_concurrent_sane
    CHECK (max_concurrent_groups_per_instructor IS NULL
        OR max_concurrent_groups_per_instructor > 0);

COMMENT ON COLUMN facility.max_concurrent_groups_per_instructor IS
  'Soft limit. Null means the club has no opinion. Above it warns; it never blocks.';

-- ---------------------------------------------------------------------------
-- Lane capacity, per level
-- ---------------------------------------------------------------------------
--
-- `lane.default_capacity` already exists and is the fallback. This is the
-- per-level override the ticket asks for: a lane rated 10 for adults may take 6
-- of the youngest, and a club that says so should not have to renumber its
-- lanes to express it.
--
-- Its own small table rather than a column on `student_level`, because the
-- number belongs to the pairing and not to either side: the same level is a
-- different density in a 25m tank and a learner pool.

CREATE TABLE lane_level_capacity (
  organization_id uuid NOT NULL REFERENCES organization (id),
  lane_id         uuid NOT NULL,
  level_id        uuid NOT NULL,

  capacity        integer NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (lane_id, level_id),

  FOREIGN KEY (organization_id, lane_id) REFERENCES lane (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, level_id)
    REFERENCES student_level (organization_id, id) ON DELETE CASCADE,

  CONSTRAINT lane_level_capacity_sane CHECK (capacity > 0)
);

COMMENT ON TABLE lane_level_capacity IS
  'What one lane holds at one level. Overrides lane.default_capacity. A warning, never a block.';

CREATE INDEX lane_level_capacity_lane_idx ON lane_level_capacity (organization_id, lane_id);

CREATE TRIGGER lane_level_capacity_updated_at BEFORE UPDATE ON lane_level_capacity
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lane_level_capacity ENABLE ROW LEVEL SECURITY;
CREATE POLICY lane_level_capacity_tenant ON lane_level_capacity
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON lane_level_capacity TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS lane_level_capacity;

ALTER TABLE facility
  DROP CONSTRAINT IF EXISTS facility_max_concurrent_sane,
  DROP COLUMN IF EXISTS max_concurrent_groups_per_instructor;

ALTER TABLE class_session
  DROP CONSTRAINT IF EXISTS class_session_instructor_free,
  DROP COLUMN IF EXISTS resolved_instructor_id;

-- The strict constraint, back exactly as it was before this migration. Rolling
-- back has to restore the old behaviour and not merely remove the new one, or a
-- reverted database would have no instructor rule at all.
ALTER TABLE class_session
  ADD CONSTRAINT class_session_instructor_free
  EXCLUDE USING gist (
    coalesce(substitute_instructor_membership_id, instructor_membership_id) WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (
    status <> 'cancelled'
    AND coalesce(substitute_instructor_membership_id, instructor_membership_id) IS NOT NULL
  );
