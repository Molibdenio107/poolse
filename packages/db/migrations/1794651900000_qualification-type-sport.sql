-- Up Migration

-- POOLSE-146 slice b — a qualification type says which sport it is for (Rui,
-- 01-11-2026): "a TPTD for swimming is not a tennis coaching licence", so a
-- required type is *em falta* only for an instructor of its sport.
--
-- **`qualification_type.sport_id`**, a plain FK to the platform's `sport`
-- catalogue; null is every sport.
--
-- **`qualification_applies(type sport, sports)`** is the one definition — a type
-- with no sport, or one of the person's (or the turma's) sports. Read by the
-- *em falta* lists, the alert job and the assignment block, not by
-- `qualification_status()`: that function judges an expiry date and knows no
-- person, so the ticket's "put it there" had nowhere to stand.
--
-- **Backfill**: the seeded TPTD (by its exact seeded name — there is no key) and
-- ISN (`counts_as_lifeguard`) are swimming's; SBV, first aid, stays every
-- sport's (the ticket's default). Every person is `{pool}` (POOLSE-145), so in a
-- pool-only club every status is what it was (rule 6). A club that renamed its
-- TPTD keeps it for every sport, which changes nothing for it either.
--
-- **The assignment block** (`blocks_assignment`) now asks the turma's sport, so
-- an expired swimming title never refuses a tennis turma's instructor.

ALTER TABLE qualification_type ADD COLUMN sport_id text REFERENCES sport (id);

COMMENT ON COLUMN qualification_type.sport_id IS
  'POOLSE-146: the sport this qualification is for; null is every sport. A required type is em falta '
  'only for an instructor of its sport, and blocks only that sport''s turmas.';

UPDATE qualification_type SET sport_id = 'pool'
 WHERE name = 'TPTD — Título Profissional de Treinador de Desporto' OR counts_as_lifeguard;

CREATE FUNCTION qualification_applies(p_type_sport text, p_sports text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$ SELECT p_type_sport IS NULL OR p_type_sport = ANY (coalesce(p_sports, '{pool}')) $$;

COMMENT ON FUNCTION qualification_applies(text, text[]) IS
  'POOLSE-146: whether a qualification type concerns somebody in these sports — null is every sport.';

CREATE OR REPLACE FUNCTION public.seed_qualification_types(p_organization_id uuid)
 RETURNS void
 LANGUAGE sql
AS $function$
  INSERT INTO qualification_type
    (organization_id, name, default_validity_months, required_to_teach, counts_as_lifeguard, sport_id)
  VALUES (p_organization_id, 'TPTD — Título Profissional de Treinador de Desporto', 60, true, false, 'pool'),
         (p_organization_id, 'Nadador-salvador (ISN)', NULL, false, true, 'pool'),
         (p_organization_id, 'SBV — Suporte Básico de Vida', NULL, false, false, NULL)
$function$;

CREATE OR REPLACE FUNCTION public.qualification_assignment_allowed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_type    text;
  v_expired date;
  v_sport   text;
  v_group   uuid;
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

  -- POOLSE-146: the turma's sport (its recinto's, swimming without one) — a
  -- swimming title never blocks a tennis turma. Each table's own field, by IF:
  -- a CASE naming NEW.class_group_id fails on class_group even untaken.
  IF TG_TABLE_NAME = 'class_group' THEN
    v_group := NEW.id;
  ELSE
    v_group := NEW.class_group_id;
  END IF;
  SELECT coalesce(pa.sport_id, 'pool') INTO v_sport
    FROM class_group cg
    LEFT JOIN playing_area pa ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
   WHERE cg.organization_id = NEW.organization_id
     AND cg.id = v_group;

  SELECT t.name, c.expires_on INTO v_type, v_expired
    FROM qualification_current c
    JOIN qualification_type t
      ON t.id = c.qualification_type_id AND t.organization_id = c.organization_id
   WHERE c.organization_id = NEW.organization_id
     AND c.membership_id = NEW.instructor_membership_id
     AND t.blocks_assignment
     AND public.qualification_applies(t.sport_id, ARRAY[coalesce(v_sport, 'pool')])
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

CREATE OR REPLACE FUNCTION public.qualification_assignment_allowed()
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

CREATE OR REPLACE FUNCTION public.seed_qualification_types(p_organization_id uuid)
 RETURNS void
 LANGUAGE sql
AS $function$
  INSERT INTO qualification_type
    (organization_id, name, default_validity_months, required_to_teach, counts_as_lifeguard)
  VALUES (p_organization_id, 'TPTD — Título Profissional de Treinador de Desporto', 60, true, false),
         (p_organization_id, 'Nadador-salvador (ISN)', NULL, false, true),
         (p_organization_id, 'SBV — Suporte Básico de Vida', NULL, false, false)
$function$;

DROP FUNCTION IF EXISTS qualification_applies(text, text[]);
ALTER TABLE qualification_type DROP COLUMN IF EXISTS sport_id;
