-- Up Migration
--
-- Turmas that overlap on a lane — a warning and a circle, never a refusal (Rui, 14-11-2026).
--
-- Two turmas in the same pool at overlapping hours on the same weekday are
-- normal when they swim in different lanes. They need the office when they
-- would share a lane, or when one of them has no lane yet (*Sem pista*): then
-- somebody has to spread them over the lanes on the calendar. This is the one
-- definition of that, read by the save's warning and by the bell's circle.
--
-- The published season only (the calendar the club is living in); a booking's
-- season is coalesce(class_schedule.season_id, class_group.season_id). One row
-- per overlapping pair of weekly slots, the lower id first.

CREATE FUNCTION turma_lane_overlaps(p_organization_id uuid)
RETURNS TABLE (
  schedule_id uuid,
  class_group_id uuid,
  other_schedule_id uuid,
  other_class_group_id uuid,
  pool_id uuid,
  weekday smallint,
  start_time text,
  other_start_time text
)
LANGUAGE sql STABLE AS $$
  WITH live AS (
    SELECT cs.id, cs.class_group_id, cs.weekday, cs.start_time, cs.duration_minutes,
           coalesce(cs.pool_id, cg.pool_id) AS pool_id
      FROM class_schedule cs
      JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
      JOIN season s ON s.id = coalesce(cs.season_id, cg.season_id) AND s.organization_id = cs.organization_id
     WHERE cs.organization_id = p_organization_id
       AND cs.archived_at IS NULL AND cs.subject_type = 'turma'
       AND cg.archived_at IS NULL
       AND s.status = 'published' AND s.archived_at IS NULL
  )
  SELECT a.id, a.class_group_id, b.id, b.class_group_id, a.pool_id, a.weekday,
         to_char(a.start_time, 'HH24:MI'), to_char(b.start_time, 'HH24:MI')
    FROM live a
    JOIN live b
      ON b.pool_id = a.pool_id AND b.weekday = a.weekday
     AND b.class_group_id <> a.class_group_id AND a.id < b.id
     AND (a.start_time, a.start_time + make_interval(mins => a.duration_minutes))
         OVERLAPS (b.start_time, b.start_time + make_interval(mins => b.duration_minutes))
   WHERE a.pool_id IS NOT NULL
     AND (
       EXISTS (SELECT 1 FROM booking_lane x JOIN booking_lane y ON y.lane_id = x.lane_id
                WHERE x.schedule_id = a.id AND y.schedule_id = b.id)
       OR NOT EXISTS (SELECT 1 FROM booking_lane x WHERE x.schedule_id = a.id)
       OR NOT EXISTS (SELECT 1 FROM booking_lane y WHERE y.schedule_id = b.id)
     )
   ORDER BY a.weekday, a.start_time;
$$;

-- Down Migration

DROP FUNCTION IF EXISTS turma_lane_overlaps(uuid);
