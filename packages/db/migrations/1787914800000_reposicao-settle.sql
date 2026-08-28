-- Closing a reposição out — POOLSE-21, the last of the credit lifecycle.
--
-- A credit went `available → booked` and stopped there. `used` existed in the
-- enum and nothing ever set it, so a family who attended their make-up in March
-- still had a credit reading "Marcada" in July, and the office's end-of-época
-- count was wrong by every reposição anybody actually took.
--
-- **A booking becomes used when its class has happened, whether or not the
-- student turned up.** The ticket is explicit about that, and it is the right
-- rule: the club held a place, an instructor expected somebody, and the cost was
-- incurred. A no-show is an attendance question, not a refund.
--
-- Time passing is the trigger, and nothing in the database notices time passing
-- by itself — so this is a function the scheduled sweep calls, beside the expiry
-- job and the hold release. All three take their "now" from the caller for the
-- same reason: a scheduled task must be re-runnable at a moment a test chooses.

-- Up Migration

CREATE FUNCTION settle_reposicao_bookings(p_organization_id uuid, p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_settled int;
BEGIN
  WITH spent AS (
    /*
     * The credit is what moves. The booking already says `confirmed` and that
     * remains true — it *was* confirmed, and rewriting it to some past tense
     * would lose the difference between "we agreed to this" and "this happened".
     *
     * `redeemed_at` is the end of the class rather than now, so the record says
     * when the class was rather than when a sweep noticed. Re-running tomorrow
     * therefore produces the same timestamp, which is what makes this idempotent
     * in the way that matters — not merely "runs twice without erroring".
     */
    UPDATE reposicao_credit c
       SET status = 'used',
           redeemed_at = cs.ends_at
      FROM reposicao_booking b
      JOIN class_session cs
        ON cs.id = b.class_session_id AND cs.organization_id = b.organization_id
     WHERE c.id = b.credit_id
       AND c.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.status = 'booked'
       AND b.status = 'confirmed'
       AND b.archived_at IS NULL
       AND cs.ends_at <= p_now
       -- A class the club cancelled after the booking was made is not a class
       -- anybody attended, so it spends nothing. The hold is released instead,
       -- by the sweep beside this one.
       AND cs.status = 'scheduled'
    RETURNING c.id, c.student_id, b.class_session_id
  ),
  logged AS (
    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT p_organization_id, 'reposicao.used', 'reposicao_credit', spent.id,
           jsonb_build_object('studentId', spent.student_id,
                              'classSessionId', spent.class_session_id)
      FROM spent
    RETURNING 1
  )
  SELECT count(*)::int INTO v_settled FROM logged;

  RETURN v_settled;
END;
$fn$;

COMMENT ON FUNCTION settle_reposicao_bookings(uuid, timestamptz) IS
  'Marks a reposição used once its class has happened — POOLSE-21. Whether or '
  'not the student turned up: the club held the place. Idempotent, and stamps '
  'redeemed_at with the end of the class rather than the moment of the sweep.';

REVOKE ALL ON FUNCTION settle_reposicao_bookings(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION settle_reposicao_bookings(uuid, timestamptz) TO poolse_app;

/*
 * A cancelled occurrence releases its guests.
 *
 * The companion to the rule above: if the club calls off the class, the family
 * did not get their make-up and must keep the credit. Without this a closure
 * would quietly consume every reposição booked into the day it covers — which is
 * the opposite of POOLSE-31's decision that a closure costs nobody anything.
 */
CREATE FUNCTION release_cancelled_reposicao_bookings(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_released int;
BEGIN
  WITH lost AS (
    UPDATE reposicao_booking b
       SET status = 'cancelled', holds_until = NULL, decided_at = now()
      FROM class_session cs
     WHERE cs.id = b.class_session_id
       AND cs.organization_id = b.organization_id
       AND b.organization_id = p_organization_id
       AND b.status IN ('pending', 'confirmed')
       AND b.archived_at IS NULL
       AND cs.status = 'cancelled'
    RETURNING b.id, b.credit_id
  ),
  freed AS (
    UPDATE reposicao_credit c
       SET status = 'available'
      FROM lost
     WHERE c.id = lost.credit_id AND c.status = 'booked'
    RETURNING c.id
  ),
  logged AS (
    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT p_organization_id, 'reposicao.class_cancelled', 'reposicao_booking',
           lost.id, jsonb_build_object('creditId', lost.credit_id)
      FROM lost
    RETURNING 1
  )
  SELECT count(*)::int INTO v_released FROM logged;

  RETURN v_released;
END;
$fn$;

COMMENT ON FUNCTION release_cancelled_reposicao_bookings(uuid) IS
  'Gives a reposição back when the club cancels the class it was booked into — '
  'POOLSE-21 and POOLSE-31. A closure costs nobody anything.';

REVOKE ALL ON FUNCTION release_cancelled_reposicao_bookings(uuid) FROM public;
GRANT EXECUTE ON FUNCTION release_cancelled_reposicao_bookings(uuid) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS release_cancelled_reposicao_bookings(uuid);
DROP FUNCTION IF EXISTS settle_reposicao_bookings(uuid, timestamptz);
