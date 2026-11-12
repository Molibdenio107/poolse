-- Up Migration
--
-- POOLSE-223 (Rui, 12-11-2026): the pool of a booking with no lanes.
--
-- A booking's pool has always been read off its lanes, so a class in no pista
-- was in no pool: the calendar drew it in the *Sem pista* column of every tank,
-- and an imported timetable mapped to the learner pool lost that mapping for
-- every block that gave no lane count. `pool_id` keeps it.
--
-- **Read only when the booking has no lanes.** With lanes, the lanes are the
-- truth, and a trigger on `booking_lane` brings `pool_id` into line with them
-- whenever they are written, so it never names a pool its lanes are not in.
--
-- The composite key carries `facility_id` as well as `organization_id`: the
-- pool must be another club's never, and another site of this club's never
-- either. Nullable: a hand-made evento with no lanes and no pool is still legal.

ALTER TABLE class_schedule ADD COLUMN pool_id uuid;

ALTER TABLE class_schedule
  ADD CONSTRAINT class_schedule_pool_fk
  FOREIGN KEY (organization_id, facility_id, pool_id)
  REFERENCES pool (organization_id, facility_id, id);

CREATE INDEX class_schedule_pool_idx ON class_schedule (organization_id, pool_id)
  WHERE pool_id IS NOT NULL;

-- Kept in line with the lanes wherever they are written (three writers in the
-- API today, and SQL functions): a lane added to a booking makes the booking
-- that lane's pool. Removing every lane leaves it — the class stays in the pool
-- it was in, which is what *Sem pista* of that pool means.
CREATE FUNCTION booking_lane_sets_pool() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE class_schedule cs
     SET pool_id = l.pool_id
    FROM lane l
   WHERE l.id = NEW.lane_id
     AND l.organization_id = NEW.organization_id
     AND cs.id = NEW.schedule_id
     AND cs.organization_id = NEW.organization_id
     AND cs.pool_id IS DISTINCT FROM l.pool_id;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER booking_lane_sets_pool AFTER INSERT ON booking_lane
  FOR EACH ROW EXECUTE FUNCTION booking_lane_sets_pool();

-- Existing bookings with lanes take their lanes' pool, so the column means the
-- same thing for old rows as for new ones.
UPDATE class_schedule cs
   SET pool_id = l.pool_id
  FROM (SELECT DISTINCT ON (bl.schedule_id) bl.schedule_id, ln.pool_id
          FROM booking_lane bl
          JOIN lane ln ON ln.id = bl.lane_id AND ln.organization_id = bl.organization_id) l
 WHERE l.schedule_id = cs.id;

-- Down Migration

DROP TRIGGER booking_lane_sets_pool ON booking_lane;
DROP FUNCTION booking_lane_sets_pool();

ALTER TABLE class_schedule DROP CONSTRAINT class_schedule_pool_fk;
DROP INDEX class_schedule_pool_idx;
ALTER TABLE class_schedule DROP COLUMN pool_id;
