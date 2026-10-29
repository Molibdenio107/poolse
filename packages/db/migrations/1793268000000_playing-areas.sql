-- Up Migration
--
-- POOLSE-122 — recintos. A site holds typed playing areas, and a pool is one
-- kind of them.
--
-- Poolse is structured for several sports before first go-live (Rui,
-- 28-10-2026, docs/decisions.md), with one rule: **the pool is untouched**. So
-- this adds a parent above `pool` and renames, moves and re-keys nothing. The
-- nineteen migrations that read `pool` go on reading it; `pool.name` and
-- `pool.facility_id` stay until a later ticket finds no reader left.
--
-- How a pool keeps its recinto without forty edited call sites: a BEFORE
-- INSERT trigger on `pool` makes the recinto when the caller names none, the
-- way `class_schedule_default_site` fills a site. Every existing INSERT INTO
-- pool — the API, `provision_organization`, the seed, every SQL test — gets its
-- recinto without knowing it exists. The other direction (a recinto of sport
-- `pool` with no pool) is a deferred constraint trigger, checked at commit.
--
-- A recinto is where sport happens; Espaços (`space`, round 6) is where it does
-- not. They stay two tables.

-- ---------------------------------------------------------------------------
-- The sport catalogue — platform-owned, no tenant key
-- ---------------------------------------------------------------------------
--
-- A table and not an enum (Rui: "it gives margin to add more"): a new sport is a
-- row Rui adds, never a migration a club waits for. The app may read it and
-- nothing else; which sports a club has switched on is POOLSE-124's.

CREATE TABLE sport (
  id                   text PRIMARY KEY CHECK (id ~ '^[a-z_]+$'),
  -- What one bookable unit is called (pista, campo, meio-campo). Null for a
  -- sport booked whole — a gym has no units.
  unit_label_pt        text,
  unit_label_en        text,
  -- Seeds a recinto's grid when it has none (POOLSE-123 rule 4).
  default_slot_minutes integer NOT NULL CHECK (default_slot_minutes > 0 AND default_slot_minutes % 15 = 0),
  has_units            boolean NOT NULL,
  has_metrics          boolean NOT NULL,
  has_inventory        boolean NOT NULL,
  -- May two groups share one unit at once (POOLSE-123 rule 3)? A lane yes, a court no.
  units_shareable      boolean NOT NULL,
  position             integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sport_units_labelled CHECK (
    NOT has_units OR (unit_label_pt IS NOT NULL AND unit_label_en IS NOT NULL)
  ),
  CONSTRAINT sport_shareable_needs_units CHECK (has_units OR NOT units_shareable)
);

COMMENT ON TABLE sport IS
  'POOLSE-122. The sport catalogue, platform-owned: a club cannot add a sport, Rui can. A recinto has one.';

INSERT INTO sport (id, unit_label_pt, unit_label_en, default_slot_minutes,
                   has_units, has_metrics, has_inventory, units_shareable, position) VALUES
  ('pool',       'pista',      'lane',       30, true,  true,  true,  true,  1),
  ('tennis',     'campo',      'court',      60, true,  false, false, false, 2),
  ('padel',      'campo',      'court',      90, true,  false, false, false, 3),
  ('basketball', 'meio-campo', 'half court', 60, true,  false, false, false, 4),
  ('football',   'meio-campo', 'half pitch', 60, true,  false, false, false, 5),
  ('handball',   'meio-campo', 'half court', 60, true,  false, false, false, 6),
  ('volleyball', 'campo',      'court',      60, true,  false, false, false, 7),
  ('gym',        NULL,         NULL,         60, false, false, true,  false, 8);

-- Default privileges hand poolse_app everything; a catalogue is read-only to it.
REVOKE ALL ON sport FROM poolse_app;
GRANT SELECT ON sport TO poolse_app;

-- ---------------------------------------------------------------------------
-- playing_area — the recinto
-- ---------------------------------------------------------------------------

CREATE TABLE playing_area (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,
  sport_id        text NOT NULL REFERENCES sport (id),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- What lets a pool's composite key say "my recinto, on my site".
  UNIQUE (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id)
);

COMMENT ON TABLE playing_area IS
  'POOLSE-122. A recinto: where sport happens on a site. A pool is one of sport pool, kept in step by trigger both ways.';

-- Rule 4: unique per site among live recintos, case- and accent-blind — one
-- level up from pool_name_uq, so a court and a pool cannot share a name either.
CREATE UNIQUE INDEX playing_area_name_uq
  ON playing_area (organization_id, facility_id, public.strip_accents(lower(name)))
  WHERE archived_at IS NULL;

CREATE INDEX playing_area_facility_idx
  ON playing_area (organization_id, facility_id) WHERE archived_at IS NULL;

CREATE TRIGGER playing_area_updated_at BEFORE UPDATE ON playing_area
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE playing_area ENABLE ROW LEVEL SECURITY;
CREATE POLICY playing_area_tenant ON playing_area
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- No DELETE: history is soft-deleted, and a recinto is archived with its pool.
REVOKE ALL ON playing_area FROM poolse_app;
GRANT SELECT, INSERT, UPDATE ON playing_area TO poolse_app;

-- ---------------------------------------------------------------------------
-- Backfill: every existing pool gets its recinto
-- ---------------------------------------------------------------------------

ALTER TABLE pool ADD COLUMN playing_area_id uuid;

UPDATE pool SET playing_area_id = gen_random_uuid();

INSERT INTO playing_area (id, organization_id, facility_id, sport_id, name, position,
                          created_at, archived_at)
SELECT p.playing_area_id, p.organization_id, p.facility_id, 'pool', p.name,
       (row_number() OVER (PARTITION BY p.facility_id ORDER BY p.created_at, p.name) - 1)::int,
       p.created_at, p.archived_at
  FROM pool p;

ALTER TABLE pool ALTER COLUMN playing_area_id SET NOT NULL;
ALTER TABLE pool
  ADD CONSTRAINT pool_playing_area_uq UNIQUE (organization_id, playing_area_id),
  -- Same tenant, same site: the pool and its recinto cannot disagree about where they are.
  ADD CONSTRAINT pool_playing_area_fk FOREIGN KEY (organization_id, facility_id, playing_area_id)
    REFERENCES playing_area (organization_id, facility_id, id);

-- ---------------------------------------------------------------------------
-- A pool always has its recinto
-- ---------------------------------------------------------------------------
--
-- Named `pool_area_ensure` so it sorts ahead of `pool_create_default_lanes`
-- (an AFTER trigger, so the order is belt and braces) and of anything later
-- that might read the column.

CREATE FUNCTION pool_area_ensure() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_sport text; v_facility uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.playing_area_id IS DISTINCT FROM OLD.playing_area_id
       OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
      RAISE EXCEPTION 'a pool keeps its recinto and its site'
        USING ERRCODE = 'check_violation', DETAIL = 'pool_area_fixed';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.playing_area_id IS NULL THEN
    INSERT INTO playing_area (organization_id, facility_id, sport_id, name, position, archived_at)
    VALUES (
      NEW.organization_id, NEW.facility_id, 'pool', NEW.name,
      coalesce((SELECT max(a.position) + 1 FROM playing_area a
                 WHERE a.organization_id = NEW.organization_id
                   AND a.facility_id = NEW.facility_id), 0),
      NEW.archived_at
    )
    RETURNING id INTO NEW.playing_area_id;
  ELSE
    SELECT a.sport_id, a.facility_id INTO v_sport, v_facility
      FROM playing_area a
     WHERE a.organization_id = NEW.organization_id AND a.id = NEW.playing_area_id;
    IF v_sport IS DISTINCT FROM 'pool' THEN
      RAISE EXCEPTION 'a pool''s recinto must be of sport pool'
        USING ERRCODE = 'check_violation', DETAIL = 'pool_area_sport';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER pool_area_ensure BEFORE INSERT OR UPDATE ON pool
  FOR EACH ROW EXECUTE FUNCTION pool_area_ensure();

-- The other direction: a recinto of sport `pool` with no pool child is refused
-- at commit, and a recinto's sport and site are fixed once it exists.
CREATE FUNCTION playing_area_pool_has_child() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.sport_id = 'pool' AND NOT EXISTS (
    SELECT 1 FROM pool p
     WHERE p.organization_id = NEW.organization_id AND p.playing_area_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a recinto of sport pool needs its pool'
      USING ERRCODE = 'check_violation', DETAIL = 'playing_area_pool_missing';
  END IF;
  RETURN NULL;
END;
$fn$;

-- Only a recinto inserted directly is checked. One made by `pool_area_ensure`
-- is made *for* the pool being inserted, and the WHEN of a constraint trigger
-- is judged when the row is written: without it, a transaction that has run
-- SET CONSTRAINTS ALL IMMEDIATE (person-merge.sql does) checks the recinto
-- before its pool row exists and refuses every new pool.
CREATE CONSTRAINT TRIGGER playing_area_pool_has_child
  AFTER INSERT ON playing_area
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION playing_area_pool_has_child();

CREATE FUNCTION playing_area_fixed() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.sport_id IS DISTINCT FROM OLD.sport_id
     OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
    RAISE EXCEPTION 'a recinto keeps its sport and its site'
      USING ERRCODE = 'check_violation', DETAIL = 'playing_area_fixed';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER playing_area_fixed BEFORE UPDATE ON playing_area
  FOR EACH ROW EXECUTE FUNCTION playing_area_fixed();

-- ---------------------------------------------------------------------------
-- pool_area_sync — one soft delete and one name, both directions (rule 6)
-- ---------------------------------------------------------------------------
--
-- Each side copies its name and archived_at to the other only where they
-- differ, so the echo finds nothing to change and stops.

CREATE FUNCTION pool_area_sync() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_TABLE_NAME = 'pool' THEN
    UPDATE playing_area a
       SET name = NEW.name, archived_at = NEW.archived_at
     WHERE a.organization_id = NEW.organization_id AND a.id = NEW.playing_area_id
       AND (a.name IS DISTINCT FROM NEW.name OR a.archived_at IS DISTINCT FROM NEW.archived_at);
  ELSE
    UPDATE pool p
       SET name = NEW.name, archived_at = NEW.archived_at
     WHERE p.organization_id = NEW.organization_id AND p.playing_area_id = NEW.id
       AND (p.name IS DISTINCT FROM NEW.name OR p.archived_at IS DISTINCT FROM NEW.archived_at);
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER pool_area_sync AFTER UPDATE OF name, archived_at ON pool
  FOR EACH ROW EXECUTE FUNCTION pool_area_sync();

CREATE TRIGGER playing_area_pool_sync AFTER UPDATE OF name, archived_at ON playing_area
  FOR EACH ROW EXECUTE FUNCTION pool_area_sync();

-- ---------------------------------------------------------------------------
-- class_group, closure, energy_meter carry the recinto (rule 5)
-- ---------------------------------------------------------------------------
--
-- Filled from `pool_id` now, kept in step by trigger while both columns exist.
-- Readers keep reading `pool_id`; the allocation rule for meters is POOLSE-128.
-- A row with no pool keeps whatever recinto it was given, which is how a
-- court's turma or closure will arrive with POOLSE-124.

ALTER TABLE class_group  ADD COLUMN playing_area_id uuid;
ALTER TABLE closure      ADD COLUMN playing_area_id uuid;
ALTER TABLE energy_meter ADD COLUMN playing_area_id uuid;

-- The backfill must not fire the tables' own triggers: it would bump
-- updated_at on every row and re-run capacity and qualification checks over
-- history. Foreign keys are system triggers and are not disabled by USER.
ALTER TABLE class_group  DISABLE TRIGGER USER;
ALTER TABLE closure      DISABLE TRIGGER USER;
ALTER TABLE energy_meter DISABLE TRIGGER USER;

UPDATE class_group t SET playing_area_id = p.playing_area_id
  FROM pool p WHERE p.organization_id = t.organization_id AND p.id = t.pool_id;
UPDATE closure t SET playing_area_id = p.playing_area_id
  FROM pool p WHERE p.organization_id = t.organization_id AND p.id = t.pool_id;
UPDATE energy_meter t SET playing_area_id = p.playing_area_id
  FROM pool p WHERE p.organization_id = t.organization_id AND p.id = t.pool_id;

ALTER TABLE class_group  ENABLE TRIGGER USER;
ALTER TABLE closure      ENABLE TRIGGER USER;
ALTER TABLE energy_meter ENABLE TRIGGER USER;

ALTER TABLE class_group ADD CONSTRAINT class_group_playing_area_fk
  FOREIGN KEY (organization_id, playing_area_id) REFERENCES playing_area (organization_id, id);
ALTER TABLE closure ADD CONSTRAINT closure_playing_area_fk
  FOREIGN KEY (organization_id, playing_area_id) REFERENCES playing_area (organization_id, id);
ALTER TABLE energy_meter ADD CONSTRAINT energy_meter_playing_area_fk
  FOREIGN KEY (organization_id, playing_area_id) REFERENCES playing_area (organization_id, id);

CREATE INDEX class_group_playing_area_idx  ON class_group  (organization_id, playing_area_id);
CREATE INDEX closure_playing_area_idx      ON closure      (organization_id, playing_area_id);
CREATE INDEX energy_meter_playing_area_idx ON energy_meter (organization_id, playing_area_id);

CREATE FUNCTION area_from_pool() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.pool_id IS NOT NULL THEN
    SELECT p.playing_area_id INTO NEW.playing_area_id
      FROM pool p WHERE p.organization_id = NEW.organization_id AND p.id = NEW.pool_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.pool_id IS NOT NULL
        AND NEW.playing_area_id IS NOT DISTINCT FROM OLD.playing_area_id THEN
    -- The pool was taken off and nobody named a recinto: the old one is stale.
    NEW.playing_area_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER class_group_area_from_pool BEFORE INSERT OR UPDATE OF pool_id, playing_area_id
  ON class_group FOR EACH ROW EXECUTE FUNCTION area_from_pool();
CREATE TRIGGER closure_area_from_pool BEFORE INSERT OR UPDATE OF pool_id, playing_area_id
  ON closure FOR EACH ROW EXECUTE FUNCTION area_from_pool();
CREATE TRIGGER energy_meter_area_from_pool BEFORE INSERT OR UPDATE OF pool_id, playing_area_id
  ON energy_meter FOR EACH ROW EXECUTE FUNCTION area_from_pool();

-- Down Migration

DROP TRIGGER IF EXISTS energy_meter_area_from_pool ON energy_meter;
DROP TRIGGER IF EXISTS closure_area_from_pool ON closure;
DROP TRIGGER IF EXISTS class_group_area_from_pool ON class_group;
DROP FUNCTION IF EXISTS area_from_pool();

ALTER TABLE energy_meter DROP COLUMN IF EXISTS playing_area_id;
ALTER TABLE closure      DROP COLUMN IF EXISTS playing_area_id;
ALTER TABLE class_group  DROP COLUMN IF EXISTS playing_area_id;

DROP TRIGGER IF EXISTS playing_area_pool_sync ON playing_area;
DROP TRIGGER IF EXISTS pool_area_sync ON pool;
DROP FUNCTION IF EXISTS pool_area_sync();
DROP TRIGGER IF EXISTS playing_area_fixed ON playing_area;
DROP FUNCTION IF EXISTS playing_area_fixed();
DROP TRIGGER IF EXISTS playing_area_pool_has_child ON playing_area;
DROP FUNCTION IF EXISTS playing_area_pool_has_child();
DROP TRIGGER IF EXISTS pool_area_ensure ON pool;
DROP FUNCTION IF EXISTS pool_area_ensure();

ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_playing_area_fk;
ALTER TABLE pool DROP CONSTRAINT IF EXISTS pool_playing_area_uq;
ALTER TABLE pool DROP COLUMN IF EXISTS playing_area_id;

DROP TABLE IF EXISTS playing_area;
DROP TABLE IF EXISTS sport;
