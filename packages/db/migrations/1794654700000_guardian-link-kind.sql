-- POOLSE-206 (Rui, 09-11-2026): a parent's link stops counting at 18, an
-- acompanhante's does not, and nobody is their own guardian.
--
-- `guardian_link` held two things in one row: the encarregado de educação of a
-- minor, whose responsibilities end at majority (Código Civil, art. 122.º), and
-- the court-appointed acompanhante of a *maior acompanhado* (Lei 49/2018), whose
-- do not. Poolse could not tell them apart, so a child who turned 18 stayed a
-- child in the app forever. `kind` tells them apart; every existing link is
-- `parental`.
--
-- **A view, not a function**, for "the links that grant guardian rights now":
-- `guardian_access` has exactly `guardian_link`'s columns, so each reader that
-- grants moves by changing one table name, and a reader that forgets is visibly
-- still on `guardian_link`. It is `security_invoker`, so RLS on guardian_link,
-- student and organization applies to whoever queries it. Nothing is stored:
-- the birthday is read against `club_today()`, so a link stops granting on the
-- day with no job and no write.
--
-- A parental link grants while the student is under the club's age of majority,
-- or their age is not known: no birth date, or a declared one. Missing or
-- declared data never makes an adult (unchanged from POOLSE-23).
--
-- The readers, by decision:
--   grants  -> guardian_access: student_is_adult_path, family_may_answer,
--              pass_family, level_change_recipients, message_recipients_all.
--   payer   -> guardian_link, every live link: invoice_payer_membership_id.
--              A former parent who paid keeps paying, and reads fees and
--              Extratos only (rule 4).
--   history -> guardian_link: apply_retention, merge_memberships,
--              accept_invitation (a comment only).
--   unchanged, because they only act on a student with no birth date, for
--   whom both readings agree: student_birth_date_fill,
--   membership_birth_date_fill, app_user_birth_date_fill, and the login
--   fallback inside the student_person view.

-- Up Migration

CREATE TYPE guardian_link_kind AS ENUM ('parental', 'accompanying');

ALTER TABLE guardian_link
  ADD COLUMN kind guardian_link_kind NOT NULL DEFAULT 'parental';

COMMENT ON COLUMN guardian_link.kind IS
  'POOLSE-206: parental (encarregado de educação of a minor; grants nothing once the student is of age) '
  'or accompanying (acompanhante of a maior acompanhado, Lei 49/2018; grants at any age). '
  'Never inferred from relationship.';

/*
 * Nobody is their own guardian. A CHECK cannot read the student row, so a
 * trigger; it refuses in words the API maps (`guardian_is_self`).
 */
CREATE FUNCTION guardian_link_not_self() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.archived_at IS NULL AND EXISTS (
       SELECT 1 FROM student s
        WHERE s.id = NEW.student_id
          AND s.organization_id = NEW.organization_id
          AND s.membership_id = NEW.guardian_membership_id) THEN
    RAISE EXCEPTION 'guardian_is_self: a person cannot be their own guardian'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER guardian_link_not_self
  BEFORE INSERT OR UPDATE OF student_id, guardian_membership_id, archived_at ON guardian_link
  FOR EACH ROW EXECUTE FUNCTION guardian_link_not_self();

/*
 * Whether a student is of age today: a confirmed birth date at or past the
 * club's age of majority. A declared date, or none, is not of age.
 */
CREATE FUNCTION student_of_age(p_organization_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce((
    SELECT s.birth_date IS NOT NULL
       AND s.birth_date_declared_at IS NULL
       AND s.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
      FROM student s
      JOIN organization o ON o.id = s.organization_id
     WHERE s.id = p_student_id AND s.organization_id = p_organization_id), false)
$fn$;

CREATE VIEW guardian_access WITH (security_invoker = true) AS
  SELECT g.*
    FROM guardian_link g
   WHERE g.archived_at IS NULL
     AND (g.kind = 'accompanying'
          OR NOT student_of_age(g.organization_id, g.student_id));

COMMENT ON VIEW guardian_access IS
  'POOLSE-206: the live guardian links that grant guardian rights today. A parental link drops out '
  'on the student''s birthday at the club''s age of majority; an accompanying one never does. '
  'security_invoker, so RLS applies as the querying role. The payer and history readers use guardian_link.';

GRANT SELECT ON guardian_access TO poolse_app;

CREATE OR REPLACE FUNCTION public.student_is_adult_path(p_organization_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT s.birth_date IS NOT NULL
     AND s.birth_date_declared_at IS NULL
     AND s.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
     AND NOT EXISTS (
       SELECT 1 FROM guardian_access g
        WHERE g.student_id = s.id
          AND g.organization_id = s.organization_id
          AND g.archived_at IS NULL
     )
    FROM student s
    JOIN organization o ON o.id = s.organization_id
   WHERE s.id = p_student_id AND s.organization_id = p_organization_id
$function$;

CREATE OR REPLACE FUNCTION public.family_may_answer(p_organization_id uuid, p_student_id uuid, p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM guardian_access gl
            WHERE gl.organization_id = p_organization_id
              AND gl.student_id = p_student_id
              AND gl.guardian_membership_id = p_membership_id
              AND gl.archived_at IS NULL)
      OR EXISTS (
           SELECT 1 FROM student s
            WHERE s.organization_id = p_organization_id
              AND s.id = p_student_id
              AND s.membership_id = p_membership_id
              AND (student_is_adult_path(p_organization_id, p_student_id)
                   OR (s.birth_date IS NOT NULL
                       AND date_part('year', age(club_today(), s.birth_date)) >= self_answer_min_age())))
$function$;

CREATE OR REPLACE FUNCTION public.pass_family(p_org uuid, p_pass_id uuid)
 RETURNS TABLE(membership_id uuid, student_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p.membership_id, p.student_id
    FROM pass p
   WHERE p.organization_id = p_org AND p.id = p_pass_id
     AND (p.membership_id IS NOT NULL OR p.student_id IS NOT NULL)
  UNION
  SELECT NULL::uuid, g.student_id
    FROM pass p
    JOIN guardian_access g
      ON g.organization_id = p.organization_id
     AND g.guardian_membership_id = p.membership_id
     AND g.archived_at IS NULL
    JOIN student s
      ON s.organization_id = g.organization_id AND s.id = g.student_id
     AND s.archived_at IS NULL
   WHERE p.organization_id = p_org AND p.id = p_pass_id AND p.shared
$function$;

CREATE OR REPLACE FUNCTION public.level_change_recipients(p_organization_id uuid, p_student_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
  WITH guardians AS (
    SELECT nullif(btrim(person_email(g.guardian_membership_id)::text), '') AS email
      FROM guardian_access g
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.student_id = p_student_id
       AND g.organization_id = p_organization_id
       AND g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  own AS (
    SELECT nullif(btrim(coalesce(person_email(s.membership_id), s.contact_email)::text), '') AS email
      FROM student s
     WHERE s.id = p_student_id AND s.organization_id = p_organization_id
  )
  SELECT coalesce(array_agg(DISTINCT email), '{}')
    FROM (
      SELECT email FROM guardians WHERE email IS NOT NULL
      UNION ALL
      SELECT email FROM own
       WHERE email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM guardians)
    ) addresses;
$function$;

CREATE OR REPLACE FUNCTION public.message_recipients_all(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
      -- POOLSE-146: the turma's sport is its recinto's; a turma with none is swimming's.
      LEFT JOIN playing_area pa
        ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             -- POOLSE-146: everybody in one sport — a student in two is one row (DISTINCT).
             WHEN 'sport'        THEN coalesce(pa.sport_id, 'pool') = p_sport_id
             -- POOLSE-90 slice 4: one cancelled lesson's turma (the caller passes it).
             WHEN 'session'      THEN cg.id = p_class_group_id
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
    UNION
    -- POOLSE-191: one person, enrolled or not: a reminder may precede a turma.
    SELECT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name)
      FROM student s
     WHERE p_audience = 'student'
       AND s.id = p_student_id
       AND s.organization_id = p_organization_id
       AND s.archived_at IS NULL
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_access g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$function$;

CREATE OR REPLACE FUNCTION public.merge_memberships(p_organization_id uuid, p_keep_id uuid, p_absorb_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
   * What is not a duplicate — sweep of 15-10-2026.
   *
   * Absorbing the Owner moved the `owner` row onto the survivor and archived the
   * Owner: an Admin could merge themselves with the Owner and be the Owner, the
   * invite matrix and `transfer_ownership` walked round. Ownership changes hands
   * only by transfer. Two records that each have their own login are two
   * people, and a support membership is Poolse's, never the club's.
   */
  IF EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = p_absorb_id AND role = 'owner' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'merge_absorbs_owner' USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM membership
       WHERE id IN (p_keep_id, p_absorb_id) AND app_user_id IS NOT NULL) = 2 THEN
    RAISE EXCEPTION 'merge_two_logins' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership
     WHERE id IN (p_keep_id, p_absorb_id) AND support_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'merge_support' USING ERRCODE = 'P0001';
  END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership SET archived_at = now() WHERE id = p_absorb_id;

  UPDATE membership k
     SET first_name = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         -- POOLSE-149: the staff record's details, non-null wins.
         locality           = coalesce(k.locality, a.locality),
         postal_code        = coalesce(k.postal_code, a.postal_code),
         niss               = coalesce(k.niss, a.niss),
         nationality        = coalesce(k.nationality, a.nationality),
         birthplace         = coalesce(k.birthplace, a.birthplace),
         emergency_name     = coalesce(k.emergency_name, a.emergency_name),
         emergency_phone    = coalesce(k.emergency_phone, a.emergency_phone),
         emergency_relation = coalesce(k.emergency_relation, a.emergency_relation),
         email      = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL ELSE coalesce(k.email, a.email) END,
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

  /*
   * POOLSE-206: a link whose guardian and student become one person is
   * archived, not moved. Moving it would either trip guardian_link_not_self
   * (the guardian moves onto the student's own record) or, once the loop below
   * repoints student.membership_id, leave a self-link the trigger never saw.
   */
  UPDATE guardian_link gl
     SET archived_at = now()
    FROM student s
   WHERE s.id = gl.student_id AND s.organization_id = gl.organization_id
     AND gl.organization_id = p_organization_id
     AND gl.archived_at IS NULL
     AND gl.guardian_membership_id IN (p_keep_id, p_absorb_id)
     AND s.membership_id IN (p_keep_id, p_absorb_id);

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
       /*
        * Only what the caller may change. The insert-only history tables
        * (audit_log, invoice, incident, …) hold no UPDATE for poolse_app, and one
        * UPDATE statement against them failed the whole merge with 42501 — it had
        * never run as the app login. Their rows stay with the absorbed record,
        * which points at the survivor through `merged_into`: history is not
        * rewritten, which is also what an insert-only table is for.
        */
       AND has_column_privilege('poolse_app', c.conrelid, att.attname, 'UPDATE')
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
$function$;

-- Down Migration

CREATE OR REPLACE FUNCTION public.student_is_adult_path(p_organization_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT s.birth_date IS NOT NULL
     AND s.birth_date_declared_at IS NULL
     AND s.birth_date <= (club_today() - make_interval(years => o.age_of_majority))
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link g
        WHERE g.student_id = s.id
          AND g.organization_id = s.organization_id
          AND g.archived_at IS NULL
     )
    FROM student s
    JOIN organization o ON o.id = s.organization_id
   WHERE s.id = p_student_id AND s.organization_id = p_organization_id
$function$;

CREATE OR REPLACE FUNCTION public.family_may_answer(p_organization_id uuid, p_student_id uuid, p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM guardian_link gl
            WHERE gl.organization_id = p_organization_id
              AND gl.student_id = p_student_id
              AND gl.guardian_membership_id = p_membership_id
              AND gl.archived_at IS NULL)
      OR EXISTS (
           SELECT 1 FROM student s
            WHERE s.organization_id = p_organization_id
              AND s.id = p_student_id
              AND s.membership_id = p_membership_id
              AND (student_is_adult_path(p_organization_id, p_student_id)
                   OR (s.birth_date IS NOT NULL
                       AND date_part('year', age(club_today(), s.birth_date)) >= self_answer_min_age())))
$function$;

CREATE OR REPLACE FUNCTION public.pass_family(p_org uuid, p_pass_id uuid)
 RETURNS TABLE(membership_id uuid, student_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p.membership_id, p.student_id
    FROM pass p
   WHERE p.organization_id = p_org AND p.id = p_pass_id
     AND (p.membership_id IS NOT NULL OR p.student_id IS NOT NULL)
  UNION
  SELECT NULL::uuid, g.student_id
    FROM pass p
    JOIN guardian_link g
      ON g.organization_id = p.organization_id
     AND g.guardian_membership_id = p.membership_id
     AND g.archived_at IS NULL
    JOIN student s
      ON s.organization_id = g.organization_id AND s.id = g.student_id
     AND s.archived_at IS NULL
   WHERE p.organization_id = p_org AND p.id = p_pass_id AND p.shared
$function$;

CREATE OR REPLACE FUNCTION public.level_change_recipients(p_organization_id uuid, p_student_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
  WITH guardians AS (
    SELECT nullif(btrim(person_email(g.guardian_membership_id)::text), '') AS email
      FROM guardian_link g
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.student_id = p_student_id
       AND g.organization_id = p_organization_id
       AND g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  own AS (
    SELECT nullif(btrim(coalesce(person_email(s.membership_id), s.contact_email)::text), '') AS email
      FROM student s
     WHERE s.id = p_student_id AND s.organization_id = p_organization_id
  )
  SELECT coalesce(array_agg(DISTINCT email), '{}')
    FROM (
      SELECT email FROM guardians WHERE email IS NOT NULL
      UNION ALL
      SELECT email FROM own
       WHERE email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM guardians)
    ) addresses;
$function$;

CREATE OR REPLACE FUNCTION public.message_recipients_all(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text, p_student_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
      -- POOLSE-146: the turma's sport is its recinto's; a turma with none is swimming's.
      LEFT JOIN playing_area pa
        ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             -- POOLSE-146: everybody in one sport — a student in two is one row (DISTINCT).
             WHEN 'sport'        THEN coalesce(pa.sport_id, 'pool') = p_sport_id
             -- POOLSE-90 slice 4: one cancelled lesson's turma (the caller passes it).
             WHEN 'session'      THEN cg.id = p_class_group_id
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
    UNION
    -- POOLSE-191: one person, enrolled or not: a reminder may precede a turma.
    SELECT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name)
      FROM student s
     WHERE p_audience = 'student'
       AND s.id = p_student_id
       AND s.organization_id = p_organization_id
       AND s.archived_at IS NULL
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$function$;

CREATE OR REPLACE FUNCTION public.merge_memberships(p_organization_id uuid, p_keep_id uuid, p_absorb_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
   * What is not a duplicate — sweep of 15-10-2026.
   *
   * Absorbing the Owner moved the `owner` row onto the survivor and archived the
   * Owner: an Admin could merge themselves with the Owner and be the Owner, the
   * invite matrix and `transfer_ownership` walked round. Ownership changes hands
   * only by transfer. Two records that each have their own login are two
   * people, and a support membership is Poolse's, never the club's.
   */
  IF EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = p_absorb_id AND role = 'owner' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'merge_absorbs_owner' USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM membership
       WHERE id IN (p_keep_id, p_absorb_id) AND app_user_id IS NOT NULL) = 2 THEN
    RAISE EXCEPTION 'merge_two_logins' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership
     WHERE id IN (p_keep_id, p_absorb_id) AND support_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'merge_support' USING ERRCODE = 'P0001';
  END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership SET archived_at = now() WHERE id = p_absorb_id;

  UPDATE membership k
     SET first_name = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         -- POOLSE-149: the staff record's details, non-null wins.
         locality           = coalesce(k.locality, a.locality),
         postal_code        = coalesce(k.postal_code, a.postal_code),
         niss               = coalesce(k.niss, a.niss),
         nationality        = coalesce(k.nationality, a.nationality),
         birthplace         = coalesce(k.birthplace, a.birthplace),
         emergency_name     = coalesce(k.emergency_name, a.emergency_name),
         emergency_phone    = coalesce(k.emergency_phone, a.emergency_phone),
         emergency_relation = coalesce(k.emergency_relation, a.emergency_relation),
         email      = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL ELSE coalesce(k.email, a.email) END,
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
       /*
        * Only what the caller may change. The insert-only history tables
        * (audit_log, invoice, incident, …) hold no UPDATE for poolse_app, and one
        * UPDATE statement against them failed the whole merge with 42501 — it had
        * never run as the app login. Their rows stay with the absorbed record,
        * which points at the survivor through `merged_into`: history is not
        * rewritten, which is also what an insert-only table is for.
        */
       AND has_column_privilege('poolse_app', c.conrelid, att.attname, 'UPDATE')
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
$function$;

DROP VIEW guardian_access;
DROP FUNCTION student_of_age(uuid, uuid);
DROP TRIGGER guardian_link_not_self ON guardian_link;
DROP FUNCTION guardian_link_not_self();
ALTER TABLE guardian_link DROP COLUMN kind;
DROP TYPE guardian_link_kind;
