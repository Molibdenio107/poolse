-- Up Migration
--
-- Everybody in the water at once — round 5, ticket 4.2.
--
-- `pool.max_capacity` records the ceiling. This is what makes it mean something:
-- the turmas sharing a tank at overlapping times may not, between them, promise
-- more places than the tank holds.
--
-- **A trigger, not an EXCLUDE constraint.** The conflict rules next door use
-- exclusion constraints because "the same instructor in two pools at once" is a
-- statement about a *pair* of rows, which is what GiST can refuse. This one is a
-- statement about a *sum*, and no exclusion constraint can express an aggregate.
-- So it takes the shape `enrollment_respects_capacity` already established one
-- table over, for the same reason and with the same lock.
--
-- **The numbers travel with the refusal**, in `DETAIL`, and that is the one
-- place this departs from the enrolment precedent next door. That trigger says
-- "full" and the API re-counts to produce a readable sentence — two
-- implementations of one sum, which agree until the day they do not. The
-- sentence this ticket asks for carries three figures ("the tank holds 40, this
-- slot already has 32, so this class may take 8"), and re-deriving them in
-- TypeScript would mean writing the overlap query twice.
--
-- So the exception carries `pool_capacity|<max>|<taken>|<asked>` in its DETAIL
-- field, which pg surfaces as `error.detail` — a real field, not prose to be
-- parsed out of a message somebody will reword. The API splits it and hands the
-- three numbers to the translation layer. One query, one answer, and it stays
-- correct even in the race this trigger exists for.
--
-- ---------------------------------------------------------------------------
-- What counts, and what deliberately does not
-- ---------------------------------------------------------------------------
--
-- **Distinct turmas, summed once.** A turma with two schedules that happen to
-- overlap is still one group of children; counting its capacity twice would
-- refuse a timetable that is fine. `sum(DISTINCT ...)` is wrong here — two
-- different turmas may legitimately hold the same number — so the sum is taken
-- over a subquery that has already reduced to one row per class group.
--
-- **Partnership bookings do not count.** A `class_schedule` row with
-- `subject_type = 'parceria'` names a partner group, not a turma, and carries no
-- headcount at all. Counting it as zero is the honest answer rather than a
-- convenient one: the schema does not know how many children a school brings, so
-- inventing a number would refuse real timetables on a figure nobody entered.
-- When partner groups grow a headcount, this is the query that reads it.
--
-- **A turma with no capacity does not count either**, and does not block. Null
-- means "not decided", which is what a club that has not filled it in means, and
-- treating it as unlimited-and-therefore-refuse-everything would make the tank
-- ceiling unusable until every turma had been edited.
--
-- **A pool with no ceiling is skipped entirely**, so nothing changes for the
-- clubs that never set one.

CREATE OR REPLACE FUNCTION pool_capacity_respected(
  p_organization_id uuid,
  p_class_group_id  uuid
) RETURNS void AS $$
DECLARE
  v_pool_id      uuid;
  v_max          integer;
  v_weekday      smallint;
  v_start        time;
  v_minutes      integer;
  v_taken        integer;
  v_own          integer;
BEGIN
  -- The tank this turma swims in, and what it may hold. Scoped by organization
  -- like every other query in this schema: without it the check reaches across
  -- tenants and refuses a save by counting another club's classes.
  SELECT cg.pool_id, cg.capacity
    INTO v_pool_id, v_own
    FROM class_group cg
   WHERE cg.id = p_class_group_id
     AND cg.organization_id = p_organization_id
     AND cg.archived_at IS NULL;

  -- No turma, no tank, or no capacity promised. Nothing to say in any of the
  -- three cases — and in the first, the composite foreign key has already said
  -- something more useful.
  IF v_pool_id IS NULL OR v_own IS NULL THEN
    RETURN;
  END IF;

  -- The lock is the important line, exactly as it is for enrolments. Without it
  -- two concurrent transactions each count the same 32 places, each decide there
  -- is room, and this function becomes decoration.
  SELECT p.max_capacity INTO v_max
    FROM pool p
   WHERE p.id = v_pool_id
     AND p.organization_id = p_organization_id
     FOR UPDATE;

  IF v_max IS NULL THEN
    RETURN;
  END IF;

  -- Every live schedule this turma has. Each one is its own question: a turma
  -- that swims Monday and Wednesday occupies the tank twice, against different
  -- neighbours each time.
  FOR v_weekday, v_start, v_minutes IN
    SELECT cs.weekday, cs.start_time, cs.duration_minutes
      FROM class_schedule cs
     WHERE cs.class_group_id = p_class_group_id
       AND cs.organization_id = p_organization_id
       AND cs.archived_at IS NULL
  LOOP
    SELECT coalesce(sum(per_group.capacity), 0) INTO v_taken
      FROM (
        SELECT DISTINCT other.id, other.capacity
          FROM class_schedule ocs
          JOIN class_group other
            ON other.id = ocs.class_group_id
           AND other.organization_id = ocs.organization_id
         WHERE ocs.organization_id = p_organization_id
           AND ocs.archived_at IS NULL
           AND ocs.subject_type = 'turma'
           AND ocs.weekday = v_weekday
           AND other.archived_at IS NULL
           AND other.pool_id = v_pool_id
           AND other.capacity IS NOT NULL
           -- Everybody but this turma. Its own places are added afterwards, so a
           -- turma with two overlapping schedules is not counted twice.
           AND other.id <> p_class_group_id
           AND (v_start, v_start + make_interval(mins => v_minutes))
               OVERLAPS
               (ocs.start_time, ocs.start_time + make_interval(mins => ocs.duration_minutes))
      ) AS per_group;

    IF v_taken + v_own > v_max THEN
      RAISE EXCEPTION
        'Pool capacity exceeded: % holds %, this slot already has %, this class asks for %',
        v_pool_id, v_max, v_taken, v_own
        USING ERRCODE = 'check_violation',
              -- Machine-readable, for the API to turn into the operator's own
              -- sentence. Pipe-separated rather than JSON because DETAIL is a
              -- string either way and three integers do not need a parser.
              DETAIL = format('pool_capacity|%s|%s|%s', v_max, v_taken, v_own);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- The two ways the invariant can be broken
--
-- AFTER rather than BEFORE, so the row being written is already visible and the
-- sum is simply the truth rather than the truth plus a correction term. The
-- correction term is the part that gets written wrong.
-- ---------------------------------------------------------------------------

-- Timetabling a turma, moving it, or dropping it on the calendar grid.
CREATE OR REPLACE FUNCTION class_schedule_pool_capacity() RETURNS trigger AS $$
BEGIN
  IF NEW.class_group_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    PERFORM pool_capacity_respected(NEW.organization_id, NEW.class_group_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER class_schedule_pool_capacity
  AFTER INSERT OR UPDATE ON class_schedule
  FOR EACH ROW EXECUTE FUNCTION class_schedule_pool_capacity();

-- Editing the turma itself: raising its capacity, or moving it to another tank.
-- Without this the ceiling holds only against new schedules, and a turma of 8
-- could be edited to 80 in a full tank with nothing objecting.
CREATE OR REPLACE FUNCTION class_group_pool_capacity() RETURNS trigger AS $$
BEGIN
  IF NEW.archived_at IS NULL THEN
    PERFORM pool_capacity_respected(NEW.organization_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER class_group_pool_capacity
  AFTER UPDATE OF capacity, pool_id, archived_at ON class_group
  FOR EACH ROW EXECUTE FUNCTION class_group_pool_capacity();

-- Down Migration

DROP TRIGGER IF EXISTS class_group_pool_capacity ON class_group;
DROP FUNCTION IF EXISTS class_group_pool_capacity();

DROP TRIGGER IF EXISTS class_schedule_pool_capacity ON class_schedule;
DROP FUNCTION IF EXISTS class_schedule_pool_capacity();

DROP FUNCTION IF EXISTS pool_capacity_respected(uuid, uuid);
