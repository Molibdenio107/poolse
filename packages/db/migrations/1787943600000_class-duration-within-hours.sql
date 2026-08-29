-- Up Migration
--
-- A class must finish before the doors close — round 4.
--
-- `class_schedule_within_facility_hours()` deliberately checked the *start* only,
-- and said so: the last lesson of the night ends when it ends, and the repo
-- carried a 23:30 class whose end crossed midnight. That was the right call when
-- hours were new and nothing depended on them. The decision this round reverses
-- it — a duration that runs past closing is now refused — because the operator
-- setting the hours is describing when the building is staffed, and a lesson
-- scheduled to finish after the lights go off is the error the hours exist to
-- catch. The old behaviour made the closing time decorative.
--
-- **Minutes, not `time` arithmetic.** `time '23:30' + interval '60 minutes'` is
-- `00:30`, and `00:30 <= 22:00` is true, so the naive check passes exactly the
-- class it needs to refuse. Wrapping past midnight is the whole failure mode
-- here, so both sides are reduced to minutes-from-midnight where a class that
-- runs to 24:30 is 1470 and is plainly greater than any closing time. `24:00`
-- reduces to 1440, so "open all day" still admits a class that ends at midnight.
--
-- **The end is inclusive; the start is not.** A class may finish exactly at
-- closing — that is the last lesson, and refusing it would make every operator
-- set closing a minute late. A class may not *start* at closing, because a
-- zero-length lesson at the moment the doors shut is not a booking.
--
-- **Still nothing is enforced retroactively.** The trigger fires when somebody
-- schedules or moves a class, never when somebody edits the site's hours, so
-- narrowing Tuesday tells the operator about the classes that no longer fit
-- rather than deleting them. That half of the round-4 decision is unchanged.
--
-- `duration_minutes` joins the `UPDATE OF` list, which is the easy thing to miss:
-- without it, lengthening an existing class to run past closing would not fire
-- the trigger at all and the rule would hold only for new rows.

CREATE OR REPLACE FUNCTION class_schedule_within_facility_hours() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_available boolean;
  v_opens_at  time;
  v_closes_at time;
  v_site      text;
  v_starts    integer;  -- minutes from midnight
  v_ends      integer;
  v_closes    integer;
BEGIN
  SELECT h.available, h.opens_at, h.closes_at, f.name
    INTO v_available, v_opens_at, v_closes_at, v_site
    FROM class_group g
    JOIN pool p
      ON p.id = g.pool_id
     AND p.organization_id = g.organization_id
    JOIN facility f
      ON f.id = p.facility_id
     AND f.organization_id = p.organization_id
    JOIN facility_hours h
      ON h.facility_id = f.id
     AND h.organization_id = f.organization_id
     AND h.weekday = NEW.weekday
   WHERE g.id = NEW.class_group_id
     AND g.organization_id = NEW.organization_id;

  -- A turma with no pool yet has no site, so there is nothing to check against.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_available THEN
    RAISE EXCEPTION
      'facility_closed_on_weekday: % does not open on ISO weekday %', v_site, NEW.weekday
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < v_opens_at OR NEW.start_time >= v_closes_at THEN
    RAISE EXCEPTION
      'outside_facility_hours: % opens % to % on ISO weekday %, class starts %',
      v_site, v_opens_at, v_closes_at, NEW.weekday, NEW.start_time
      USING ERRCODE = 'check_violation';
  END IF;

  -- `extract(hour from time '24:00')` is 24, so closing at midnight is 1440 and
  -- a class ending at midnight is admitted.
  v_starts := (extract(hour FROM NEW.start_time) * 60
             + extract(minute FROM NEW.start_time))::integer;
  v_ends   := v_starts + NEW.duration_minutes;
  v_closes := (extract(hour FROM v_closes_at) * 60
             + extract(minute FROM v_closes_at))::integer;

  IF v_ends > v_closes THEN
    RAISE EXCEPTION
      'class_ends_after_closing: % closes at % on ISO weekday %, class runs % to %',
      v_site,
      v_closes_at,
      NEW.weekday,
      NEW.start_time,
      -- Reported as minutes-from-midnight past 24:00 rather than a wrapped
      -- clock time, so "ends at 00:30" cannot be misread as "ends before
      -- opening".
      (v_ends / 60)::text || ':' || lpad((v_ends % 60)::text, 2, '0')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Recreated rather than left alone: `duration_minutes` has to be in the column
-- list or the rule holds only for inserts.
DROP TRIGGER IF EXISTS class_schedule_hours ON class_schedule;

CREATE TRIGGER class_schedule_hours
  BEFORE INSERT OR UPDATE OF weekday, start_time, duration_minutes, class_group_id
  ON class_schedule
  FOR EACH ROW
  WHEN (NEW.archived_at IS NULL)
  EXECUTE FUNCTION class_schedule_within_facility_hours();

-- Down Migration
--
-- Back to checking the start only, and to a trigger that does not watch
-- `duration_minutes`.

CREATE OR REPLACE FUNCTION class_schedule_within_facility_hours() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_available boolean;
  v_opens_at  time;
  v_closes_at time;
  v_site      text;
BEGIN
  SELECT h.available, h.opens_at, h.closes_at, f.name
    INTO v_available, v_opens_at, v_closes_at, v_site
    FROM class_group g
    JOIN pool p
      ON p.id = g.pool_id
     AND p.organization_id = g.organization_id
    JOIN facility f
      ON f.id = p.facility_id
     AND f.organization_id = p.organization_id
    JOIN facility_hours h
      ON h.facility_id = f.id
     AND h.organization_id = f.organization_id
     AND h.weekday = NEW.weekday
   WHERE g.id = NEW.class_group_id
     AND g.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT v_available THEN
    RAISE EXCEPTION
      'facility_closed_on_weekday: % does not open on ISO weekday %', v_site, NEW.weekday
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < v_opens_at OR NEW.start_time >= v_closes_at THEN
    RAISE EXCEPTION
      'outside_facility_hours: % opens % to % on ISO weekday %, class starts %',
      v_site, v_opens_at, v_closes_at, NEW.weekday, NEW.start_time
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_schedule_hours ON class_schedule;

CREATE TRIGGER class_schedule_hours
  BEFORE INSERT OR UPDATE OF weekday, start_time, class_group_id ON class_schedule
  FOR EACH ROW
  WHEN (NEW.archived_at IS NULL)
  EXECUTE FUNCTION class_schedule_within_facility_hours();
