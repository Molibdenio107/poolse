-- Up Migration
--
-- The opening-hours rule follows the turma's facility, not its pool — round 5.
--
-- The trigger resolved the site by joining `class_group` to `pool` to `facility`,
-- which was the only route there when it was written. Round 4 gave `class_group`
-- a NOT NULL `facility_id` of its own, and since then a turma with no pool
-- assigned has escaped the rule entirely: the join finds nothing, the function
-- returns, and a class lands on a day the building is shut.
--
-- Reading `g.facility_id` fixes that and removes a join. Nothing else about the
-- rule changes: same refusals, same messages, same inclusive end.

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
    JOIN facility f
      ON f.id = g.facility_id
     AND f.organization_id = g.organization_id
    JOIN facility_hours h
      ON h.facility_id = f.id
     AND h.organization_id = f.organization_id
     AND h.weekday = NEW.weekday
   WHERE g.id = NEW.class_group_id
     AND g.organization_id = NEW.organization_id;

  -- A site that has never had its hours written down says nothing about when it
  -- opens, and a rule with no data behind it must not refuse anybody.
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

  /*
   * Minutes from midnight on both sides — round 4's rule, unchanged.
   *
   * `time '23:30' + interval '60 minutes'` is `00:30`, and `00:30 <= 22:00` is
   * true, so the naive comparison passes exactly the class it has to refuse.
   */
  v_starts := extract(HOUR FROM NEW.start_time) * 60 + extract(MINUTE FROM NEW.start_time);
  v_ends   := v_starts + NEW.duration_minutes;
  v_closes := extract(HOUR FROM v_closes_at) * 60 + extract(MINUTE FROM v_closes_at);
  IF v_closes_at = TIME '24:00' THEN v_closes := 1440; END IF;

  IF v_ends > v_closes THEN
    RAISE EXCEPTION
      'class_ends_after_closing: % closes at % on ISO weekday %, class runs % to %',
      v_site, v_closes_at, NEW.weekday, NEW.start_time,
      (NEW.start_time + (NEW.duration_minutes || ' minutes')::interval)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Down Migration
--
-- Back to resolving the site through the pool, which leaves a turma with no pool
-- unchecked.

CREATE OR REPLACE FUNCTION class_schedule_within_facility_hours() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_available boolean;
  v_opens_at  time;
  v_closes_at time;
  v_site      text;
  v_starts    integer;
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

  v_starts := extract(HOUR FROM NEW.start_time) * 60 + extract(MINUTE FROM NEW.start_time);
  v_ends   := v_starts + NEW.duration_minutes;
  v_closes := extract(HOUR FROM v_closes_at) * 60 + extract(MINUTE FROM v_closes_at);
  IF v_closes_at = TIME '24:00' THEN v_closes := 1440; END IF;

  IF v_ends > v_closes THEN
    RAISE EXCEPTION
      'class_ends_after_closing: % closes at % on ISO weekday %, class runs % to %',
      v_site, v_closes_at, NEW.weekday, NEW.start_time,
      (NEW.start_time + (NEW.duration_minutes || ' minutes')::interval)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
