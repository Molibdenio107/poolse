-- Sweep of POOLSE-112, 23-10-2026.
--
-- **A skill no longer cancels an age proposal.** `advancement_on_skill_progress()`
-- invalidated every pending proposal from a level whenever a skill was written
-- and the level was not complete -- the normal state. An age proposal does not
-- rest on the level being complete, so the next skill a coach marked took a
-- nine-year-old out of the queue, and in automatic mode they were never moved.
-- The UPDATE now reaches `reason = 'skills'` only.
--
-- **The queue's Propor judges on the day its count uses.** The outlook counts who
-- is above their band *today* and shows *Propor* for them; the generator judged
-- on the season's first day, so a child who passed the maximum in December was
-- counted and offered, and pressing it queued nobody. `propose_age_advancements`
-- takes an optional `p_on`; the button passes `club_today()`, the publish passes
-- nothing and keeps the season's first day.

-- Up Migration

CREATE OR REPLACE FUNCTION advancement_on_skill_progress() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_level uuid;
  v_next  uuid;
BEGIN
  SELECT level_id INTO v_level FROM skill WHERE id = NEW.skill_id;
  IF v_level IS NULL THEN RETURN NEW; END IF;

  IF level_is_complete(NEW.student_id, v_level) THEN
    v_next := next_level(NEW.organization_id, v_level);

    /*
     * No next level: nothing happens, deliberately.
     *
     * What a club owes a student who has finished the whole programme is a
     * business decision that is still open — it may be the student's choice, or
     * it may follow from their age. Inventing a state here would be guessing,
     * and a guess in the schema is expensive to unpick.
     */
    IF v_next IS NULL THEN RETURN NEW; END IF;

    /*
     * ON CONFLICT DO NOTHING against the partial unique index, which is what
     * makes this idempotent under the grid's incremental saves. Marking the last
     * skill twice proposes once.
     */
    INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id)
    VALUES (NEW.organization_id, NEW.student_id, v_level, v_next)
    ON CONFLICT DO NOTHING;

  ELSE
    /*
     * The level is no longer complete — a skill was corrected back down. Any
     * pending proposal is invalidated rather than deleted, so the queue can say
     * what happened instead of a row disappearing between two glances. A
     * proposal already confirmed is history and is left alone.
     */
    UPDATE transfer_proposal
       SET status = 'invalidated'
     WHERE organization_id = NEW.organization_id
       AND student_id = NEW.student_id
       AND from_level_id = v_level
       AND status = 'pending'
       -- A skills proposal only (sweep 23-10-2026): an age proposal does not
       -- rest on the level being complete, so a skill marked at the old level
       -- must not take it out of the queue.
       AND reason = 'skills'
       AND archived_at IS NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP FUNCTION propose_age_advancements(uuid, uuid, uuid);

CREATE FUNCTION propose_age_advancements(
  p_organization_id uuid,
  p_season_id       uuid,
  p_level_id        uuid DEFAULT NULL,
  -- The day ages are judged on; the season's first day when not given.
  p_on              date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_on    date;
  v_count integer;
BEGIN
  SELECT starts_on INTO v_on
    FROM season
   WHERE id = p_season_id AND organization_id = p_organization_id
     AND archived_at IS NULL;
  IF v_on IS NULL THEN
    RAISE EXCEPTION 'propose_age_advancements: no such season %', p_season_id
      USING ERRCODE = 'no_data_found';
  END IF;
  v_on := coalesce(p_on, v_on);

  WITH queued AS (
    INSERT INTO transfer_proposal
      (organization_id, student_id, from_level_id, to_level_id, reason, season_id)
    SELECT p_organization_id, st.student_id, st.level_id, st.fits, 'age', p_season_id
      FROM age_band_standing(p_organization_id, v_on) st
     WHERE st.standing = 'above'
       AND st.fits IS NOT NULL
       AND (p_level_id IS NULL OR st.level_id = p_level_id)
       AND NOT EXISTS (
             SELECT 1 FROM transfer_proposal d
              WHERE d.student_id = st.student_id
                AND d.from_level_id = st.level_id
                AND d.season_id = p_season_id
                AND d.status = 'dismissed'
                AND d.archived_at IS NULL
           )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM queued;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION propose_age_advancements(uuid, uuid, uuid, date) IS
  'Queues an age proposal for every live student above their level''s band on '
  'p_on, else the season''s first day -- POOLSE-112 BA 1. Idempotent; a person''s '
  'dismissal for that season is kept. Optionally one level only (the queue''s Propor).';

-- Down Migration

CREATE OR REPLACE FUNCTION advancement_on_skill_progress() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_level uuid;
  v_next  uuid;
BEGIN
  SELECT level_id INTO v_level FROM skill WHERE id = NEW.skill_id;
  IF v_level IS NULL THEN RETURN NEW; END IF;

  IF level_is_complete(NEW.student_id, v_level) THEN
    v_next := next_level(NEW.organization_id, v_level);

    /*
     * No next level: nothing happens, deliberately.
     *
     * What a club owes a student who has finished the whole programme is a
     * business decision that is still open — it may be the student's choice, or
     * it may follow from their age. Inventing a state here would be guessing,
     * and a guess in the schema is expensive to unpick.
     */
    IF v_next IS NULL THEN RETURN NEW; END IF;

    /*
     * ON CONFLICT DO NOTHING against the partial unique index, which is what
     * makes this idempotent under the grid's incremental saves. Marking the last
     * skill twice proposes once.
     */
    INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id)
    VALUES (NEW.organization_id, NEW.student_id, v_level, v_next)
    ON CONFLICT DO NOTHING;

  ELSE
    /*
     * The level is no longer complete — a skill was corrected back down. Any
     * pending proposal is invalidated rather than deleted, so the queue can say
     * what happened instead of a row disappearing between two glances. A
     * proposal already confirmed is history and is left alone.
     */
    UPDATE transfer_proposal
       SET status = 'invalidated'
     WHERE organization_id = NEW.organization_id
       AND student_id = NEW.student_id
       AND from_level_id = v_level
       AND status = 'pending'
       AND archived_at IS NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP FUNCTION propose_age_advancements(uuid, uuid, uuid, date);

CREATE FUNCTION propose_age_advancements(
  p_organization_id uuid,
  p_season_id       uuid,
  p_level_id        uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_on    date;
  v_count integer;
BEGIN
  SELECT starts_on INTO v_on
    FROM season
   WHERE id = p_season_id AND organization_id = p_organization_id
     AND archived_at IS NULL;
  IF v_on IS NULL THEN
    RAISE EXCEPTION 'propose_age_advancements: no such season %', p_season_id
      USING ERRCODE = 'no_data_found';
  END IF;

  WITH queued AS (
    INSERT INTO transfer_proposal
      (organization_id, student_id, from_level_id, to_level_id, reason, season_id)
    SELECT p_organization_id, st.student_id, st.level_id, st.fits, 'age', p_season_id
      FROM age_band_standing(p_organization_id, v_on) st
     WHERE st.standing = 'above'
       AND st.fits IS NOT NULL
       AND (p_level_id IS NULL OR st.level_id = p_level_id)
       AND NOT EXISTS (
             SELECT 1 FROM transfer_proposal d
              WHERE d.student_id = st.student_id
                AND d.from_level_id = st.level_id
                AND d.season_id = p_season_id
                AND d.status = 'dismissed'
                AND d.archived_at IS NULL
           )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM queued;

  RETURN v_count;
END;
$fn$;
