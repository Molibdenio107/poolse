-- Up Migration
--
-- Partnerships the club actually runs the lessons for.
--
-- A parceria has been "a school books the tank and brings its own coach" since
-- POOLSE-46, so a partnership booking carries no plan and takes no register. In
-- practice that is only *usually* true: plenty of clubs sell a school an hour
-- and teach it themselves, and for those the block on the calendar should offer
-- what any other class offers.
--
-- **One switch, on the partnership.** Not per group: a school is one agreement
-- and "we teach the 3rd year but not the 4th" is not a thing anybody has asked
-- for. If it ever is, the column moves down a level and the partner's value
-- becomes the default.
--
-- **The register is deliberately not part of it.** A partner_group holds a
-- `participant_count` and no people, and `attendance` needs a real `student_id`
-- — so "marcar presenças" would have to mean a headcount, which is a different
-- feature with a different table. Settled 2026-09-07: the plan and cancelling,
-- and nothing else.

ALTER TABLE partner
  ADD COLUMN managed_lessons boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN partner.managed_lessons IS
  'The club runs these lessons rather than the partner: their calendar blocks '
  'offer a training plan and can be cancelled. Never a register — a partner '
  'group has a headcount, not students. Default false, which is what a '
  'partnership was before this column existed.';

-- ---------------------------------------------------------------------------
-- A plan can belong to a partner group
-- ---------------------------------------------------------------------------
--
-- `lesson_plan` was keyed on the turma and the date, because a turma was the
-- only thing that had lessons. A partner group is the same kind of thing for
-- this purpose — a named set of people who turn up at an hour — so it gets the
-- same treatment rather than a second table that would need its own read path,
-- its own permissions and its own copy of every bug.
--
-- Exactly one of the two is set, and the CHECK is what makes that a fact rather
-- than a convention. `class_group_id` therefore has to become nullable, which is
-- the only destructive-looking part of this file: nothing is lost, because every
-- existing row keeps its value and the CHECK still passes for all of them.

ALTER TABLE lesson_plan
  ALTER COLUMN class_group_id DROP NOT NULL,
  ADD COLUMN partner_group_id uuid;

ALTER TABLE lesson_plan
  ADD CONSTRAINT lesson_plan_one_subject
  CHECK (num_nonnulls(class_group_id, partner_group_id) = 1);

-- Composite, like every other reference here: a bare `id` would let a plan in
-- one club point at a partner group in another, and both rows would pass their
-- own RLS policy while doing it.
ALTER TABLE lesson_plan
  ADD CONSTRAINT lesson_plan_organization_id_partner_group_id_fkey
  FOREIGN KEY (organization_id, partner_group_id)
  REFERENCES partner_group (organization_id, id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- The uniqueness, split in two
-- ---------------------------------------------------------------------------
--
-- One plan per subject per day, still. A single index over both columns would
-- not do it: `(organization_id, class_group_id, partner_group_id, on_date)`
-- treats two partner plans on one date as distinct because their null
-- `class_group_id`s never compare equal. Two partial indexes say what is meant.
--
-- Both keep `WHERE archived_at IS NULL`, for the reason every unique index in
-- this schema does: a plan deleted in March must not stop one being written for
-- the same turma next March.

DROP INDEX lesson_plan_occurrence_uq;

CREATE UNIQUE INDEX lesson_plan_occurrence_uq
  ON lesson_plan (organization_id, class_group_id, on_date)
  WHERE archived_at IS NULL AND class_group_id IS NOT NULL;

CREATE UNIQUE INDEX lesson_plan_partner_occurrence_uq
  ON lesson_plan (organization_id, partner_group_id, on_date)
  WHERE archived_at IS NULL AND partner_group_id IS NOT NULL;

-- "The plan for the lesson before this one" reads backwards from a date, and
-- the partner side needs its own or that query goes to a sequential scan.
CREATE INDEX lesson_plan_partner_previous_idx
  ON lesson_plan (organization_id, partner_group_id, on_date DESC)
  WHERE archived_at IS NULL AND partner_group_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS lesson_plan_partner_previous_idx;
DROP INDEX IF EXISTS lesson_plan_partner_occurrence_uq;
DROP INDEX IF EXISTS lesson_plan_occurrence_uq;

-- Partner plans cannot survive a column that is about to be NOT NULL again.
-- They are the only rows this removes, and they exist only if the feature was
-- used — which is what rolling it back means.
DELETE FROM lesson_plan WHERE partner_group_id IS NOT NULL;

CREATE UNIQUE INDEX lesson_plan_occurrence_uq
  ON lesson_plan (organization_id, class_group_id, on_date)
  WHERE archived_at IS NULL;

ALTER TABLE lesson_plan
  DROP CONSTRAINT lesson_plan_organization_id_partner_group_id_fkey,
  DROP CONSTRAINT lesson_plan_one_subject,
  DROP COLUMN partner_group_id,
  ALTER COLUMN class_group_id SET NOT NULL;

ALTER TABLE partner DROP COLUMN managed_lessons;
