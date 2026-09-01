-- Up Migration
--
-- The grid a club's schedule is written on — POOLSE-44.
--
-- A real timetable has rows before it has classes. The reference sheet runs
-- 06:30, 08:45, 09:30, 10:15, 11:00, 11:45, then nothing until 14:45, then
-- 15:30, 16:15, 17:00, 17:45, 18:30, 19:15, 20:00, 21:00 — roughly a 45-minute
-- pitch with holes in it, and a completely different set at the weekend. That
-- grid is a property of the building. It is what the club prints and what
-- somebody scheduling a class is choosing from.
--
-- Poolse had no such concept: a class carries a free `start_time` and the
-- calendar draws a uniform 15-minute lattice. Fine for reading one week, useless
-- for planning a season — it offers 96 rows where the club has fourteen.
--
-- **Three day groups, not two.** `weekday` covers 2ª–6ª; `saturday` and `sunday`
-- are separate because the reference club runs different hours on each and
-- prints them as their own block. One `weekend` group would force a club that
-- opens Saturday morning and not Sunday to encode that as an absence somewhere
-- else.
--
-- **Gaps are the absence of a slot, not a slot of type "closed".** Nothing needs
-- to know why the pool is quiet at lunchtime.
--
-- **No `position` column.** The ticket asked for one and it would be a second
-- answer to "what order are the rows in": slots cannot overlap, so `start_time`
-- already totally orders them, and a stored position could disagree with the
-- clock. Ordering is `ORDER BY start_time`.

CREATE TYPE day_group AS ENUM ('weekday', 'saturday', 'sunday');

CREATE TABLE facility_time_slot (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  -- The season, so next year's grid can be drafted without disturbing the one
  -- the club is running — POOLSE-45. Duplicating a season clones these.
  season_id       uuid NOT NULL,

  day_group       day_group NOT NULL,

  -- Wall-clock at the facility, like every other time in this schema. `24:00` is
  -- a real `time` in Postgres and is how "to the end of the day" is written —
  -- `facility_hours` already uses it for exactly that.
  start_time      time NOT NULL,
  end_time        time NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),

  /*
   * This also refuses `00:00` as an end time, which is the trap worth naming.
   * `24:00` means midnight-at-the-end and arithmetics to 1440; `00:00` means
   * midnight-at-the-start and arithmetics to 0, which would make an empty range
   * that the exclusion below silently ignores. A slot from 21:00 to 00:00 is
   * caught here rather than becoming a row that overlaps everything and
   * conflicts with nothing.
   */
  CHECK (end_time > start_time)
);

COMMENT ON TABLE facility_time_slot IS
  'The rows of a facility''s schedule grid, per season and day group. Bookings snap to these.';

/*
 * Slots may not overlap within one day group of one season at one site.
 *
 * Postgres has no built-in range type over `time`, so this works in minutes from
 * midnight — which is also how `class_schedule_within_facility_hours()` already
 * reasons, and for the same reason: `time '23:30' + interval '60 minutes'` wraps
 * to `00:30` and compares as earlier than every closing time.
 *
 * `int4range` is half-open, so 09:30–10:15 and 10:15–11:00 abut without
 * colliding — which is exactly the behaviour a 45-minute pitch needs.
 *
 * `season_id` is in the key deliberately: without it a club could not draft next
 * year's grid, because every slot would collide with this year's.
 */
ALTER TABLE facility_time_slot
  ADD CONSTRAINT facility_time_slot_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    facility_id WITH =,
    season_id WITH =,
    day_group WITH =,
    int4range(
      extract(hour FROM start_time)::int * 60 + extract(minute FROM start_time)::int,
      extract(hour FROM end_time)::int   * 60 + extract(minute FROM end_time)::int
    ) WITH &&
  ) WHERE (archived_at IS NULL);

CREATE INDEX facility_time_slot_grid_idx
  ON facility_time_slot (organization_id, facility_id, season_id, day_group, start_time)
  WHERE archived_at IS NULL;

CREATE TRIGGER facility_time_slot_updated_at BEFORE UPDATE ON facility_time_slot
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE facility_time_slot ENABLE ROW LEVEL SECURITY;

CREATE POLICY facility_time_slot_tenant ON facility_time_slot
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON facility_time_slot TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS facility_time_slot_tenant ON facility_time_slot;
DROP TABLE IF EXISTS facility_time_slot;
DROP TYPE IF EXISTS day_group;
