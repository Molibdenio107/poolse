-- Up Migration
--
-- A category on the person, with proof seen and a valid-until date — POOLSE-202.
--
-- A free swimmer has no enrolment, so the categories POOLSE-23 put on the
-- enrolment and the turma cannot reach them. This puts a category on the
-- **person**: a student record, or a membership (somebody reception knows).
-- The office ticks it after seeing proof; Poolse never decides eligibility.
--
-- **Monthly fees are untouched.** `enrolment_fee_category_all`,
-- `enrolment_fee_category()` and `student_fee` are not modified and nothing here
-- reads or writes them. A person's category is for passes (POOLSE-203).
--
-- **Rank is its own column** (Rui, 08-11-2026): `sort_order` stays the display
-- order, `rank` is which category wins when a person holds several. Seeded from
-- `sort_order` so a club's order today is its rank until somebody changes it.
--
-- **Validity is said once, in SQL.** `person_category_status(valid_until)` is
-- the one definition of live / expiring (30 days) / expired against
-- `club_today()`, and `person_categories()` is the person's live ones by rank.
-- Nothing in TypeScript compares a date.

-- ---------------------------------------------------------------------------
-- Rank
-- ---------------------------------------------------------------------------

ALTER TABLE fee_category ADD COLUMN rank integer NOT NULL DEFAULT 0;

UPDATE fee_category SET rank = sort_order;

COMMENT ON COLUMN fee_category.rank IS
  'Which category wins when a person holds several: lowest first. Separate from '
  'sort_order, which is display only (Rui, 08-11-2026). POOLSE-202.';

-- ---------------------------------------------------------------------------
-- The person's category
-- ---------------------------------------------------------------------------

CREATE TABLE person_category (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),

  -- Exactly one: a student record, or a membership reception knows.
  membership_id    uuid,
  student_id       uuid,

  fee_category_id  uuid NOT NULL,

  proof_seen_on    date NOT NULL,
  -- Nullable only because anonymisation clears it; the API always sets it.
  proof_seen_by    uuid,
  -- Null means no expiry.
  valid_until      date,
  -- What was seen ("Cartão de estudante"), never its number.
  notes            text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, fee_category_id) REFERENCES fee_category (organization_id, id),
  FOREIGN KEY (organization_id, proof_seen_by) REFERENCES membership (organization_id, id),

  CONSTRAINT person_category_one_person CHECK ((membership_id IS NULL) <> (student_id IS NULL)),
  CONSTRAINT person_category_notes_short CHECK (notes IS NULL OR char_length(notes) <= 200),
  -- A document number is six or more digits in a row; the notes say what was
  -- seen, not its number. The screen says so under the field.
  CONSTRAINT person_category_notes_no_number CHECK (notes IS NULL OR notes !~ '[0-9]{6,}'),
  CONSTRAINT person_category_valid_after_proof CHECK (valid_until IS NULL OR valid_until >= proof_seen_on)
);

COMMENT ON TABLE person_category IS
  'A fee category on one person (student or membership), ticked by the office after '
  'seeing proof. For passes only; monthly fees keep the enrolment/turma rule. POOLSE-202.';

CREATE TRIGGER person_category_updated_at BEFORE UPDATE ON person_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One live row per person per category. Partial, so a removed one can come back.
CREATE UNIQUE INDEX person_category_membership_uq
  ON person_category (organization_id, membership_id, fee_category_id)
  WHERE archived_at IS NULL AND membership_id IS NOT NULL;
CREATE UNIQUE INDEX person_category_student_uq
  ON person_category (organization_id, student_id, fee_category_id)
  WHERE archived_at IS NULL AND student_id IS NOT NULL;

-- The expiry list reads by date.
CREATE INDEX person_category_valid_until_idx
  ON person_category (organization_id, valid_until)
  WHERE archived_at IS NULL AND valid_until IS NOT NULL;

ALTER TABLE person_category ENABLE ROW LEVEL SECURITY;

CREATE POLICY person_category_tenant ON person_category
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Default privileges would grant DELETE; a removal is an archive, never a delete.
REVOKE ALL ON person_category FROM poolse_app;
GRANT SELECT, INSERT, UPDATE ON person_category TO poolse_app;

-- ---------------------------------------------------------------------------
-- Validity, once
-- ---------------------------------------------------------------------------

/*
 * `live` (no expiry, or more than 30 days left), `expiring` (0 to 30 days left:
 * still valid, the office is warned) or `expired` (before the club's today).
 * The one definition; every read of a row's state calls it.
 */
CREATE FUNCTION person_category_status(p_valid_until date) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN p_valid_until IS NULL THEN 'live'
           WHEN p_valid_until < club_today() THEN 'expired'
           WHEN p_valid_until <= club_today() + 30 THEN 'expiring'
           ELSE 'live'
         END
$$;

COMMENT ON FUNCTION person_category_status(date) IS
  'live / expiring (≤ 30 days) / expired against club_today(). The one definition. POOLSE-202.';

/*
 * A person's valid categories, top rank first. A person is a membership, a
 * student, or both (a student whose login is that membership): rows on either
 * count, and a category held on both is returned once.
 *
 * Invoker, so RLS applies; `p_org` keeps the statement on one club besides.
 */
CREATE FUNCTION person_categories(
  p_org           uuid,
  p_membership_id uuid,
  p_student_id    uuid
) RETURNS TABLE (
  fee_category_id uuid,
  name            text,
  rank            integer,
  valid_until     date
)
LANGUAGE sql STABLE AS $$
  SELECT fee_category_id, name, rank, valid_until
    FROM (
      SELECT DISTINCT ON (c.id)
             c.id AS fee_category_id, c.name, c.rank, pc.valid_until
        FROM person_category pc
        JOIN fee_category c
          ON c.organization_id = pc.organization_id AND c.id = pc.fee_category_id
       WHERE pc.organization_id = p_org
         AND pc.archived_at IS NULL
         AND c.archived_at IS NULL
         AND person_category_status(pc.valid_until) <> 'expired'
         AND (
              (p_membership_id IS NOT NULL AND pc.membership_id = p_membership_id)
           OR (p_student_id IS NOT NULL AND pc.student_id = p_student_id)
           OR (p_membership_id IS NOT NULL AND pc.student_id IN (
                 SELECT s.id FROM student s
                  WHERE s.organization_id = p_org AND s.membership_id = p_membership_id
                    AND s.archived_at IS NULL))
           OR (p_student_id IS NOT NULL AND pc.membership_id = (
                 SELECT s.membership_id FROM student s
                  WHERE s.organization_id = p_org AND s.id = p_student_id))
         )
       -- Held twice (on the student and on their login): the later expiry wins.
       ORDER BY c.id, pc.valid_until DESC NULLS FIRST
    ) one
   ORDER BY rank, lower(name)
$$;

COMMENT ON FUNCTION person_categories(uuid, uuid, uuid) IS
  'A person''s valid categories (not archived, not expired), top rank first. A '
  'membership and the student whose login it is count as one person. POOLSE-202.';

-- ---------------------------------------------------------------------------
-- Retention: what was proven goes with the person
-- ---------------------------------------------------------------------------

CREATE FUNCTION person_category_anonymise_student() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE person_category
     SET notes = NULL, proof_seen_by = NULL
   WHERE organization_id = NEW.organization_id AND student_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE FUNCTION person_category_anonymise_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE person_category
     SET notes = NULL, proof_seen_by = NULL
   WHERE organization_id = NEW.organization_id AND membership_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER student_anonymised_clears_person_category
  AFTER UPDATE OF anonymised_at ON student
  FOR EACH ROW
  WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL)
  EXECUTE FUNCTION person_category_anonymise_student();

-- The same test the invoice reminders use for an anonymised membership.
CREATE TRIGGER membership_anonymised_clears_person_category
  AFTER UPDATE OF first_name, last_name, email ON membership
  FOR EACH ROW
  WHEN (NEW.first_name = 'Pessoa' AND NEW.last_name = 'anonimizada' AND NEW.email IS NULL
        AND NEW.archived_at IS NOT NULL
        AND (OLD.first_name IS DISTINCT FROM 'Pessoa' OR OLD.last_name IS DISTINCT FROM 'anonimizada'))
  EXECUTE FUNCTION person_category_anonymise_membership();

-- Down Migration

DROP TRIGGER IF EXISTS membership_anonymised_clears_person_category ON membership;
DROP TRIGGER IF EXISTS student_anonymised_clears_person_category ON student;
DROP FUNCTION IF EXISTS person_category_anonymise_membership();
DROP FUNCTION IF EXISTS person_category_anonymise_student();
DROP FUNCTION IF EXISTS person_categories(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS person_category_status(date);
DROP POLICY IF EXISTS person_category_tenant ON person_category;
DROP TABLE IF EXISTS person_category;
ALTER TABLE fee_category DROP COLUMN IF EXISTS rank;
