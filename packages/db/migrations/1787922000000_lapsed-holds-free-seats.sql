-- A hold that ran out stops holding the seat — POOLSE-21, found in review.
--
-- `session_free_seats()` subtracted every pending booking regardless of
-- `holds_until`. `release_expired_reposicao_holds()` exists to clear those, and
-- **nothing calls it**, because the product has no scheduled-job runner yet.
--
-- So the bug was not "the sweep is late". It was that an unanswered request
-- removed a place from that occurrence *permanently*: the seat never came back,
-- the family never got their class, and no screen explained why the turma looked
-- full when it was not.
--
-- **The fix is to make the rule true without the sweep.** A hold past its
-- deadline is not a hold, so the seat count stops counting it the moment it
-- lapses. The sweep is still worth running when there is something to run it —
-- it writes the cancellation, returns the credit to `available` and gives the
-- family their class back — but the seat is no longer hostage to it.
--
-- This is the better shape regardless of scheduling. A derived count that
-- depends on a job having run is a count that is wrong for as long as the job is
-- late, and "how late is the job" is not a question a roster should answer.

-- Up Migration

CREATE OR REPLACE FUNCTION session_free_seats(p_session_id uuid) RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  SELECT cg.capacity
         - (
             SELECT count(*)
               FROM enrollment e
              WHERE e.class_group_id = cs.class_group_id
                AND e.organization_id = cs.organization_id
                AND e.status = 'active'
           )
         + (
             -- Absences recorded on this occurrence give their place back for
             -- this date. Only for students actually enrolled, so a guest marked
             -- absent cannot free a seat they never occupied.
             SELECT count(*)
               FROM attendance a
               JOIN enrollment e
                 ON e.student_id = a.student_id
                AND e.class_group_id = cs.class_group_id
                AND e.organization_id = a.organization_id
                AND e.status = 'active'
              WHERE a.class_session_id = cs.id
                AND a.organization_id = cs.organization_id
                AND a.status IN ('absent', 'excused')
           )
         - (
             SELECT count(*)
               FROM reposicao_booking b
              WHERE b.class_session_id = cs.id
                AND b.organization_id = cs.organization_id
                AND b.archived_at IS NULL
                AND (
                  b.status = 'confirmed'
                  /*
                   * A pending request holds its seat only while its hold is
                   * live. Past `holds_until` it is waiting to be tidied away,
                   * not occupying anything — and until a scheduler exists to do
                   * the tidying, treating it as occupied would take the place out
                   * of circulation for good.
                   */
                  OR (b.status = 'pending'
                      AND (b.holds_until IS NULL OR b.holds_until > now()))
                )
           )
    FROM class_session cs
    JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = p_session_id;
$fn$;

COMMENT ON FUNCTION session_free_seats(uuid) IS
  'Places open on one occurrence: enrolled, minus absences recorded on that date, '
  'minus reposição guests whose booking is confirmed or still within its hold — '
  'POOLSE-21. A lapsed hold frees the seat immediately, without waiting for a '
  'sweep that may never run.';

-- Down Migration
--
-- Back to counting every pending booking, lapsed or not. Restored verbatim from
-- the `reposicao-booking` migration so a rollback lands on exactly what was
-- there before rather than on something similar.

CREATE OR REPLACE FUNCTION session_free_seats(p_session_id uuid) RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  SELECT cg.capacity
         - (
             SELECT count(*)
               FROM enrollment e
              WHERE e.class_group_id = cs.class_group_id
                AND e.organization_id = cs.organization_id
                AND e.status = 'active'
           )
         + (
             SELECT count(*)
               FROM attendance a
               JOIN enrollment e
                 ON e.student_id = a.student_id
                AND e.class_group_id = cs.class_group_id
                AND e.organization_id = a.organization_id
                AND e.status = 'active'
              WHERE a.class_session_id = cs.id
                AND a.organization_id = cs.organization_id
                AND a.status IN ('absent', 'excused')
           )
         - (
             SELECT count(*)
               FROM reposicao_booking b
              WHERE b.class_session_id = cs.id
                AND b.organization_id = cs.organization_id
                AND b.status IN ('pending', 'confirmed')
                AND b.archived_at IS NULL
           )
    FROM class_session cs
    JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = p_session_id;
$fn$;
