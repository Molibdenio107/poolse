-- "Sem professor" is a state, not a blank — POOLSE-53.
--
-- Everything here is one assertion in six parts: **`to_define` and `uncovered`
-- are never converted into one another by the system.** They are the same
-- absence of data and opposite claims about the club — "we have not decided"
-- against "nobody is covering this" — and the single way to get this ticket
-- wrong is to compute one of them from a null instructor. Then a manager reading
-- "7 aulas sem professor" is reading a number that includes six they already
-- knew about and had not yet staffed, and the counter stops being worth looking
-- at in its first week.
--
-- So the state machine is asserted from all three directions the instructor can
-- change from — the booking's own override, the turma's instructor, and the
-- partner group's own teacher — because a rule that lives in one repository
-- method is a rule the other two paths do not have.
--
-- Test 4 is the one that matters most: an operator escalates a booking to
-- `uncovered`, something unrelated is saved on it, and it is still `uncovered`.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_i', 'i@clube.pt', 'Sandra', 'Lopes', NULL, '2026-09-01 09:00:00+00');

INSERT INTO organization (id, name, slug) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Clube Estado', 'clube-estado');

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_season uuid;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';

  INSERT INTO facility (organization_id, name) VALUES (v_org, 'Piscina Municipal')
  RETURNING id INTO v_facility;

  INSERT INTO pool (organization_id, facility_id, name) VALUES (v_org, v_facility, 'Tanque Grande')
  RETURNING id INTO v_pool;

  INSERT INTO season (organization_id, name, starts_on, ends_on, status)
  VALUES (v_org, '2026/2027', '2026-09-01', '2027-08-31', 'published')
  RETURNING id INTO v_season;

  INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
  VALUES (v_org, v_season, v_facility, 'Absolutos', v_pool),
         (v_org, v_season, v_facility, 'Cadetes', v_pool);

  -- Sandra, who will be assigned and then taken away again.
  INSERT INTO membership (organization_id, app_user_id, status)
  SELECT v_org, id, 'active' FROM app_user WHERE clerk_user_id = 'user_i';
END $$;

-- ---------------------------------------------------------------------------
-- Test 1 — a new booking with nobody on it is `to_define`, never `uncovered`
--
-- 53.4. The column default used to be `assigned`, which claims a fact about a
-- booking nobody has staffed. "We have not decided yet" is the honest reading of
-- a brand-new row; "this is uncovered" is an accusation, and the system is not
-- entitled to make it on the club's behalf.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_facility uuid; v_group uuid; v_state instructor_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';

  INSERT INTO class_schedule
    (organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_group, v_facility, 2, TIME '19:15', 45)
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'to_define' THEN
    RAISE EXCEPTION 'FAIL test 1a: a booking with no instructor arrived as %', v_state;
  END IF;

  -- And an insert that claims `assigned` while naming nobody is corrected rather
  -- than believed. The grid would otherwise print a blank line where a name goes.
  INSERT INTO class_schedule
    (organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes,
     instructor_status)
  VALUES (v_org, v_group, v_facility, 4, TIME '19:15', 45, 'assigned')
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'to_define' THEN
    RAISE EXCEPTION 'FAIL test 1b: an unstaffed booking was allowed to claim %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 1: an unstaffed booking is to_define';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — assigning sets `assigned`, from either direction
--
-- 53.5. The booking's own override and the turma's instructor are both ways of
-- putting somebody in the water, and the state machine has to see both. The
-- override wins where they disagree, which is the same precedence the grid reads
-- with — a substitute on a Tuesday shows as the substitute.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_group uuid; v_cadetes uuid;
  v_sandra uuid; v_state instructor_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_group   FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';
  SELECT id INTO v_cadetes FROM class_group WHERE organization_id = v_org AND name = 'Cadetes';
  SELECT id INTO v_sandra  FROM membership  WHERE organization_id = v_org;

  -- The booking's own override.
  UPDATE class_schedule SET instructor_membership_id = v_sandra
   WHERE organization_id = v_org AND class_group_id = v_group AND weekday = 2
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'assigned' THEN
    RAISE EXCEPTION 'FAIL test 2a: assigning an instructor left the booking %', v_state;
  END IF;

  -- The turma's own instructor, reaching a booking that carries no override.
  -- The booking already exists and is `to_define`; giving the turma somebody has
  -- to reach down and correct it, or a club that staffs a turma still reads
  -- "sem professor" on every one of its classes.
  INSERT INTO class_schedule
    (organization_id, class_group_id, facility_id, weekday, start_time, duration_minutes)
  VALUES (v_org, v_cadetes, v_facility, 3, TIME '18:00', 45);

  UPDATE class_group SET instructor_membership_id = v_sandra WHERE id = v_cadetes;

  SELECT instructor_status INTO v_state
    FROM class_schedule
   WHERE organization_id = v_org AND class_group_id = v_cadetes AND weekday = 3;

  IF v_state <> 'assigned' THEN
    RAISE EXCEPTION 'FAIL test 2b: staffing the turma left its booking %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 2: an instructor from either direction sets assigned';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — removing an instructor returns to `to_define`, not `uncovered`
--
-- 53.6, and criterion 3. Somebody leaving is not the same event as the club
-- deciding a slot is a problem. The system takes the booking back to "not
-- decided" and waits for a person to say the other thing.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_group uuid; v_cadetes uuid; v_state instructor_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_group   FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';
  SELECT id INTO v_cadetes FROM class_group WHERE organization_id = v_org AND name = 'Cadetes';

  UPDATE class_schedule SET instructor_membership_id = NULL
   WHERE organization_id = v_org AND class_group_id = v_group AND weekday = 2
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'to_define' THEN
    RAISE EXCEPTION 'FAIL test 3a: removing the booking''s instructor left it %', v_state;
  END IF;

  -- And the same when the turma loses its instructor.
  UPDATE class_group SET instructor_membership_id = NULL WHERE id = v_cadetes;

  SELECT instructor_status INTO v_state
    FROM class_schedule
   WHERE organization_id = v_org AND class_group_id = v_cadetes AND weekday = 3;

  IF v_state <> 'to_define' THEN
    RAISE EXCEPTION 'FAIL test 3b: unstaffing the turma left its booking %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 3: removing an instructor returns to to_define';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — `uncovered` is the operator's, and survives everything else
--
-- 53.7, and the reason this file exists. The escalation is a judgement somebody
-- made; a save on an unrelated field must not quietly undo it, or the club
-- learns that marking a problem does not stick and goes back to the printout.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_state instructor_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_group FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';

  UPDATE class_schedule SET instructor_status = 'uncovered'
   WHERE organization_id = v_org AND class_group_id = v_group AND weekday = 2;

  -- Something else entirely is saved on the booking.
  UPDATE class_schedule SET notes = 'Falar com a Sandra'
   WHERE organization_id = v_org AND class_group_id = v_group AND weekday = 2
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'uncovered' THEN
    RAISE EXCEPTION 'FAIL test 4a: an unrelated save turned uncovered into %', v_state;
  END IF;

  -- Moving it does not soften it either. A drag across the grid is the commonest
  -- write there is, and it must not launder a problem into "not decided".
  UPDATE class_schedule SET weekday = 4, start_time = TIME '20:00'
   WHERE organization_id = v_org AND class_group_id = v_group AND weekday = 2
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'uncovered' THEN
    RAISE EXCEPTION 'FAIL test 4b: moving the booking turned uncovered into %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 4: uncovered is the operator''s and stays put';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — assigning somebody clears an escalation, and only that
--
-- The one automatic transition the ticket allows: `uncovered` -> `assigned`,
-- because a booking with somebody teaching it is not uncovered by any reading.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_org uuid; v_group uuid; v_sandra uuid; v_state instructor_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_group  FROM class_group WHERE organization_id = v_org AND name = 'Absolutos';
  SELECT id INTO v_sandra FROM membership  WHERE organization_id = v_org;

  UPDATE class_schedule SET instructor_membership_id = v_sandra
   WHERE organization_id = v_org AND class_group_id = v_group AND weekday = 4
     AND start_time = TIME '20:00'
  RETURNING instructor_status INTO v_state;

  IF v_state <> 'assigned' THEN
    RAISE EXCEPTION 'FAIL test 5: staffing an uncovered booking left it %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 5: staffing an uncovered booking clears the alert';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6 — `external` follows the partner group's own teacher
--
-- 53.8 and criterion 7. The school brings somebody; that is not the club's gap
-- and must never appear in the counter. `brings_own_instructor` is the column
-- the parcerias migration already said decides this, so it decides it — a club
-- that ticks the box on an existing group gets its grid corrected instead of
-- keeping a stale alert on four bookings.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_season uuid;
  v_partner uuid; v_group uuid; v_state instructor_status;
BEGIN
  v_org := '99999999-9999-9999-9999-999999999999';
  SELECT id INTO v_facility FROM facility WHERE organization_id = v_org;
  SELECT id INTO v_season   FROM season   WHERE organization_id = v_org;

  INSERT INTO partner (organization_id, facility_id, name, type)
  VALUES (v_org, v_facility, 'ES D. Dinis', 'escola')
  RETURNING id INTO v_partner;

  INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
  VALUES (v_org, v_partner, '6B', 22)
  RETURNING id INTO v_group;

  INSERT INTO class_schedule
    (organization_id, facility_id, subject_type, partner_group_id, season_id,
     weekday, start_time, duration_minutes)
  VALUES (v_org, v_facility, 'parceria', v_group, v_season, 1, TIME '10:15', 45)
  RETURNING instructor_status INTO v_state;

  -- No own teacher yet, so it is the club's slot to staff like any other.
  IF v_state <> 'to_define' THEN
    RAISE EXCEPTION 'FAIL test 6a: a parceria with no teacher arrived as %', v_state;
  END IF;

  UPDATE partner_group
     SET brings_own_instructor = true, own_instructor_name = 'Prof. Silva'
   WHERE id = v_group;

  SELECT instructor_status INTO v_state
    FROM class_schedule WHERE organization_id = v_org AND partner_group_id = v_group;

  IF v_state <> 'external' THEN
    RAISE EXCEPTION 'FAIL test 6b: the group brought a teacher and the booking is %', v_state;
  END IF;

  -- And the school withdraws them again. Back to the club's problem, and to
  -- `to_define` rather than to an accusation nobody made.
  UPDATE partner_group
     SET brings_own_instructor = false, own_instructor_name = NULL
   WHERE id = v_group;

  SELECT instructor_status INTO v_state
    FROM class_schedule WHERE organization_id = v_org AND partner_group_id = v_group;

  IF v_state <> 'to_define' THEN
    RAISE EXCEPTION 'FAIL test 6c: the teacher was withdrawn and the booking is %', v_state;
  END IF;

  RAISE NOTICE 'PASS test 6: external follows the partner group, both ways';
END $$;

ROLLBACK;
