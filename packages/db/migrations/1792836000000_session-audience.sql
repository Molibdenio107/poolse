-- Up Migration

-- POOLSE-90 slice 4: a cancelled lesson tells its families. A new audience on
-- POOLSE-67's message record, so email, retry, recipients and history come with
-- it. Its own migration because a value added to an enum cannot be used in the
-- transaction that adds it — the closure audience did the same (1790028000000).

ALTER TYPE message_audience ADD VALUE IF NOT EXISTS 'session';

-- Down Migration

-- An enum value cannot be dropped without rebuilding the type; the next
-- migration's Down removes every use of it, and an unused value is harmless.
