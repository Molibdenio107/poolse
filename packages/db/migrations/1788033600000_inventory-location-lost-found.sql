-- Up Migration
--
-- Where a thing belongs, and where a thing turned up — round 5, ticket 6.
--
-- Two related additions, one migration, because they are the same idea from two
-- ends: the store room knows where its kit lives, and the lost-property box
-- knows where somebody's goggles were found.
--
-- ---------------------------------------------------------------------------
-- 6.0 — a location on an inventory item
-- ---------------------------------------------------------------------------
--
-- **Free text, and no rooms entity.** The ticket is explicit and it is the right
-- call: a club knows "balneário masculino" and "escritório" as words, not as
-- records, and a rooms table would mean an operator adding kit has to stop and
-- create a room first. The interface offers the locations already used at that
-- site as suggestions, so the words stay consistent without anybody maintaining
-- a list.
--
-- If rooms ever earn their own table — a booking system for them, say — this
-- column is the data that tells us what the club actually calls them.

ALTER TABLE inventory_item
  ADD COLUMN location text;

COMMENT ON COLUMN inventory_item.location IS
  'Free text, where the item belongs. Suggested from what this site already uses; deliberately not a rooms entity.';

-- ---------------------------------------------------------------------------
-- 6.1 — lost and found
-- ---------------------------------------------------------------------------
--
-- **Its own table, not a flag on `inventory_item`.** They look alike and are
-- not: an inventory item is club property with a count, and a lost item is one
-- specific object belonging to somebody else, with a date and a status and
-- possibly a name attached. Sharing a table would mean every inventory query
-- growing a `WHERE kind = ...` and every lost-property query carrying a quantity
-- that is always 1.

CREATE TYPE lost_and_found_status AS ENUM ('found', 'returned');

CREATE TABLE lost_and_found_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id uuid NOT NULL,

  description text NOT NULL,
  -- Where it turned up, in the same words the inventory uses for where kit
  -- lives, so one set of suggestions serves both.
  location_found text,
  found_on date NOT NULL DEFAULT CURRENT_DATE,
  notes text,

  /*
   * Whose it is, when anybody knows.
   *
   * Nullable and expected to be null most of the time — a towel on a bench
   * belongs to nobody until somebody claims it. The composite foreign key is
   * what stops a row naming another tenant's student.
   */
  student_id uuid,

  /*
   * That the student was told — round 5, ticket 6.1.
   *
   * A stamp rather than a `student_notification` row. The notifications
   * subsystem is phase 3.0 and is meant to be built once; a second store here
   * would be something for it to migrate away from, and this records the same
   * fact — when, and therefore whether. The mobile app reads it when the real
   * subsystem lands.
   *
   * Null while nobody has been told, which includes every item with no student
   * attached.
   */
  student_notified_at timestamptz,

  status lost_and_found_status NOT NULL DEFAULT 'found',
  returned_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  UNIQUE (organization_id, id),

  -- Composite, never a bare id: without these a row in one club could name
  -- another club's site or student, and RLS would not catch it — both rows pass
  -- their own policy.
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),

  -- The status and the timestamp are one fact written twice, so they are kept
  -- honest here rather than by whichever code path happens to set them.
  CONSTRAINT lost_and_found_returned_shape CHECK (
    (status = 'returned') = (returned_at IS NOT NULL)
  ),

  -- Nobody is notified about an item with no owner.
  CONSTRAINT lost_and_found_notified_needs_student CHECK (
    student_notified_at IS NULL OR student_id IS NOT NULL
  ),

  CONSTRAINT lost_and_found_description_present CHECK (btrim(description) <> '')
);

CREATE INDEX lost_and_found_facility_idx
  ON lost_and_found_item (organization_id, facility_id, status)
  WHERE archived_at IS NULL;

-- A student's own items, for the mobile app and for the student page later.
CREATE INDEX lost_and_found_student_idx
  ON lost_and_found_item (organization_id, student_id)
  WHERE archived_at IS NULL AND student_id IS NOT NULL;

CREATE TRIGGER lost_and_found_item_updated_at
  BEFORE UPDATE ON lost_and_found_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lost_and_found_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY lost_and_found_item_tenant ON lost_and_found_item
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON lost_and_found_item TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS lost_and_found_item;
DROP TYPE IF EXISTS lost_and_found_status;

ALTER TABLE inventory_item
  DROP COLUMN IF EXISTS location;
