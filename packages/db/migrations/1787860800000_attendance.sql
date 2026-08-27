-- Up Migration
--
-- Attendance — slice 1.8, and the last thing between phase 1 and an operator
-- running real classes on Poolse.
--
-- The shape has been in `docs/data-model.md` since phase 0 and is followed here
-- exactly: one row per student per session, four statuses, and who recorded it.
--
-- Three decisions worth reading before the SQL.
--
-- **Absent is a recorded fact, not a missing row.** "Nobody has marked this
-- class yet" and "Ana did not come" are different answers and an operator needs
-- to tell them apart — the first is work outstanding, the second is a
-- conversation with a parent. So absence is stored, and a session with no rows
-- is a session nobody has marked.
--
-- **It attaches to the session, not to the enrollment.** A student can attend a
-- class they are not enrolled in — a trial, a make-up for one they missed, a
-- sibling brought along — and an operator who cannot record that will record
-- nothing. Enrollment supplies the list to mark; it does not gate what may be
-- marked.
--
-- **`recorded_by_membership_id` is not nullable.** Attendance is a claim about a
-- child made by a person, and it is the evidence when a parent says their
-- daughter was there. A row nobody signed is worth much less than no row at all.

/*
 * `class_session` never needed to be referenced before, so it never had the
 * composite key that makes referencing it possible.
 *
 * Every tenant table here carries `UNIQUE (organization_id, id)` so children can
 * point at `(organization_id, parent_id)` rather than a bare `id` — that pair is
 * what stops a row in one organization referencing a row in another, which RLS
 * cannot catch because both rows pass their own policies. `class_session` is the
 * first table to become a parent since it was written, and this is the key it
 * has been missing.
 *
 * Free to add: `id` is already the primary key, so the pair is already unique.
 */
ALTER TABLE class_session ADD CONSTRAINT class_session_organization_id_id_key
  UNIQUE (organization_id, id);

CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'excused', 'late');

CREATE TABLE attendance (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization (id),
  class_session_id         uuid NOT NULL,
  student_id               uuid NOT NULL,

  status                   attendance_status NOT NULL,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at              timestamptz NOT NULL DEFAULT now(),

  /*
   * Free text, and deliberately not medical.
   *
   * "Saiu mais cedo", "chegou às 18:20". The same trap as `student.notes`: a box
   * on a child's record is where somebody types an allergy if nothing tells them
   * not to, so it is short, optional, and the interface says what it is for.
   * Medical information has its own table, its own access rules and its own
   * audit trail — see "Minors and consent".
   */
  note                     text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, class_session_id)
    REFERENCES class_session (organization_id, id),
  FOREIGN KEY (organization_id, student_id)
    REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES membership (organization_id, id),

  CHECK (note IS NULL OR btrim(note) <> '')
);

-- One mark per student per session. Changing a mark is an UPDATE — a second row
-- saying something different would make "was Ana here?" unanswerable.
--
-- Not partial, and this is the one soft-delete exception in the schema: there is
-- no `archived_at` on this table. Attendance is not archived, it is corrected.
-- Keeping a withdrawn mark beside a live one is how a register stops adding up.
CREATE UNIQUE INDEX attendance_session_student_uq
  ON attendance (organization_id, class_session_id, student_id);

-- The register for one class, which is the read the marking screen makes.
CREATE INDEX attendance_session_idx ON attendance (organization_id, class_session_id);

-- "How often has Ana come this term", which is the read a parent conversation
-- makes, and the one phase 6 will build trends on.
CREATE INDEX attendance_student_idx ON attendance (organization_id, student_id, recorded_at DESC);

CREATE TRIGGER attendance_updated_at BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_tenant ON attendance
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON attendance TO poolse_app;

-- ---------------------------------------------------------------------------
-- A marked class cannot be called off
--
-- Backlog round 3, story 5's last rule, which has been waiting for this table:
-- "a class with attendance already recorded cannot be removed; the interface
-- explains why".
--
-- A trigger rather than a check in a repository method, because there are
-- already two ways a session gets cancelled — a person on the calendar, and
-- `generate_sessions` when a closure covers the day — and a rule enforced in one
-- of them is a rule the other breaks. The generator is the dangerous one: adding
-- an August closure after a term has been taught would silently cancel classes
-- that people attended.
--
-- Restoring is unaffected. Only the transition *into* cancelled is refused, so a
-- closure being removed can still put a class back.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refuse_cancelling_marked_session() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    IF EXISTS (
      SELECT 1 FROM attendance a
       WHERE a.class_session_id = NEW.id
         AND a.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'Attendance has been recorded for this class'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER class_session_keep_marked BEFORE UPDATE OF status ON class_session
  FOR EACH ROW EXECUTE FUNCTION refuse_cancelling_marked_session();

-- Down Migration

DROP TRIGGER IF EXISTS class_session_keep_marked ON class_session;
DROP FUNCTION IF EXISTS refuse_cancelling_marked_session();

DROP TABLE IF EXISTS attendance;
DROP TYPE IF EXISTS attendance_status;

ALTER TABLE class_session DROP CONSTRAINT IF EXISTS class_session_organization_id_id_key;
