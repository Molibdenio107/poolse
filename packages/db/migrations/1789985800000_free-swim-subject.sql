-- Up Migration
--
-- POOLSE-68 slice 2: free swim is a booking on the lane grid — decisions
-- 2026-10-11. A subject type of its own, so the calendar stays the one picture
-- of the pool and the lane rules keep a turma off a public lane.
--
-- Its own file because Postgres refuses to *use* an enum value in the
-- transaction that added it, and the next migration's CHECK uses it.

ALTER TYPE booking_subject ADD VALUE IF NOT EXISTS 'free_swim';

-- Down Migration

-- An enum value cannot be dropped in place. The next migration's Down refuses
-- while a free-swim booking exists; with none, the value is harmless and stays.
SELECT 1;
