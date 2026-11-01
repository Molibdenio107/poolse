-- Up Migration
--
-- A white strip under each value on a club's form — POOLSE-142 (Rui,
-- 01-11-2026). A value printed on the form's image covers the line from where it
-- starts to where the blank ends, so a mark on the scan — or an old answer on a
-- form that was not blank — never shows through. `width` is that strip, a
-- fraction of the page's width; null is no strip (a tick box's X, or a club that
-- does not want one). It stays on the page.

ALTER TABLE boletim_template_field ADD COLUMN width numeric(5,4)
  CONSTRAINT boletim_template_field_width CHECK (width IS NULL OR (width > 0 AND x + width <= 1.0001));

-- Down Migration

ALTER TABLE boletim_template_field DROP COLUMN width;
