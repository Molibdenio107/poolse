-- Up Migration
--
-- POOLSE-149 slice D — the seventh AI reader (Rui, 02-11-2026): a certificate
-- dropped on a staff member's *Qualificações* is read for its type, issuing
-- body and dates, proposed in the new-qualification form for a person to
-- confirm. Gated like the other six: its platform switch (off), the club's
-- tick (none for any club) and the monthly cap.

ALTER TYPE ai_reader ADD VALUE IF NOT EXISTS 'qualification_certificate';

ALTER TABLE platform_switch DROP CONSTRAINT platform_switch_name_check;
ALTER TABLE platform_switch ADD CONSTRAINT platform_switch_name_check
  CHECK (name IN ('id_document_ai', 'energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai',
                  'boletim_template_ai', 'qualification_certificate_ai'));
INSERT INTO platform_switch (name) VALUES ('qualification_certificate_ai');

-- Down Migration
--
-- `ai_reader` keeps 'qualification_certificate': Postgres cannot drop an enum
-- value. A club's tick for it is taken off, so nothing names a reader the code
-- no longer has.

UPDATE organization SET ai_readers = array_remove(ai_readers, 'qualification_certificate')
 WHERE 'qualification_certificate' = ANY (ai_readers);
DELETE FROM platform_switch WHERE name = 'qualification_certificate_ai';
ALTER TABLE platform_switch DROP CONSTRAINT platform_switch_name_check;
ALTER TABLE platform_switch ADD CONSTRAINT platform_switch_name_check
  CHECK (name IN ('id_document_ai', 'energy_invoice_ai', 'water_report_ai', 'pdf_table_ai', 'column_match_ai',
                  'boletim_template_ai'));
