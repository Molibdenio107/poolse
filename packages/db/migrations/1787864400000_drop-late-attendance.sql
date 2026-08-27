-- Up Migration
--
-- "Atrasado" stops being a thing — POOLSE-13.
--
-- The ticket is explicit that this is not a relabelling: late arrival is no
-- longer recorded anywhere, and a student who arrives late is simply *Presente*.
-- So the value goes from the enum as well as from the interface, and the rows
-- that hold it are rewritten.
--
-- **This is not reversible for those rows.** A mark that said "late" becomes one
-- that says "present", and nothing remembers which. The down migration puts the
-- enum value back so the schema can be rolled back, but it cannot put the
-- distinction back — there is nowhere left holding it. That is the operator's
-- decision and it is written here so nobody is surprised by it later.
--
-- Postgres cannot drop a value from an enum. The type has to be recreated and
-- every column repointed at it, which is why this is longer than an ALTER.

-- Rewrite first, or the cast below has nothing to turn 'late' into.
UPDATE attendance SET status = 'present' WHERE status = 'late';

-- ---------------------------------------------------------------------------
-- Recreate the type without it
--
-- Renaming the old type rather than dropping it lets the column be repointed in
-- one ALTER with a cast through text, which is the only way across two enum
-- types. The old type is dropped once nothing references it.
-- ---------------------------------------------------------------------------

ALTER TYPE attendance_status RENAME TO attendance_status_old;

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'excused');

ALTER TABLE attendance
  ALTER COLUMN status TYPE attendance_status
  USING status::text::attendance_status;

DROP TYPE attendance_status_old;

COMMENT ON COLUMN attendance.status IS
  'present | absent | excused. Late arrival is deliberately not recorded — '
  'somebody who arrives late is present. POOLSE-13.';

-- Down Migration
--
-- Puts the value back so the schema matches the previous migration. It cannot
-- put back *which* marks were late: that distinction was destroyed on the way
-- up, and no column survived holding it.

ALTER TYPE attendance_status RENAME TO attendance_status_new;

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'excused', 'late');

ALTER TABLE attendance
  ALTER COLUMN status TYPE attendance_status
  USING status::text::attendance_status;

DROP TYPE attendance_status_new;

COMMENT ON COLUMN attendance.status IS NULL;
