-- Up Migration
--
-- A reading holds each dial of a multi-rate meter (Rui, 12-11-2026; research
-- in docs/features/energy.md › Mostradores).
--
-- A Portuguese meter on a bi-, tri- or tetra-horário tariff keeps one running
-- index per period: the E-REDES display steps through 1.8.1 vazio, 1.8.2 ponta,
-- 1.8.3 cheias, 1.8.4 super vazio. A single figure lost what the club pays for
-- most: ponta. So a meter says its dial set and a reading carries one value per
-- dial; `value` stays the total, which is what every existing sum, chart and
-- cost already reads, and is held equal to the dials' sum by a check.
--
-- Columns on the reading, not a child table: `energy_reading` is a TimescaleDB
-- hypertable keyed on (organization, meter, moment), and nothing can hold a
-- foreign key to it.
--
-- Dial sets, as ERSE defines the options (Diretiva 3/2026):
--   single  one figure (simples, gas, water)
--   bi      vazio + fora de vazio
--   tri     vazio + cheias + ponta
--   tetra   super vazio + vazio normal + cheias + ponta (BTE, MT)
-- The periods' hours are not stored: the meter and the bill already assign
-- every kWh to its dial, and ERSE moves the hours in 2027.

CREATE TYPE energy_dial_set AS ENUM ('single', 'bi', 'tri', 'tetra');

ALTER TABLE energy_meter ADD COLUMN dial_set energy_dial_set NOT NULL DEFAULT 'single';

ALTER TABLE energy_reading
  ADD COLUMN dial_vazio       numeric(14,3),
  ADD COLUMN dial_fora_vazio  numeric(14,3),
  ADD COLUMN dial_cheias      numeric(14,3),
  ADD COLUMN dial_ponta       numeric(14,3),
  ADD COLUMN dial_super_vazio numeric(14,3);

ALTER TABLE energy_reading
  ADD CONSTRAINT energy_reading_dials_sum CHECK (
    (dial_vazio IS NULL AND dial_fora_vazio IS NULL AND dial_cheias IS NULL
       AND dial_ponta IS NULL AND dial_super_vazio IS NULL)
    OR value = coalesce(dial_vazio, 0) + coalesce(dial_fora_vazio, 0) + coalesce(dial_cheias, 0)
             + coalesce(dial_ponta, 0) + coalesce(dial_super_vazio, 0)
  ),
  ADD CONSTRAINT energy_reading_dials_positive CHECK (
    coalesce(dial_vazio, 0) >= 0 AND coalesce(dial_fora_vazio, 0) >= 0 AND coalesce(dial_cheias, 0) >= 0
    AND coalesce(dial_ponta, 0) >= 0 AND coalesce(dial_super_vazio, 0) >= 0
  );

-- The dial-never-goes-back rule, now per dial as well as for the total. The
-- refusal names the dial, so the form can put the sentence under that field.
CREATE OR REPLACE FUNCTION energy_index_monotonic() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_reads    energy_meter_reads;
  v_initial  numeric;
  v_previous energy_reading%ROWTYPE;
  v_next     energy_reading%ROWTYPE;
  v_floor    numeric;
  v_dial     text;
  v_new      numeric;
  v_before   numeric;
  v_after    numeric;
BEGIN
  -- An archived reading is out of the series and may say anything.
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT reads, initial_index INTO v_reads, v_initial
    FROM energy_meter
   WHERE organization_id = NEW.organization_id AND id = NEW.meter_id;

  IF v_reads <> 'cumulative_index' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_previous
    FROM energy_reading
   WHERE organization_id = NEW.organization_id
     AND meter_id = NEW.meter_id
     AND taken_at < NEW.taken_at
     AND archived_at IS NULL
   ORDER BY taken_at DESC
   LIMIT 1;

  SELECT * INTO v_next
    FROM energy_reading
   WHERE organization_id = NEW.organization_id
     AND meter_id = NEW.meter_id
     AND taken_at > NEW.taken_at
     AND archived_at IS NULL
   ORDER BY taken_at
   LIMIT 1;

  -- No earlier reading: the floor is the dial when logging began, if known.
  v_floor := coalesce(v_previous.value, v_initial);

  IF v_floor IS NOT NULL AND NEW.value < v_floor THEN
    RAISE EXCEPTION 'Meter % read % at %, below the earlier reading of %',
      NEW.meter_id, NEW.value, NEW.taken_at, v_floor
      USING ERRCODE = 'check_violation',
            DETAIL = format('energy_index_backwards|%s|%s', v_floor, NEW.value);
  END IF;

  IF v_next.value IS NOT NULL AND NEW.value > v_next.value THEN
    RAISE EXCEPTION 'Meter % read % at %, above the later reading of %',
      NEW.meter_id, NEW.value, NEW.taken_at, v_next.value
      USING ERRCODE = 'check_violation',
            DETAIL = format('energy_index_ahead|%s|%s', v_next.value, NEW.value);
  END IF;

  -- Each dial against the same dial either side, where both carry one.
  FOREACH v_dial IN ARRAY ARRAY['vazio', 'fora_vazio', 'cheias', 'ponta', 'super_vazio'] LOOP
    v_new    := (to_jsonb(NEW)        ->> ('dial_' || v_dial))::numeric;
    v_before := (to_jsonb(v_previous) ->> ('dial_' || v_dial))::numeric;
    v_after  := (to_jsonb(v_next)     ->> ('dial_' || v_dial))::numeric;
    CONTINUE WHEN v_new IS NULL;

    IF v_before IS NOT NULL AND v_new < v_before THEN
      RAISE EXCEPTION 'Meter % dial % read % at %, below the earlier %',
        NEW.meter_id, v_dial, v_new, NEW.taken_at, v_before
        USING ERRCODE = 'check_violation',
              DETAIL = format('energy_index_backwards|%s|%s|%s', v_before, v_new, v_dial);
    END IF;
    IF v_after IS NOT NULL AND v_new > v_after THEN
      RAISE EXCEPTION 'Meter % dial % read % at %, above the later %',
        NEW.meter_id, v_dial, v_new, NEW.taken_at, v_after
        USING ERRCODE = 'check_violation',
              DETAIL = format('energy_index_ahead|%s|%s|%s', v_after, v_new, v_dial);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$fn$;

COMMENT ON COLUMN energy_meter.dial_set IS
  'Which dials a reading carries: single, bi (vazio/fora de vazio), tri (vazio/cheias/ponta), tetra (+ super vazio). 12-11-2026.';

-- Down Migration

CREATE OR REPLACE FUNCTION energy_index_monotonic() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_reads         energy_meter_reads;
  v_initial       numeric;
  v_previous      numeric;
  v_next          numeric;
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT reads, initial_index INTO v_reads, v_initial
    FROM energy_meter
   WHERE organization_id = NEW.organization_id AND id = NEW.meter_id;

  IF v_reads <> 'cumulative_index' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_previous
    FROM energy_reading
   WHERE organization_id = NEW.organization_id
     AND meter_id = NEW.meter_id
     AND taken_at < NEW.taken_at
     AND archived_at IS NULL
   ORDER BY taken_at DESC
   LIMIT 1;

  v_previous := coalesce(v_previous, v_initial);

  SELECT value INTO v_next
    FROM energy_reading
   WHERE organization_id = NEW.organization_id
     AND meter_id = NEW.meter_id
     AND taken_at > NEW.taken_at
     AND archived_at IS NULL
   ORDER BY taken_at
   LIMIT 1;

  IF v_previous IS NOT NULL AND NEW.value < v_previous THEN
    RAISE EXCEPTION 'Meter % read % at %, below the earlier reading of %',
      NEW.meter_id, NEW.value, NEW.taken_at, v_previous
      USING ERRCODE = 'check_violation',
            DETAIL = format('energy_index_backwards|%s|%s', v_previous, NEW.value);
  END IF;

  IF v_next IS NOT NULL AND NEW.value > v_next THEN
    RAISE EXCEPTION 'Meter % read % at %, above the later reading of %',
      NEW.meter_id, NEW.value, NEW.taken_at, v_next
      USING ERRCODE = 'check_violation',
            DETAIL = format('energy_index_ahead|%s|%s', v_next, NEW.value);
  END IF;

  RETURN NEW;
END;
$fn$;

ALTER TABLE energy_reading DROP CONSTRAINT energy_reading_dials_positive;
ALTER TABLE energy_reading DROP CONSTRAINT energy_reading_dials_sum;
ALTER TABLE energy_reading
  DROP COLUMN dial_super_vazio,
  DROP COLUMN dial_ponta,
  DROP COLUMN dial_cheias,
  DROP COLUMN dial_fora_vazio,
  DROP COLUMN dial_vazio;
ALTER TABLE energy_meter DROP COLUMN dial_set;
DROP TYPE energy_dial_set;
