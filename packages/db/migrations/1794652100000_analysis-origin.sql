-- Up Migration

-- POOLSE-153 (Rui, 04-11-2026) — where an analysis came from.
--
-- Nothing recorded whether a reading or a laboratory result was typed into the
-- form or imported from a file, so Laboratório could not say which, and a
-- chemistry-only report (filed as a reading since POOLSE-101) was
-- indistinguishable from a reading somebody typed at the poolside.
--
-- Three values, because the readings import serves two different things:
--   typed  — entered on the form, one at a time;
--   log    — a spreadsheet of the club's own readings (the water log);
--   report — a laboratory's document, read by the parser or mapped by hand.
-- Laboratório lists the reports; Histórico keeps every reading as before.
--
-- **Existing rows stay NULL — "origem não registada"** (Rui's call, the same
-- day): guessing "typed" for history would be wrong for every report imported
-- before today. Only new rows take the default, which the ADD-then-SET DEFAULT
-- order guarantees: a default given in ADD COLUMN would be written into every
-- existing row.
--
-- A reading made from a lab result copies the lab result's origin, written by
-- `createLabResultIn` in the same statement that inserts it.

CREATE TYPE analysis_origin AS ENUM ('typed', 'log', 'report');

ALTER TABLE lab_result ADD COLUMN origin analysis_origin;
ALTER TABLE lab_result ALTER COLUMN origin SET DEFAULT 'typed';

ALTER TABLE pool_analysis ADD COLUMN origin analysis_origin;
ALTER TABLE pool_analysis ALTER COLUMN origin SET DEFAULT 'typed';

COMMENT ON COLUMN lab_result.origin IS
  'POOLSE-153: typed on the form, or a report imported from a file. NULL is a row from before '
  'the column existed: its origin was never recorded.';
COMMENT ON COLUMN pool_analysis.origin IS
  'POOLSE-153: typed, a water-log spreadsheet (log) or a laboratory document (report); a reading '
  'from a lab result copies its origin. NULL is a row from before the column existed.';

-- Down Migration

ALTER TABLE pool_analysis DROP COLUMN origin;
ALTER TABLE lab_result DROP COLUMN origin;
DROP TYPE analysis_origin;
