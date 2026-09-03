-- Parcerias — POOLSE-47.
--
-- What is asserted here rather than read, and why each one earns a test.
--
-- **The unit price survives being a unit price.** `numeric(12,6)` is the whole
-- point of the column and the ticket names it as the thing most likely to be got
-- wrong. A lane-hour at €14.375 stored as cents is off by half a cent, which is
-- nothing until it is multiplied by six lanes by thirty weeks. So: store the
-- awkward number, multiply it, and check the answer is exact.
--
-- **A partner name collides accent- and case-insensitively, per facility.**
-- Four scenarios in one: the same name twice is refused, the same name at
-- another site is fine, and archiving frees the name again. The partial index is
-- what makes the third true, and a plain unique constraint would pass the first
-- two while quietly breaking the third a season later.
--
-- **The composite keys hold in both directions.** A partner cannot be attached
-- to another tenant's facility, and — the one that matters for POOLSE-49 — a
-- booking cannot be attached to another tenant's partner group. RLS does not
-- catch that case: both rows pass their own policies. Only the composite key
-- does.
--
-- **A parceria booking carries a season and a turma booking does not.** The gap
-- POOLSE-46 left, closed by this migration, and load-bearing for every occupancy
-- query in POOLSE-49 through 52.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_p', 'p@clube.pt', 'Rui', 'Fonseca', NULL, '2026-09-01 09:00:00+00');

-- Fixed ids: the cross-tenant tests run under RLS as `poolse_app`, where a
-- lookup by name returns nothing and a null id would pass for the wrong reason.
INSERT INTO organization (id, name, slug) VALUES
  ('77777777-7777-7777-7777-777777777777', 'Clube Parcerias', 'clube-parcerias'),
  ('88888888-8888-8888-8888-888888888888', 'Clube Vizinho P', 'clube-vizinho-p');

DO $$
DECLARE
  v_org uuid; v_other uuid;
  v_central uuid; v_norte uuid; v_other_facility uuid;
  v_season uuid;
  v_dinis uuid;
BEGIN
  v_org   := '77777777-7777-7777-7777-777777777777';
  v_other := '88888888-8888-8888-8888-888888888888';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Central')
  RETURNING id INTO v_central;
  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Norte')
  RETURNING id INTO v_norte;
  INSERT INTO facility (organization_id, name) VALUES (v_other, 'Piscina do Vizinho')
  RETURNING id INTO v_other_facility;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-07-31', 'published')
  RETURNING id INTO v_season;

  -- The reference club's actual morning, near enough.
  INSERT INTO partner (organization_id, facility_id, name, type, nif, color)
  VALUES (v_org, v_central, 'ES D. Dinis', 'escola', '501234567', '#67a6b6')
  RETURNING id INTO v_dinis;

  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_central, 'Misericórdia', 'ipss_misericordia');

  INSERT INTO partner_contact (organization_id, partner_id, name, role, email)
  VALUES (v_org, v_dinis, 'Ana Marques', 'Coordenadora de Educação Física', 'ana@esdinis.pt');

  INSERT INTO partner_agreement (
    organization_id, partner_id, season_id, start_date, end_date,
    billing_model, unit_price, vat_rate, payment_period
  ) VALUES (
    v_org, v_dinis, v_season, '2026-09-01', '2027-07-31',
    'por_hora_pista', 14.375, 0.2300, 'mensal'
  );

  INSERT INTO partner_group (
    organization_id, partner_id, name, participant_count, tag
  ) VALUES
    (v_org, v_dinis, '6A', 24, 'DE'),
    (v_org, v_dinis, '6B', 22, NULL),
    (v_org, v_dinis, '10G 11B', 18, 'DE');
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a unit price is a unit price
--
-- QA 47.8. The number the ticket names, multiplied the way a season multiplies
-- it. If this column were ever "fixed" to integer cents, 14.375 arrives as 14.38
-- or 14.37 and this fails by €1.35 over a single week of six lanes — which is
-- exactly the scale at which nobody notices and the invoice is still wrong.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_price numeric; v_total numeric;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';

  SELECT a.unit_price INTO v_price
    FROM partner_agreement a
    JOIN partner p ON p.id = a.partner_id
   WHERE a.organization_id = v_org AND p.name = 'ES D. Dinis';

  IF v_price <> 14.375 THEN
    RAISE EXCEPTION 'FAIL test 1a: unit price came back as %, not 14.375', v_price;
  END IF;

  -- Six lanes, thirty weeks, two hours a week.
  v_total := v_price * 6 * 30 * 2;
  IF v_total <> 5175.000 THEN
    RAISE EXCEPTION 'FAIL test 1b: a season of lane-hours came to %, not 5175', v_total;
  END IF;

  RAISE NOTICE 'PASS test 1: a unit price survives multiplication exactly';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — null vat_rate is isento, and a nonsense rate is refused
--
-- QA 47.9. Null carries a meaning here, so it is worth proving it is storable
-- and that the range check does not accidentally forbid it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_partner uuid; v_rate numeric; ok boolean;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_partner FROM partner
   WHERE organization_id = v_org AND name = 'Misericórdia';

  INSERT INTO partner_agreement (
    organization_id, partner_id, start_date, billing_model, unit_price, vat_rate
  ) VALUES (v_org, v_partner, '2026-09-01', 'mensal_fixo', 320.000000, NULL);

  SELECT vat_rate INTO v_rate FROM partner_agreement WHERE partner_id = v_partner;
  IF v_rate IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2a: isento did not store as null, got %', v_rate;
  END IF;

  -- 23 is not a rate; 0.23 is. A club typing the percentage into the fraction
  -- would otherwise store a 2300% VAT rate and invoice against it.
  ok := false;
  BEGIN
    INSERT INTO partner_agreement (
      organization_id, partner_id, start_date, billing_model, unit_price, vat_rate
    ) VALUES (v_org, v_partner, '2026-09-01', 'mensal_fixo', 320.000000, 23);
  EXCEPTION WHEN check_violation OR numeric_value_out_of_range THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 2b: a VAT rate of 23 (not 0.23) was accepted';
  END IF;

  RAISE NOTICE 'PASS test 2: null vat_rate means isento, and 23 is not a rate';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — partner names collide per facility, accent- and case-insensitively
--
-- QA 47.2, 47.3 and 47.4 in one block, because they are three faces of one
-- index and testing them apart would let a plain unique constraint pass two.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_central uuid; v_norte uuid; ok boolean; n int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_central FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Central';
  SELECT id INTO v_norte FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Norte';

  -- 47.2 — same name, different case and accents, same site.
  ok := false;
  BEGIN
    INSERT INTO partner (organization_id, facility_id, name, type)
    VALUES (v_org, v_central, 'misericordia', 'ipss_misericordia');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3a: "misericordia" was accepted beside "Misericórdia"';
  END IF;

  -- 47.3 — the same school at the other building is a different partnership,
  -- with its own agreement, price and contact. That is the design, not a leak.
  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_norte, 'Misericórdia', 'ipss_misericordia');

  -- 47.4 — archiving frees the name. The partial index is what makes this work,
  -- and it is the one that breaks silently a season later without a test.
  UPDATE partner SET archived_at = now()
   WHERE organization_id = v_org AND facility_id = v_norte AND name = 'Misericórdia';

  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_norte, 'Misericórdia', 'ipss_misericordia');

  SELECT count(*) INTO n FROM partner
   WHERE organization_id = v_org AND facility_id = v_norte
     AND lower(strip_accents(name)) = 'misericordia';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3b: expected the archived row plus the new one, got %', n;
  END IF;

  RAISE NOTICE 'PASS test 3: partner names are unique per site, accent-blind, and freed by archiving';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a group name is unique within its partner, and free across partners
--
-- Every school has a 6A. Scoping the index to the partner rather than the
-- facility is what lets two of them coexist.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_dinis uuid; v_mis uuid; v_central uuid; ok boolean;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_dinis FROM partner
   WHERE organization_id = v_org AND name = 'ES D. Dinis';
  SELECT id INTO v_central FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Central';
  /*
   * Scoped to the site, not `LIMIT 1`.
   *
   * Test 3 deliberately leaves three Misericórdia rows about — the original at
   * Central, an archived one at Norte and its replacement — so an unordered
   * `LIMIT 1` picks whichever the plan happens to return first. It picked the
   * Central one until an unrelated migration added an index and the row order
   * moved, and then test 10 failed instead, three tests away from the cause.
   */
  SELECT id INTO v_mis FROM partner
   WHERE organization_id = v_org AND name = 'Misericórdia' AND archived_at IS NULL
     AND facility_id = v_central;

  ok := false;
  BEGIN
    INSERT INTO partner_group (organization_id, partner_id, name)
    VALUES (v_org, v_dinis, '6a');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4a: "6a" was accepted beside "6A" in the same partner';
  END IF;

  -- Another partner's 6A is a different class of children entirely.
  INSERT INTO partner_group (organization_id, partner_id, name)
  VALUES (v_org, v_mis, '6A');

  RAISE NOTICE 'PASS test 4: group names are unique within a partner, not across them';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — a group that brings nobody cannot name an instructor
--
-- The flag and the name are one fact in two columns, and the risk is the stale
-- half: somebody turns `brings_own_instructor` off and the school's teacher is
-- still printed on the grid beside a booking Poolse now believes it must staff.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_dinis uuid; ok boolean;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_dinis FROM partner
   WHERE organization_id = v_org AND name = 'ES D. Dinis';

  ok := false;
  BEGIN
    INSERT INTO partner_group (
      organization_id, partner_id, name, brings_own_instructor, own_instructor_name
    ) VALUES (v_org, v_dinis, '7A', false, 'Prof. Silva');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 5a: a group with no own instructor kept an instructor name';
  END IF;

  INSERT INTO partner_group (
    organization_id, partner_id, name, brings_own_instructor, own_instructor_name
  ) VALUES (v_org, v_dinis, '7A', true, 'Prof. Silva');

  -- And turning the flag off must take the name with it, not leave it behind.
  ok := false;
  BEGIN
    UPDATE partner_group SET brings_own_instructor = false
     WHERE organization_id = v_org AND partner_id = v_dinis AND name = '7A';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 5b: the flag was cleared while the instructor name stayed';
  END IF;

  RAISE NOTICE 'PASS test 5: own_instructor_name cannot outlive its flag';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — a contact must be reachable, and a participant count cannot be negative
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_dinis uuid; ok boolean;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_dinis FROM partner
   WHERE organization_id = v_org AND name = 'ES D. Dinis';

  ok := false;
  BEGIN
    INSERT INTO partner_contact (organization_id, partner_id, name)
    VALUES (v_org, v_dinis, 'Alguém do Conselho');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 6a: a contact with no email and no phone was accepted';
  END IF;

  -- A telephone alone is enough — a partner contact is not a guardian and is
  -- never deduplicated against the register.
  INSERT INTO partner_contact (organization_id, partner_id, name, phone)
  VALUES (v_org, v_dinis, 'Secretaria', '212345678');

  -- Zero is a real answer. Negative twelve is not.
  INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
  VALUES (v_org, v_dinis, 'Por dimensionar', 0);

  ok := false;
  BEGIN
    INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
    VALUES (v_org, v_dinis, 'Impossível', -12);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 6b: a negative participant count was accepted';
  END IF;

  RAISE NOTICE 'PASS test 6: a contact is reachable and a group is not negatively sized';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7 — a booking carries a season iff it is not a turma
--
-- The gap POOLSE-46 left. Both directions, because the failure that matters is
-- the silent one: a turma booking growing a season that disagrees with its
-- class_group's, leaving occupancy with two answers and no way to choose.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_central uuid; v_season uuid; v_group uuid; v_schedule uuid;
  v_level uuid; v_class uuid; ok boolean;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_central FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Central';
  SELECT id INTO v_season FROM season WHERE organization_id = v_org;
  SELECT g.id INTO v_group
    FROM partner_group g JOIN partner p ON p.id = g.partner_id
   WHERE g.organization_id = v_org AND p.name = 'ES D. Dinis' AND g.name = '6A';

  -- A parceria booking with no season is refused.
  ok := false;
  BEGIN
    INSERT INTO class_schedule (
      organization_id, facility_id, subject_type, partner_group_id,
      weekday, start_time, duration_minutes
    ) VALUES (v_org, v_central, 'parceria', v_group, 2, '09:00', 45);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 7a: a parceria booking was accepted with no season';
  END IF;

  INSERT INTO class_schedule (
    organization_id, facility_id, subject_type, partner_group_id, season_id,
    weekday, start_time, duration_minutes
  ) VALUES (v_org, v_central, 'parceria', v_group, v_season, 2, '09:00', 45)
  RETURNING id INTO v_schedule;

  -- And a turma booking with one is refused, because its turma already answers.
  INSERT INTO student_level (organization_id, name, sort_order)
  VALUES (v_org, 'Adaptação', 1) RETURNING id INTO v_level;

  INSERT INTO class_group (organization_id, season_id, facility_id, name, level_id)
  VALUES (v_org, v_season, v_central, 'Turma A', v_level) RETURNING id INTO v_class;

  ok := false;
  BEGIN
    INSERT INTO class_schedule (
      organization_id, facility_id, subject_type, class_group_id, season_id,
      weekday, start_time, duration_minutes
    ) VALUES (v_org, v_central, 'turma', v_class, v_season, 3, '17:00', 45);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 7b: a turma booking was allowed its own season';
  END IF;

  INSERT INTO class_schedule (
    organization_id, facility_id, subject_type, class_group_id,
    weekday, start_time, duration_minutes
  ) VALUES (v_org, v_central, 'turma', v_class, 3, '17:00', 45);

  -- A manutenção in the August gap belongs to no season, and must not be forced
  -- to name one it does not fall inside. A gala within the year may name its own.
  INSERT INTO class_schedule (
    organization_id, facility_id, subject_type, title,
    weekday, start_time, duration_minutes
  ) VALUES (v_org, v_central, 'manutencao', 'Paragem técnica', 1, '07:00', 120);

  INSERT INTO class_schedule (
    organization_id, facility_id, subject_type, title, season_id,
    weekday, start_time, duration_minutes
  ) VALUES (v_org, v_central, 'evento', 'Gala de Natal', v_season, 6, '15:00', 180);

  RAISE NOTICE 'PASS test 7: a turma never carries a season, a parceria always does, a shutdown may not';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8 — the composite keys, in both directions
--
-- QA 47.14. The case RLS cannot catch: two rows that each pass their own policy
-- while the reference between them crosses tenants. Only the composite key sees
-- it, so it is worth one test per hop.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_other uuid; v_other_facility uuid;
  v_central uuid; v_group uuid; v_season uuid; ok boolean;
BEGIN
  v_org   := '77777777-7777-7777-7777-777777777777';
  v_other := '88888888-8888-8888-8888-888888888888';
  SELECT id INTO v_other_facility FROM facility WHERE organization_id = v_other;
  SELECT id INTO v_central FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Central';
  SELECT id INTO v_season FROM season WHERE organization_id = v_org;
  SELECT g.id INTO v_group
    FROM partner_group g JOIN partner p ON p.id = g.partner_id
   WHERE g.organization_id = v_org AND p.name = 'ES D. Dinis' AND g.name = '6A';

  -- A partner cannot sit in another tenant's building.
  ok := false;
  BEGIN
    INSERT INTO partner (organization_id, facility_id, name, type)
    VALUES (v_org, v_other_facility, 'Escola Roubada', 'escola');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 8a: a partner was attached to another tenant''s facility';
  END IF;

  -- The one that matters for POOLSE-49: a booking cannot be pointed at another
  -- tenant's partner group. This is the FK the bookings migration deferred.
  ok := false;
  BEGIN
    INSERT INTO class_schedule (
      organization_id, facility_id, subject_type, partner_group_id, season_id,
      weekday, start_time, duration_minutes
    ) VALUES (v_other, v_other_facility, 'parceria', v_group, v_season, 2, '10:00', 45);
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 8b: a booking was attached to another tenant''s partner group';
  END IF;

  RAISE NOTICE 'PASS test 8: partners and their groups cannot be borrowed across tenants';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9 — RLS seals all five tables
--
-- QA 47.14's read half. Under the app role, the neighbour sees nothing, and the
-- unscoped `SELECT` that forgot its where clause returns zero rather than
-- everything.
-- ---------------------------------------------------------------------------

DO $$
DECLARE n int;
BEGIN
  SET LOCAL ROLE poolse_app;
  PERFORM set_config('app.organization_id', '88888888-8888-8888-8888-888888888888', true);

  SELECT count(*) INTO n FROM partner;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9a: the neighbour sees % partners', n; END IF;

  SELECT count(*) INTO n FROM partner_contact;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9b: the neighbour sees % contacts', n; END IF;

  SELECT count(*) INTO n FROM partner_agreement;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9c: the neighbour sees % agreements', n; END IF;

  SELECT count(*) INTO n FROM partner_group;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9d: the neighbour sees % groups', n; END IF;

  SELECT count(*) INTO n FROM partner_group_member;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL test 9e: the neighbour sees % roster names', n; END IF;

  -- And the owning tenant does see its own, so the policies are not simply
  -- refusing everybody — a test that passes because nothing works.
  PERFORM set_config('app.organization_id', '77777777-7777-7777-7777-777777777777', true);
  SELECT count(*) INTO n FROM partner WHERE archived_at IS NULL;
  IF n < 3 THEN
    RAISE EXCEPTION 'FAIL test 9f: the owning tenant sees only % of its own partners', n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS test 9: all five partner tables are sealed, and open to their owner';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10 — horas/semana and pistas·hora/semana, in SQL
--
-- Criterion 8 and QA 47.5/47.6. The shape of the query the repository runs, kept
-- here so that a change to the booking model that breaks the arithmetic fails in
-- the database suite rather than on a screen nobody has opened yet.
--
-- The zero row is the point of the LEFT JOIN: QA 47.6 says a partner with no
-- bookings reads 0, not blank, and an inner join would drop it off the list
-- entirely.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_central uuid; v_season uuid; v_pool uuid; v_lane uuid;
  v_schedule uuid; v_group uuid;
  v_hours numeric; v_lane_hours numeric; v_groups int;
BEGIN
  v_org := '77777777-7777-7777-7777-777777777777';
  SELECT id INTO v_central FROM facility
   WHERE organization_id = v_org AND name = 'Piscina Central';
  SELECT id INTO v_season FROM season WHERE organization_id = v_org;

  INSERT INTO pool (organization_id, facility_id, name, kind)
  VALUES (v_org, v_central, 'Tanque Grande', 'indoor') RETURNING id INTO v_pool;

  -- Two lanes: the implicit one every pool arrives with, plus one more, so the
  -- lane-hours figure is not accidentally equal to the hours figure.
  SELECT id INTO v_lane FROM lane WHERE pool_id = v_pool AND position = 1;
  INSERT INTO lane (organization_id, pool_id, name, position)
  VALUES (v_org, v_pool, 'Pista 2', 2);

  SELECT id INTO v_schedule FROM class_schedule
   WHERE organization_id = v_org AND subject_type = 'parceria';

  INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
  SELECT v_org, v_schedule, l.id FROM lane l WHERE l.pool_id = v_pool;

  -- 45 minutes on two lanes = 0.75 hours and 1.5 lane-hours.
  SELECT
      coalesce(sum(cs.duration_minutes) / 60.0, 0),
      coalesce(sum(cs.duration_minutes * bl.lanes) / 60.0, 0)
    INTO v_hours, v_lane_hours
    FROM partner p
    JOIN partner_group g
      ON g.partner_id = p.id AND g.organization_id = p.organization_id
     AND g.archived_at IS NULL
    JOIN class_schedule cs
      ON cs.partner_group_id = g.id AND cs.organization_id = g.organization_id
     AND cs.archived_at IS NULL AND cs.season_id = v_season
    LEFT JOIN LATERAL (
      SELECT count(*) AS lanes FROM booking_lane b
       WHERE b.schedule_id = cs.id AND b.organization_id = cs.organization_id
    ) bl ON true
   WHERE p.organization_id = v_org AND p.name = 'ES D. Dinis';

  IF v_hours <> 0.75 THEN
    RAISE EXCEPTION 'FAIL test 10a: horas/semana came to %, not 0.75', v_hours;
  END IF;
  IF v_lane_hours <> 1.5 THEN
    RAISE EXCEPTION 'FAIL test 10b: pistas·hora/semana came to %, not 1.5', v_lane_hours;
  END IF;

  -- QA 47.6 — a partner with no bookings at all reads zero and stays in the list.
  SELECT
      count(DISTINCT g.id),
      coalesce(sum(cs.duration_minutes) / 60.0, 0)
    INTO v_groups, v_hours
    FROM partner p
    LEFT JOIN partner_group g
      ON g.partner_id = p.id AND g.organization_id = p.organization_id
     AND g.archived_at IS NULL
    LEFT JOIN class_schedule cs
      ON cs.partner_group_id = g.id AND cs.organization_id = g.organization_id
     AND cs.archived_at IS NULL AND cs.season_id = v_season
   WHERE p.organization_id = v_org AND p.name = 'Misericórdia'
     AND p.archived_at IS NULL AND p.facility_id = v_central
   GROUP BY p.id;

  IF v_hours <> 0 THEN
    RAISE EXCEPTION 'FAIL test 10c: a partner with no bookings read %, not 0', v_hours;
  END IF;
  IF v_groups <> 1 THEN
    RAISE EXCEPTION 'FAIL test 10d: expected 1 group on the unbooked partner, got %', v_groups;
  END IF;

  RAISE NOTICE 'PASS test 10: the derived columns compute in SQL, and zero is a number';
END $$;

ROLLBACK;
