-- Up Migration
--
-- POOLSE-142 slice B — the sixth AI reader (Rui, 01-11-2026): the model looks
-- at a club's boletim template and proposes where each Poolse field goes; a
-- person adjusts and saves. Gated like the other five: its platform switch
-- (off), the club's tick (none for any club) and the monthly cap.

ALTER TYPE ai_reader ADD VALUE IF NOT EXISTS 'boletim_template';

ALTER TABLE platform_switch DROP CONSTRAINT platform_switch_name_check;
ALTER TABLE platform_switch ADD CONSTRAINT platform_switch_name_check
  CHECK (name IN ('id_document_ai', 'energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai',
                  'boletim_template_ai'));
INSERT INTO platform_switch (name) VALUES ('boletim_template_ai');

-- Down Migration
--
-- `ai_reader` keeps 'boletim_template': Postgres cannot drop an enum value. A
-- club's tick for it is taken off, so nothing names a reader the code no longer has.

UPDATE organization SET ai_readers = array_remove(ai_readers, 'boletim_template')
 WHERE 'boletim_template' = ANY (ai_readers);
DELETE FROM platform_switch WHERE name = 'boletim_template_ai';
ALTER TABLE platform_switch DROP CONSTRAINT platform_switch_name_check;
ALTER TABLE platform_switch ADD CONSTRAINT platform_switch_name_check
  CHECK (name IN ('id_document_ai', 'energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai'));
