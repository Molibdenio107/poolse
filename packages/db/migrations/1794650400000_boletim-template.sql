-- Up Migration
--
-- POOLSE-142 — a club's own boletim de sócio (Rui, 01-11-2026). The club
-- uploads its paper form (a PDF is rendered to an image in the browser first),
-- places Poolse's fields on it, and each student's boletim prints on that form.
--
-- * One live template per club (partial unique index); replacing it archives
--   the old one, and its placements with it — positions on another scan mean
--   nothing.
-- * A placement is a field, x and y as fractions of the page (the text's
--   baseline start), and a size in pt. A field may be placed more than once.
-- * Placements are written as a set: saving archives the live set and inserts
--   the new one, so the history of what was printed where survives.
-- * `boletim_field` is the closed list Poolse knows how to fill; it equals
--   `BOLETIM_FIELDS` in @poolse/rules by test.

ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'boletim_template';

CREATE TYPE boletim_field AS ENUM (
  'name', 'parent_one_name', 'parent_two_name',
  'birth_date', 'birth_day', 'birth_month', 'birth_year',
  'marital_status', 'profession', 'education', 'birthplace', 'nationality',
  'address_line', 'locality', 'postal_code', 'phone', 'email',
  'tax_number', 'id_document_number', 'sns_number',
  'socio_number', 'socio_since',
  'guardian_name', 'guardian_phone', 'guardian_email', 'guardian_relationship',
  'today', 'today_day', 'today_month', 'today_year', 'today_year_short'
);

CREATE TABLE boletim_template (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  file_id         uuid NOT NULL,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES membership (organization_id, id)
);

COMMENT ON TABLE boletim_template IS
  'POOLSE-142: the club''s own boletim de sócio, an image of one A4 page. One live per club; '
  'replacing it archives the old one and its placements.';

CREATE UNIQUE INDEX boletim_template_live_uq ON boletim_template (organization_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER boletim_template_updated_at BEFORE UPDATE ON boletim_template
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE boletim_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY boletim_template_tenant ON boletim_template
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON boletim_template FROM poolse_app;
GRANT SELECT, INSERT ON boletim_template TO poolse_app;
GRANT UPDATE (archived_at) ON boletim_template TO poolse_app;

CREATE TABLE boletim_template_field (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  template_id     uuid NOT NULL,
  field           boletim_field NOT NULL,
  -- Fractions of the page, so a different render size moves nothing.
  x               numeric(5,4) NOT NULL,
  y               numeric(5,4) NOT NULL,
  size_pt         numeric(4,1) NOT NULL DEFAULT 11,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, template_id) REFERENCES boletim_template (organization_id, id),
  CONSTRAINT boletim_template_field_on_page CHECK (x >= 0 AND x <= 1 AND y >= 0 AND y <= 1),
  CONSTRAINT boletim_template_field_size CHECK (size_pt >= 6 AND size_pt <= 24)
);

COMMENT ON TABLE boletim_template_field IS
  'POOLSE-142: one Poolse field placed on a club''s boletim template, x/y as fractions of the page. '
  'Saved as a set: the live set is archived and the new one inserted.';

CREATE INDEX boletim_template_field_live_idx ON boletim_template_field (organization_id, template_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER boletim_template_field_updated_at BEFORE UPDATE ON boletim_template_field
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE boletim_template_field ENABLE ROW LEVEL SECURITY;
CREATE POLICY boletim_template_field_tenant ON boletim_template_field
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON boletim_template_field FROM poolse_app;
GRANT SELECT, INSERT ON boletim_template_field TO poolse_app;
GRANT UPDATE (archived_at) ON boletim_template_field TO poolse_app;

-- Down Migration
--
-- `file_purpose` keeps 'boletim_template': Postgres cannot drop an enum value,
-- and an unused value is harmless (the medical-certificate migration's terms).

DROP TABLE IF EXISTS boletim_template_field;
DROP TABLE IF EXISTS boletim_template;
DROP TYPE IF EXISTS boletim_field;
