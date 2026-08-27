-- One person, many roles — POOLSE-17, and the rewritten POOLSE-04.
--
-- The problem, in one sentence: a senior student who is also the encarregado de
-- educação of a grandchild was two unrelated records for one human — two phone
-- numbers to keep in sync, two addresses to update, and a People list that
-- showed them twice.
--
-- **`membership` is the person.** Not a new `person` table, and not `app_user`.
--
-- `app_user` is Clerk's, is global, has no `organization_id` and no row-level
-- security, and every row in it is somebody who authenticated. Filling it with
-- operator-typed guardians would put tenant-authored data in the one table the
-- isolation rules do not cover — the exact failure `docs/data-model.md`
-- decision 2 exists to prevent.
--
-- `membership` already is what the ticket describes: tenant-scoped with a
-- policy, one row per human per organization, `app_user_id` nullable so somebody
-- can exist before (or without ever) having a login, and `membership_role`
-- attached so one person holds several roles at once. What it lacked was a name.
--
-- **Who owns which field.** When `app_user_id` is set, Clerk owns the name and
-- the email and `app_user`'s cache holds them — writing them here would be the
-- bug CLAUDE.md warns about, where a save appears to work and is silently
-- reverted by the next webhook. The columns below are the club's record of
-- somebody who has no login. `person_name` and `person_email` resolve the two in
-- one place so no query has to remember the rule.
--
-- **Guardianship is a relation between two people**, carrying the relationship
-- type and a primary-contact flag — because the same woman is a grandmother to
-- one child and a legal guardian to another, and that fact belongs to the pair,
-- not to her.
--
-- The free-text `student.guardian_*` columns added earlier today are migrated
-- into real people and links, then dropped. They were the right shape for a
-- ticket that has since been rewritten.

-- Up Migration

-- ---------------------------------------------------------------------------
-- A membership can hold a name
--
-- Only meaningful where there is no `app_user_id`. Guarded rather than trusted:
-- the check below refuses a row that tries to hold a name for somebody Clerk
-- already names, so the two can never disagree.
-- ---------------------------------------------------------------------------

ALTER TABLE membership
  ADD COLUMN first_name  text,
  ADD COLUMN last_name   text,
  ADD COLUMN email       citext,
  ADD COLUMN phone       text,
  ADD COLUMN tax_number  text,
  ADD COLUMN address     text,
  ADD COLUMN birth_date  date;

COMMENT ON COLUMN membership.first_name IS
  'The club''s record of somebody with no login. Null when app_user_id is set — '
  'Clerk owns the name then, and app_user.cached_first_name holds it.';

COMMENT ON COLUMN membership.tax_number IS
  'NIF. Used to recognise somebody already known to the club before a duplicate '
  'is created; never validated as a real number, because an operator typing one '
  'from a form should not be stopped by a checksum.';

ALTER TABLE membership
  ADD CONSTRAINT membership_identity_belongs_to_one_owner
  CHECK (
    app_user_id IS NULL
    OR (first_name IS NULL AND last_name IS NULL AND email IS NULL)
  );

ALTER TABLE membership
  ADD CONSTRAINT membership_person_fields_not_blank
  CHECK (
    (first_name IS NULL OR btrim(first_name) <> '')
    AND (last_name IS NULL OR btrim(last_name) <> '')
    AND (phone IS NULL OR btrim(phone) <> '')
    AND (tax_number IS NULL OR btrim(tax_number) <> '')
    AND (address IS NULL OR btrim(address) <> '')
  );

ALTER TABLE membership
  ADD CONSTRAINT membership_email_shape
  CHECK (email IS NULL OR email::text ~ '^[^[:space:]@]+@[^[:space:]@.]+\.[^[:space:]@]+$');

ALTER TABLE membership
  ADD CONSTRAINT membership_birth_date_sane
  CHECK (birth_date IS NULL OR birth_date >= DATE '1900-01-01');

/*
 * A person with no login still needs a name.
 *
 * `NOT VALID` on purpose: it binds every future write while leaving any existing
 * invited-but-unaccepted membership alone. Those have an `invitation` row
 * carrying the email and no name anywhere yet, and failing this migration on
 * them would be failing on correct data.
 */
ALTER TABLE membership
  ADD CONSTRAINT membership_person_has_a_name
  CHECK (
    app_user_id IS NOT NULL
    OR status = 'invited'
    OR (first_name IS NOT NULL AND last_name IS NOT NULL)
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- Recognising somebody the club already knows
--
-- Criterion 9: creating a person whose NIF or email already exists should offer
-- to add the role to the person who is there, rather than making a second them.
-- These indexes are what makes that lookup cheap, and what stops two operators
-- doing it at the same moment from winning separately.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX membership_tax_number_uq
  ON membership (organization_id, tax_number)
  WHERE archived_at IS NULL AND tax_number IS NOT NULL;

CREATE UNIQUE INDEX membership_email_uq
  ON membership (organization_id, email)
  WHERE archived_at IS NULL AND email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- person_name / person_email — the resolution rule, in one place
--
-- Clerk's cache wins where there is a login; the club's own record answers where
-- there is not. Every screen that shows a person's name goes through these, so
-- the rule is stated once rather than re-derived in each query that joins.
-- ---------------------------------------------------------------------------

CREATE FUNCTION person_name(p_membership_id uuid) RETURNS text
LANGUAGE sql STABLE
AS $fn$
  SELECT btrim(
           coalesce(u.cached_first_name, m.first_name, '') || ' ' ||
           coalesce(u.cached_last_name,  m.last_name,  '')
         )
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = p_membership_id;
$fn$;

CREATE FUNCTION person_email(p_membership_id uuid) RETURNS citext
LANGUAGE sql STABLE
AS $fn$
  SELECT coalesce(u.cached_email, m.email)
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = p_membership_id;
$fn$;

COMMENT ON FUNCTION person_name(uuid) IS
  'The name to show for a membership. Clerk''s cache where there is a login, the '
  'club''s own record where there is not — POOLSE-17.';

-- ---------------------------------------------------------------------------
-- A student is a person
--
-- Nullable, and stays nullable. Most children in a swimming school are a
-- register entry and nothing else, and requiring a membership for each of them
-- would create thousands of role-less people to no purpose. The column exists
-- for the case the ticket is about: the adult student who is also somebody's
-- encarregado, who must be one human rather than two.
-- ---------------------------------------------------------------------------

ALTER TABLE student ADD COLUMN membership_id uuid;

ALTER TABLE student
  ADD CONSTRAINT student_organization_id_membership_id_fkey
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id);

CREATE INDEX student_membership_idx
  ON student (organization_id, membership_id)
  WHERE archived_at IS NULL AND membership_id IS NOT NULL;

COMMENT ON COLUMN student.membership_id IS
  'The person this student is, where they are also known to the club in their own '
  'right — an adult student, or one who is an encarregado for somebody else. Null '
  'for a child who is only a register entry.';

-- ---------------------------------------------------------------------------
-- guardian_link — the relation between two people
--
-- `docs/data-model.md` has described this table since the beginning; it was
-- never actually created. It is created here, and pointed at `membership` rather
-- than at `app_user`, which is what makes it usable: almost no encarregado de
-- educação has a login, and one that required an account would be a table that
-- stayed empty.
--
-- The relationship and the primary-contact flag live on the link, per criterion
-- 4 — the same person is "avó" to one child and "tutora legal" to another.
-- ---------------------------------------------------------------------------

CREATE TABLE guardian_link (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organization (id),
  student_id             uuid NOT NULL,
  guardian_membership_id uuid NOT NULL,
  relationship           text,
  /*
   * Who to ring first.
   *
   * Not enforced as "exactly one", deliberately: a student may briefly have none
   * marked while an operator is adding the second guardian, and refusing that
   * would mean the form could not be filled in the order people fill it. At most
   * one is enforced, which is the half that matters — two primary contacts is a
   * question nobody can answer.
   */
  is_primary             boolean NOT NULL DEFAULT false,
  can_view_progress      boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  archived_at            timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, guardian_membership_id)
    REFERENCES membership (organization_id, id),
  CONSTRAINT guardian_link_relationship_not_blank
    CHECK (relationship IS NULL OR btrim(relationship) <> '')
);

-- One link per pair. Partial, so removing a guardian and adding them back next
-- season does not collide with the dead row.
CREATE UNIQUE INDEX guardian_link_uq
  ON guardian_link (student_id, guardian_membership_id)
  WHERE archived_at IS NULL;

-- At most one primary contact per student.
CREATE UNIQUE INDEX guardian_link_one_primary
  ON guardian_link (student_id)
  WHERE archived_at IS NULL AND is_primary;

-- "Which students is this person responsible for" — criterion 9 of POOLSE-04,
-- and the query behind the guardian's own page.
CREATE INDEX guardian_link_guardian_idx
  ON guardian_link (organization_id, guardian_membership_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER guardian_link_updated_at BEFORE UPDATE ON guardian_link
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE guardian_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY guardian_link_tenant ON guardian_link
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON guardian_link TO poolse_app;

-- ---------------------------------------------------------------------------
-- Migrating today's free-text guardians into real people
--
-- Criterion 10 asks for a merge with a report of what was merged. The report is
-- the audit log: one `guardian.migrated` row per link created, carrying the name
-- it came from, so an operator can see exactly what this did rather than taking
-- it on trust.
--
-- Matched on NIF first, then email — the stable keys criterion 8 names. Two
-- siblings sharing a mother's phone number and address become one guardian with
-- two links, which is the whole point.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  v_membership uuid;
  v_first text;
  v_last  text;
BEGIN
  FOR r IN
    SELECT id, organization_id, guardian_name, guardian_relationship, guardian_phone,
           guardian_email, guardian_tax_number, guardian_address
      FROM student
     WHERE guardian_name IS NOT NULL
       AND archived_at IS NULL
  LOOP
    -- "Maria Alves Costa" → first "Maria", last "Alves Costa". Crude, and right
    -- far more often than any alternative: Portuguese names put the given name
    -- first and carry two or more surnames.
    v_first := split_part(btrim(r.guardian_name), ' ', 1);
    v_last  := btrim(substr(btrim(r.guardian_name), length(v_first) + 1));
    IF v_last = '' THEN v_last := v_first; END IF;

    v_membership := NULL;

    -- Already known to this club? NIF first, then email.
    IF r.guardian_tax_number IS NOT NULL THEN
      SELECT id INTO v_membership FROM membership
       WHERE organization_id = r.organization_id
         AND tax_number = r.guardian_tax_number
         AND archived_at IS NULL;
    END IF;

    IF v_membership IS NULL AND r.guardian_email IS NOT NULL THEN
      SELECT m.id INTO v_membership FROM membership m
       LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE m.organization_id = r.organization_id
         AND coalesce(u.cached_email, m.email) = r.guardian_email
         AND m.archived_at IS NULL;
    END IF;

    IF v_membership IS NULL THEN
      INSERT INTO membership (organization_id, status, first_name, last_name,
                              email, phone, tax_number, address)
      VALUES (r.organization_id, 'active', v_first, v_last,
              r.guardian_email, r.guardian_phone, r.guardian_tax_number,
              r.guardian_address)
      RETURNING id INTO v_membership;

      INSERT INTO membership_role (organization_id, membership_id, role)
      VALUES (r.organization_id, v_membership, 'guardian');
    ELSE
      -- Known already, in some other capacity. Give them the role rather than a
      -- second record — criterion 9, and the reason this ticket exists.
      INSERT INTO membership_role (organization_id, membership_id, role)
      SELECT r.organization_id, v_membership, 'guardian'
       WHERE NOT EXISTS (
         SELECT 1 FROM membership_role
          WHERE membership_id = v_membership
            AND role = 'guardian'
            AND archived_at IS NULL
       );
    END IF;

    INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                               relationship, is_primary)
    VALUES (r.organization_id, r.id, v_membership, r.guardian_relationship, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    VALUES (
      r.organization_id, 'guardian.migrated', 'student', r.id,
      jsonb_build_object(
        'guardianMembershipId', v_membership,
        'fromName', r.guardian_name,
        'matchedExisting', v_membership IS NOT NULL
      )
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The free-text columns go
--
-- Superseded, not merely unused: leaving them would leave two places a
-- guardian's phone number could live, and the next tired evening would write to
-- the wrong one.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS student_guardian_email_idx;

ALTER TABLE student
  DROP CONSTRAINT IF EXISTS student_guardian_fields_not_blank,
  DROP CONSTRAINT IF EXISTS student_guardian_email_shape;

ALTER TABLE student
  DROP COLUMN guardian_name,
  DROP COLUMN guardian_relationship,
  DROP COLUMN guardian_phone,
  DROP COLUMN guardian_email,
  DROP COLUMN guardian_tax_number,
  DROP COLUMN guardian_address;

-- Down Migration

ALTER TABLE student
  ADD COLUMN guardian_name         text,
  ADD COLUMN guardian_relationship text,
  ADD COLUMN guardian_phone        text,
  ADD COLUMN guardian_email        citext,
  ADD COLUMN guardian_tax_number   text,
  ADD COLUMN guardian_address      text;

-- The primary guardian's details go back onto the student. A student who gained
-- a second guardian while this migration was applied keeps only the first, which
-- is the most the old shape could hold.
UPDATE student s
   SET guardian_name         = person_name(gl.guardian_membership_id),
       guardian_relationship = gl.relationship,
       guardian_phone        = m.phone,
       guardian_email        = person_email(gl.guardian_membership_id),
       guardian_tax_number   = m.tax_number,
       guardian_address      = m.address
  FROM guardian_link gl
  JOIN membership m ON m.id = gl.guardian_membership_id
 WHERE gl.student_id = s.id
   AND gl.archived_at IS NULL
   AND gl.is_primary;

ALTER TABLE student
  ADD CONSTRAINT student_guardian_fields_not_blank
  CHECK (
    (guardian_name IS NULL OR btrim(guardian_name) <> '')
    AND (guardian_relationship IS NULL OR btrim(guardian_relationship) <> '')
    AND (guardian_phone IS NULL OR btrim(guardian_phone) <> '')
    AND (guardian_tax_number IS NULL OR btrim(guardian_tax_number) <> '')
    AND (guardian_address IS NULL OR btrim(guardian_address) <> '')
  );

ALTER TABLE student
  ADD CONSTRAINT student_guardian_email_shape
  CHECK (guardian_email IS NULL OR guardian_email::text ~ '^[^[:space:]@]+@[^[:space:]@.]+\.[^[:space:]@]+$');

CREATE INDEX student_guardian_email_idx
  ON student (organization_id, guardian_email)
  WHERE archived_at IS NULL AND guardian_email IS NOT NULL;

DROP TABLE IF EXISTS guardian_link;

DROP INDEX IF EXISTS student_membership_idx;
ALTER TABLE student DROP CONSTRAINT IF EXISTS student_organization_id_membership_id_fkey;
ALTER TABLE student DROP COLUMN IF EXISTS membership_id;

DROP FUNCTION IF EXISTS person_email(uuid);
DROP FUNCTION IF EXISTS person_name(uuid);

DROP INDEX IF EXISTS membership_email_uq;
DROP INDEX IF EXISTS membership_tax_number_uq;

ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_person_has_a_name,
  DROP CONSTRAINT IF EXISTS membership_birth_date_sane,
  DROP CONSTRAINT IF EXISTS membership_email_shape,
  DROP CONSTRAINT IF EXISTS membership_person_fields_not_blank,
  DROP CONSTRAINT IF EXISTS membership_identity_belongs_to_one_owner;

ALTER TABLE membership
  DROP COLUMN IF EXISTS birth_date,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS tax_number,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS first_name;
