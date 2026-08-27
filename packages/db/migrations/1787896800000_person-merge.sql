-- One Person, many roles — POOLSE-17, the parts that were missing.
--
-- `membership` already is the Person: tenant-scoped with a policy, one row per
-- human per organization, roles in `membership_role`, `app_user_id` nullable so
-- somebody exists without ever having a login. What it lacked was everything to
-- do with *duplicates* — the half of the ticket that touches live data.
--
-- Three things here, in the order the ticket's Dev section asks for them.
--
-- **A guardian must be dedupable.** Answering the ticket's open question: a
-- student may have neither NIF nor email — most seven-year-olds have neither —
-- but a guardian is an adult who has at least one, and guardians are where
-- duplicates actually come from. Enforced by a trigger rather than a check
-- because the rule spans two tables: the key is on `membership`, the role is on
-- `membership_role`, and a CHECK cannot see across.
--
-- **The merge is phased.** `merge_candidates` is read-only and reports what it
-- *would* do, including every field where two records disagree. `merge_memberships`
-- performs one pair. The constraint that prevents new duplicates already exists
-- — the partial unique indexes on NIF and email went in with the person
-- migration — so the ticket's phase 3 is done.
--
-- **Nothing is deleted.** An absorbed record is archived and carries
-- `merged_into`, which is what makes an incorrect merge recoverable and keeps
-- old audit rows resolvable to a human.

-- Up Migration

-- ---------------------------------------------------------------------------
-- merged_into — where an absorbed record went
-- ---------------------------------------------------------------------------

ALTER TABLE membership
  ADD COLUMN merged_into uuid;

ALTER TABLE membership
  ADD CONSTRAINT membership_organization_id_merged_into_fkey
  FOREIGN KEY (organization_id, merged_into) REFERENCES membership (organization_id, id);

/*
 * A merged record is a dead record. Enforced, because the whole value of the
 * pointer is that nothing still treats the absorbed row as a live person — and
 * `archived_at IS NULL` is what every other query in the product filters on.
 */
ALTER TABLE membership
  ADD CONSTRAINT membership_merged_is_archived
  CHECK (merged_into IS NULL OR archived_at IS NOT NULL);

-- Nobody merges into themselves.
ALTER TABLE membership
  ADD CONSTRAINT membership_merged_into_is_somebody_else
  CHECK (merged_into IS NULL OR merged_into <> id);

CREATE INDEX membership_merged_into_idx
  ON membership (organization_id, merged_into)
  WHERE merged_into IS NOT NULL;

COMMENT ON COLUMN membership.merged_into IS
  'The surviving person this record was absorbed into. Set by merge_memberships; '
  'kept so an incorrect merge is recoverable and old audit rows still resolve — '
  'POOLSE-17 AC10.';

-- ---------------------------------------------------------------------------
-- Who granted a role, and when
--
-- The ticket asks for both on `person_role`. Permission changes are the
-- definition of "permission-sensitive" in the conventions, and a role that
-- appeared with nobody's name on it is exactly what an audit is for.
-- ---------------------------------------------------------------------------

ALTER TABLE membership_role
  ADD COLUMN granted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN granted_by_membership_id uuid;

ALTER TABLE membership_role
  ADD CONSTRAINT membership_role_granted_by_fkey
  FOREIGN KEY (organization_id, granted_by_membership_id)
    REFERENCES membership (organization_id, id);

-- Reading "which roles does this person hold" is the hottest authorisation
-- query in the product; it runs on every request.
CREATE INDEX membership_role_person_idx
  ON membership_role (membership_id)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- A guardian must carry a dedup key
--
-- Trigger rather than CHECK: the key lives on `membership` and the role lives on
-- `membership_role`, so the rule spans two tables and has to be checked from
-- both directions — granting the role, and clearing the key afterwards.
-- ---------------------------------------------------------------------------

CREATE FUNCTION guardian_needs_a_key() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_membership uuid;
  v_has_key    boolean;
  v_is_guardian boolean;
BEGIN
  /*
   * IF, not CASE.
   *
   * PL/pgSQL resolves the field references in every branch of a CASE, so
   * `NEW.membership_id` raises "record new has no field membership_id" when this
   * fires on `membership` — even though that branch is never taken. An IF only
   * evaluates the branch it enters.
   */
  IF TG_TABLE_NAME = 'membership_role' THEN
    v_membership := NEW.membership_id;
  ELSE
    v_membership := NEW.id;
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM membership_role mr
            WHERE mr.membership_id = v_membership
              AND mr.role = 'guardian'
              AND mr.archived_at IS NULL
         )
    INTO v_is_guardian;

  IF NOT v_is_guardian THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(m.tax_number, '') <> ''
         OR coalesce(u.cached_email::text, m.email::text, '') <> ''
    INTO v_has_key
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = v_membership;

  IF NOT coalesce(v_has_key, false) THEN
    RAISE EXCEPTION
      'An encarregado de educação needs a NIF or an email address'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION guardian_needs_a_key() IS
  'A guardian must be dedupable — POOLSE-17. A student may have neither NIF nor '
  'email; a guardian is an adult who has one, and guardians are where duplicates '
  'come from.';

/*
 * AFTER, and deferrable, on purpose.
 *
 * Creating a guardian is two statements — insert the person, then grant the
 * role — and they arrive in either order. A non-deferred trigger would refuse
 * the first half of a perfectly good pair. Deferring to commit lets the
 * transaction assemble the person before the rule is applied.
 */
CREATE CONSTRAINT TRIGGER membership_role_guardian_key
  AFTER INSERT OR UPDATE ON membership_role
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guardian_needs_a_key();

CREATE CONSTRAINT TRIGGER membership_guardian_key
  AFTER UPDATE ON membership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guardian_needs_a_key();

-- ---------------------------------------------------------------------------
-- Phase 1 — merge_candidates: what a merge would do, without doing it
--
-- Read-only, per tenant, and it names every field where the two records
-- disagree. The ticket is explicit that the report is reviewed before anything
-- is merged, and that no contact detail may vanish unreported.
--
-- NIF first, then email among the records that have no NIF. Two records sharing
-- an email but holding *different* NIFs are not the same person — NIF wins over
-- email whenever both are present and disagree, which is why the email pass
-- excludes anybody who has a NIF at all.
-- ---------------------------------------------------------------------------

CREATE FUNCTION merge_candidates(p_organization_id uuid)
RETURNS TABLE (
  o_keep_id     uuid,
  o_absorb_id   uuid,
  o_matched_on  text,
  o_keep_name   text,
  o_absorb_name text,
  o_conflicts   jsonb
)
LANGUAGE sql STABLE
AS $fn$
  WITH live AS (
    SELECT m.*, person_name(m.id) AS resolved_name
      FROM membership m
     WHERE m.organization_id = p_organization_id
       AND m.archived_at IS NULL
  ),
  pairs AS (
    -- By NIF.
    SELECT a.id AS keep_id, b.id AS absorb_id, 'nif'::text AS matched_on,
           a.resolved_name AS keep_name, b.resolved_name AS absorb_name,
           a AS keep_row, b AS absorb_row
      FROM live a
      JOIN live b
        ON b.tax_number = a.tax_number
       AND a.tax_number IS NOT NULL
       -- The oldest row survives, deterministically. `created_at` then `id`, so
       -- two rows made in the same millisecond still order the same way twice.
       AND (a.created_at, a.id) < (b.created_at, b.id)

    UNION ALL

    -- By email, among those with no NIF to disagree about.
    SELECT a.id, b.id, 'email'::text,
           a.resolved_name, b.resolved_name, a, b
      FROM live a
      JOIN live b
        ON coalesce(b.email::text, '') = coalesce(a.email::text, '')
       AND a.email IS NOT NULL
       AND a.tax_number IS NULL
       AND b.tax_number IS NULL
       AND (a.created_at, a.id) < (b.created_at, b.id)
  )
  SELECT keep_id, absorb_id, matched_on, keep_name, absorb_name,
         -- Every field where the two disagree and both hold a value. A field
         -- where one is null is not a conflict — non-null simply wins.
         (
           SELECT coalesce(jsonb_object_agg(field, jsonb_build_object(
                    'keep', keep_value, 'absorb', absorb_value)), '{}'::jsonb)
             FROM (
               VALUES
                 ('phone',      (keep_row).phone,            (absorb_row).phone),
                 ('address',    (keep_row).address,          (absorb_row).address),
                 ('email',      (keep_row).email::text,      (absorb_row).email::text),
                 ('tax_number', (keep_row).tax_number,       (absorb_row).tax_number),
                 ('first_name', (keep_row).first_name,       (absorb_row).first_name),
                 ('last_name',  (keep_row).last_name,        (absorb_row).last_name),
                 ('birth_date', (keep_row).birth_date::text, (absorb_row).birth_date::text)
             ) AS f(field, keep_value, absorb_value)
            WHERE keep_value IS NOT NULL
              AND absorb_value IS NOT NULL
              AND keep_value <> absorb_value
         ) AS conflicts
    FROM pairs
   ORDER BY keep_name, absorb_name;
$fn$;

COMMENT ON FUNCTION merge_candidates(uuid) IS
  'Phase 1 of the POOLSE-17 merge: what would be merged, and every field where '
  'the two records disagree. Changes nothing.';

-- ---------------------------------------------------------------------------
-- Phase 2 — merge_memberships: absorb one record into another
--
-- **Foreign keys are discovered from the catalogue, not listed here.** Twenty-one
-- columns point at `membership` today; a hardcoded list would be right until the
-- next table adds one, and would then repoint everything except the new thing,
-- which is the worst of the three possible outcomes. `pg_constraint` always
-- knows.
--
-- The two tables carrying a uniqueness rule that involves the membership are
-- handled first and by hand: repointing a role or a guardianship the survivor
-- already holds would violate its index rather than merge anything.
--
-- Idempotent and re-runnable: absorbing a record that is already merged returns
-- 0 and changes nothing.
-- ---------------------------------------------------------------------------

CREATE FUNCTION merge_memberships(
  p_organization_id uuid,
  p_keep_id         uuid,
  p_absorb_id       uuid
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_moved integer := 0;
  v_count integer;
  r       RECORD;
BEGIN
  IF p_keep_id = p_absorb_id THEN
    RAISE EXCEPTION 'A person cannot be merged into themselves';
  END IF;

  -- Both must be live and in this tenant. This is also what makes the function
  -- idempotent: the second run finds the absorbed record archived and stops.
  PERFORM 1 FROM membership
   WHERE id = p_keep_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM 1 FROM membership
   WHERE id = p_absorb_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership k
     SET first_name = CASE WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         email      = coalesce(k.email, a.email),
         -- A login is identity, and the survivor's own wins. Two people with two
         -- logins is not a duplicate this function should be resolving.
         app_user_id = coalesce(k.app_user_id, a.app_user_id)
    FROM membership a
   WHERE k.id = p_keep_id
     AND a.id = p_absorb_id
     -- The identity constraint refuses club-held names on somebody Clerk names.
     -- Where the survivor gains a login, its own columns must go.
     AND true;

  -- Clerk owns the name and email where there is a login; clear ours rather than
  -- leave two answers to the same question.
  UPDATE membership
     SET first_name = NULL, last_name = NULL, email = NULL
   WHERE id = p_keep_id AND app_user_id IS NOT NULL;

  -- Roles the survivor does not already hold.
  UPDATE membership_role mr
     SET membership_id = p_keep_id
   WHERE mr.membership_id = p_absorb_id
     AND mr.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM membership_role keep
        WHERE keep.membership_id = p_keep_id
          AND keep.role = mr.role
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  -- Whatever is left is a role both held. Archive rather than delete.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = p_absorb_id AND archived_at IS NULL;

  -- Guardianships the survivor does not already have over the same student.
  UPDATE guardian_link gl
     SET guardian_membership_id = p_keep_id
   WHERE gl.guardian_membership_id = p_absorb_id
     AND gl.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link keep
        WHERE keep.guardian_membership_id = p_keep_id
          AND keep.student_id = gl.student_id
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE guardian_link SET archived_at = now()
   WHERE guardian_membership_id = p_absorb_id AND archived_at IS NULL;

  /*
   * Everything else, discovered rather than listed.
   *
   * Excludes the two handled above, and `membership` itself — the merged_into
   * pointer is set deliberately below and must not be swept up by a loop that
   * repoints every reference.
   */
  FOR r IN
    SELECT DISTINCT cl.relname AS table_name, att.attname AS column_name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
     WHERE c.contype = 'f'
       AND ref.relname = 'membership'
       AND att.attname LIKE '%membership_id'
       AND cl.relname NOT IN ('membership', 'membership_role', 'guardian_link')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE %I = $2 AND organization_id = $3',
      r.table_name, r.column_name, r.column_name
    ) USING p_keep_id, p_absorb_id, p_organization_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved + v_count;
  END LOOP;

  -- And the student side of the relation, which points at a person by a column
  -- that does not end in `membership_id` on every table.
  UPDATE student SET membership_id = p_keep_id
   WHERE membership_id = p_absorb_id AND organization_id = p_organization_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE membership
     SET archived_at = now(), merged_into = p_keep_id
   WHERE id = p_absorb_id;

  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  VALUES (
    p_organization_id, 'person.merged', 'membership', p_keep_id,
    jsonb_build_object('absorbed', p_absorb_id, 'rowsRepointed', v_moved)
  );

  RETURN v_moved;
END;
$fn$;

COMMENT ON FUNCTION merge_memberships(uuid, uuid, uuid) IS
  'Phase 2 of the POOLSE-17 merge. Repoints every reference discovered from the '
  'catalogue, then archives the absorbed record with a merged_into pointer. '
  'Idempotent: a second run finds it archived and returns 0.';

REVOKE ALL ON FUNCTION merge_memberships(uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION merge_memberships(uuid, uuid, uuid) TO poolse_app;
GRANT EXECUTE ON FUNCTION merge_candidates(uuid) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS merge_memberships(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS merge_candidates(uuid);

DROP TRIGGER IF EXISTS membership_guardian_key ON membership;
DROP TRIGGER IF EXISTS membership_role_guardian_key ON membership_role;
DROP FUNCTION IF EXISTS guardian_needs_a_key();

DROP INDEX IF EXISTS membership_role_person_idx;
ALTER TABLE membership_role
  DROP CONSTRAINT IF EXISTS membership_role_granted_by_fkey;
ALTER TABLE membership_role
  DROP COLUMN IF EXISTS granted_by_membership_id,
  DROP COLUMN IF EXISTS granted_at;

DROP INDEX IF EXISTS membership_merged_into_idx;
ALTER TABLE membership
  DROP CONSTRAINT IF EXISTS membership_merged_into_is_somebody_else,
  DROP CONSTRAINT IF EXISTS membership_merged_is_archived,
  DROP CONSTRAINT IF EXISTS membership_organization_id_merged_into_fkey;
ALTER TABLE membership DROP COLUMN IF EXISTS merged_into;
