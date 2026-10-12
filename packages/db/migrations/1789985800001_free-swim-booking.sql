-- Up Migration
--
-- POOLSE-68 slice 2: a free-swim booking. No turma and no partner group, like
-- an evento — it holds lanes for the public at a weekday and hour, and
-- `generate_sessions` already materialises any non-turma booking of the
-- published season, so its sessions and their lane rows follow with no change
-- there. That is what keeps a turma off a public lane: the lane exclusion is on
-- `class_session_lane`.
--
-- **Nobody teaches it.** `instructor_status` stays whatever the state machine
-- leaves (`to_define`), and every reader of "sem professor" leaves free swim
-- out; a lifeguard on duty is POOLSE-70's, not an instructor.
--
-- **It counts nobody.** `pool_occupancy` counts free swimmers by check-in, so a
-- free-swim session contributes zero rather than a headcount it would double.

ALTER TABLE class_schedule DROP CONSTRAINT class_schedule_subject_check;
ALTER TABLE class_schedule ADD CONSTRAINT class_schedule_subject_check CHECK (
  (subject_type = 'turma' AND class_group_id IS NOT NULL AND partner_group_id IS NULL)
  OR (subject_type = 'parceria' AND partner_group_id IS NOT NULL AND class_group_id IS NULL)
  OR (subject_type IN ('evento', 'manutencao', 'free_swim')
      AND class_group_id IS NULL AND partner_group_id IS NULL)
);

CREATE OR REPLACE FUNCTION pool_occupancy(
  p_organization_id uuid,
  p_pool_id         uuid,
  p_at              timestamptz DEFAULT now()
) RETURNS TABLE (capacity integer, swimmers integer, in_classes integer)
LANGUAGE sql
STABLE
AS $$
  SELECT p.max_capacity,
         (SELECT count(*)::integer
            FROM pass_check_in c
           WHERE c.organization_id = p_organization_id
             AND c.pool_id = p_pool_id
             AND c.archived_at IS NULL
             AND c.checked_in_at <= p_at
             AND coalesce(c.checked_out_at,
                          c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
                 > p_at),
         (SELECT coalesce(sum(
                   CASE
                     -- A free-swim block holds the water for the public; the
                     -- people in it arrive as check-ins and are counted there.
                     WHEN sch.subject_type = 'free_swim' THEN 0
                     WHEN cg.id IS NOT NULL THEN (
                       SELECT count(*) FROM enrollment e
                        WHERE e.class_group_id = cg.id
                          AND e.organization_id = s.organization_id
                          AND e.status = 'active')
                     ELSE coalesce(sch.headcount_override, pg.participant_count, 0)
                   END), 0)::integer
            FROM class_session s
            LEFT JOIN class_schedule sch
              ON sch.id = s.schedule_id AND sch.organization_id = s.organization_id
            LEFT JOIN class_group cg
              ON cg.id = coalesce(s.class_group_id, sch.class_group_id)
             AND cg.organization_id = s.organization_id
            LEFT JOIN partner_group pg
              ON pg.id = sch.partner_group_id AND pg.organization_id = s.organization_id
           WHERE s.organization_id = p_organization_id
             AND s.status <> 'cancelled'
             AND s.starts_at <= p_at
             AND s.ends_at > p_at
             AND (coalesce(s.pool_id, cg.pool_id) = p_pool_id
                  OR EXISTS (
                    SELECT 1 FROM class_session_lane sl
                      JOIN lane l ON l.id = sl.lane_id AND l.organization_id = sl.organization_id
                     WHERE sl.session_id = s.id
                       AND sl.organization_id = s.organization_id
                       AND NOT sl.cancelled
                       AND l.pool_id = p_pool_id)))
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
   WHERE p.id = p_pool_id
     AND p.organization_id = p_organization_id
$$;

-- Down Migration

-- Refused while a free-swim booking exists, which is correct: the older CHECK
-- cannot describe it, and dropping bookings silently would empty the grid.
ALTER TABLE class_schedule DROP CONSTRAINT class_schedule_subject_check;
ALTER TABLE class_schedule ADD CONSTRAINT class_schedule_subject_check CHECK (
  (subject_type = 'turma' AND class_group_id IS NOT NULL AND partner_group_id IS NULL)
  OR (subject_type = 'parceria' AND partner_group_id IS NOT NULL AND class_group_id IS NULL)
  OR (subject_type IN ('evento', 'manutencao')
      AND class_group_id IS NULL AND partner_group_id IS NULL)
);

CREATE OR REPLACE FUNCTION pool_occupancy(
  p_organization_id uuid,
  p_pool_id         uuid,
  p_at              timestamptz DEFAULT now()
) RETURNS TABLE (capacity integer, swimmers integer, in_classes integer)
LANGUAGE sql
STABLE
AS $$
  SELECT p.max_capacity,
         (SELECT count(*)::integer
            FROM pass_check_in c
           WHERE c.organization_id = p_organization_id
             AND c.pool_id = p_pool_id
             AND c.archived_at IS NULL
             AND c.checked_in_at <= p_at
             AND coalesce(c.checked_out_at,
                          c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
                 > p_at),
         (SELECT coalesce(sum(
                   CASE
                     WHEN cg.id IS NOT NULL THEN (
                       SELECT count(*) FROM enrollment e
                        WHERE e.class_group_id = cg.id
                          AND e.organization_id = s.organization_id
                          AND e.status = 'active')
                     ELSE coalesce(sch.headcount_override, pg.participant_count, 0)
                   END), 0)::integer
            FROM class_session s
            LEFT JOIN class_schedule sch
              ON sch.id = s.schedule_id AND sch.organization_id = s.organization_id
            LEFT JOIN class_group cg
              ON cg.id = coalesce(s.class_group_id, sch.class_group_id)
             AND cg.organization_id = s.organization_id
            LEFT JOIN partner_group pg
              ON pg.id = sch.partner_group_id AND pg.organization_id = s.organization_id
           WHERE s.organization_id = p_organization_id
             AND s.status <> 'cancelled'
             AND s.starts_at <= p_at
             AND s.ends_at > p_at
             AND (coalesce(s.pool_id, cg.pool_id) = p_pool_id
                  OR EXISTS (
                    SELECT 1 FROM class_session_lane sl
                      JOIN lane l ON l.id = sl.lane_id AND l.organization_id = sl.organization_id
                     WHERE sl.session_id = s.id
                       AND sl.organization_id = s.organization_id
                       AND NOT sl.cancelled
                       AND l.pool_id = p_pool_id)))
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
   WHERE p.id = p_pool_id
     AND p.organization_id = p_organization_id
$$;
