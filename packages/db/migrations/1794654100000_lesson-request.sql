-- Up Migration

-- POOLSE-198 — what a teacher asks of the office about one lesson.
--
-- `substitute`: they cannot come, and the office names who does. `cancelled`: they
-- cancelled it themselves, and the office is told. Both are a circle on the menu
-- until somebody answers, so one row, closed by `closed_at`.
--
-- One lesson at a time (Rui, 07-11-2026). A record of who asked and how it ended,
-- so no `archived_at`, no DELETE grant, and the words it was opened with do not
-- change: only the closing columns move.

CREATE TYPE lesson_request_kind AS ENUM ('substitute', 'cancelled');
CREATE TYPE lesson_request_outcome AS ENUM ('assigned', 'withdrawn', 'seen');

CREATE TABLE lesson_request (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organization (id),
  class_session_id           uuid NOT NULL,
  kind                       lesson_request_kind NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  note                       text,
  closed_at                  timestamptz,
  closed_by_membership_id    uuid,
  outcome                    lesson_request_outcome,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, class_session_id) REFERENCES class_session (organization_id, id),
  FOREIGN KEY (organization_id, requested_by_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, closed_by_membership_id) REFERENCES membership (organization_id, id),
  CONSTRAINT lesson_request_note_short CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  CONSTRAINT lesson_request_closed_says_how CHECK ((closed_at IS NULL) = (outcome IS NULL))
);

-- One open of each kind per lesson, and the index the circle reads.
CREATE UNIQUE INDEX lesson_request_one_open
  ON lesson_request (organization_id, class_session_id, kind)
  WHERE closed_at IS NULL;

CREATE TRIGGER lesson_request_updated_at BEFORE UPDATE ON lesson_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lesson_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesson_request_tenant ON lesson_request
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON lesson_request FROM poolse_app;
GRANT SELECT, INSERT ON lesson_request TO poolse_app;
GRANT UPDATE (closed_at, closed_by_membership_id, outcome) ON lesson_request TO poolse_app;

-- Down Migration

DROP TABLE lesson_request;
DROP TYPE lesson_request_outcome;
DROP TYPE lesson_request_kind;
