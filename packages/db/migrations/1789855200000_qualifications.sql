-- Up Migration
--
-- Qualifications with expiry — POOLSE-27, brought forward as roadmap 7b.2.
--
-- A lapsed lifeguard certificate or a TPTD that ran out is not an administrative
-- detail. This records who holds what until when, and turns "too late" into a
-- three-month warning: verde, âmbar, vermelho.
--
-- **Status is derived, never stored** — `qualification_status()` below is the one
-- definition, read through `qualification_current`, which every screen, the
-- dashboard, the daily alert job and the assignment block query. A stored status
-- is right on the day it is written and wrong a week later.
--
-- **A person's standing for a type is their latest record of it.** Renewal is a
-- new row; the old one stays as history. A record with no expiry (some are for
-- life) is verde for ever, and is the latest of all.
--
-- **A warning, and a block only where the club asks** (decisions, 11-10-2026).
-- An expired qualification is flagged everywhere; a type's `blocks_assignment`,
-- off by default, makes the database refuse a *new* turma or booking assignment
-- for somebody whose record of that type is vermelho. Existing assignments are
-- never touched, a one-week stand-in is never refused, and a missing record is
-- flagged ("em falta") but never blocks — the block is about an expired record.
--
-- **Notifications are records first** — the 4.2 pattern. `qualification_alert`
-- holds one row per (qualification, threshold), written by the daily job in its
-- transaction; the unique index is what makes "notify once, on crossing" true.

-- ---------------------------------------------------------------------------
-- The club's window
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN qualification_amber_days integer NOT NULL DEFAULT 90,
  ADD CONSTRAINT organization_qualification_amber_days_range
    CHECK (qualification_amber_days BETWEEN 1 AND 365);

COMMENT ON COLUMN organization.qualification_amber_days IS
  'POOLSE-27: how many days before expiry a qualification turns âmbar. A type may override it.';

-- ---------------------------------------------------------------------------
-- Types — tenant data, never translated
-- ---------------------------------------------------------------------------

CREATE TABLE qualification_type (
  id                      uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization (id),
  name                    text NOT NULL,
  -- Pre-fills an expiry from the issue date on the form. Null: no default.
  default_validity_months integer,
  -- Overrides the club's window for this type. Null: the club's.
  amber_days              integer,
  -- An instructor without a live record of a required type is flagged "em falta".
  required_to_teach       boolean NOT NULL DEFAULT false,
  -- Opt-in: a vermelho record refuses new turma and booking assignments.
  blocks_assignment       boolean NOT NULL DEFAULT false,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  archived_at             timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CHECK (default_validity_months IS NULL OR default_validity_months BETWEEN 1 AND 600),
  CHECK (amber_days IS NULL OR amber_days BETWEEN 1 AND 365),
  -- Blocking on a type nobody is required to hold would refuse an assignment
  -- for a certificate the club does not ask instructors for.
  CHECK (NOT blocks_assignment OR required_to_teach)
);

CREATE UNIQUE INDEX qualification_type_name_uq
  ON qualification_type (organization_id, lower(btrim(name))) WHERE archived_at IS NULL;

CREATE TRIGGER qualification_type_updated_at BEFORE UPDATE ON qualification_type
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE qualification_type IS
  'POOLSE-27: a kind of qualification a club tracks. Tenant data, named in the club''s words.';

-- ---------------------------------------------------------------------------
-- Records
-- ---------------------------------------------------------------------------

CREATE TABLE qualification (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization (id),
  -- On the person (POOLSE-17), not on a role.
  membership_id         uuid NOT NULL,
  qualification_type_id uuid NOT NULL,
  issuing_body          text,
  issued_on             date,
  -- Null: does not expire, and is verde for ever.
  expires_on            date,
  created_by_membership_id uuid,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, qualification_type_id)
    REFERENCES qualification_type (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES membership (organization_id, id),

  CHECK (issuing_body IS NULL OR char_length(issuing_body) <= 200),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

-- The amber/red report, sorted by expiry.
CREATE INDEX qualification_expiry_idx
  ON qualification (organization_id, expires_on) WHERE archived_at IS NULL;
CREATE INDEX qualification_person_idx
  ON qualification (organization_id, membership_id) WHERE archived_at IS NULL;

CREATE TRIGGER qualification_updated_at BEFORE UPDATE ON qualification
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE qualification IS
  'POOLSE-27: one record of a qualification held by a person. Renewal is a new row; '
  'the latest per person and type is their standing. Status is derived, never stored.';

-- ---------------------------------------------------------------------------
-- The one definition of a status
-- ---------------------------------------------------------------------------

CREATE FUNCTION qualification_status(p_expires_on date, p_amber_days integer, p_today date)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN p_expires_on IS NULL THEN 'green'
           WHEN p_expires_on < p_today THEN 'red'
           -- Inclusive at the window's edge: 90 days out is âmbar, 91 is verde.
           WHEN p_expires_on <= p_today + p_amber_days THEN 'amber'
           ELSE 'green'
         END
$$;

COMMENT ON FUNCTION qualification_status(date, integer, date) IS
  'POOLSE-27: green, amber or red from an expiry, a window and a day. The one definition.';

-- The club's day, which is the Lisbon day: a certificate expiring today is still
-- valid until midnight here, not in UTC.
CREATE FUNCTION club_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Europe/Lisbon')::date $$;

-- Every person's standing per type: their latest live record, with its status.
-- `security_invoker`, so it reads under the caller's RLS like the tables do.
CREATE VIEW qualification_current WITH (security_invoker = true) AS
SELECT DISTINCT ON (q.organization_id, q.membership_id, q.qualification_type_id)
       q.id,
       q.organization_id,
       q.membership_id,
       q.qualification_type_id,
       q.issuing_body,
       q.issued_on,
       q.expires_on,
       coalesce(t.amber_days, o.qualification_amber_days) AS amber_days,
       qualification_status(q.expires_on, coalesce(t.amber_days, o.qualification_amber_days),
                            club_today()) AS status
  FROM qualification q
  JOIN qualification_type t
    ON t.id = q.qualification_type_id AND t.organization_id = q.organization_id
  JOIN organization o ON o.id = q.organization_id
 WHERE q.archived_at IS NULL
   AND t.archived_at IS NULL
 ORDER BY q.organization_id, q.membership_id, q.qualification_type_id,
          q.expires_on DESC NULLS FIRST, q.issued_on DESC NULLS LAST, q.created_at DESC;

COMMENT ON VIEW qualification_current IS
  'POOLSE-27: each person''s latest live record per type, with its derived status.';

-- ---------------------------------------------------------------------------
-- The opt-in block on new assignments
-- ---------------------------------------------------------------------------

CREATE FUNCTION qualification_assignment_allowed() RETURNS trigger AS $$
DECLARE
  v_type    text;
  v_expired date;
BEGIN
  IF NEW.instructor_membership_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only a *new* assignment. Saving a turma for another reason must never start
  -- refusing because a certificate lapsed since it was assigned.
  IF TG_OP = 'UPDATE' AND NEW.instructor_membership_id IS NOT DISTINCT FROM OLD.instructor_membership_id THEN
    RETURN NEW;
  END IF;

  SELECT t.name, c.expires_on INTO v_type, v_expired
    FROM qualification_current c
    JOIN qualification_type t
      ON t.id = c.qualification_type_id AND t.organization_id = c.organization_id
   WHERE c.organization_id = NEW.organization_id
     AND c.membership_id = NEW.instructor_membership_id
     AND t.blocks_assignment
     AND c.status = 'red'
   ORDER BY c.expires_on
   LIMIT 1;

  IF v_type IS NOT NULL THEN
    RAISE EXCEPTION 'Instructor % holds an expired %', NEW.instructor_membership_id, v_type
      USING ERRCODE = 'check_violation',
            DETAIL = format('qualification_blocked|%s|%s', v_type, v_expired);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER class_group_qualification_allowed
  BEFORE INSERT OR UPDATE OF instructor_membership_id ON class_group
  FOR EACH ROW EXECUTE FUNCTION qualification_assignment_allowed();

CREATE TRIGGER class_schedule_qualification_allowed
  BEFORE INSERT OR UPDATE OF instructor_membership_id ON class_schedule
  FOR EACH ROW EXECUTE FUNCTION qualification_assignment_allowed();

-- ---------------------------------------------------------------------------
-- Alerts — records first, email after commit
-- ---------------------------------------------------------------------------

CREATE TYPE qualification_threshold AS ENUM ('amber', 'red');

CREATE TABLE qualification_alert (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  qualification_id uuid NOT NULL,
  threshold        qualification_threshold NOT NULL,
  raised_at        timestamptz NOT NULL DEFAULT now(),
  -- Addresses as they were: "who was told" outlives the people.
  recipients       text[] NOT NULL DEFAULT '{}',
  -- Null: recorded, not sent.
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, qualification_id) REFERENCES qualification (organization_id, id),
  CHECK (delivered_at IS NULL OR cardinality(recipients) > 0)
);

-- Once per crossing — the idempotence of the daily job.
CREATE UNIQUE INDEX qualification_alert_once_uq
  ON qualification_alert (organization_id, qualification_id, threshold);

CREATE TRIGGER qualification_alert_updated_at BEFORE UPDATE ON qualification_alert
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- The Portuguese types, on every business tenant
--
-- Ordinary editable rows. Seeded once, when the club is made — by a trigger, so
-- every provisioning path inherits it without `provision_organization` being
-- rewritten — and backfilled here for the clubs that exist. Never re-run, so a
-- type a club archived does not come back. Validity is filled only where the law
-- states it (TPTD, Lei 40/2012); the others are the club's to set.
-- ---------------------------------------------------------------------------

CREATE FUNCTION seed_qualification_types(p_organization_id uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO qualification_type (organization_id, name, default_validity_months, required_to_teach)
  VALUES (p_organization_id, 'TPTD — Título Profissional de Treinador de Desporto', 60, true),
         (p_organization_id, 'Nadador-salvador (ISN)', NULL, false),
         (p_organization_id, 'SBV — Suporte Básico de Vida', NULL, false)
$$;

CREATE FUNCTION organization_seed_qualification_types() RETURNS trigger AS $$
BEGIN
  PERFORM seed_qualification_types(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_qualification_types
  AFTER INSERT ON organization
  FOR EACH ROW WHEN (NEW.kind = 'business')
  EXECUTE FUNCTION organization_seed_qualification_types();

SELECT seed_qualification_types(o.id)
  FROM organization o
 WHERE o.kind = 'business'
   AND NOT EXISTS (SELECT 1 FROM qualification_type t WHERE t.organization_id = o.id);

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

ALTER TABLE qualification_type ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualification_type_tenant ON qualification_type
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

ALTER TABLE qualification ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualification_tenant ON qualification
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

ALTER TABLE qualification_alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualification_alert_tenant ON qualification_alert
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE DELETE ON qualification_type FROM poolse_app;

-- A record is archived, never edited: a correction is archive and add again,
-- so the history of what was on file stays true.
REVOKE UPDATE, DELETE ON qualification FROM poolse_app;
GRANT SELECT, INSERT ON qualification TO poolse_app;
GRANT UPDATE (archived_at) ON qualification TO poolse_app;

REVOKE UPDATE, DELETE ON qualification_alert FROM poolse_app;
GRANT SELECT, INSERT ON qualification_alert TO poolse_app;
GRANT UPDATE (recipients, delivered_at) ON qualification_alert TO poolse_app;

GRANT SELECT ON qualification_current TO poolse_app;

-- Down Migration

DROP TRIGGER IF EXISTS organization_qualification_types ON organization;
DROP FUNCTION IF EXISTS organization_seed_qualification_types();
DROP FUNCTION IF EXISTS seed_qualification_types(uuid);

DROP TRIGGER IF EXISTS class_schedule_qualification_allowed ON class_schedule;
DROP TRIGGER IF EXISTS class_group_qualification_allowed ON class_group;
DROP FUNCTION IF EXISTS qualification_assignment_allowed();

DROP POLICY IF EXISTS qualification_alert_tenant ON qualification_alert;
DROP TABLE IF EXISTS qualification_alert;
DROP TYPE IF EXISTS qualification_threshold;

DROP VIEW IF EXISTS qualification_current;
DROP FUNCTION IF EXISTS club_today();
DROP FUNCTION IF EXISTS qualification_status(date, integer, date);

DROP POLICY IF EXISTS qualification_tenant ON qualification;
DROP TABLE IF EXISTS qualification;
DROP POLICY IF EXISTS qualification_type_tenant ON qualification_type;
DROP TABLE IF EXISTS qualification_type;

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_qualification_amber_days_range,
  DROP COLUMN IF EXISTS qualification_amber_days;
