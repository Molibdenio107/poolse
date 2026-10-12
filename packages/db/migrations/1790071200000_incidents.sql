-- Up Migration
--
-- Bather incidents — POOLSE-70, slice 1.
--
-- A child slips on the deck on Saturday; on Monday the insurer asks what
-- happened, who gave first aid, who was on duty. This is the dated record that
-- answers, and it stores the most sensitive thing in the product after medical
-- notes. Three tables, and the split between them is the design:
--
--   * `incident` — the plain facts: when, where, who was involved, whether
--     emergency services were called, who was on duty, who wrote it. Lists and
--     the roster read these without decrypting anything.
--   * `incident_detail` — what happened, the injury and the first aid given,
--     **encrypted by the application** (AES-256-GCM, `sensitive/cipher.ts`)
--     before it reaches the database, exactly as `student_sensitive` is. A
--     CHECK refuses anything that is not ciphertext, so no future code path can
--     store an injury in plain text by mistake.
--   * `incident_addendum` — a correction, encrypted the same way, with its own
--     author and time.
--
-- **Written once.** `poolse_app` holds SELECT and INSERT on all three and
-- nothing else, bar `UPDATE (archived_at)` on `incident` — the `invoice`
-- arrangement: a record that can be edited is not a record, and a missing
-- privilege cannot be forgotten by application code.
--
-- **Who may read the detail** (Owner/Admin and the author, answered 12-10-2026)
-- is a question about a row, so it lives in the repository, and every
-- decrypting read writes `incident_detail.read` to `audit_log`.

CREATE TABLE incident (
  id                      uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization (id),
  facility_id             uuid NOT NULL,

  /* Where: a tank, a space, or neither (somewhere else on the site). */
  pool_id                 uuid,
  space_id                uuid,

  occurred_at             timestamptz NOT NULL,

  /* Who was involved: a student, another person the club knows, or a visitor
   * typed by name — exactly one, by CHECK. */
  student_id              uuid,
  membership_id           uuid,
  visitor_name            text,

  emergency_called        boolean NOT NULL DEFAULT false,

  /* Who was the lifeguard on duty, as the writer recorded it (slice 2 pre-fills
   * it from the roster; the writer may correct it). Null is "not recorded". */
  lifeguard_membership_id uuid,

  /* The apólice, in words until 7b.5 holds policies to point at. */
  policy_reference        text,

  recorded_by             uuid NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  archived_at             timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, space_id) REFERENCES space (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, lifeguard_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),

  CONSTRAINT incident_one_place CHECK (pool_id IS NULL OR space_id IS NULL),
  CONSTRAINT incident_one_person CHECK (num_nonnulls(student_id, membership_id, visitor_name) = 1),
  CONSTRAINT incident_visitor_not_blank CHECK (visitor_name IS NULL OR btrim(visitor_name) <> ''),
  CONSTRAINT incident_policy_not_blank CHECK (policy_reference IS NULL OR btrim(policy_reference) <> '')
);

COMMENT ON TABLE incident IS
  'POOLSE-70: a bather incident''s plain facts. Written once — SELECT, INSERT and '
  'UPDATE (archived_at) only. The health detail is in incident_detail, encrypted.';

CREATE INDEX incident_facility_idx
  ON incident (organization_id, facility_id, occurred_at DESC)
  WHERE archived_at IS NULL;

/*
 * The tank or space belongs to the incident's site.
 *
 * The composite keys keep both inside the club; this keeps them inside the
 * site, so a list filtered by site cannot show an incident in another site's
 * tank.
 */
CREATE FUNCTION incident_place_on_site() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pool_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pool p
     WHERE p.id = NEW.pool_id AND p.organization_id = NEW.organization_id
       AND p.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'The tank is not at this site'
      USING ERRCODE = 'check_violation', DETAIL = 'incident_place_off_site';
  END IF;
  IF NEW.space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM space s
     WHERE s.id = NEW.space_id AND s.organization_id = NEW.organization_id
       AND s.facility_id = NEW.facility_id
  ) THEN
    RAISE EXCEPTION 'The space is not at this site'
      USING ERRCODE = 'check_violation', DETAIL = 'incident_place_off_site';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER incident_place_on_site BEFORE INSERT ON incident
  FOR EACH ROW EXECUTE FUNCTION incident_place_on_site();

ALTER TABLE incident ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_tenant ON incident
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE UPDATE, DELETE ON incident FROM poolse_app;
GRANT SELECT, INSERT ON incident TO poolse_app;
GRANT UPDATE (archived_at) ON incident TO poolse_app;


CREATE TABLE incident_detail (
  organization_id          uuid NOT NULL REFERENCES organization (id),
  incident_id              uuid NOT NULL,

  -- Ciphertext from `encryptSensitive`: `v1.<iv>.<tag>.<data>`, never prose.
  what_happened_encrypted  text NOT NULL,
  injury_encrypted         text,
  first_aid_encrypted      text,

  created_at               timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (incident_id),
  FOREIGN KEY (organization_id, incident_id) REFERENCES incident (organization_id, id),

  CONSTRAINT incident_detail_ciphertext CHECK (
    what_happened_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    AND (injury_encrypted IS NULL
         OR injury_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
    AND (first_aid_encrypted IS NULL
         OR first_aid_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
  )
);

COMMENT ON TABLE incident_detail IS
  'POOLSE-70: what happened, the injury and the first aid — encrypted by the '
  'application, refused by CHECK if not ciphertext. Insert-only; every read logged.';

ALTER TABLE incident_detail ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_detail_tenant ON incident_detail
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE UPDATE, DELETE ON incident_detail FROM poolse_app;
GRANT SELECT, INSERT ON incident_detail TO poolse_app;


CREATE TABLE incident_addendum (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  incident_id      uuid NOT NULL,

  -- A correction can be about the injury as easily as the time, so it is
  -- encrypted and read under the same rule as the detail.
  body_encrypted   text NOT NULL,

  written_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, incident_id) REFERENCES incident (organization_id, id),
  FOREIGN KEY (organization_id, written_by) REFERENCES membership (organization_id, id),

  CONSTRAINT incident_addendum_ciphertext CHECK (
    body_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  )
);

COMMENT ON TABLE incident_addendum IS
  'POOLSE-70: a correction to an incident, encrypted, with its own author and '
  'time. The original is never edited. Insert-only.';

CREATE INDEX incident_addendum_incident_idx
  ON incident_addendum (organization_id, incident_id, created_at);

ALTER TABLE incident_addendum ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_addendum_tenant ON incident_addendum
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE UPDATE, DELETE ON incident_addendum FROM poolse_app;
GRANT SELECT, INSERT ON incident_addendum TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS incident_addendum;
DROP TABLE IF EXISTS incident_detail;
DROP TRIGGER IF EXISTS incident_place_on_site ON incident;
DROP FUNCTION IF EXISTS incident_place_on_site();
DROP TABLE IF EXISTS incident;
