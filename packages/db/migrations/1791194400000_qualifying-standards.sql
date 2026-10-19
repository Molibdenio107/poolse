-- Up Migration
--
-- POOLSE-85 — gap to qualify: FPN age groups, qualifying standards, entry times.
--
-- **An FPN age group is its own table, never a `student_level` row.** "Escalão"
-- is the club's level everywhere else in Poolse; the FPN's is an age band fixed
-- by birth year for a whole season, with girls a year earlier. That last part is
-- rows with a gender, never a rule in code — the FPN moves its bands and a club
-- must be able to follow without a deploy. A group with no gender admits both.
--
-- **The club enters both** (Rui, 19-10-2026). Poolse ships no FPN data; the
-- coach types each season's bands and each championship's entry times. So all
-- three tables are tenant-scoped and nothing here touches the platform grant.
--
-- **A qualifying time carries its season** so the composite foreign keys can
-- prove that a time's age group and its standard belong to the same season —
-- a Juvenis band from last year under this year's Nacionais is otherwise a row
-- nothing refuses.
--
-- **The gap is `qualifying_gaps()`, the one definition.** A valid time is the
-- same course (never converted), swum at an *official* live meet, inside the
-- standard's window (else its season). The student page and the coach's board
-- both read it, so they cannot disagree about who has qualified. It is
-- SECURITY INVOKER: RLS scopes it like any query.

-- ---------------------------------------------------------------------------
-- federation_age_group
-- ---------------------------------------------------------------------------

CREATE TABLE federation_age_group (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  season_id       uuid NOT NULL,
  name            text NOT NULL,
  -- Null admits both. The FPN's bands are per gender, so most rows carry one.
  gender          student_gender,
  -- Birth years, inclusive. Either may be open: "Seniores, 2006 e anteriores".
  born_from       smallint,
  born_to         smallint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  UNIQUE (organization_id, id),
  UNIQUE (organization_id, season_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  CONSTRAINT federation_age_group_name_present CHECK (btrim(name) <> '' AND length(name) <= 80),
  CONSTRAINT federation_age_group_years
    CHECK ((born_from IS NULL OR born_from BETWEEN 1900 AND 2200)
       AND (born_to IS NULL OR born_to BETWEEN 1900 AND 2200)
       AND (born_from IS NULL OR born_to IS NULL OR born_from <= born_to))
);

COMMENT ON TABLE federation_age_group IS
  'POOLSE-85: an FPN age group (escalão da federação) for one season — birth years and '
  'gender. Never a student_level row. A swimmer''s group is derived, never stored.';

CREATE UNIQUE INDEX federation_age_group_name_uq
  ON federation_age_group (organization_id, season_id, lower(btrim(name)), gender)
  NULLS NOT DISTINCT
  WHERE archived_at IS NULL;

CREATE TRIGGER federation_age_group_updated_at BEFORE UPDATE ON federation_age_group
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE federation_age_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY federation_age_group_tenant ON federation_age_group
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON federation_age_group TO poolse_app;

-- ---------------------------------------------------------------------------
-- qualifying_standard
-- ---------------------------------------------------------------------------

CREATE TABLE qualifying_standard (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  season_id       uuid NOT NULL,
  name            text NOT NULL,
  -- The qualifying window. Null on either side falls back to the season's.
  window_from     date,
  window_to       date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  UNIQUE (organization_id, id),
  UNIQUE (organization_id, season_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  CONSTRAINT qualifying_standard_name_present CHECK (btrim(name) <> '' AND length(name) <= 200),
  CONSTRAINT qualifying_standard_window
    CHECK (window_from IS NULL OR window_to IS NULL OR window_from <= window_to)
);

COMMENT ON TABLE qualifying_standard IS
  'POOLSE-85: a championship''s entry times (tempos de admissão) for one season — the club''s '
  'own copy of a published table.';

CREATE UNIQUE INDEX qualifying_standard_name_uq
  ON qualifying_standard (organization_id, season_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE TRIGGER qualifying_standard_updated_at BEFORE UPDATE ON qualifying_standard
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE qualifying_standard ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualifying_standard_tenant ON qualifying_standard
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON qualifying_standard TO poolse_app;

-- ---------------------------------------------------------------------------
-- qualifying_time
-- ---------------------------------------------------------------------------

CREATE TABLE qualifying_time (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  season_id       uuid NOT NULL,
  standard_id     uuid NOT NULL,
  age_group_id    uuid NOT NULL,
  stroke          swim_stroke NOT NULL,
  distance_m      integer NOT NULL,
  -- Never null: an entry time with no pool length cannot be compared with anything.
  course          swim_course NOT NULL,
  time_ms         integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  UNIQUE (organization_id, id),
  -- Season in both keys: the group and the standard must share it.
  FOREIGN KEY (organization_id, season_id, standard_id)
    REFERENCES qualifying_standard (organization_id, season_id, id),
  FOREIGN KEY (organization_id, season_id, age_group_id)
    REFERENCES federation_age_group (organization_id, season_id, id),
  CONSTRAINT qualifying_time_distance CHECK (distance_m > 0 AND distance_m <= 10000),
  CONSTRAINT qualifying_time_positive CHECK (time_ms > 0 AND time_ms < 86400000)
);

COMMENT ON TABLE qualifying_time IS
  'POOLSE-85: one entry time — standard, age group, stroke, distance, course. Clearing a '
  'cell archives the row.';

CREATE UNIQUE INDEX qualifying_time_cell_uq
  ON qualifying_time (organization_id, standard_id, age_group_id, stroke, distance_m, course)
  WHERE archived_at IS NULL;

CREATE TRIGGER qualifying_time_updated_at BEFORE UPDATE ON qualifying_time
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE qualifying_time ENABLE ROW LEVEL SECURITY;
CREATE POLICY qualifying_time_tenant ON qualifying_time
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON qualifying_time TO poolse_app;

-- ---------------------------------------------------------------------------
-- The definitions
-- ---------------------------------------------------------------------------

-- Whether an age group admits a swimmer. Birth *year*, never age on a day: the
-- FPN fixes the band for the whole season. No birth date admits nobody — the
-- youngest band is the guess that cannot be recovered from.
CREATE FUNCTION federation_age_group_admits(
  p_gender student_gender, p_born_from smallint, p_born_to smallint,
  p_birth_date date, p_student_gender student_gender
) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_birth_date IS NOT NULL
     AND (p_gender IS NULL OR p_gender = p_student_gender)
     AND (p_born_from IS NULL OR extract(year FROM p_birth_date) >= p_born_from)
     AND (p_born_to IS NULL OR extract(year FROM p_birth_date) <= p_born_to)
$$;

-- Every (standard, swimmer, age group, event) a live standard asks of a live
-- swimmer whose group it names, with the swimmer's best valid time or null.
-- Null arguments mean every standard / every swimmer.
CREATE FUNCTION qualifying_gaps(p_standard uuid DEFAULT NULL, p_student uuid DEFAULT NULL)
RETURNS TABLE (
  standard_id   uuid,
  student_id    uuid,
  age_group_id  uuid,
  stroke        swim_stroke,
  distance_m    integer,
  course        swim_course,
  entry_ms      integer,
  best_ms       integer,
  best_swum_on  date,
  best_meet     text
)
LANGUAGE sql STABLE
AS $$
  WITH std AS (
    SELECT q.id, q.season_id,
           coalesce(q.window_from, se.starts_on) AS valid_from,
           coalesce(q.window_to, se.ends_on)     AS valid_to
      FROM qualifying_standard q
      JOIN season se ON se.id = q.season_id AND se.organization_id = q.organization_id
     WHERE q.archived_at IS NULL
       AND (p_standard IS NULL OR q.id = p_standard)
  ),
  eligible AS (
    SELECT std.id AS standard_id, std.valid_from, std.valid_to, s.id AS student_id, g.id AS age_group_id
      FROM std
      JOIN federation_age_group g ON g.season_id = std.season_id AND g.archived_at IS NULL
      JOIN student s ON s.archived_at IS NULL
                    AND (p_student IS NULL OR s.id = p_student)
                    AND federation_age_group_admits(g.gender, g.born_from, g.born_to, s.birth_date, s.gender)
  )
  SELECT e.standard_id, e.student_id, e.age_group_id, qt.stroke, qt.distance_m, qt.course,
         qt.time_ms, b.time_ms, b.swum_on, b.meet_name
    FROM eligible e
    JOIN qualifying_time qt ON qt.standard_id = e.standard_id
                           AND qt.age_group_id = e.age_group_id
                           AND qt.archived_at IS NULL
    LEFT JOIN LATERAL (
      SELECT r.time_ms, r.swum_on, sm.name AS meet_name
        FROM student_record r
        JOIN swim_meet sm ON sm.id = r.meet_id AND sm.organization_id = r.organization_id
       WHERE r.student_id = e.student_id
         AND r.archived_at IS NULL
         AND sm.archived_at IS NULL
         AND sm.official
         AND r.stroke = qt.stroke
         AND r.distance_m = qt.distance_m
         AND r.course = qt.course
         AND r.swum_on BETWEEN e.valid_from AND e.valid_to
       ORDER BY r.time_ms, r.swum_on
       LIMIT 1
    ) b ON true
$$;

COMMENT ON FUNCTION qualifying_gaps(uuid, uuid) IS
  'POOLSE-85: the one definition of a valid time and the gap. Same course, official live '
  'meet, inside the window (else the season). Read by Progressão and the Mínimos board.';

-- Down Migration

DROP FUNCTION IF EXISTS qualifying_gaps(uuid, uuid);
DROP FUNCTION IF EXISTS federation_age_group_admits(student_gender, smallint, smallint, date, student_gender);
DROP TABLE IF EXISTS qualifying_time;
DROP TABLE IF EXISTS qualifying_standard;
DROP TABLE IF EXISTS federation_age_group;
