-- Up Migration
--
-- POOLSE-81, slice 2 — who a results file named that matched nobody.
--
-- The meet's page lists the club's swimmers the import could not match, so the
-- coach can register them or fix a licence and import again. They are people
-- with no record in Poolse, so this keeps the least that makes the list useful:
-- the name as the file spelled it and how many results it carried. No birth
-- date, no licence — a re-import reads those from the file again. Each import
-- replaces the list.

ALTER TABLE swim_meet
  ADD COLUMN unmatched jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT swim_meet_unmatched_is_list CHECK (jsonb_typeof(unmatched) = 'array');

COMMENT ON COLUMN swim_meet.unmatched IS
  'POOLSE-81: the club''s athletes in the last imported file that matched no student — '
  '[{name, results}], names only. Replaced by each import.';

-- Down Migration

ALTER TABLE swim_meet DROP CONSTRAINT IF EXISTS swim_meet_unmatched_is_list,
  DROP COLUMN IF EXISTS unmatched;
