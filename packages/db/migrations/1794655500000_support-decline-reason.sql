-- A declined support request says why — Rui, 11-11-2026.
--
-- The Owner declining Poolse support's request writes a reason, and the
-- operator reads it on /admin. One column on the request, written by the club
-- in the same UPDATE as the answer.
--
-- The CHECK is NOT VALID: requests declined before today have no reason and
-- keep none (nobody wrote one, and inventing one would be a record of something
-- that was not said). Every answer from now on is checked, because an answered
-- row is never updated again.

-- Up Migration

ALTER TABLE support_request ADD COLUMN decline_reason text;

COMMENT ON COLUMN support_request.decline_reason IS
  'Why the Owner declined, in their words (11-11-2026). Required on a decline, absent otherwise; '
  'older declines have none.';

ALTER TABLE support_request
  ADD CONSTRAINT support_request_decline_reason CHECK (
    (answer = 'declined') = (decline_reason IS NOT NULL)
    AND (decline_reason IS NULL OR (btrim(decline_reason) <> '' AND char_length(decline_reason) <= 500))
  ) NOT VALID;

-- The club writes it with the answer. The platform already reads every column.
GRANT UPDATE (decline_reason) ON support_request TO poolse_app;

-- Down Migration

REVOKE UPDATE (decline_reason) ON support_request FROM poolse_app;
ALTER TABLE support_request DROP CONSTRAINT support_request_decline_reason;
ALTER TABLE support_request DROP COLUMN decline_reason;
