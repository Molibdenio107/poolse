-- Up Migration
--
-- A confirmed timetable import is a record, so it can be undone or replaced
-- (Rui, 12-11-2026).
--
-- Until now Confirmar wrote turmas and weekly slots with nothing saying they
-- came from one file, so the next day there was no way to take the import back
-- or to put a corrected calendar in its place. Each confirmed import is now a
-- `timetable_import` row, and every turma and slot it wrote points at it.
-- Undoing it archives exactly those (restorable from Arquivados); importing
-- onto a pool that already has a calendar must first say whether to replace it.

CREATE TABLE timetable_import (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,
  season_id       uuid NOT NULL,
  -- The pools the rows went into, for "this pool's calendar came from…".
  pool_ids        uuid[] NOT NULL DEFAULT '{}',
  file_name       text,
  turmas_created  integer NOT NULL DEFAULT 0,
  slots_created   integer NOT NULL DEFAULT 0,
  -- Set when this import replaced a pool's calendar: the archive entry that holds it.
  replaced        boolean NOT NULL DEFAULT false,
  created_by_membership_id uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Undone: the import's turmas and slots went to the bin with it.
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id) REFERENCES membership (organization_id, id),
  CONSTRAINT timetable_import_counts CHECK (turmas_created >= 0 AND slots_created >= 0),
  CONSTRAINT timetable_import_file_not_blank CHECK (file_name IS NULL OR btrim(file_name) <> '')
);

CREATE INDEX timetable_import_facility_idx ON timetable_import (organization_id, facility_id, created_at DESC);

CREATE TRIGGER timetable_import_updated_at BEFORE UPDATE ON timetable_import
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE timetable_import ENABLE ROW LEVEL SECURITY;
CREATE POLICY timetable_import_tenant ON timetable_import
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON timetable_import TO poolse_app;

ALTER TABLE class_group ADD COLUMN timetable_import_id uuid;
ALTER TABLE class_group
  ADD CONSTRAINT class_group_timetable_import_fk
  FOREIGN KEY (organization_id, timetable_import_id) REFERENCES timetable_import (organization_id, id);

ALTER TABLE class_schedule ADD COLUMN timetable_import_id uuid;
ALTER TABLE class_schedule
  ADD CONSTRAINT class_schedule_timetable_import_fk
  FOREIGN KEY (organization_id, timetable_import_id) REFERENCES timetable_import (organization_id, id);

CREATE INDEX class_group_timetable_import_idx ON class_group (organization_id, timetable_import_id)
  WHERE timetable_import_id IS NOT NULL;
CREATE INDEX class_schedule_timetable_import_idx ON class_schedule (organization_id, timetable_import_id)
  WHERE timetable_import_id IS NOT NULL;

COMMENT ON TABLE timetable_import IS
  'A confirmed timetable import: what it wrote points here, so it can be undone or replaced. 12-11-2026.';

-- Down Migration

DROP INDEX class_schedule_timetable_import_idx;
DROP INDEX class_group_timetable_import_idx;
ALTER TABLE class_schedule DROP CONSTRAINT class_schedule_timetable_import_fk;
ALTER TABLE class_schedule DROP COLUMN timetable_import_id;
ALTER TABLE class_group DROP CONSTRAINT class_group_timetable_import_fk;
ALTER TABLE class_group DROP COLUMN timetable_import_id;
DROP POLICY timetable_import_tenant ON timetable_import;
DROP TABLE timetable_import;
