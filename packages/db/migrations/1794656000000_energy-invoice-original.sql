-- Up Migration
--
-- A bill keeps its original file (Rui, 12-11-2026).
--
-- Until now an imported PDF or photo was read and thrown away; only its name
-- was kept (`source_file_name`). The file now goes where every other club
-- document goes — `stored_file`, bytes in R2, read only through the app — under
-- its own purpose, and the bill points at it. A bill imported from a file keeps
-- it as it is filed; a bill already on record, or typed by hand, can have its
-- original attached later. Readable by everyone who reads the bill's figures
-- (Owner, Admin, Maintenance), per `RULES.energy_invoice`.
--
-- Not in the database: a bill PDF is ~100–500 KB in object storage; the row
-- holds an id.

ALTER TYPE file_purpose ADD VALUE IF NOT EXISTS 'energy_invoice';

ALTER TABLE energy_invoice ADD COLUMN original_file_id uuid;

-- Composite, so a bill can never point at another club's file.
ALTER TABLE energy_invoice
  ADD CONSTRAINT energy_invoice_original_file_fk
  FOREIGN KEY (organization_id, original_file_id) REFERENCES stored_file (organization_id, id);

COMMENT ON COLUMN energy_invoice.original_file_id IS
  'The bill as received (PDF or photo), in stored_file with purpose energy_invoice. Null: none kept (12-11-2026).';

-- Down Migration

ALTER TABLE energy_invoice DROP CONSTRAINT energy_invoice_original_file_fk;
ALTER TABLE energy_invoice DROP COLUMN original_file_id;
-- The enum value stays: Postgres cannot drop one, and an unused value is harmless.
