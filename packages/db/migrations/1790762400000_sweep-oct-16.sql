-- Up Migration

-- ===========================================================================
-- Sweep, 16-10-2026.
--
-- **Retention read too many students as gone** (7b.8). `student_left_on()`
-- counted anybody without an active or waiting enrolment as departed since
-- they were created: a sócio paying only a quota, a new student waiting for a
-- turma. Their health data would have been erased a year after signing up,
-- and the student page told the club they had left. Now a live fee line also
-- means "still here", a student never enrolled has not left until archived,
-- and the leaving day is the latest of the last enrolment, fee line and mark.
--
-- **Nor may it anonymise a kept child's emergency contact.** A parent who
-- existed only for the departed child could still be another child's
-- emergency contact, and that child's phone number reads through them.
--
-- **Two functions still read the UTC day** rather than `club_today()`: the
-- first season's year at signup, and the profile's birth-date check.
--
-- **A flooded sign-up form now says so.** `submit_lead()` dropped everything
-- past thirty leads in ten minutes without a trace; it now records
-- `lead.ceiling_reached`, which the Pedidos page shows.
-- ===========================================================================

CREATE OR REPLACE FUNCTION student_left_on(p_student_id uuid) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN s.archived_at IS NOT NULL
             THEN (s.archived_at AT TIME ZONE 'Europe/Lisbon')::date
           -- Still here: a live enrolment, or a live fee line. A sócio who pays
           -- a quota and swims in no turma is a member, not a departure.
           WHEN EXISTS (
             SELECT 1 FROM enrollment e
              WHERE e.student_id = s.id AND e.status IN ('active', 'waiting')
           ) OR EXISTS (
             SELECT 1 FROM student_fee f
              WHERE f.student_id = s.id AND f.archived_at IS NULL
                AND (f.ends_on IS NULL OR f.ends_on >= club_today())
           ) THEN NULL
           -- Never enrolled and not archived: somebody waiting for a turma has
           -- not left. Only the club archiving them says they have.
           WHEN NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = s.id)
             THEN NULL
           ELSE greatest(
             (SELECT max(e.ended_on) FROM enrollment e WHERE e.student_id = s.id),
             (SELECT max(f.ends_on) FROM student_fee f
               WHERE f.student_id = s.id AND f.archived_at IS NULL),
             (SELECT max(cs.occurs_on) FROM attendance a
                JOIN class_session cs ON cs.id = a.class_session_id
               WHERE a.student_id = s.id)
           )
         END
    FROM student s
   WHERE s.id = p_student_id
$$;

CREATE OR REPLACE FUNCTION apply_retention()
RETURNS TABLE (health_erased integer, anonymised integer, leads_anonymised integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org       uuid := current_organization_id();
  v_today     date := club_today();
  v_health    uuid[];
  v_identity  uuid[];
  v_people    uuid[];
  v_leads     integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'apply_retention() runs inside a tenant context';
  END IF;

  -- ----------------------------------------------------------- health, 1 year
  SELECT coalesce(array_agg(s.id), '{}') INTO v_health
    FROM student s
   WHERE s.organization_id = v_org
     AND s.health_erased_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_health_period();

  IF cardinality(v_health) > 0 THEN
    DELETE FROM student_sensitive
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    DELETE FROM consent
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    UPDATE attendance SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health) AND note IS NOT NULL;
    UPDATE student_medical_leave SET reason = NULL, justification_reference = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health)
       AND (reason IS NOT NULL OR justification_reference IS NOT NULL);
    UPDATE student
       SET emergency_contact_membership_id = NULL,
           emergency_contact_name = NULL,
           emergency_contact_phone = NULL,
           emergency_contact_relationship = NULL,
           health_erased_at = now()
     WHERE organization_id = v_org AND id = ANY (v_health);

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.health_erased', 'student', id,
           jsonb_build_object('period', retention_health_period()::text)
      FROM unnest(v_health) AS id;
  END IF;

  -- -------------------------------------------------------- identity, 5 years
  SELECT coalesce(array_agg(s.id), '{}') INTO v_identity
    FROM student s
   WHERE s.organization_id = v_org
     AND s.anonymised_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_identity_period();

  IF cardinality(v_identity) > 0 THEN
    /*
     * The people behind them who exist only for them: a guardian, or the
     * student's own person record, with no login (Clerk owns a login's name),
     * no role but guardian or student, and no link to a student kept.
     */
    SELECT coalesce(array_agg(DISTINCT m.id), '{}') INTO v_people
      FROM membership m
     WHERE m.organization_id = v_org
       AND m.app_user_id IS NULL
       AND (
         m.id IN (SELECT gl.guardian_membership_id FROM guardian_link gl
                   WHERE gl.organization_id = v_org AND gl.student_id = ANY (v_identity))
         OR m.id IN (SELECT s.membership_id FROM student s
                      WHERE s.organization_id = v_org AND s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM membership_role r
          WHERE r.membership_id = m.id AND r.archived_at IS NULL
            AND r.role NOT IN ('guardian', 'student')
       )
       AND NOT EXISTS (
         SELECT 1 FROM guardian_link gl
           JOIN student s ON s.id = gl.student_id
          WHERE gl.guardian_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       -- Nor anybody who is still a kept student's emergency contact: that
       -- child's phone number reads through this person.
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.emergency_contact_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       );

    UPDATE student
       SET first_name = 'Aluno', last_name = 'anonimizado',
           birth_date = NULL, contact_email = NULL, contact_phone = NULL,
           tax_number = NULL, notes = NULL, gender = NULL,
           photo_storage_key = NULL, socio_number = NULL,
           anonymised_at = now()
     WHERE organization_id = v_org AND id = ANY (v_identity);

    UPDATE student_record SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND note IS NOT NULL;

    -- Incidents are kept for the same five years, then their words go. The
    -- facts (when, where, emergency, lifeguard) stay, naming nobody.
    DELETE FROM incident_addendum
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));
    DELETE FROM incident_detail
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));

    UPDATE message_recipient
       SET student_name = 'Aluno anonimizado',
           name = CASE WHEN guardian_membership_id IS NULL THEN 'Aluno anonimizado' ELSE name END,
           email = CASE WHEN guardian_membership_id IS NULL THEN NULL ELSE email END
     WHERE organization_id = v_org AND student_id = ANY (v_identity);

    UPDATE lead
       SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
           swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
           swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
           guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
           phone = NULL, note = NULL, anonymised_at = now()
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND anonymised_at IS NULL;

    IF cardinality(v_people) > 0 THEN
      -- The role first: a live guardian must have a NIF or an e-mail
      -- (`guardian_needs_a_key`), and these are about to have neither.
      UPDATE membership_role SET archived_at = now()
       WHERE organization_id = v_org AND membership_id = ANY (v_people) AND archived_at IS NULL;
      UPDATE membership
         SET first_name = 'Pessoa', last_name = 'anonimizada',
             email = NULL, phone = NULL, tax_number = NULL, address = NULL,
             birth_date = NULL, notes = NULL,
             archived_at = coalesce(archived_at, now())
       WHERE organization_id = v_org AND id = ANY (v_people);
      UPDATE message_recipient SET name = 'Pessoa anonimizada', email = NULL
       WHERE organization_id = v_org AND guardian_membership_id = ANY (v_people);
    END IF;

    -- Names copied into the trail. The entries stay; the names in them go.
    UPDATE audit_log SET data = data - 'name' - 'fromName'
     WHERE organization_id = v_org
       AND entity_id = ANY (v_identity || v_people)
       AND (data ? 'name' OR data ? 'fromName');

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.anonymised', 'student', id,
           jsonb_build_object('period', retention_identity_period()::text,
                              'people', cardinality(v_people))
      FROM unnest(v_identity) AS id;
  END IF;

  -- ------------------------------------- leads that never became a student
  -- Archived after twelve months unconverted (`lead_retention()`), then kept
  -- the same five years as anybody else's identity.
  UPDATE lead
     SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
         swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
         swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
         guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
         phone = NULL, note = NULL, anonymised_at = now()
   WHERE organization_id = v_org
     AND student_id IS NULL
     AND anonymised_at IS NULL
     AND archived_at <= now() - retention_identity_period();
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  RETURN QUERY SELECT cardinality(v_health), cardinality(v_identity), v_leads;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.provision_organization(p_clerk_user_id text, p_name text, p_locale text, p_facility_name text, p_kind organization_kind DEFAULT 'business'::organization_kind, p_signup_ip_hash text DEFAULT NULL::text)
 RETURNS TABLE(o_organization_id uuid, o_membership_id uuid, o_facility_id uuid, o_slug text, o_pool_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user          uuid;
  v_org           uuid;
  v_membership    uuid;
  v_facility      uuid;
  v_pool          uuid;
  v_season        uuid;
  v_start_year    int;
  v_name          text := btrim(p_name);
  v_facility_name text := btrim(coalesce(nullif(btrim(p_facility_name), ''), p_name));
  v_base          text;
  v_slug          text;
  v_suffix        int := 1;
  v_trial_ends    timestamptz := now() + trial_period();
  v_email         text;
  v_normalized    text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'provision_organization requires a name';
  END IF;

  SELECT id, cached_email INTO v_user, v_email
    FROM app_user
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'provision_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  -- A name of nothing but punctuation slugifies to an empty string, which would
  -- otherwise become a unique index entry of ''.
  v_base := coalesce(nullif(slugify(v_name), ''), 'org');
  v_slug := v_base;

  WHILE EXISTS (SELECT 1 FROM organization WHERE slug = v_slug AND archived_at IS NULL) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  END LOOP;

  INSERT INTO organization (kind, name, locale, slug, subscription_status, trial_ends_at)
  VALUES (
    coalesce(p_kind, 'business'),
    v_name,
    coalesce(nullif(btrim(p_locale), ''), 'pt-PT'),
    v_slug,
    'trialing',
    v_trial_ends
  )
  -- The slug as stored: the claim trigger may have stepped past a retired one.
  RETURNING id, slug INTO v_org, v_slug;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');

  -- The first facility, so the new tenant is not an empty room. Everything in
  -- module 1 hangs off a facility, so an organization without one cannot hold a
  -- class group, a schedule or an attendance record — the operator would have to
  -- discover that themselves before anything worked.
  INSERT INTO facility (organization_id, name)
  VALUES (v_org, v_facility_name)
  RETURNING id INTO v_facility;

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user,
    'organization.created', 'organization', v_org,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'kind', coalesce(p_kind, 'business'),
                       'trial_ends_at', v_trial_ends)
  ), (
    v_org, v_membership, v_user,
    'facility.created', 'facility', v_facility,
    jsonb_build_object('name', v_facility_name, 'source', 'signup')
  );

  IF coalesce(p_kind, 'business') = 'personal' THEN
    -- The pool, named like the site: an individual has one, and asking them to
    -- name it at signup is a question with one answer. `outdoor` because a garden
    -- pool usually is, and it is one select on the pool's page if not.
    INSERT INTO pool (organization_id, facility_id, name, kind)
    VALUES (v_org, v_facility, v_facility_name, 'outdoor')
    RETURNING id INTO v_pool;

    INSERT INTO audit_log (
      organization_id, actor_membership_id, actor_app_user_id,
      action, entity_type, entity_id, data
    ) VALUES (
      v_org, v_membership, v_user,
      'pool.created', 'pool', v_pool,
      jsonb_build_object('name', v_facility_name, 'source', 'signup')
    );
  ELSE
    -- The first season, for the same reason as the facility and a stronger one:
    -- `class_group` requires it, so without this the very first turma fails on a
    -- NOT NULL. September to August, pivoting in August because that is the
    -- month the pool is shut and there is nothing left to run.
    v_start_year := CASE
                      WHEN extract(month FROM club_today()) >= 8
                        THEN extract(year FROM club_today())::int
                      ELSE extract(year FROM club_today())::int - 1
                    END;

    INSERT INTO season (organization_id, name, starts_on, ends_on)
    VALUES (
      v_org,
      to_char(v_start_year, 'FM9999') || '/' || to_char(v_start_year + 1, 'FM9999'),
      make_date(v_start_year, 9, 1),
      make_date(v_start_year + 1, 8, 31)
    )
    RETURNING id INTO v_season;

    INSERT INTO audit_log (
      organization_id, actor_membership_id, actor_app_user_id,
      action, entity_type, entity_id, data
    ) VALUES (
      v_org, v_membership, v_user,
      'season.created', 'season', v_season,
      jsonb_build_object('source', 'signup')
    );
  END IF;

  /*
   * The claim, last.
   *
   * **A user with no cached address claims nothing rather than claiming ''.** An
   * address is Clerk's and the cache can be a moment behind on a laptop, where
   * the webhook cannot reach; refusing the signup over that would break the one
   * path a developer uses every day, and a claim of empty string would block the
   * *next* such signup for ever. The block is a ledger, not a login check.
   */
  v_normalized := normalize_signup_email(v_email);

  IF v_normalized IS NOT NULL THEN
    INSERT INTO trial_claim (organization_id, normalized_email, email_domain, signup_ip_hash)
    VALUES (
      v_org,
      v_normalized,
      split_part(lower(btrim(v_email)), '@', 2),
      nullif(btrim(coalesce(p_signup_ip_hash, '')), '')
    );
  END IF;

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug, v_pool;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_app_user_profile(p_clerk_user_id text, p_locale text, p_theme text, p_birth_date date, p_contact_phone text)
 RETURNS TABLE(o_locale text, o_theme text, o_birth_date date, o_contact_phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_found boolean;
BEGIN
  IF p_locale IS NULL OR p_theme IS NULL THEN
    RAISE EXCEPTION 'set_app_user_profile: locale and theme are required';
  END IF;

  -- Checked here as well as by the constraints, so a bad value comes back as a
  -- sentence rather than as a constraint name the API would have to parse.
  IF p_locale NOT IN ('pt-PT', 'en') THEN
    RAISE EXCEPTION 'Unsupported locale: %', p_locale;
  END IF;
  IF p_theme NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'Unsupported theme: %', p_theme;
  END IF;
  IF p_birth_date IS NOT NULL AND p_birth_date > club_today() THEN
    RAISE EXCEPTION 'Birth date is in the future: %', p_birth_date;
  END IF;

  UPDATE app_user
     SET locale           = p_locale,
         theme_preference = p_theme,
         birth_date       = p_birth_date,
         contact_phone    = nullif(btrim(p_contact_phone), '')
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL
  RETURNING true INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'set_app_user_profile: no live app_user for %', p_clerk_user_id;
  END IF;

  RETURN QUERY
    SELECT u.locale, u.theme_preference, u.birth_date, u.contact_phone
      FROM app_user u
     WHERE u.clerk_user_id = p_clerk_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_lead(p_slug text, p_lead jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org       uuid;
  v_facility  uuid;
  v_level     uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN;
  END IF;

  -- Locked, so the per-club ceiling below counts every racing submit.
  SELECT o.id INTO v_org
    FROM organization o
   WHERE o.slug = p_slug
     AND o.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.read_only_at IS NULL
     AND o.public_registration_open
     AND o.kind = 'business'
     FOR NO KEY UPDATE;

  IF v_org IS NULL THEN
    RETURN;
  END IF;

  -- The per-club ceiling: a September queue is a few hundred over weeks, so
  -- thirty in ten minutes is somebody's script, not a busy evening.
  IF (SELECT count(*) FROM lead
       WHERE organization_id = v_org
         AND created_at > now() - interval '10 minutes') >= 30 THEN
    -- Said, once per window: a silent drop let one script hide every real
    -- parent's request from the club — 16-10-2026 sweep. The staff queue
    -- reads this entry and says so.
    IF NOT EXISTS (
      SELECT 1 FROM audit_log
       WHERE organization_id = v_org AND action = 'lead.ceiling_reached'
         AND created_at > now() - interval '10 minutes'
    ) THEN
      INSERT INTO audit_log (organization_id, action, entity_type, data)
      VALUES (v_org, 'lead.ceiling_reached', 'organization', '{}'::jsonb);
    END IF;
    RETURN;
  END IF;

  -- An id that is not this club's is dropped to "no preference" rather than
  -- refused: the composite key would refuse it, but a refusal is an answer.
  SELECT f.id INTO v_facility FROM facility f
   WHERE f.organization_id = v_org AND f.archived_at IS NULL
     AND f.id::text = p_lead->>'facilityId';
  SELECT l.id INTO v_level FROM student_level l
   WHERE l.organization_id = v_org AND l.archived_at IS NULL
     AND l.id::text = p_lead->>'levelId';

  INSERT INTO lead (
    organization_id, facility_id, level_id, preferred_days,
    swimmer_first_name, swimmer_last_name, swimmer_birth_date, swimmer_tax_number,
    guardian_name, guardian_relationship, guardian_tax_number,
    email, phone, note, locale, consent_text_version, consented_at
  ) VALUES (
    v_org, v_facility, v_level,
    coalesce((SELECT array_agg(d::smallint) FROM jsonb_array_elements_text(
                coalesce(p_lead->'preferredDays', '[]'::jsonb)) d), '{}'),
    p_lead->>'swimmerFirstName', p_lead->>'swimmerLastName',
    (p_lead->>'swimmerBirthDate')::date, nullif(p_lead->>'swimmerTaxNumber', ''),
    nullif(p_lead->>'guardianName', ''), nullif(p_lead->>'guardianRelationship', ''),
    nullif(p_lead->>'guardianTaxNumber', ''),
    p_lead->>'email', nullif(p_lead->>'phone', ''), nullif(p_lead->>'note', ''),
    coalesce(p_lead->>'locale', 'pt-PT'),
    p_lead->>'consentTextVersion', now()
  );
END;
$function$;

-- Down Migration

CREATE OR REPLACE FUNCTION student_left_on(p_student_id uuid) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN s.archived_at IS NOT NULL
             THEN (s.archived_at AT TIME ZONE 'Europe/Lisbon')::date
           WHEN EXISTS (
             SELECT 1 FROM enrollment e
              WHERE e.student_id = s.id AND e.status IN ('active', 'waiting')
           ) THEN NULL
           ELSE greatest(
             (s.created_at AT TIME ZONE 'Europe/Lisbon')::date,
             (SELECT max(e.ended_on) FROM enrollment e WHERE e.student_id = s.id)
           )
         END
    FROM student s
   WHERE s.id = p_student_id
$$;

CREATE OR REPLACE FUNCTION apply_retention()
RETURNS TABLE (health_erased integer, anonymised integer, leads_anonymised integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org       uuid := current_organization_id();
  v_today     date := club_today();
  v_health    uuid[];
  v_identity  uuid[];
  v_people    uuid[];
  v_leads     integer;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'apply_retention() runs inside a tenant context';
  END IF;

  -- ----------------------------------------------------------- health, 1 year
  SELECT coalesce(array_agg(s.id), '{}') INTO v_health
    FROM student s
   WHERE s.organization_id = v_org
     AND s.health_erased_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_health_period();

  IF cardinality(v_health) > 0 THEN
    DELETE FROM student_sensitive
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    DELETE FROM consent
     WHERE organization_id = v_org AND student_id = ANY (v_health);
    UPDATE attendance SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health) AND note IS NOT NULL;
    UPDATE student_medical_leave SET reason = NULL, justification_reference = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_health)
       AND (reason IS NOT NULL OR justification_reference IS NOT NULL);
    UPDATE student
       SET emergency_contact_membership_id = NULL,
           emergency_contact_name = NULL,
           emergency_contact_phone = NULL,
           emergency_contact_relationship = NULL,
           health_erased_at = now()
     WHERE organization_id = v_org AND id = ANY (v_health);

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.health_erased', 'student', id,
           jsonb_build_object('period', retention_health_period()::text)
      FROM unnest(v_health) AS id;
  END IF;

  -- -------------------------------------------------------- identity, 5 years
  SELECT coalesce(array_agg(s.id), '{}') INTO v_identity
    FROM student s
   WHERE s.organization_id = v_org
     AND s.anonymised_at IS NULL
     AND student_left_on(s.id) <= v_today - retention_identity_period();

  IF cardinality(v_identity) > 0 THEN
    /*
     * The people behind them who exist only for them: a guardian, or the
     * student's own person record, with no login (Clerk owns a login's name),
     * no role but guardian or student, and no link to a student kept.
     */
    SELECT coalesce(array_agg(DISTINCT m.id), '{}') INTO v_people
      FROM membership m
     WHERE m.organization_id = v_org
       AND m.app_user_id IS NULL
       AND (
         m.id IN (SELECT gl.guardian_membership_id FROM guardian_link gl
                   WHERE gl.organization_id = v_org AND gl.student_id = ANY (v_identity))
         OR m.id IN (SELECT s.membership_id FROM student s
                      WHERE s.organization_id = v_org AND s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM membership_role r
          WHERE r.membership_id = m.id AND r.archived_at IS NULL
            AND r.role NOT IN ('guardian', 'student')
       )
       AND NOT EXISTS (
         SELECT 1 FROM guardian_link gl
           JOIN student s ON s.id = gl.student_id
          WHERE gl.guardian_membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       )
       AND NOT EXISTS (
         SELECT 1 FROM student s
          WHERE s.membership_id = m.id
            AND s.anonymised_at IS NULL AND NOT (s.id = ANY (v_identity))
       );

    UPDATE student
       SET first_name = 'Aluno', last_name = 'anonimizado',
           birth_date = NULL, contact_email = NULL, contact_phone = NULL,
           tax_number = NULL, notes = NULL, gender = NULL,
           photo_storage_key = NULL, socio_number = NULL,
           anonymised_at = now()
     WHERE organization_id = v_org AND id = ANY (v_identity);

    UPDATE student_record SET note = NULL
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND note IS NOT NULL;

    -- Incidents are kept for the same five years, then their words go. The
    -- facts (when, where, emergency, lifeguard) stay, naming nobody.
    DELETE FROM incident_addendum
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));
    DELETE FROM incident_detail
     WHERE organization_id = v_org
       AND incident_id IN (SELECT id FROM incident
                            WHERE organization_id = v_org AND student_id = ANY (v_identity));

    UPDATE message_recipient
       SET student_name = 'Aluno anonimizado',
           name = CASE WHEN guardian_membership_id IS NULL THEN 'Aluno anonimizado' ELSE name END,
           email = CASE WHEN guardian_membership_id IS NULL THEN NULL ELSE email END
     WHERE organization_id = v_org AND student_id = ANY (v_identity);

    UPDATE lead
       SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
           swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
           swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
           guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
           phone = NULL, note = NULL, anonymised_at = now()
     WHERE organization_id = v_org AND student_id = ANY (v_identity) AND anonymised_at IS NULL;

    IF cardinality(v_people) > 0 THEN
      -- The role first: a live guardian must have a NIF or an e-mail
      -- (`guardian_needs_a_key`), and these are about to have neither.
      UPDATE membership_role SET archived_at = now()
       WHERE organization_id = v_org AND membership_id = ANY (v_people) AND archived_at IS NULL;
      UPDATE membership
         SET first_name = 'Pessoa', last_name = 'anonimizada',
             email = NULL, phone = NULL, tax_number = NULL, address = NULL,
             birth_date = NULL, notes = NULL,
             archived_at = coalesce(archived_at, now())
       WHERE organization_id = v_org AND id = ANY (v_people);
      UPDATE message_recipient SET name = 'Pessoa anonimizada', email = NULL
       WHERE organization_id = v_org AND guardian_membership_id = ANY (v_people);
    END IF;

    -- Names copied into the trail. The entries stay; the names in them go.
    UPDATE audit_log SET data = data - 'name' - 'fromName'
     WHERE organization_id = v_org
       AND entity_id = ANY (v_identity || v_people)
       AND (data ? 'name' OR data ? 'fromName');

    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT v_org, 'retention.anonymised', 'student', id,
           jsonb_build_object('period', retention_identity_period()::text,
                              'people', cardinality(v_people))
      FROM unnest(v_identity) AS id;
  END IF;

  -- ------------------------------------- leads that never became a student
  -- Archived after twelve months unconverted (`lead_retention()`), then kept
  -- the same five years as anybody else's identity.
  UPDATE lead
     SET swimmer_first_name = 'Aluno', swimmer_last_name = 'anonimizado',
         swimmer_birth_date = make_date(extract(year FROM swimmer_birth_date)::int, 1, 1),
         swimmer_tax_number = NULL, guardian_name = NULL, guardian_relationship = NULL,
         guardian_tax_number = NULL, email = 'anonimizado@anonimizado.invalid',
         phone = NULL, note = NULL, anonymised_at = now()
   WHERE organization_id = v_org
     AND student_id IS NULL
     AND anonymised_at IS NULL
     AND archived_at <= now() - retention_identity_period();
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  RETURN QUERY SELECT cardinality(v_health), cardinality(v_identity), v_leads;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.provision_organization(p_clerk_user_id text, p_name text, p_locale text, p_facility_name text, p_kind organization_kind DEFAULT 'business'::organization_kind, p_signup_ip_hash text DEFAULT NULL::text)
 RETURNS TABLE(o_organization_id uuid, o_membership_id uuid, o_facility_id uuid, o_slug text, o_pool_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user          uuid;
  v_org           uuid;
  v_membership    uuid;
  v_facility      uuid;
  v_pool          uuid;
  v_season        uuid;
  v_start_year    int;
  v_name          text := btrim(p_name);
  v_facility_name text := btrim(coalesce(nullif(btrim(p_facility_name), ''), p_name));
  v_base          text;
  v_slug          text;
  v_suffix        int := 1;
  v_trial_ends    timestamptz := now() + trial_period();
  v_email         text;
  v_normalized    text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'provision_organization requires a name';
  END IF;

  SELECT id, cached_email INTO v_user, v_email
    FROM app_user
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'provision_organization: no live app_user for %', p_clerk_user_id;
  END IF;

  -- A name of nothing but punctuation slugifies to an empty string, which would
  -- otherwise become a unique index entry of ''.
  v_base := coalesce(nullif(slugify(v_name), ''), 'org');
  v_slug := v_base;

  WHILE EXISTS (SELECT 1 FROM organization WHERE slug = v_slug AND archived_at IS NULL) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  END LOOP;

  INSERT INTO organization (kind, name, locale, slug, subscription_status, trial_ends_at)
  VALUES (
    coalesce(p_kind, 'business'),
    v_name,
    coalesce(nullif(btrim(p_locale), ''), 'pt-PT'),
    v_slug,
    'trialing',
    v_trial_ends
  )
  -- The slug as stored: the claim trigger may have stepped past a retired one.
  RETURNING id, slug INTO v_org, v_slug;

  INSERT INTO membership (organization_id, app_user_id, status)
  VALUES (v_org, v_user, 'active')
  RETURNING id INTO v_membership;

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, v_membership, 'owner');

  -- The first facility, so the new tenant is not an empty room. Everything in
  -- module 1 hangs off a facility, so an organization without one cannot hold a
  -- class group, a schedule or an attendance record — the operator would have to
  -- discover that themselves before anything worked.
  INSERT INTO facility (organization_id, name)
  VALUES (v_org, v_facility_name)
  RETURNING id INTO v_facility;

  INSERT INTO audit_log (
    organization_id, actor_membership_id, actor_app_user_id,
    action, entity_type, entity_id, data
  ) VALUES (
    v_org, v_membership, v_user,
    'organization.created', 'organization', v_org,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'kind', coalesce(p_kind, 'business'),
                       'trial_ends_at', v_trial_ends)
  ), (
    v_org, v_membership, v_user,
    'facility.created', 'facility', v_facility,
    jsonb_build_object('name', v_facility_name, 'source', 'signup')
  );

  IF coalesce(p_kind, 'business') = 'personal' THEN
    -- The pool, named like the site: an individual has one, and asking them to
    -- name it at signup is a question with one answer. `outdoor` because a garden
    -- pool usually is, and it is one select on the pool's page if not.
    INSERT INTO pool (organization_id, facility_id, name, kind)
    VALUES (v_org, v_facility, v_facility_name, 'outdoor')
    RETURNING id INTO v_pool;

    INSERT INTO audit_log (
      organization_id, actor_membership_id, actor_app_user_id,
      action, entity_type, entity_id, data
    ) VALUES (
      v_org, v_membership, v_user,
      'pool.created', 'pool', v_pool,
      jsonb_build_object('name', v_facility_name, 'source', 'signup')
    );
  ELSE
    -- The first season, for the same reason as the facility and a stronger one:
    -- `class_group` requires it, so without this the very first turma fails on a
    -- NOT NULL. September to August, pivoting in August because that is the
    -- month the pool is shut and there is nothing left to run.
    v_start_year := CASE
                      WHEN extract(month FROM current_date) >= 8
                        THEN extract(year FROM current_date)::int
                      ELSE extract(year FROM current_date)::int - 1
                    END;

    INSERT INTO season (organization_id, name, starts_on, ends_on)
    VALUES (
      v_org,
      to_char(v_start_year, 'FM9999') || '/' || to_char(v_start_year + 1, 'FM9999'),
      make_date(v_start_year, 9, 1),
      make_date(v_start_year + 1, 8, 31)
    )
    RETURNING id INTO v_season;

    INSERT INTO audit_log (
      organization_id, actor_membership_id, actor_app_user_id,
      action, entity_type, entity_id, data
    ) VALUES (
      v_org, v_membership, v_user,
      'season.created', 'season', v_season,
      jsonb_build_object('source', 'signup')
    );
  END IF;

  /*
   * The claim, last.
   *
   * **A user with no cached address claims nothing rather than claiming ''.** An
   * address is Clerk's and the cache can be a moment behind on a laptop, where
   * the webhook cannot reach; refusing the signup over that would break the one
   * path a developer uses every day, and a claim of empty string would block the
   * *next* such signup for ever. The block is a ledger, not a login check.
   */
  v_normalized := normalize_signup_email(v_email);

  IF v_normalized IS NOT NULL THEN
    INSERT INTO trial_claim (organization_id, normalized_email, email_domain, signup_ip_hash)
    VALUES (
      v_org,
      v_normalized,
      split_part(lower(btrim(v_email)), '@', 2),
      nullif(btrim(coalesce(p_signup_ip_hash, '')), '')
    );
  END IF;

  RETURN QUERY SELECT v_org, v_membership, v_facility, v_slug, v_pool;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_app_user_profile(p_clerk_user_id text, p_locale text, p_theme text, p_birth_date date, p_contact_phone text)
 RETURNS TABLE(o_locale text, o_theme text, o_birth_date date, o_contact_phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_found boolean;
BEGIN
  IF p_locale IS NULL OR p_theme IS NULL THEN
    RAISE EXCEPTION 'set_app_user_profile: locale and theme are required';
  END IF;

  -- Checked here as well as by the constraints, so a bad value comes back as a
  -- sentence rather than as a constraint name the API would have to parse.
  IF p_locale NOT IN ('pt-PT', 'en') THEN
    RAISE EXCEPTION 'Unsupported locale: %', p_locale;
  END IF;
  IF p_theme NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'Unsupported theme: %', p_theme;
  END IF;
  IF p_birth_date IS NOT NULL AND p_birth_date > current_date THEN
    RAISE EXCEPTION 'Birth date is in the future: %', p_birth_date;
  END IF;

  UPDATE app_user
     SET locale           = p_locale,
         theme_preference = p_theme,
         birth_date       = p_birth_date,
         contact_phone    = nullif(btrim(p_contact_phone), '')
   WHERE clerk_user_id = p_clerk_user_id
     AND deleted_at IS NULL
  RETURNING true INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'set_app_user_profile: no live app_user for %', p_clerk_user_id;
  END IF;

  RETURN QUERY
    SELECT u.locale, u.theme_preference, u.birth_date, u.contact_phone
      FROM app_user u
     WHERE u.clerk_user_id = p_clerk_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_lead(p_slug text, p_lead jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org       uuid;
  v_facility  uuid;
  v_level     uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN;
  END IF;

  -- Locked, so the per-club ceiling below counts every racing submit.
  SELECT o.id INTO v_org
    FROM organization o
   WHERE o.slug = p_slug
     AND o.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.read_only_at IS NULL
     AND o.public_registration_open
     AND o.kind = 'business'
     FOR NO KEY UPDATE;

  IF v_org IS NULL THEN
    RETURN;
  END IF;

  -- The per-club ceiling: a September queue is a few hundred over weeks, so
  -- thirty in ten minutes is somebody's script, not a busy evening.
  IF (SELECT count(*) FROM lead
       WHERE organization_id = v_org
         AND created_at > now() - interval '10 minutes') >= 30 THEN
    RETURN;
  END IF;

  -- An id that is not this club's is dropped to "no preference" rather than
  -- refused: the composite key would refuse it, but a refusal is an answer.
  SELECT f.id INTO v_facility FROM facility f
   WHERE f.organization_id = v_org AND f.archived_at IS NULL
     AND f.id::text = p_lead->>'facilityId';
  SELECT l.id INTO v_level FROM student_level l
   WHERE l.organization_id = v_org AND l.archived_at IS NULL
     AND l.id::text = p_lead->>'levelId';

  INSERT INTO lead (
    organization_id, facility_id, level_id, preferred_days,
    swimmer_first_name, swimmer_last_name, swimmer_birth_date, swimmer_tax_number,
    guardian_name, guardian_relationship, guardian_tax_number,
    email, phone, note, locale, consent_text_version, consented_at
  ) VALUES (
    v_org, v_facility, v_level,
    coalesce((SELECT array_agg(d::smallint) FROM jsonb_array_elements_text(
                coalesce(p_lead->'preferredDays', '[]'::jsonb)) d), '{}'),
    p_lead->>'swimmerFirstName', p_lead->>'swimmerLastName',
    (p_lead->>'swimmerBirthDate')::date, nullif(p_lead->>'swimmerTaxNumber', ''),
    nullif(p_lead->>'guardianName', ''), nullif(p_lead->>'guardianRelationship', ''),
    nullif(p_lead->>'guardianTaxNumber', ''),
    p_lead->>'email', nullif(p_lead->>'phone', ''), nullif(p_lead->>'note', ''),
    coalesce(p_lead->>'locale', 'pt-PT'),
    p_lead->>'consentTextVersion', now()
  );
END;
$function$;
