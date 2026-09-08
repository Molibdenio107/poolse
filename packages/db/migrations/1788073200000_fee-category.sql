-- Up Migration
--
-- A fee category, on the turma or on the enrolment — POOLSE-23 AC4.
--
-- "Sénior", "Estudante", "Família numerosa", "Funcionário": the reason one
-- person pays a different price from the person in the next lane. The ticket
-- asks only that it can be *expressed*; the pricing engine that consults it is
-- explicitly out of scope, and this deliberately touches `fee_plan` not at all.
--
-- **A lookup table, not an enum.** An operator invents these — a club that
-- starts a bombeiros discount in March should not wait for a deploy — and
-- CLAUDE.md's rule is exactly that: an enum where only a developer changes the
-- set, a table where an operator might.
--
-- **A category reference, never a percentage.** The ticket says so and it is
-- worth repeating: a number typed into a UI is a discount nobody can report on
-- and nobody can change in one place. What the category is *worth* is the
-- pricing engine's, whenever it arrives.
--
-- **The enrolment wins over the turma.** A senior turma carries the category so
-- nobody types it forty times; the one member of it who is staff carries their
-- own on the enrolment. `enrolment_fee_category` is that sentence, in SQL, once
-- — the same reasoning as `fee_total_cents`: two implementations of one rule
-- agree until the day they do not.

CREATE TABLE fee_category (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  name            text NOT NULL,
  sort_order      integer NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  CONSTRAINT fee_category_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE fee_category IS
  'Why one person pays a different price from the next — senior, student, staff. '
  'A reference the pricing engine will consult, never a percentage. POOLSE-23 AC4.';

CREATE TRIGGER fee_category_updated_at BEFORE UPDATE ON fee_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Partial, like every unique on a soft-deletable table: a club that retires
-- "Sénior" and brings it back next season must not collide with the dead row.
CREATE UNIQUE INDEX fee_category_name_uq
  ON fee_category (organization_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

ALTER TABLE fee_category ENABLE ROW LEVEL SECURITY;

CREATE POLICY fee_category_tenant ON fee_category
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON fee_category TO poolse_app;

-- ---------------------------------------------------------------------------
-- Where a category can be said
-- ---------------------------------------------------------------------------
--
-- Both nullable, and null means "no category" rather than a default one. A club
-- that has never heard of concessions has nulls everywhere and nothing changes
-- for it — which is what makes this safe to add to a live price list.

ALTER TABLE class_group ADD COLUMN fee_category_id uuid;
ALTER TABLE enrollment  ADD COLUMN fee_category_id uuid;

ALTER TABLE class_group
  ADD CONSTRAINT class_group_fee_category_fkey
    FOREIGN KEY (organization_id, fee_category_id)
      REFERENCES fee_category (organization_id, id);

ALTER TABLE enrollment
  ADD CONSTRAINT enrollment_fee_category_fkey
    FOREIGN KEY (organization_id, fee_category_id)
      REFERENCES fee_category (organization_id, id);

COMMENT ON COLUMN class_group.fee_category_id IS
  'The category everybody in this turma is on unless their enrolment says '
  'otherwise. A senior turma carries it so nobody types it forty times.';
COMMENT ON COLUMN enrollment.fee_category_id IS
  'This person''s own category, which beats the turma''s — POOLSE-23 AC4.';

CREATE INDEX enrollment_fee_category_idx
  ON enrollment (organization_id, fee_category_id)
  WHERE fee_category_id IS NOT NULL;

/*
 * Which category applies, in one place.
 *
 * The enrolment wins where both are set; the turma answers where only it is;
 * null means the club has said nothing, which is not the same as a category
 * called "normal" and must not become one.
 *
 * A function rather than a `coalesce` copied into every caller, for the reason
 * `fee_total_cents` is one: the pricing engine, the student page and whatever
 * reads this next have to agree, and two spellings of one rule agree until they
 * do not. STABLE — it reads tables, and nothing here depends on the clock.
 */
CREATE FUNCTION enrolment_fee_category(
  p_organization_id uuid,
  p_enrollment_id   uuid
) RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(e.fee_category_id, cg.fee_category_id)
    FROM enrollment e
    JOIN class_group cg
      ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
   WHERE e.id = p_enrollment_id AND e.organization_id = p_organization_id
$$;

COMMENT ON FUNCTION enrolment_fee_category(uuid, uuid) IS
  'The category that applies to one enrolment: its own, else its turma''s, else '
  'none. The single definition — POOLSE-23 AC4.';

-- Down Migration
--
-- The columns go and the table with them. A club that had categorised its
-- turmas loses that, which is what dropping a column means; nothing else was
-- modified, so everything around it comes back intact.

DROP FUNCTION IF EXISTS enrolment_fee_category(uuid, uuid);

DROP INDEX IF EXISTS enrollment_fee_category_idx;

ALTER TABLE enrollment
  DROP CONSTRAINT IF EXISTS enrollment_fee_category_fkey,
  DROP COLUMN IF EXISTS fee_category_id;

ALTER TABLE class_group
  DROP CONSTRAINT IF EXISTS class_group_fee_category_fkey,
  DROP COLUMN IF EXISTS fee_category_id;

DROP POLICY IF EXISTS fee_category_tenant ON fee_category;
DROP TABLE IF EXISTS fee_category;
