-- Up Migration
--
-- Sweep of 20-10-2026 — POOLSE-87, after review.
--
-- A club with **qualifications** switched off can no longer see or change a
-- qualification type or record, so a `blocks_assignment` type it set up before
-- must not go on refusing instructor assignments on core screens (turmas, the
-- calendar) with a reason the club cannot reach. Switching the module off hides
-- and refuses; it never leaves a rule standing that nobody can see. Switching it
-- back on restores the block, because the types and records were never touched.
--
-- Runs as the caller, like before: `organization` is readable under the
-- caller's own policy, and the row is the trigger's own club.

CREATE OR REPLACE FUNCTION qualification_assignment_allowed()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_type    text;
  v_expired date;
BEGIN
  IF NEW.instructor_membership_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only a *new* assignment. Saving a turma for another reason must never start
  -- refusing because a certificate lapsed since it was assigned.
  IF TG_OP = 'UPDATE' AND NEW.instructor_membership_id IS NOT DISTINCT FROM OLD.instructor_membership_id THEN
    RETURN NEW;
  END IF;
  -- POOLSE-87: the module is off, so the rule is hidden with it.
  IF EXISTS (
    SELECT 1 FROM organization o
     WHERE o.id = NEW.organization_id
       AND 'qualifications' = ANY (o.disabled_modules)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT t.name, c.expires_on INTO v_type, v_expired
    FROM qualification_current c
    JOIN qualification_type t
      ON t.id = c.qualification_type_id AND t.organization_id = c.organization_id
   WHERE c.organization_id = NEW.organization_id
     AND c.membership_id = NEW.instructor_membership_id
     AND t.blocks_assignment
     AND c.status = 'red'
   ORDER BY c.expires_on
   LIMIT 1;

  IF v_type IS NOT NULL THEN
    RAISE EXCEPTION 'Instructor % holds an expired %', NEW.instructor_membership_id, v_type
      USING ERRCODE = 'check_violation',
            DETAIL = format('qualification_blocked|%s|%s', v_type, v_expired);
  END IF;
  RETURN NEW;
END;
$function$;

-- Down Migration

CREATE OR REPLACE FUNCTION qualification_assignment_allowed()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_type    text;
  v_expired date;
BEGIN
  IF NEW.instructor_membership_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only a *new* assignment. Saving a turma for another reason must never start
  -- refusing because a certificate lapsed since it was assigned.
  IF TG_OP = 'UPDATE' AND NEW.instructor_membership_id IS NOT DISTINCT FROM OLD.instructor_membership_id THEN
    RETURN NEW;
  END IF;

  SELECT t.name, c.expires_on INTO v_type, v_expired
    FROM qualification_current c
    JOIN qualification_type t
      ON t.id = c.qualification_type_id AND t.organization_id = c.organization_id
   WHERE c.organization_id = NEW.organization_id
     AND c.membership_id = NEW.instructor_membership_id
     AND t.blocks_assignment
     AND c.status = 'red'
   ORDER BY c.expires_on
   LIMIT 1;

  IF v_type IS NOT NULL THEN
    RAISE EXCEPTION 'Instructor % holds an expired %', NEW.instructor_membership_id, v_type
      USING ERRCODE = 'check_violation',
            DETAIL = format('qualification_blocked|%s|%s', v_type, v_expired);
  END IF;
  RETURN NEW;
END;
$function$;
