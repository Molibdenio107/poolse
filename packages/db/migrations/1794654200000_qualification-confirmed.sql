-- Up Migration

-- A teacher sends their own qualification from the phone, and the office
-- confirms it (Rui, 07-11-2026). Until then it is on file and counts for
-- nothing: not the colour, not the alerts, not the block on assignment, all of
-- which read qualification_current. Every record before today was filed by the
-- office, so it is confirmed as of its creation, and an office insert still is by
-- default: only the person's own route writes null, explicitly.

ALTER TABLE qualification
  ADD COLUMN confirmed_at timestamptz DEFAULT now(),
  ADD COLUMN confirmed_by_membership_id uuid,
  ADD CONSTRAINT qualification_confirmed_by_fk
    FOREIGN KEY (organization_id, confirmed_by_membership_id) REFERENCES membership (organization_id, id);

UPDATE qualification SET confirmed_at = created_at;

COMMENT ON COLUMN qualification.confirmed_at IS
  'Null while a record the person sent waits for the office; qualification_current reads only confirmed rows.';

-- The office confirms by column; nothing else on the row becomes writable.
GRANT UPDATE (confirmed_at, confirmed_by_membership_id) ON qualification TO poolse_app;

CREATE OR REPLACE VIEW qualification_current WITH (security_invoker = true) AS
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
   AND q.confirmed_at IS NOT NULL
   AND t.archived_at IS NULL
 ORDER BY q.organization_id, q.membership_id, q.qualification_type_id,
          q.expires_on DESC NULLS FIRST, q.issued_on DESC NULLS LAST, q.created_at DESC;

-- Down Migration

CREATE OR REPLACE VIEW qualification_current WITH (security_invoker = true) AS
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

REVOKE UPDATE (confirmed_at, confirmed_by_membership_id) ON qualification FROM poolse_app;

ALTER TABLE qualification
  DROP CONSTRAINT qualification_confirmed_by_fk,
  DROP COLUMN confirmed_by_membership_id,
  DROP COLUMN confirmed_at;
