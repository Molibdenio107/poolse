-- Up Migration
--
-- Online pre-registration and trial lessons — POOLSE-69, roadmap 7.3.
--
-- A parent fills in a form from the club's own page; it becomes a `lead`, and
-- staff turn the lead into a waiting-list place, an aula experimental or an
-- enrolment without typing it again.
--
-- **This is the first tenant write with no tenant context**, so the boundary is
-- one function with a fixed body, `submit_lead()` below — the
-- `public_water_page()` pattern, applied to a write. Never "look the slug up,
-- then `withOrg`": that is a second, unreviewed cross-tenant read path, and the
-- lookup alone is what would let a stranger enumerate clubs.
--
-- **The URL is `organization.slug`**, which already existed (decisions,
-- 13-10-2026): no second `public_slug`, and the Owner may now edit it.
--
-- **A club takes public sign-ups only once it says so** —
-- `public_registration_open`, off by default. Every club has a slug from the day
-- it signs up, and a form that collected children's details for a club that never
-- asked for one would be a form nobody reads. A closed club answers exactly as an
-- unknown slug does.
--
-- **An aula experimental is a seat on one occurrence held by somebody who is not
-- a student**, so it cannot be an `attendance` row (that needs a `student_id`)
-- nor an `enrollment`. It is `lead.trial_session_id`, counted by
-- `session_free_seats()` beside the reposição guests, and refused by a trigger
-- under the session lock when the occurrence has no place — the numbers in
-- DETAIL, as `pool_capacity` does.

-- ---------------------------------------------------------------------------
-- organization — the switch, and how long a lead is kept
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN public_registration_open boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organization.public_registration_open IS
  'POOLSE-69: whether /<slug>/inscricao takes sign-ups. Off by default; a closed '
  'club answers exactly as an unknown slug does.';

-- The Owner now chooses the slug, so it gets the shape slugify() always produced:
-- lowercase ASCII, digits and single hyphens, no hyphen at either end. Existing
-- rows already satisfy it — they were all made by slugify() plus "-<n>".
ALTER TABLE organization
  ADD CONSTRAINT organization_slug_shape
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60);

-- The retention window's one definition (decisions, 13-10-2026), the way
-- trial_period() is the trial's. A function rather than a literal in the job, so
-- the screen that says "kept for 12 months" and the job that archives cannot
-- disagree.
CREATE FUNCTION lead_retention() RETURNS interval
LANGUAGE sql IMMUTABLE
AS $fn$ SELECT interval '12 months' $fn$;

COMMENT ON FUNCTION lead_retention() IS
  'POOLSE-69: how long an unconverted lead is kept before it is archived.';

-- ---------------------------------------------------------------------------
-- lead
-- ---------------------------------------------------------------------------

CREATE TYPE lead_status AS ENUM
  ('new', 'waitlisted', 'trial_booked', 'converted', 'dismissed');

CREATE TABLE lead (
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),

  -- What the family asked for. Both optional: a club with one site and a parent
  -- who does not know the level names are the ordinary case.
  facility_id               uuid,
  level_id                  uuid,
  -- ISO weekdays, 1 = Monday. Empty means "any day".
  preferred_days            smallint[] NOT NULL DEFAULT '{}',

  swimmer_first_name        text NOT NULL,
  swimmer_last_name         text NOT NULL,
  swimmer_birth_date        date NOT NULL,
  swimmer_tax_number        text,

  -- The guardian of a minor. Null for an adult signing themselves up; whether
  -- the swimmer *is* an adult is decided by the server at conversion, from the
  -- birth date and the club's age of majority, never from this being empty.
  -- One name, as the student form's guardian takes it.
  guardian_name             text,
  guardian_relationship     text,
  guardian_tax_number       text,

  -- The contact: the guardian's for a minor, the swimmer's own otherwise.
  email                     text NOT NULL,
  phone                     text,
  note                      text,
  -- The language the form was filled in, so a reply goes out in it.
  locale                    text NOT NULL DEFAULT 'pt-PT',

  consent_text_version      text NOT NULL,
  consented_at              timestamptz NOT NULL,

  status                    lead_status NOT NULL DEFAULT 'new',
  dismissed_reason          text,
  -- Set by waitlisting or converting: the person the lead became.
  student_id                uuid,
  -- Set by booking an aula experimental.
  trial_session_id          uuid,

  decided_by_membership_id  uuid,
  decided_at                timestamptz,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- Composite, so a lead can never name another club's site, level, session or
  -- student — including a level id a stranger typed into the public form.
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, trial_session_id)
    REFERENCES class_session (organization_id, id),
  FOREIGN KEY (organization_id, decided_by_membership_id)
    REFERENCES membership (organization_id, id),

  CONSTRAINT lead_days_are_weekdays CHECK (preferred_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  CONSTRAINT lead_names_present
    CHECK (btrim(swimmer_first_name) <> '' AND btrim(swimmer_last_name) <> ''),
  -- Free text from the public internet: bounded, so a form cannot be used to
  -- park megabytes in a club's database.
  CONSTRAINT lead_text_bounded CHECK (
    length(swimmer_first_name) <= 100 AND length(swimmer_last_name) <= 100
    AND coalesce(length(guardian_name), 0) <= 200
    AND coalesce(length(guardian_relationship), 0) <= 80
    AND length(email) <= 254 AND coalesce(length(phone), 0) <= 40
    AND coalesce(length(note), 0) <= 2000
    AND coalesce(length(dismissed_reason), 0) <= 500
  ),
  CONSTRAINT lead_locale_known CHECK (locale IN ('pt-PT', 'en')),
  CONSTRAINT lead_dismissal_has_reason
    CHECK (status <> 'dismissed' OR btrim(coalesce(dismissed_reason, '')) <> ''),
  CONSTRAINT lead_person_when_placed
    CHECK (status NOT IN ('waitlisted', 'converted') OR student_id IS NOT NULL),
  CONSTRAINT lead_session_when_trial
    CHECK (status <> 'trial_booked' OR trial_session_id IS NOT NULL),
  CONSTRAINT lead_decided_when_decided
    CHECK (status = 'new' OR decided_at IS NOT NULL)
);

COMMENT ON TABLE lead IS
  'POOLSE-69: a public pre-registration, worked by staff into a waiting-list place, '
  'an aula experimental or an enrolment. Written from outside only by submit_lead().';
COMMENT ON COLUMN lead.trial_session_id IS
  'The occurrence of an aula experimental. Holds a seat while status = trial_booked, '
  'counted by session_free_seats().';
COMMENT ON COLUMN lead.archived_at IS
  'Set by staff, or by archive_stale_leads() once an unconverted lead is older than '
  'lead_retention(). Never deleted.';

-- The queue, newest first.
CREATE INDEX lead_queue_idx ON lead (organization_id, status, created_at DESC)
  WHERE archived_at IS NULL;

-- "Who is coming to this occurrence on trial", read by session_free_seats().
CREATE INDEX lead_trial_session_idx ON lead (organization_id, trial_session_id)
  WHERE status = 'trial_booked' AND archived_at IS NULL;

CREATE TRIGGER lead_updated_at BEFORE UPDATE ON lead
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lead ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_tenant ON lead
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON lead TO poolse_app;
REVOKE DELETE ON lead FROM poolse_app;

-- ---------------------------------------------------------------------------
-- session_free_seats — now minus trial guests too
--
-- Restated whole from `lapsed-holds-free-seats`, plus the last term. One
-- definition of an open place, so the reposição list and the trial booking can
-- never both take the last one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION session_free_seats(p_session_id uuid) RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  SELECT cg.capacity
         - (
             SELECT count(*)
               FROM enrollment e
              WHERE e.class_group_id = cs.class_group_id
                AND e.organization_id = cs.organization_id
                AND e.status = 'active'
           )
         + (
             -- Absences recorded on this occurrence give their place back for
             -- this date. Only for students actually enrolled, so a guest marked
             -- absent cannot free a seat they never occupied.
             SELECT count(*)
               FROM attendance a
               JOIN enrollment e
                 ON e.student_id = a.student_id
                AND e.class_group_id = cs.class_group_id
                AND e.organization_id = a.organization_id
                AND e.status = 'active'
              WHERE a.class_session_id = cs.id
                AND a.organization_id = cs.organization_id
                AND a.status IN ('absent', 'excused')
           )
         - (
             SELECT count(*)
               FROM reposicao_booking b
              WHERE b.class_session_id = cs.id
                AND b.organization_id = cs.organization_id
                AND b.archived_at IS NULL
                AND (
                  b.status = 'confirmed'
                  OR (b.status = 'pending'
                      AND (b.holds_until IS NULL OR b.holds_until > now()))
                )
           )
         - (
             -- POOLSE-69: an aula experimental holds its seat like a guest.
             SELECT count(*)
               FROM lead l
              WHERE l.trial_session_id = cs.id
                AND l.organization_id = cs.organization_id
                AND l.status = 'trial_booked'
                AND l.archived_at IS NULL
           )
    FROM class_session cs
    JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = p_session_id;
$fn$;

COMMENT ON FUNCTION session_free_seats(uuid) IS
  'Places open on one occurrence: enrolled, minus absences recorded on that date, '
  'minus reposição guests whose booking is confirmed or still within its hold, '
  'minus aulas experimentais booked into it — POOLSE-21, POOLSE-69.';

-- ---------------------------------------------------------------------------
-- The trial seat — refused in the database, under the session lock
--
-- A trial that bypassed `class_group.capacity` is the ticket's named mistake, so
-- the check is a trigger rather than an API courtesy. It locks the occurrence
-- first — the row two bookings for the last place actually contend over — and
-- then reads the shared count. The lead's own row is excluded by being written
-- only after this returns.
-- ---------------------------------------------------------------------------

CREATE FUNCTION lead_trial_respects_capacity() RETURNS trigger
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

CREATE TRIGGER lead_trial_capacity
  BEFORE INSERT OR UPDATE OF status, trial_session_id, archived_at ON lead
  FOR EACH ROW EXECUTE FUNCTION lead_trial_respects_capacity();

-- ---------------------------------------------------------------------------
-- The public form — what it may show
--
-- Given the slug of a club that takes sign-ups and is neither suspended, archived
-- nor read-only, exactly these keys:
--
--   clubName, facilities[{id, name}], levels[{id, name}]
--
-- and NULL for anything else: unknown, closed and shut look the same. The form
-- needs the names to offer a choice; nothing else about the club leaves here.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public_lead_form(p_slug text) RETURNS jsonb
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

COMMENT ON FUNCTION public_lead_form(text) IS
  'POOLSE-69: what the public sign-up form of one open club shows, and nothing '
  'else. Its result keys are asserted by a test.';

REVOKE ALL ON FUNCTION public_lead_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_lead_form(text) TO poolse_app;

-- ---------------------------------------------------------------------------
-- The public write — the whole boundary
--
-- Returns nothing, whatever happened. The API has already refused a honeypot,
-- a stale form and a noisy origin; this refuses an unknown or closed slug, a
-- club taking more than 30 leads in ten minutes, and a site or level id that is
-- not that club's — all silently, because the caller's answer must not depend
-- on any of it. Shape errors in the payload raise, and the API (which validated
-- the shape first) treats a raise as one more silent drop.
-- ---------------------------------------------------------------------------

CREATE FUNCTION submit_lead(p_slug text, p_lead jsonb) RETURNS void
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

COMMENT ON FUNCTION submit_lead(text, jsonb) IS
  'POOLSE-69: the only tenant write with no tenant context. Returns nothing, '
  'whether or not it wrote, so the public answer cannot depend on the club.';

REVOKE ALL ON FUNCTION submit_lead(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_lead(text, jsonb) TO poolse_app;

-- ---------------------------------------------------------------------------
-- Retention — archived, never deleted
--
-- Run per tenant inside its own policy by the daily job. Unconverted means
-- anything but `converted`: a waitlisted lead's person already lives on as a
-- student, which this does not touch.
-- ---------------------------------------------------------------------------

CREATE FUNCTION archive_stale_leads() RETURNS integer
LANGUAGE sql
AS $fn$
  WITH stale AS (
    UPDATE lead SET archived_at = now()
     WHERE organization_id = current_organization_id()
       AND archived_at IS NULL
       AND status <> 'converted'
       AND created_at < now() - lead_retention()
    RETURNING 1
  )
  SELECT count(*)::int FROM stale;
$fn$;

COMMENT ON FUNCTION archive_stale_leads() IS
  'POOLSE-69: archives the current tenant''s unconverted leads older than '
  'lead_retention(). Never deletes.';

GRANT EXECUTE ON FUNCTION archive_stale_leads() TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS archive_stale_leads();
DROP FUNCTION IF EXISTS submit_lead(text, jsonb);
DROP FUNCTION IF EXISTS public_lead_form(text);
DROP TRIGGER IF EXISTS lead_trial_capacity ON lead;
DROP FUNCTION IF EXISTS lead_trial_respects_capacity();

-- session_free_seats back to `lapsed-holds-free-seats`, verbatim.
CREATE OR REPLACE FUNCTION session_free_seats(p_session_id uuid) RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  SELECT cg.capacity
         - (
             SELECT count(*)
               FROM enrollment e
              WHERE e.class_group_id = cs.class_group_id
                AND e.organization_id = cs.organization_id
                AND e.status = 'active'
           )
         + (
             SELECT count(*)
               FROM attendance a
               JOIN enrollment e
                 ON e.student_id = a.student_id
                AND e.class_group_id = cs.class_group_id
                AND e.organization_id = a.organization_id
                AND e.status = 'active'
              WHERE a.class_session_id = cs.id
                AND a.organization_id = cs.organization_id
                AND a.status IN ('absent', 'excused')
           )
         - (
             SELECT count(*)
               FROM reposicao_booking b
              WHERE b.class_session_id = cs.id
                AND b.organization_id = cs.organization_id
                AND b.archived_at IS NULL
                AND (
                  b.status = 'confirmed'
                  OR (b.status = 'pending'
                      AND (b.holds_until IS NULL OR b.holds_until > now()))
                )
           )
    FROM class_session cs
    JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = p_session_id;
$fn$;

DROP POLICY IF EXISTS lead_tenant ON lead;
DROP TABLE IF EXISTS lead;
DROP TYPE IF EXISTS lead_status;
DROP FUNCTION IF EXISTS lead_retention();
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_slug_shape;
ALTER TABLE organization DROP COLUMN IF EXISTS public_registration_open;
