-- Up Migration
--
-- A message to the families a closure took lessons from — 12 October 2026.
-- Its own file: Postgres refuses to use an enum value in the transaction that
-- added it, and the next migration's CHECK and function use it.

ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'closure';

-- Down Migration

-- An enum value cannot be dropped in place; the next migration's Down refuses
-- while a closure message exists, and with none the value is harmless.
SELECT 1;
