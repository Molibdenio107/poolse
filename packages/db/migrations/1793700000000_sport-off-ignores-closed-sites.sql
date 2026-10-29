-- Up Migration
--
-- Sweep of 29-10-2026. A court on a site that was archived stayed "live" — the
-- site archive cascades to its pools only — so switching its sport off was
-- refused for ever, naming a court nobody could see or archive. A recinto on an
-- archived site is not in use: the refusal now reads only recintos whose site is
-- live, the same rule the /admin count follows.

CREATE OR REPLACE FUNCTION organization_sports_known() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unknown text;
  v_sport   text;
  v_names   text;
BEGIN
  SELECT s INTO v_unknown
    FROM unnest(NEW.enabled_sports) AS s
   WHERE NOT EXISTS (SELECT 1 FROM sport WHERE sport.id = s)
   LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'unknown sport %', v_unknown
      USING ERRCODE = 'foreign_key_violation', DETAIL = format('sport_unknown|%s', v_unknown);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT a.sport_id, string_agg(a.name, ', ' ORDER BY a.name)
      INTO v_sport, v_names
      FROM playing_area a
      JOIN facility f ON f.id = a.facility_id AND f.organization_id = a.organization_id
     WHERE a.organization_id = NEW.id
       AND a.archived_at IS NULL
       AND f.archived_at IS NULL
       AND a.sport_id = ANY (OLD.enabled_sports)
       AND NOT (a.sport_id = ANY (NEW.enabled_sports))
     GROUP BY a.sport_id
     ORDER BY a.sport_id
     LIMIT 1;
    IF v_sport IS NOT NULL THEN
      RAISE EXCEPTION 'sport % still has live recintos', v_sport
        USING ERRCODE = 'check_violation', DETAIL = format('sport_in_use|%s|%s', v_sport, v_names);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION organization_sports_known() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unknown text;
  v_sport   text;
  v_names   text;
BEGIN
  SELECT s INTO v_unknown
    FROM unnest(NEW.enabled_sports) AS s
   WHERE NOT EXISTS (SELECT 1 FROM sport WHERE sport.id = s)
   LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'unknown sport %', v_unknown
      USING ERRCODE = 'foreign_key_violation', DETAIL = format('sport_unknown|%s', v_unknown);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT a.sport_id, string_agg(a.name, ', ' ORDER BY a.name)
      INTO v_sport, v_names
      FROM playing_area a
     WHERE a.organization_id = NEW.id
       AND a.archived_at IS NULL
       AND a.sport_id = ANY (OLD.enabled_sports)
       AND NOT (a.sport_id = ANY (NEW.enabled_sports))
     GROUP BY a.sport_id
     ORDER BY a.sport_id
     LIMIT 1;
    IF v_sport IS NOT NULL THEN
      RAISE EXCEPTION 'sport % still has live recintos', v_sport
        USING ERRCODE = 'check_violation', DETAIL = format('sport_in_use|%s|%s', v_sport, v_names);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
