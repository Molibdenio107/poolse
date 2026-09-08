-- Up Migration
--
-- The adult and senior path — POOLSE-23.
--
-- An adult signing up for hidroginástica should not be walked through a form
-- built for somebody else's child, with the guardian fields greyed out and a
-- consent form addressed to a parent. Most of that is branching on data that
-- already exists; this adds the two facts an adult record needs and that a
-- child's does not.
--
-- **There is no `is_adult` column, and there must never be one.** An adult
-- participant is a student at or above the club's `age_of_majority` with no
-- inbound guardian link — the absence of the edge *is* the definition. A boolean
-- beside it would drift the first time a date of birth is corrected, and the
-- ticket says so explicitly. Every branch reads the two facts.
--
-- **Mobility notes sit beside the medical ones, in the same table.** They are
-- the same class of fact — something about a person's body that whoever is at
-- the poolside needs to know before that person is in the water — so they get
-- the same encryption, the same audited read and the same permission. Slice 1.12
-- settled that permission for the medical notes: owner, admin and any
-- instructor, because a cover instructor is exactly who would otherwise be
-- locked out, and the unconditional audit log is what makes the open read safe.
-- Putting mobility notes in a second table under a second rule would have been a
-- difference nobody could defend.

ALTER TABLE student_sensitive
  ADD COLUMN mobility_notes_encrypted text;

COMMENT ON COLUMN student_sensitive.mobility_notes_encrypted IS
  'Mobility and physical limitations, encrypted by the app like the medical '
  'notes beside them. Same audited read, same permission — POOLSE-23 AC3.';

-- ---------------------------------------------------------------------------
-- The emergency contact, which is explicitly not a guardian
-- ---------------------------------------------------------------------------
--
-- **This grants nothing.** It is not a `guardian_link`, it confers no role, no
-- login and no access to the student's record, and it does not appear in
-- guardian lists — QA 23.4. That is a property of what this *is not*: three
-- columns on `student`, touching neither `membership_role` nor `guardian_link`,
-- so there is no path by which naming somebody here could grant them anything.
--
-- A link **or** free text, never both. A club that has the person in its system
-- points at them and gets a name that stays correct when they change it; a club
-- with a phone number on a form types the phone number. Allowing both would make
-- "which one is authoritative" a question every reader has to answer, and two
-- readers would answer it differently.

ALTER TABLE student
  ADD COLUMN emergency_contact_membership_id uuid,
  ADD COLUMN emergency_contact_name          text,
  ADD COLUMN emergency_contact_phone         text,
  ADD COLUMN emergency_contact_relationship  text;

ALTER TABLE student
  ADD CONSTRAINT student_emergency_contact_org_fkey
    FOREIGN KEY (organization_id, emergency_contact_membership_id)
      REFERENCES membership (organization_id, id);

ALTER TABLE student
  ADD CONSTRAINT student_emergency_contact_is_one_thing CHECK (
    emergency_contact_membership_id IS NULL
    OR (emergency_contact_name IS NULL AND emergency_contact_phone IS NULL)
  ),
  -- A blank is an absence, and an absence is a null. Otherwise "is there an
  -- emergency contact" has two answers and every screen picks one.
  ADD CONSTRAINT student_emergency_contact_not_blank CHECK (
    (emergency_contact_name IS NULL OR btrim(emergency_contact_name) <> '')
    AND (emergency_contact_phone IS NULL OR btrim(emergency_contact_phone) <> '')
    AND (emergency_contact_relationship IS NULL
         OR btrim(emergency_contact_relationship) <> '')
  );

COMMENT ON COLUMN student.emergency_contact_membership_id IS
  'Somebody already in the club, named as the emergency contact. Grants nothing '
  '— not a guardian_link, no role, no access. POOLSE-23 AC3, QA 23.4.';
COMMENT ON COLUMN student.emergency_contact_name IS
  'The free-text alternative, for a contact who is not in the system. Exclusive '
  'with the membership link: a CHECK refuses both.';

-- ---------------------------------------------------------------------------
-- Which path a student is on, answered in one place
-- ---------------------------------------------------------------------------
--
-- The enrolment flow, the consent form and the guardian block all branch on the
-- same question, and each of them computing it from scattered fields is how
-- three screens end up disagreeing about one person. So it is a function.
--
-- STABLE rather than IMMUTABLE: it reads `current_date`, and caching an answer
-- would make it wrong on somebody's birthday — the one day it matters most.
--
-- A student with no birth date recorded is **not** on the adult path. Guessing
-- adult for missing data is the guess that skips the guardian block for a child
-- nobody has finished registering; guessing child asks for a guardian that an
-- adult can then be corrected out of, which is the recoverable mistake.

CREATE FUNCTION student_is_adult_path(
  p_organization_id uuid,
  p_student_id      uuid
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT s.birth_date IS NOT NULL
     AND s.birth_date <= (current_date - make_interval(years => o.age_of_majority))
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link g
        WHERE g.student_id = s.id
          AND g.organization_id = s.organization_id
          AND g.archived_at IS NULL
     )
    FROM student s
    JOIN organization o ON o.id = s.organization_id
   WHERE s.id = p_student_id AND s.organization_id = p_organization_id
$$;

COMMENT ON FUNCTION student_is_adult_path(uuid, uuid) IS
  'At or above the club age of majority, with no live guardian link. The absence '
  'of the edge is the definition — there is deliberately no is_adult column.';

-- Down Migration
--
-- Clean: the notes and the contact go, and nothing else was modified. A club
-- that recorded either loses it, which is what dropping a column means.

DROP FUNCTION IF EXISTS student_is_adult_path(uuid, uuid);

ALTER TABLE student
  DROP CONSTRAINT IF EXISTS student_emergency_contact_not_blank,
  DROP CONSTRAINT IF EXISTS student_emergency_contact_is_one_thing,
  DROP CONSTRAINT IF EXISTS student_emergency_contact_org_fkey,
  DROP COLUMN IF EXISTS emergency_contact_relationship,
  DROP COLUMN IF EXISTS emergency_contact_phone,
  DROP COLUMN IF EXISTS emergency_contact_name,
  DROP COLUMN IF EXISTS emergency_contact_membership_id;

ALTER TABLE student_sensitive DROP COLUMN IF EXISTS mobility_notes_encrypted;
