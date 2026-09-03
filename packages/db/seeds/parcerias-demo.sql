-- Three dummy parcerias for Clube de Santo Tirso, modelled on the reference
-- club's actual morning: a secondary school booked per class, a Misericórdia
-- doing hidroterapia, and an under-16 handball squad.
--
-- Bookings are placed on real slots and real lanes so the grid has something to
-- draw. Deliberately includes a three-lane span and a group that brings its own
-- instructor, because those are the two cases most worth looking at.
--
-- Idempotent: every insert is guarded, so running it twice changes nothing.

\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_org      uuid := '9d4816d5-3a50-4629-bc38-b159e2b0f85f';
  v_facility uuid := 'd766406f-221d-4af6-b360-0e11ca58dedf';
  v_season   uuid;
  v_pool     uuid;
  v_dinis uuid; v_mis uuid; v_andebol uuid;
  v_6a uuid; v_6b uuid; v_hidro uuid; v_sub16 uuid;
  v_slot_0930 uuid; v_slot_1015 uuid; v_slot_1100 uuid; v_slot_1915 uuid;
  v_lane1 uuid; v_lane2 uuid; v_lane3 uuid; v_lane4 uuid;
  v_booking uuid;
BEGIN
  SELECT id INTO v_season FROM season
   WHERE organization_id = v_org AND status = 'published';

  -- The six-lane tank, which is where a school class actually goes.
  SELECT id INTO v_pool FROM pool
   WHERE organization_id = v_org AND name = 'Piscina principal' AND archived_at IS NULL;

  SELECT id INTO v_lane1 FROM lane WHERE pool_id = v_pool AND position = 1;
  SELECT id INTO v_lane2 FROM lane WHERE pool_id = v_pool AND position = 2;
  SELECT id INTO v_lane3 FROM lane WHERE pool_id = v_pool AND position = 3;
  SELECT id INTO v_lane4 FROM lane WHERE pool_id = v_pool AND position = 4;

  SELECT id INTO v_slot_0930 FROM facility_time_slot
   WHERE facility_id = v_facility AND season_id = v_season
     AND day_group = 'weekday' AND start_time = '09:30';
  SELECT id INTO v_slot_1015 FROM facility_time_slot
   WHERE facility_id = v_facility AND season_id = v_season
     AND day_group = 'weekday' AND start_time = '10:15';
  SELECT id INTO v_slot_1100 FROM facility_time_slot
   WHERE facility_id = v_facility AND season_id = v_season
     AND day_group = 'weekday' AND start_time = '11:00';
  SELECT id INTO v_slot_1915 FROM facility_time_slot
   WHERE facility_id = v_facility AND season_id = v_season
     AND day_group = 'weekday' AND start_time = '19:15';

  -- -------------------------------------------------------------- partners

  INSERT INTO partner (organization_id, facility_id, name, type, nif, address, color, notes)
  VALUES (v_org, v_facility, 'ES D. Dinis', 'escola', '600078987',
          'Rua da Escola 12, Santo Tirso', '#67a6b6',
          'Reserva a manhã de 2ª e 4ª. Turmas do 2.º e 3.º ciclo.')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_dinis FROM partner
   WHERE organization_id = v_org AND facility_id = v_facility AND name = 'ES D. Dinis';

  INSERT INTO partner (organization_id, facility_id, name, type, nif, address, color, notes)
  VALUES (v_org, v_facility, 'Misericórdia de Santo Tirso', 'ipss_misericordia', '501234567',
          'Praça 25 de Abril, Santo Tirso', '#b3d49d',
          'Hidroterapia. Grupo pequeno, precisa de água mais quente.')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_mis FROM partner
   WHERE organization_id = v_org AND facility_id = v_facility
     AND name = 'Misericórdia de Santo Tirso';

  INSERT INTO partner (organization_id, facility_id, name, type, nif, color, notes)
  VALUES (v_org, v_facility, 'Andebol Clube de Santo Tirso', 'clube', '502998877', '#d99a6c',
          'Treino de recuperação para o plantel sub-16.')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_andebol FROM partner
   WHERE organization_id = v_org AND facility_id = v_facility
     AND name = 'Andebol Clube de Santo Tirso';

  -- -------------------------------------------------------------- contacts

  INSERT INTO partner_contact (organization_id, partner_id, name, role, email, phone)
  SELECT v_org, v_dinis, 'Ana Marques', 'Coordenadora de Educação Física',
         'ana.marques@esdinis.pt', '252123456'
   WHERE NOT EXISTS (SELECT 1 FROM partner_contact WHERE partner_id = v_dinis);

  INSERT INTO partner_contact (organization_id, partner_id, name, role, phone)
  SELECT v_org, v_mis, 'Secretaria', 'Serviços administrativos', '252987654'
   WHERE NOT EXISTS (SELECT 1 FROM partner_contact WHERE partner_id = v_mis);

  INSERT INTO partner_contact (organization_id, partner_id, name, role, email)
  SELECT v_org, v_andebol, 'Pedro Sousa', 'Treinador principal', 'pedro@andeboltirso.pt'
   WHERE NOT EXISTS (SELECT 1 FROM partner_contact WHERE partner_id = v_andebol);

  -- ------------------------------------------------------------ agreements
  --
  -- The awkward unit price is on purpose: 14,375 € a pista·hora is the number
  -- that must survive multiplication, and it is worth having one on screen.

  INSERT INTO partner_agreement
    (organization_id, partner_id, season_id, start_date, end_date,
     billing_model, unit_price, vat_rate, payment_period, notes)
  SELECT v_org, v_dinis, v_season, '2026-09-15', '2027-06-30',
         'por_hora_pista', 14.375, 0.2300, 'mensal',
         'Protocolo anual, renovável. Faturado ao agrupamento.'
   WHERE NOT EXISTS (SELECT 1 FROM partner_agreement WHERE partner_id = v_dinis);

  -- Isento, which is the case the interface has to say out loud rather than
  -- leaving blank.
  INSERT INTO partner_agreement
    (organization_id, partner_id, start_date, billing_model, unit_price, vat_rate, payment_period)
  SELECT v_org, v_mis, '2026-09-01', 'mensal_fixo', 320.000000, NULL, 'mensal'
   WHERE NOT EXISTS (SELECT 1 FROM partner_agreement WHERE partner_id = v_mis);

  INSERT INTO partner_agreement
    (organization_id, partner_id, season_id, start_date,
     billing_model, unit_price, vat_rate, payment_period)
  SELECT v_org, v_andebol, v_season, '2026-10-01',
         'por_participante', 3.500000, 0.2300, 'trimestral'
   WHERE NOT EXISTS (SELECT 1 FROM partner_agreement WHERE partner_id = v_andebol);

  -- ---------------------------------------------------------------- groups

  INSERT INTO partner_group
    (organization_id, partner_id, name, participant_count, brings_own_instructor,
     own_instructor_name, tag, notes)
  SELECT v_org, v_dinis, '6A', 24, true, 'Prof. Silva', 'DE', NULL
   WHERE NOT EXISTS (SELECT 1 FROM partner_group WHERE partner_id = v_dinis AND name = '6A');
  SELECT id INTO v_6a FROM partner_group WHERE partner_id = v_dinis AND name = '6A';

  INSERT INTO partner_group (organization_id, partner_id, name, participant_count, tag)
  SELECT v_org, v_dinis, '6B', 22, 'DE'
   WHERE NOT EXISTS (SELECT 1 FROM partner_group WHERE partner_id = v_dinis AND name = '6B');
  SELECT id INTO v_6b FROM partner_group WHERE partner_id = v_dinis AND name = '6B';

  -- Zero participants, because it has not been sized yet — a real state the
  -- screen has to show as 0 rather than as a blank.
  INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
  SELECT v_org, v_dinis, '10G 11B', 0
   WHERE NOT EXISTS (SELECT 1 FROM partner_group WHERE partner_id = v_dinis AND name = '10G 11B');

  INSERT INTO partner_group (organization_id, partner_id, name, participant_count, notes)
  SELECT v_org, v_mis, 'Hidroterapia', 8, 'Acesso pela rampa. Precisa de duas monitoras.'
   WHERE NOT EXISTS (SELECT 1 FROM partner_group WHERE partner_id = v_mis AND name = 'Hidroterapia');
  SELECT id INTO v_hidro FROM partner_group WHERE partner_id = v_mis AND name = 'Hidroterapia';

  INSERT INTO partner_group
    (organization_id, partner_id, name, participant_count, brings_own_instructor, own_instructor_name)
  SELECT v_org, v_andebol, 'Sub-16', 18, true, 'Pedro Sousa'
   WHERE NOT EXISTS (SELECT 1 FROM partner_group WHERE partner_id = v_andebol AND name = 'Sub-16');
  SELECT id INTO v_sub16 FROM partner_group WHERE partner_id = v_andebol AND name = 'Sub-16';

  -- -------------------------------------------------------------- bookings
  --
  -- Real slots, real lanes, so the grid has something to draw. `instructor_status`
  -- is `external` wherever the group brings its own teacher — which is what keeps
  -- it out of POOLSE-53's "sem professor" alerts.

  -- 6A, Monday 09:30, lanes 1-3. The three-lane span, so the block spanning
  -- rows is visible on the first screen somebody opens.
  IF v_slot_0930 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM class_schedule WHERE partner_group_id = v_6a AND weekday = 1
  ) THEN
    INSERT INTO class_schedule
      (organization_id, facility_id, subject_type, partner_group_id, season_id, slot_id,
       instructor_status, weekday, start_time, duration_minutes)
    VALUES (v_org, v_facility, 'parceria', v_6a, v_season, v_slot_0930,
            'external', 1, '09:30', 45)
    RETURNING id INTO v_booking;

    INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
    VALUES (v_org, v_booking, v_lane1), (v_org, v_booking, v_lane2), (v_org, v_booking, v_lane3);
  END IF;

  -- 6B, Monday 10:15, lane 4. Beside 6A rather than under it.
  IF v_slot_1015 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM class_schedule WHERE partner_group_id = v_6b AND weekday = 1
  ) THEN
    INSERT INTO class_schedule
      (organization_id, facility_id, subject_type, partner_group_id, season_id, slot_id,
       instructor_status, weekday, start_time, duration_minutes)
    VALUES (v_org, v_facility, 'parceria', v_6b, v_season, v_slot_1015,
            'to_define', 1, '10:15', 45)
    RETURNING id INTO v_booking;

    INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
    VALUES (v_org, v_booking, v_lane4);
  END IF;

  -- Hidroterapia, Wednesday 11:00, lane 1.
  IF v_slot_1100 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM class_schedule WHERE partner_group_id = v_hidro AND weekday = 3
  ) THEN
    INSERT INTO class_schedule
      (organization_id, facility_id, subject_type, partner_group_id, season_id, slot_id,
       instructor_status, weekday, start_time, duration_minutes)
    VALUES (v_org, v_facility, 'parceria', v_hidro, v_season, v_slot_1100,
            'to_define', 3, '11:00', 45)
    RETURNING id INTO v_booking;

    INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
    VALUES (v_org, v_booking, v_lane1);
  END IF;

  -- Sub-16, Friday 19:15, lanes 5-6. (Tuesday is closed at this club.) In the evening, where the turmas are, so
  -- the two subject types share a slot on screen.
  IF v_slot_1915 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM class_schedule WHERE partner_group_id = v_sub16 AND weekday = 5
  ) THEN
    INSERT INTO class_schedule
      (organization_id, facility_id, subject_type, partner_group_id, season_id, slot_id,
       instructor_status, weekday, start_time, duration_minutes)
    VALUES (v_org, v_facility, 'parceria', v_sub16, v_season, v_slot_1915,
            'external', 5, '19:15', 45)
    RETURNING id INTO v_booking;

    INSERT INTO booking_lane (organization_id, schedule_id, lane_id)
    SELECT v_org, v_booking, l.id FROM lane l
     WHERE l.pool_id = v_pool AND l.position IN (5, 6);
  END IF;

  RAISE NOTICE 'Seeded three parcerias, five groups and four bookings.';
END $$;

COMMIT;
