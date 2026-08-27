-- Encerramentos as ranges — POOLSE-31.
--
-- Three gaps between what closures do today and what the ticket asks for.
--
-- **Overlaps are not prevented.** Two closures covering the same days is not a
-- richer truth, it is a question nobody can answer: which reason does a
-- cancelled class carry? Prevented by the database rather than by a check in the
-- controller, because two operators creating "Natal" at the same moment would
-- both pass an application check and both insert.
--
-- **A closure only takes effect at the next generation.** `generate_sessions`
-- cancels what a closure covers, which means creating one today leaves this
-- afternoon's class standing until somebody presses "Gerar a época". Criterion 8
-- says the classes are cancelled; `apply_closure` is that step, callable on its
-- own.
--
-- **Nothing says what a closure is about to cost.** Criterion 10 wants a warning
-- when a closure covers days that already have registers, and that needs a
-- count before the insert rather than a regret after it.
--
-- What is already right and is not touched: `closure_id` on a cancelled session
-- distinguishes "the pool was shut" from a class somebody removed by hand
-- (POOLSE-14), and removing a closure restores exactly what it put down.

-- Up Migration

-- ---------------------------------------------------------------------------
-- No two manual closures over the same days
--
-- Scoped to closures of the same reach: two pool-specific closures on different
-- pools are not in conflict, and a pool closure inside an organization-wide one
-- is redundant rather than contradictory — the whole site is shut either way.
-- The sentinel uuid stands in for "the whole organization" so a null pool
-- compares equal to another null.
--
-- Annually-repeating closures are excluded. Their range is a pattern rather than
-- dates, `daterange` cannot express "every year", and the honest options were to
-- leave them out or to pretend. `closure_covers` is what evaluates them.
-- ---------------------------------------------------------------------------

ALTER TABLE closure
  ADD CONSTRAINT closure_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    (coalesce(pool_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
  WHERE (archived_at IS NULL AND source = 'manual' AND NOT repeats_annually);

-- ---------------------------------------------------------------------------
-- apply_closure — make one closure take effect now
--
-- The same cancellation `generate_sessions` performs, for a single closure and
-- without generating anything. Extracted rather than duplicated: if the rule for
-- what a closure covers ever changes, it must change in one place, and
-- `closure_covers` is already that place.
--
-- Only touches `scheduled` sessions. A class somebody already cancelled by hand
-- keeps their reason, and one that is `completed` is history.
-- ---------------------------------------------------------------------------

CREATE FUNCTION apply_closure(p_organization_id uuid, p_closure_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_cancelled integer;
BEGIN
  WITH cancelled AS (
    UPDATE class_session cs
       SET status = 'cancelled',
           closure_id = c.id,
           cancellation_reason = c.reason
      FROM closure c
     WHERE c.id = p_closure_id
       AND c.organization_id = p_organization_id
       AND cs.organization_id = p_organization_id
       AND c.archived_at IS NULL
       AND c.blocks_generation
       AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)
       AND cs.status = 'scheduled'
       AND closure_covers(
             c.starts_on, c.ends_on, c.repeats_annually,
             session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
           )
    RETURNING cs.id
  )
  SELECT count(*) INTO v_cancelled FROM cancelled;

  RETURN v_cancelled;
END;
$fn$;

COMMENT ON FUNCTION apply_closure(uuid, uuid) IS
  'Cancels the scheduled classes one closure covers, stamping closure_id so the '
  'cancellation is distinguishable from a human one and reversible — POOLSE-31.';

-- ---------------------------------------------------------------------------
-- closure_impact — what a range would cost, before it is saved
--
-- Answers criterion 10. Takes a range rather than a closure id, because the
-- question is asked while somebody is still choosing the dates.
--
-- `marked` is the number that matters: cancelling a class nobody has registered
-- is routine, and cancelling one with a register already taken means somebody
-- stood at the poolside and wrote it down.
-- ---------------------------------------------------------------------------

CREATE FUNCTION closure_impact(
  p_organization_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_pool_id uuid DEFAULT NULL
) RETURNS TABLE (o_sessions integer, o_marked integer)
LANGUAGE sql STABLE
AS $fn$
  WITH covered AS (
    SELECT cs.id
      FROM class_session cs
     WHERE cs.organization_id = p_organization_id
       AND cs.status = 'scheduled'
       AND (p_pool_id IS NULL OR cs.pool_id = p_pool_id)
       AND session_local_date(p_organization_id, cs.pool_id, cs.starts_at)
             BETWEEN p_starts_on AND p_ends_on
  )
  SELECT (SELECT count(*) FROM covered)::int,
         (SELECT count(DISTINCT a.class_session_id)
            FROM attendance a
           WHERE a.class_session_id IN (SELECT id FROM covered))::int;
$fn$;

-- Down Migration

DROP FUNCTION IF EXISTS closure_impact(uuid, date, date, uuid);
DROP FUNCTION IF EXISTS apply_closure(uuid, uuid);

ALTER TABLE closure DROP CONSTRAINT IF EXISTS closure_no_overlap;
