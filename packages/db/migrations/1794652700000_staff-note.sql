-- Up Migration

/*
 * The staff's post-it board — POOLSE-169 (Rui, 04-11-2026).
 *
 * "A section on the dashboard for any employee to add a post-it note, for
 * everyone that works there to see." Not an aviso and not a message: no
 * audience, no window, no recipients. A note is written once by any working
 * role, read by every working role, and stays until its author or the office
 * takes it down (archived, so the bin brings it back). To change one, take it
 * down and write another — there is no UPDATE on the text, by column grant.
 *
 * The colour is the author's pick of four, a closed set the screen draws: a
 * CHECK rather than an enum, because it is a display choice and dropping or
 * adding one should not need a type migration.
 */

CREATE TABLE staff_note (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization (id),
  author_membership_id  uuid NOT NULL,
  body                  text NOT NULL,
  colour                text NOT NULL DEFAULT 'yellow',
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, author_membership_id) REFERENCES membership (organization_id, id),

  CONSTRAINT staff_note_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  CONSTRAINT staff_note_colour CHECK (colour IN ('yellow', 'orange', 'green', 'blue'))
);

COMMENT ON TABLE staff_note IS
  'A post-it on the staff board — POOLSE-169. Written by any working role, read by every one, '
  'taken down (archived) by its author or the office. Never edited.';
COMMENT ON COLUMN staff_note.colour IS 'The author''s pick: yellow, orange, green or blue.';

-- The board: live notes, newest first.
CREATE INDEX staff_note_live_idx ON staff_note (organization_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER staff_note_updated_at BEFORE UPDATE ON staff_note
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE staff_note ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_note_tenant ON staff_note
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Written once: the only change the app may make is taking it down or back.
REVOKE ALL ON staff_note FROM poolse_app;
GRANT SELECT, INSERT ON staff_note TO poolse_app;
GRANT UPDATE (archived_at) ON staff_note TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS staff_note;
