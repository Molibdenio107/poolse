-- Up Migration
--
-- POOLSE-126, the schema half — levels belong to a sport; a season is shared
-- unless the club gives a sport its own.
--
-- **Levels.** `student_level.sport_id`, backfilled to `pool` by its default, so
-- every level a club has today is a swimming level and every caller that inserts
-- one without naming a sport keeps making swimming levels. A level keeps its
-- sport once written. Names and age bands are unique *per sport* — a tennis
-- *Iniciação* beside a swimming one is two ladders, not a duplicate. The two
-- functions that walk the ladder (`next_level`, `age_fit_level`) stay on the
-- current level's sport, so advancement never moves a swimmer onto a tennis rung.
--
-- **A turma's level and season match its recinto's sport** (Decided 12/13), by
-- trigger, because it crosses three tables. A turma with no recinto is judged on
-- nothing — the same "null is not measured" rule as everywhere else.
--
-- **Seasons.** One shared *época* per club (`season.sport_id` null), and a sport
-- the club has switched to *Época própria* (`organization.own_season_sports`)
-- may publish its own: one published season per sport-with-its-own plus the
-- shared one. The pool always uses the shared season (CHECK) — it is the one the
-- shared season exists for. `season_scope()` says which sports a season reaches.
--
-- **The generator, the reset and the advancement pass are scoped by
-- construction**: each works from a season's turmas, and a turma can now only
-- sit in a season that reaches its sport. Nothing in the API sets
-- `season.sport_id` or the toggle yet — that is the screens half — so every
-- "the published season" lookup in the API still finds exactly one row.

-- ---------------------------------------------------------------------------
-- Levels
-- ---------------------------------------------------------------------------

ALTER TABLE student_level
  ADD COLUMN sport_id text NOT NULL DEFAULT 'pool' REFERENCES sport (id);

COMMENT ON COLUMN student_level.sport_id IS
  'POOLSE-126: the sport whose ladder this level is on. Fixed once written. Names and age bands are unique per sport.';

CREATE INDEX student_level_sport_idx ON student_level (organization_id, sport_id, sort_order)
  WHERE archived_at IS NULL;

DROP INDEX student_level_name_uq;
CREATE UNIQUE INDEX student_level_name_uq ON student_level
  (organization_id, sport_id, lower(public.strip_accents(name)), admits_male, admits_female)
  WHERE archived_at IS NULL;

CREATE FUNCTION student_level_sport_fixed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.sport_id IS DISTINCT FROM OLD.sport_id THEN
    RAISE EXCEPTION 'a level keeps its sport'
      USING ERRCODE = 'check_violation', DETAIL = 'level_sport_fixed';
  END IF;
  RETURN NEW;
END;
$$;

-- Named to fire before student_level_range_free (BEFORE triggers run in name
-- order), so changing a level's sport is refused as that, not as a band clash.
CREATE TRIGGER student_level_keeps_sport BEFORE UPDATE OF sport_id ON student_level
  FOR EACH ROW EXECUTE FUNCTION student_level_sport_fixed();

-- An age band is claimed per sport. Rewritten in place, refused loudly if the
-- text it expects has moved.
DO $do$
DECLARE def text; rewritten text;
BEGIN
  def := pg_get_functiondef('student_level_range_is_free()'::regprocedure);
  -- Single-line anchors: a body created from a CRLF file carries CR LF line ends.
  rewritten := replace(def,
    'WHERE o.organization_id = NEW.organization_id',
    'WHERE o.organization_id = NEW.organization_id AND o.sport_id = NEW.sport_id');
  IF rewritten = def THEN RAISE EXCEPTION 'student_level_range_is_free: the filter was not found'; END IF;
  EXECUTE rewritten;

  FOREACH def IN ARRAY ARRAY[
    pg_get_functiondef('next_level(uuid,uuid)'::regprocedure),
    pg_get_functiondef('age_fit_level(uuid,uuid,integer,student_gender)'::regprocedure)
  ] LOOP
    rewritten := replace(def,
      'ON n.organization_id = cur.organization_id',
      'ON n.organization_id = cur.organization_id AND n.sport_id = cur.sport_id');
    IF rewritten = def THEN RAISE EXCEPTION 'ladder function: the join was not found'; END IF;
    EXECUTE rewritten;
  END LOOP;
END
$do$;

-- the range trigger also has to fire when a level is made on another sport
DROP TRIGGER student_level_range_free ON student_level;
CREATE TRIGGER student_level_range_free
  BEFORE INSERT OR UPDATE OF min_age_months, max_age_months, admits_male, admits_female, archived_at, sport_id
  ON student_level FOR EACH ROW EXECUTE FUNCTION student_level_range_is_free();

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN own_season_sports text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT organization_pool_shares_season CHECK (NOT ('pool' = ANY (own_season_sports)));

COMMENT ON COLUMN organization.own_season_sports IS
  'POOLSE-126: sports with Época própria — their turmas use a season of their own (season.sport_id). Empty: every sport uses the shared season. The pool always does.';

-- The club's own setting (owner/admin, the screens half), so the app may write it.
GRANT UPDATE (own_season_sports) ON organization TO poolse_app;

ALTER TABLE season ADD COLUMN sport_id text REFERENCES sport (id),
  ADD CONSTRAINT season_pool_is_shared CHECK (sport_id IS DISTINCT FROM 'pool');

COMMENT ON COLUMN season.sport_id IS
  'POOLSE-126: null is the shared season, reaching every sport without Época própria; set, the season of that one sport. Fixed once written. See season_scope().';

DROP INDEX season_one_published;
CREATE UNIQUE INDEX season_one_published ON season (organization_id, coalesce(sport_id, ''))
  WHERE status = 'published';

-- A sport's season only for a sport switched to Época própria, checked when it is
-- made or published; one already published stays history if the toggle goes off.
CREATE FUNCTION season_sport_allowed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sport_id IS DISTINCT FROM OLD.sport_id THEN
    RAISE EXCEPTION 'a season keeps its sport'
      USING ERRCODE = 'check_violation', DETAIL = 'season_sport_fixed';
  END IF;
  IF NEW.sport_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'published' AND OLD.status <> 'published') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization o
     WHERE o.id = NEW.organization_id AND NEW.sport_id = ANY (o.own_season_sports)
  ) THEN
    RAISE EXCEPTION 'sport % uses the shared season', NEW.sport_id
      USING ERRCODE = 'check_violation', DETAIL = format('season_sport_not_own|%s', NEW.sport_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER season_sport_allowed BEFORE INSERT OR UPDATE OF sport_id, status ON season
  FOR EACH ROW EXECUTE FUNCTION season_sport_allowed();

-- The sports a season reaches: its own, or — the shared one — every sport the
-- club has on without Época própria. One definition for the generator, the reset
-- and the advancement pass to read, and for the screen that says what a season covers.
CREATE FUNCTION season_scope(p_season_id uuid) RETURNS SETOF text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.sport_id FROM season s
   WHERE s.id = p_season_id AND s.sport_id IS NOT NULL
  UNION ALL
  SELECT sport FROM season s
    JOIN organization o ON o.id = s.organization_id
   CROSS JOIN LATERAL unnest(o.enabled_sports) AS sport
   WHERE s.id = p_season_id AND s.sport_id IS NULL
     AND NOT (sport = ANY (o.own_season_sports));
$$;

GRANT EXECUTE ON FUNCTION season_scope(uuid) TO poolse_app;

-- ---------------------------------------------------------------------------
-- A turma's level and season share its recinto's sport
-- ---------------------------------------------------------------------------
--
-- Named after `class_group_area_from_pool` alphabetically, so the recinto has
-- been filled from the pool by the time this reads it.

CREATE FUNCTION class_group_sport_matches() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_sport text; v_other text;
BEGIN
  IF NEW.playing_area_id IS NULL THEN RETURN NEW; END IF;
  SELECT a.sport_id INTO v_sport FROM playing_area a
   WHERE a.organization_id = NEW.organization_id AND a.id = NEW.playing_area_id;

  IF NEW.level_id IS NOT NULL THEN
    SELECT l.sport_id INTO v_other FROM student_level l
     WHERE l.organization_id = NEW.organization_id AND l.id = NEW.level_id;
    IF v_other IS DISTINCT FROM v_sport THEN
      RAISE EXCEPTION 'a % level on a % turma', v_other, v_sport
        USING ERRCODE = 'check_violation', DETAIL = format('level_sport_mismatch|%s|%s', v_other, v_sport);
    END IF;
  END IF;

  SELECT s.sport_id INTO v_other FROM season s
   WHERE s.organization_id = NEW.organization_id AND s.id = NEW.season_id;
  IF v_other IS NOT NULL AND v_other IS DISTINCT FROM v_sport THEN
    RAISE EXCEPTION 'a % season for a % turma', v_other, v_sport
      USING ERRCODE = 'check_violation', DETAIL = format('season_sport_mismatch|%s|%s', v_other, v_sport);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER class_group_sport_matches
  BEFORE INSERT OR UPDATE OF level_id, season_id, pool_id, playing_area_id ON class_group
  FOR EACH ROW EXECUTE FUNCTION class_group_sport_matches();

-- Down Migration

DROP TRIGGER class_group_sport_matches ON class_group;
DROP FUNCTION class_group_sport_matches();

DROP FUNCTION season_scope(uuid);
DROP TRIGGER season_sport_allowed ON season;
DROP FUNCTION season_sport_allowed();
DROP INDEX season_one_published;
CREATE UNIQUE INDEX season_one_published ON season (organization_id) WHERE status = 'published';
ALTER TABLE season DROP CONSTRAINT season_pool_is_shared, DROP COLUMN sport_id;

REVOKE UPDATE (own_season_sports) ON organization FROM poolse_app;
ALTER TABLE organization DROP CONSTRAINT organization_pool_shares_season, DROP COLUMN own_season_sports;

DROP TRIGGER student_level_range_free ON student_level;
CREATE TRIGGER student_level_range_free
  BEFORE INSERT OR UPDATE OF min_age_months, max_age_months, admits_male, admits_female, archived_at
  ON student_level FOR EACH ROW EXECUTE FUNCTION student_level_range_is_free();

DO $do$
DECLARE def text; rewritten text;
BEGIN
  def := pg_get_functiondef('student_level_range_is_free()'::regprocedure);
  rewritten := replace(def, ' AND o.sport_id = NEW.sport_id', '');
  IF rewritten = def THEN RAISE EXCEPTION 'student_level_range_is_free: the sport filter was not found'; END IF;
  EXECUTE rewritten;

  FOREACH def IN ARRAY ARRAY[
    pg_get_functiondef('next_level(uuid,uuid)'::regprocedure),
    pg_get_functiondef('age_fit_level(uuid,uuid,integer,student_gender)'::regprocedure)
  ] LOOP
    rewritten := replace(def, ' AND n.sport_id = cur.sport_id', '');
    IF rewritten = def THEN RAISE EXCEPTION 'ladder function: the sport filter was not found'; END IF;
    EXECUTE rewritten;
  END LOOP;
END
$do$;

DROP TRIGGER student_level_keeps_sport ON student_level;
DROP FUNCTION student_level_sport_fixed();

DROP INDEX student_level_name_uq;
CREATE UNIQUE INDEX student_level_name_uq ON student_level
  (organization_id, lower(public.strip_accents(name)), admits_male, admits_female)
  WHERE archived_at IS NULL;
DROP INDEX student_level_sport_idx;
ALTER TABLE student_level DROP COLUMN sport_id;
