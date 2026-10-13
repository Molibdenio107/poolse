-- Up Migration
--
-- End-of-session sweep, 13 October 2026 — what review found in POOLSE-69.
--
-- 1. **A short or long club name could no longer sign up.** `organization_slug_shape`
--    (3–60) arrived with the lead table, but `slugify()` never cut or padded, so
--    "GD" (2) and a 78-character junta name were refused inside
--    `provision_organization` — a 500 at signup. `slugify()` now cuts to 50 and
--    pads anything under 3 as `piscina-…`, leaving room for the `-<n>` suffix.
--
-- 2. **A slug a club gave up could be claimed by another club, which would then
--    receive the first club's sign-ups** from every poster and QR still printed.
--    `slug_claim` holds every slug any club has ever used, for ever; its primary
--    key is the whole enforcement. It is tenant-scoped like everything else: a
--    club reads its own claims, and the key — which RLS does not hide — refuses
--    another club's. A slug a club used before is its own to go back to.
--    Provisioning runs as the definer and sees every claim, so it steps past a
--    claimed slug the way it already steps past a live one.
--
-- 3. `submit_lead` locked the club row `FOR UPDATE`, which waits on every
--    foreign-key check in that club; `FOR NO KEY UPDATE` serialises racing
--    submits without that.
--
-- 4. The trial trigger answered "unavailable" (409) for a session that is not
--    the club's; it now answers as the foreign key would (404).
--
-- 5. `public_lead_form` returns the club's `ageOfMajority`, so the form asks for
--    a guardian exactly where conversion will require one. A lead the form
--    accepted and the student path then refused could only be dismissed.


CREATE OR REPLACE FUNCTION slugify(p_text text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN length(s) = 0 THEN ''
           WHEN length(s) < 3 THEN 'piscina-' || s
           ELSE s
         END
    FROM (
      SELECT trim(BOTH '-' FROM left(
        trim(BOTH '-' FROM
          regexp_replace(
            regexp_replace(
              lower(translate(
                coalesce(p_text, ''),
                'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
              )),
              '[^a-z0-9]+', '-', 'g'
            ),
            '-{2,}', '-', 'g'
          )
        ), 50)) AS s
    ) shaped;
$$;

-- ---------------------------------------------------------------------------
-- slug_claim
-- ---------------------------------------------------------------------------

CREATE TABLE slug_claim (
  slug            text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organization (id),
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug)
);

COMMENT ON TABLE slug_claim IS
  'Every slug a club has ever used, held for ever — 13-10-2026 sweep. Its primary '
  'key is what stops a printed /inscricao link reaching a different club.';

-- Live clubs first, so where an archived club and a live one share a slug today
-- (the old index was partial on live rows) the live one keeps it.
INSERT INTO slug_claim (slug, organization_id, claimed_at)
SELECT DISTINCT ON (slug) slug, id, created_at
  FROM organization
 ORDER BY slug, (archived_at IS NULL) DESC, created_at;

ALTER TABLE slug_claim ENABLE ROW LEVEL SECURITY;
CREATE POLICY slug_claim_tenant ON slug_claim
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Claimed, never released.
GRANT SELECT, INSERT ON slug_claim TO poolse_app;
REVOKE UPDATE, DELETE ON slug_claim FROM poolse_app;

-- Before a new club is written: step past any slug somebody once held. Only
-- provisioning inserts organizations, as the definer, so this sees every claim.
CREATE FUNCTION organization_avoids_claimed_slug() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_base text := NEW.slug;
  v_n    integer := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM slug_claim WHERE slug = NEW.slug) LOOP
    v_n := v_n + 1;
    NEW.slug := v_base || '-' || v_n;
  END LOOP;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER organization_slug_unclaimed
  BEFORE INSERT ON organization
  FOR EACH ROW EXECUTE FUNCTION organization_avoids_claimed_slug();

-- After the row exists (the claim's key points at it): claim the slug, and
-- refuse one another club holds — under the live index's own name, so the API's
-- existing "address taken" mapping answers it.
CREATE FUNCTION organization_claims_slug() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug = OLD.slug THEN
    RETURN NULL;
  END IF;

  INSERT INTO slug_claim (slug, organization_id)
  VALUES (NEW.slug, NEW.id)
  ON CONFLICT (slug) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM slug_claim WHERE slug = NEW.slug AND organization_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'The slug % belongs to another club', NEW.slug
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'organization_slug_uq';
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER organization_slug_claimed
  AFTER INSERT OR UPDATE OF slug ON organization
  FOR EACH ROW EXECUTE FUNCTION organization_claims_slug();

-- ---------------------------------------------------------------------------
-- The lead functions, restated with their fixes
-- ---------------------------------------------------------------------------


CREATE OR REPLACE FUNCTION submit_lead(p_slug text, p_lead jsonb) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
$fn$;

CREATE OR REPLACE FUNCTION public_lead_form(p_slug text) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org      uuid;
  v_name     text;
  v_majority smallint;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.name, o.age_of_majority INTO v_org, v_name, v_majority
    FROM organization o
   WHERE o.slug = p_slug
     AND o.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.read_only_at IS NULL
     AND o.public_registration_open
     AND o.kind = 'business';

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'clubName', v_name,
    'ageOfMajority', v_majority,
    'facilities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) ORDER BY f.name)
        FROM facility f
       WHERE f.organization_id = v_org AND f.archived_at IS NULL), '[]'::jsonb),
    'levels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name)
                       ORDER BY l.sort_order, l.name)
        FROM student_level l
       WHERE l.organization_id = v_org AND l.archived_at IS NULL), '[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION lead_trial_respects_capacity() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_session  record;
  v_free     integer;
BEGIN
  IF NEW.status <> 'trial_booked' OR NEW.trial_session_id IS NULL OR NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- An UPDATE that leaves an existing booking where it was is not a new claim.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'trial_booked'
     AND OLD.trial_session_id IS NOT DISTINCT FROM NEW.trial_session_id
     AND OLD.archived_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cs.id, cs.status::text AS status, cs.starts_at, cs.class_group_id, cg.capacity
    INTO v_session
    FROM class_session cs
    LEFT JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = NEW.trial_session_id AND cs.organization_id = NEW.organization_id
     FOR UPDATE OF cs;

  -- No such session in this club: the foreign key's answer, given here
  -- because this trigger runs before the key is checked.
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'No such session'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A partnership hour, a cancelled class or one already started is not
  -- somewhere a family can try a lesson.
  IF v_session.class_group_id IS NULL
     OR v_session.status = 'cancelled'
     OR v_session.starts_at <= now() THEN
    RAISE EXCEPTION 'This occurrence cannot take an aula experimental'
      USING ERRCODE = 'check_violation', DETAIL = 'trial_session_unavailable';
  END IF;

  -- Null capacity means not measured, and enforces nothing.
  IF v_session.capacity IS NULL THEN
    RETURN NEW;
  END IF;

  v_free := session_free_seats(NEW.trial_session_id);
  IF v_free < 1 THEN
    RAISE EXCEPTION 'This occurrence is full'
      USING ERRCODE = 'check_violation',
            DETAIL = format('trial_capacity|%s|%s', v_session.capacity,
                            v_session.capacity - v_free);
  END IF;

  RETURN NEW;
END;
$fn$;

-- Down Migration

CREATE OR REPLACE FUNCTION lead_trial_respects_capacity() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_session  record;
  v_free     integer;
BEGIN
  IF NEW.status <> 'trial_booked' OR NEW.trial_session_id IS NULL OR NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- An UPDATE that leaves an existing booking where it was is not a new claim.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'trial_booked'
     AND OLD.trial_session_id IS NOT DISTINCT FROM NEW.trial_session_id
     AND OLD.archived_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cs.id, cs.status::text AS status, cs.starts_at, cs.class_group_id, cg.capacity
    INTO v_session
    FROM class_session cs
    LEFT JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = NEW.trial_session_id AND cs.organization_id = NEW.organization_id
     FOR UPDATE OF cs;

  -- A partnership hour, a cancelled class or one already started is not
  -- somewhere a family can try a lesson.
  IF v_session.id IS NULL
     OR v_session.class_group_id IS NULL
     OR v_session.status = 'cancelled'
     OR v_session.starts_at <= now() THEN
    RAISE EXCEPTION 'This occurrence cannot take an aula experimental'
      USING ERRCODE = 'check_violation', DETAIL = 'trial_session_unavailable';
  END IF;

  -- Null capacity means not measured, and enforces nothing.
  IF v_session.capacity IS NULL THEN
    RETURN NEW;
  END IF;

  v_free := session_free_seats(NEW.trial_session_id);
  IF v_free < 1 THEN
    RAISE EXCEPTION 'This occurrence is full'
      USING ERRCODE = 'check_violation',
            DETAIL = format('trial_capacity|%s|%s', v_session.capacity,
                            v_session.capacity - v_free);
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public_lead_form(p_slug text) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org  uuid;
  v_name text;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.name INTO v_org, v_name
    FROM organization o
   WHERE o.slug = p_slug
     AND o.archived_at IS NULL
     AND o.suspended_at IS NULL
     AND o.read_only_at IS NULL
     AND o.public_registration_open
     AND o.kind = 'business';

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'clubName', v_name,
    'facilities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) ORDER BY f.name)
        FROM facility f
       WHERE f.organization_id = v_org AND f.archived_at IS NULL), '[]'::jsonb),
    'levels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name)
                       ORDER BY l.sort_order, l.name)
        FROM student_level l
       WHERE l.organization_id = v_org AND l.archived_at IS NULL), '[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION submit_lead(p_slug text, p_lead jsonb) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
     FOR UPDATE;

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
$fn$;

DROP TRIGGER IF EXISTS organization_slug_claimed ON organization;
DROP FUNCTION IF EXISTS organization_claims_slug();
DROP TRIGGER IF EXISTS organization_slug_unclaimed ON organization;
DROP FUNCTION IF EXISTS organization_avoids_claimed_slug();
DROP POLICY IF EXISTS slug_claim_tenant ON slug_claim;
DROP TABLE IF EXISTS slug_claim;

CREATE OR REPLACE FUNCTION slugify(p_text text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH '-' FROM
    regexp_replace(
      regexp_replace(
        lower(translate(
          coalesce(p_text, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
        )),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-{2,}', '-', 'g'
    )
  );
$$;
