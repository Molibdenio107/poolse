-- Up Migration
--
-- POOLSE-142, second half (Rui, 01-11-2026): a club's own forms move to a
-- *Documentos* tab, and beside the boletim de sócio the club may upload its
-- copy of the FPN's declaration — one for adults and one for minors — filled
-- for each student exactly as the boletim is.
--
-- * `boletim_template` gains `kind`, spelled as `student_document.kind` spells
--   the signed copies (`socio_form`, `fpn_declaration`, `fpn_declaration_minor`).
--   A CHECK rather than that enum: it also holds `id_document`, a photograph and
--   not a form to print. The tables keep their names; their comment says so.
-- * One live template per club **and kind**.
-- * `boletim_field` gains what the FPN's form asks: the signer (the guardian on
--   a minor's), the season, the club's association, FPN code and place, the ID
--   document's type and dates, and one box per modalidade — printed as an X
--   where the student's own *Documentos* tab has it ticked, never from a level.
--   Which fields a kind offers is `fieldsFor(kind)` in @poolse/rules, checked by
--   the API on every save.

ALTER TABLE boletim_template ADD COLUMN kind text NOT NULL DEFAULT 'socio_form'
  CONSTRAINT boletim_template_kind CHECK (kind IN ('socio_form', 'fpn_declaration', 'fpn_declaration_minor'));

DROP INDEX boletim_template_live_uq;
CREATE UNIQUE INDEX boletim_template_live_uq ON boletim_template (organization_id, kind)
  WHERE archived_at IS NULL;

COMMENT ON TABLE boletim_template IS
  'POOLSE-142: a club''s own paper form — the boletim de sócio or the FPN declaration (adult or minor), by kind — '
  'as an image of one A4 page. One live per club and kind; replacing it archives the old one and its placements.';

ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'signer_name';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'season';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'fpn_association';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'fpn_club_code';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'fpn_place';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'id_document_type';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'id_document_issued_on';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'id_document_valid_until';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_pura';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_open_water';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_water_polo';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_artistic';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_adapted';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_masters';
ALTER TYPE boletim_field ADD VALUE IF NOT EXISTS 'discipline_diving';

-- Down Migration
--
-- The new `boletim_field` values stay (Postgres cannot drop an enum value). The
-- FPN templates and their placements are archived first, so the restored
-- one-per-club index has a single live row to hold.

UPDATE boletim_template_field f SET archived_at = now()
  FROM boletim_template t
 WHERE f.template_id = t.id AND t.kind <> 'socio_form' AND f.archived_at IS NULL;
UPDATE boletim_template SET archived_at = now() WHERE kind <> 'socio_form' AND archived_at IS NULL;
DROP INDEX boletim_template_live_uq;
CREATE UNIQUE INDEX boletim_template_live_uq ON boletim_template (organization_id) WHERE archived_at IS NULL;
ALTER TABLE boletim_template DROP COLUMN kind;
