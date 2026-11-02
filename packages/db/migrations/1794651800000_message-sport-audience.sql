-- Up Migration

-- POOLSE-146: a message to everybody in one sport. The enum value alone — a
-- value added by ALTER TYPE cannot be used in the transaction that added it, so
-- the column, the CHECK and the recipients branch are the next migration (the
-- shape 1792836000000 took for `session`).

ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'sport';

-- Down Migration

-- Postgres cannot drop an enum value; nothing names it once the next migration
-- is reverted.
SELECT 1;
