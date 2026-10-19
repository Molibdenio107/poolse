-- Up Migration
--
-- 19-10-2026 sweep — what review found in POOLSE-84's closures.
--
-- **From today on.** `apply_closures`, `release_closures` and `closure_impact`
-- walked every lesson the club ever had, on every timetable write: 77 ms for
-- 1,400 sessions in dev, seconds for a club with three seasons behind it. And
-- walking the past was wrong as well as slow — an annual closure rewrote last
-- year's lessons, which the cost report and invoicing read as history. A
-- closure acts on lessons from the club's today: the same window
-- `syncSeasonLessons` generates in.
--
-- **A taught lesson is a record.** Generation-wide, `apply_closures` now leaves
-- a lesson with a register alone instead of letting `class_session_keep_marked`
-- roll the whole generation back — one lesson moved into a closed tank and
-- marked used to stop every turma in the club getting its lessons, logged and
-- never said. Saving one closure over a marked lesson is still refused, with
-- its sentence: the operator is asking, and should be told.
--
-- **Lifting gives back only what still exists.** `release_closures` restores a
-- lesson only if its slot and its turma are live — a slot removed while a
-- closure held its weeks used to come back owing registers — and does it one
-- lesson at a time, so a lesson whose lane or instructor was taken meanwhile
-- stays cancelled and counted instead of failing the removal with a 500.

CREATE OR REPLACE FUNCTION apply_closures(p_organization_id uuid, p_closure_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_cancelled integer;
BEGIN
  WITH hit AS (
    SELECT DISTINCT ON (cs.id) cs.id, c.id AS closure_id, c.reason
      FROM class_session cs
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
      JOIN closure c
        ON c.organization_id = cs.organization_id
       AND closure_applies(c, r.facility_id, r.pool_ids, r.local_start)
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       -- A day either side of today in UTC, so the index does the narrowing;
       -- the club's own day decides.
       AND cs.starts_at >= (club_today() - 1)::timestamptz
       AND r.local_start::date >= club_today()
       AND (p_closure_id IS NULL OR c.id = p_closure_id)
       -- Generation-wide, a taught lesson is left alone; one closure saved over
       -- it is refused by `class_session_keep_marked`, which says so.
       AND (p_closure_id IS NOT NULL OR NOT EXISTS (
             SELECT 1 FROM attendance a
              WHERE a.class_session_id = cs.id AND a.organization_id = cs.organization_id))
     ORDER BY cs.id, c.created_at, c.id
  ),
  cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = hit.closure_id,
           cancellation_reason = hit.reason
      FROM hit
     WHERE cs.id = hit.id AND cs.organization_id = p_organization_id
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  RETURN v_cancelled;
END;
$fn$;

CREATE OR REPLACE FUNCTION release_closures(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_restored integer := 0;
  s          record;
  v_next     record;
BEGIN
  FOR s IN
    SELECT cs.id, r.facility_id, r.pool_ids, r.local_start
      FROM class_session cs
      JOIN closure c0
        ON c0.id = cs.closure_id AND c0.organization_id = cs.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
      LEFT JOIN class_group cg
        ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'cancelled'
       AND cs.closure_id IS NOT NULL
       AND cs.starts_at >= (club_today() - 1)::timestamptz
       AND r.local_start::date >= club_today()
       -- Only what still exists: a removed slot or an archived turma stays off.
       AND (cs.schedule_id IS NULL OR sch.archived_at IS NULL)
       AND (cs.class_group_id IS NULL OR cg.archived_at IS NULL)
       AND NOT closure_applies(c0, r.facility_id, r.pool_ids, r.local_start)
  LOOP
    -- Still under another closure: that one holds it now.
    SELECT c.id, c.reason INTO v_next
      FROM closure c
     WHERE c.organization_id = p_organization_id
       AND closure_applies(c, s.facility_id, s.pool_ids, s.local_start)
     ORDER BY c.created_at, c.id
     LIMIT 1;

    IF v_next.id IS NOT NULL THEN
      UPDATE class_session
         SET closure_id = v_next.id, cancellation_reason = v_next.reason
       WHERE id = s.id;
      CONTINUE;
    END IF;

    -- One at a time: a lane or an instructor taken meanwhile keeps this one off.
    BEGIN
      UPDATE class_session
         SET status = 'scheduled', closure_id = NULL, cancellation_reason = NULL
       WHERE id = s.id;
      v_restored := v_restored + 1;
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      NULL;
    END;
  END LOOP;

  RETURN v_restored;
END;
$fn$;

CREATE OR REPLACE FUNCTION closure_impact(
  p_organization_id uuid,
  p_starts_on       date,
  p_ends_on         date,
  p_facility_id     uuid,
  p_pool_ids        uuid[] DEFAULT '{}',
  p_part            closure_part_of_day DEFAULT NULL,
  p_repeats         boolean DEFAULT false
) RETURNS TABLE (o_sessions integer, o_marked integer)
LANGUAGE sql STABLE
AS $fn$
  WITH covered AS (
    SELECT cs.id
      FROM class_session cs
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       -- The window `apply_closures` acts in, so the count is what it will take.
       AND cs.starts_at >= (club_today() - 1)::timestamptz
       AND r.local_start::date >= club_today()
       AND EXISTS (
         SELECT 1
           FROM unnest(CASE WHEN cardinality(p_pool_ids) = 0 THEN ARRAY[NULL::uuid]
                            ELSE p_pool_ids END) AS tank(id)
          WHERE closure_reaches(p_facility_id, tank.id, p_starts_on, p_ends_on, p_repeats,
                                p_part, r.facility_id, r.pool_ids, r.local_start)
       )
  )
  SELECT (SELECT count(*) FROM covered)::int,
         (SELECT count(DISTINCT a.class_session_id)
            FROM attendance a
           WHERE a.class_session_id IN (SELECT id FROM covered))::int;
$fn$;

-- Down Migration

-- The POOLSE-84 definitions, as they were.

CREATE OR REPLACE FUNCTION apply_closures(p_organization_id uuid, p_closure_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_cancelled integer;
BEGIN
  WITH hit AS (
    SELECT DISTINCT ON (cs.id) cs.id, c.id AS closure_id, c.reason
      FROM class_session cs
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
      JOIN closure c
        ON c.organization_id = cs.organization_id
       AND closure_applies(c, r.facility_id, r.pool_ids, r.local_start)
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       AND (p_closure_id IS NULL OR c.id = p_closure_id)
     ORDER BY cs.id, c.created_at, c.id
  ),
  cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = hit.closure_id,
           cancellation_reason = hit.reason
      FROM hit
     WHERE cs.id = hit.id AND cs.organization_id = p_organization_id
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  RETURN v_cancelled;
END;
$fn$;

CREATE OR REPLACE FUNCTION release_closures(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_restored integer;
BEGIN
  WITH stale AS (
    SELECT cs.id, r.facility_id, r.pool_ids, r.local_start
      FROM class_session cs
      JOIN closure c0
        ON c0.id = cs.closure_id AND c0.organization_id = cs.organization_id
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'cancelled'
       AND cs.closure_id IS NOT NULL
       AND NOT closure_applies(c0, r.facility_id, r.pool_ids, r.local_start)
  ),
  successor AS (
    SELECT DISTINCT ON (s.id) s.id, c.id AS closure_id, c.reason
      FROM stale s
      JOIN closure c
        ON c.organization_id = p_organization_id
       AND closure_applies(c, s.facility_id, s.pool_ids, s.local_start)
     ORDER BY s.id, c.created_at, c.id
  ),
  restamped AS (
    UPDATE class_session cs
       SET closure_id = n.closure_id,
           cancellation_reason = n.reason
      FROM successor n
     WHERE cs.id = n.id AND cs.organization_id = p_organization_id
    RETURNING 1
  ),
  restored AS (
    UPDATE class_session cs
       SET status = 'scheduled',
           closure_id = NULL,
           cancellation_reason = NULL
      FROM stale s
     WHERE cs.id = s.id AND cs.organization_id = p_organization_id
       AND NOT EXISTS (SELECT 1 FROM successor n WHERE n.id = s.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_restored FROM restored
   CROSS JOIN (SELECT count(*) FROM restamped) AS written;

  RETURN v_restored;
END;
$fn$;

CREATE OR REPLACE FUNCTION closure_impact(
  p_organization_id uuid,
  p_starts_on       date,
  p_ends_on         date,
  p_facility_id     uuid,
  p_pool_ids        uuid[] DEFAULT '{}',
  p_part            closure_part_of_day DEFAULT NULL,
  p_repeats         boolean DEFAULT false
) RETURNS TABLE (o_sessions integer, o_marked integer)
LANGUAGE sql STABLE
AS $fn$
  WITH covered AS (
    SELECT cs.id
      FROM class_session cs
      CROSS JOIN LATERAL session_reach(cs.organization_id, cs.id) r
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       AND EXISTS (
         SELECT 1
           FROM unnest(CASE WHEN cardinality(p_pool_ids) = 0 THEN ARRAY[NULL::uuid]
                            ELSE p_pool_ids END) AS tank(id)
          WHERE closure_reaches(p_facility_id, tank.id, p_starts_on, p_ends_on, p_repeats,
                                p_part, r.facility_id, r.pool_ids, r.local_start)
       )
  )
  SELECT (SELECT count(*) FROM covered)::int,
         (SELECT count(DISTINCT a.class_session_id)
            FROM attendance a
           WHERE a.class_session_id IN (SELECT id FROM covered))::int;
$fn$;
