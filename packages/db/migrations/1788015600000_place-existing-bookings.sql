-- Up Migration
--
-- Put the bookings that already exist onto the grid they now have.
--
-- A gap between two tickets, found the first time a real club's calendar was
-- opened after POOLSE-49: **every existing booking rendered "fora da grelha"**
-- and the grid itself was empty.
--
-- Neither ticket was wrong on its own. POOLSE-46 added `class_schedule.slot_id`
-- nullable, because the slots did not exist yet. POOLSE-44 created the slots,
-- but had no reason to reach into bookings that predated it. So the column was
-- correct, the slots were correct, and nothing had ever connected them — which
-- only became visible once POOLSE-49 started *drawing* the grid from slots.
--
-- **Matched on the exact start time, and nothing looser.** A class at 10:30 in a
-- club whose grid runs 10:15 and 11:00 is genuinely not on the grid, and
-- snapping it to the nearest row would silently move a real class by fifteen
-- minutes to make a screen tidier. Those keep a null `slot_id` and render in
-- "fora da grelha" with their real time, which is the honest answer and exactly
-- what that block was built for.
--
-- The day group is derived the way the grid reads it: 1–5 weekday, 6 Saturday,
-- 7 Sunday.
--
-- Idempotent: only rows whose `slot_id` is null are touched, so re-running it
-- after somebody has dragged a booking somewhere does not undo their work.

UPDATE class_schedule cs
   SET slot_id = fts.id
  FROM facility_time_slot fts
  LEFT JOIN LATERAL (SELECT 1) AS ignored ON true
 WHERE cs.slot_id IS NULL
   AND cs.archived_at IS NULL
   AND fts.archived_at IS NULL
   AND fts.organization_id = cs.organization_id
   AND fts.facility_id = cs.facility_id
   AND fts.start_time = cs.start_time
   AND fts.day_group = (
     CASE
       WHEN cs.weekday BETWEEN 1 AND 5 THEN 'weekday'
       WHEN cs.weekday = 6 THEN 'saturday'
       ELSE 'sunday'
     END
   )::day_group
   /*
    * The slot has to belong to the booking's own season, or a club planning next
    * year would find this year's classes placed on next year's grid. The season
    * of a booking is `coalesce(cs.season_id, cg.season_id)` — POOLSE-47's rule.
    */
   AND fts.season_id = coalesce(
     cs.season_id,
     (SELECT cg.season_id FROM class_group cg
       WHERE cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id)
   );

-- Down Migration
--
-- Deliberately does nothing.
--
-- Reversing this would mean clearing `slot_id` on bookings that may since have
-- been dragged onto a slot on purpose, and there is no way to tell those apart
-- from the ones this migration placed. Rolling back would therefore destroy real
-- work to undo a repair. The Up is idempotent and additive; there is nothing
-- here worth taking back.

SELECT 1;
