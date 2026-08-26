-- Up Migration
--
-- Backlog story 3: where a student's photograph lives, and the rule that governs
-- whether anyone ever sees it.
--
-- The column is only half of this. The important half is that a student's
-- photograph may be shown **only** where a `photo` consent record is granted and
-- not withdrawn — and that rule is enforced in the query that reads the key, not
-- in the twelve places a student is rendered.
--
-- That is a deliberate choice about where to put it. A check in the component
-- protects the components somebody remembered; a `CASE` in the one query that
-- can produce the key means a caller who forgets about consent gets NULL and has
-- nothing to render. Withdrawal therefore takes effect everywhere at once,
-- because there is only one place it is decided.
--
-- No storage is wired yet — object storage is chosen (Cloudflare R2) but not
-- configured, so this column stays empty and the upload control in the interface
-- is visibly disabled. The rule is built now regardless, because the alternative
-- is bolting it on afterwards to code that already works without it.

ALTER TABLE student ADD COLUMN photo_storage_key text;

COMMENT ON COLUMN student.photo_storage_key IS
  'Object storage key. Never rendered without a granted, unwithdrawn photo consent.';

-- The read this enables: "is there a live photo consent for this student".
-- `consent_live_uq` already covers (organization_id, student_id, kind) for live
-- rows, so this is only for the filtered lookup by kind.
CREATE INDEX consent_photo_idx
  ON consent (organization_id, student_id)
  WHERE kind = 'photo' AND withdrawn_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS consent_photo_idx;
ALTER TABLE student DROP COLUMN IF EXISTS photo_storage_key;
