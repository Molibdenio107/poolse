-- Up Migration

-- Sweep of 27-10-2026, POOLSE-116: the feedback window counts from the day the
-- lesson happened, not from `occurs_on`.
--
-- `occurs_on` is the pattern's day, fixed at generation, and a one-week move
-- never changes it (1788004800000_move-one-occurrence). A Monday lesson moved
-- to the Wednesday of the following week therefore had its window close two
-- days before it was taught. Before the lesson the trigger answered "too
-- early", and after it "window closed", so nobody could ever answer. The day
-- a lesson happened is `session_local_date()`, the site's clock on `starts_at`,
-- and `lesson_feedback_closes_on()` is now the one definition of the last day,
-- read by this trigger and by the API alike.

CREATE FUNCTION lesson_feedback_closes_on(p_organization_id uuid, p_pool_id uuid, p_starts_at timestamptz)
RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT session_local_date(p_organization_id, p_pool_id, p_starts_at) + lesson_feedback_window()
$$;

COMMENT ON FUNCTION lesson_feedback_closes_on(uuid, uuid, timestamptz) IS
  'POOLSE-116: the last day a lesson''s feedback may be written: the day it happened on the '
  'site''s clock, plus lesson_feedback_window(). Never occurs_on, which a move does not change.';

CREATE OR REPLACE FUNCTION lesson_feedback_admissible() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status text;
  v_ends   timestamptz;
  v_closes date;
  v_mark   text;
BEGIN
  IF NEW.anonymised_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.mood = OLD.mood
     AND NEW.comment IS NOT DISTINCT FROM OLD.comment
     AND NEW.class_session_id = OLD.class_session_id
     AND NEW.student_id = OLD.student_id THEN
    RETURN NEW;
  END IF;

  SELECT cs.status::text, cs.ends_at, lesson_feedback_closes_on(cs.organization_id, cs.pool_id, cs.starts_at)
    INTO v_status, v_ends, v_closes
    FROM class_session cs
   WHERE cs.id = NEW.class_session_id AND cs.organization_id = NEW.organization_id;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Feedback on a cancelled lesson'
      USING ERRCODE = 'check_violation', DETAIL = 'feedback_cancelled';
  END IF;
  IF v_ends > now() THEN
    RAISE EXCEPTION 'Feedback before the lesson has ended'
      USING ERRCODE = 'check_violation',
            DETAIL = format('feedback_too_early|%s', to_char(v_ends AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  END IF;

  SELECT a.status::text INTO v_mark
    FROM attendance a
   WHERE a.organization_id = NEW.organization_id
     AND a.class_session_id = NEW.class_session_id
     AND a.student_id = NEW.student_id;
  IF v_mark IS DISTINCT FROM 'present' THEN
    RAISE EXCEPTION 'Feedback for a student not marked present'
      USING ERRCODE = 'check_violation',
            DETAIL = format('feedback_not_present|%s', coalesce(v_mark, 'none'));
  END IF;

  IF club_today() > v_closes THEN
    RAISE EXCEPTION 'The feedback window has closed'
      USING ERRCODE = 'check_violation',
            DETAIL = format('feedback_window_closed|%s', to_char(v_closes, 'YYYY-MM-DD'));
  END IF;
  RETURN NEW;
END;
$fn$;

-- Down Migration

CREATE OR REPLACE FUNCTION lesson_feedback_admissible() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_status text;
  v_ends   timestamptz;
  v_on     date;
  v_mark   text;
BEGIN
  IF NEW.anonymised_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.mood = OLD.mood
     AND NEW.comment IS NOT DISTINCT FROM OLD.comment
     AND NEW.class_session_id = OLD.class_session_id
     AND NEW.student_id = OLD.student_id THEN
    RETURN NEW;
  END IF;

  SELECT cs.status::text, cs.ends_at, cs.occurs_on INTO v_status, v_ends, v_on
    FROM class_session cs
   WHERE cs.id = NEW.class_session_id AND cs.organization_id = NEW.organization_id;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'Feedback on a cancelled lesson'
      USING ERRCODE = 'check_violation', DETAIL = 'feedback_cancelled';
  END IF;
  IF v_ends > now() THEN
    RAISE EXCEPTION 'Feedback before the lesson has ended'
      USING ERRCODE = 'check_violation',
            DETAIL = format('feedback_too_early|%s', to_char(v_ends AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  END IF;

  SELECT a.status::text INTO v_mark
    FROM attendance a
   WHERE a.organization_id = NEW.organization_id
     AND a.class_session_id = NEW.class_session_id
     AND a.student_id = NEW.student_id;
  IF v_mark IS DISTINCT FROM 'present' THEN
    RAISE EXCEPTION 'Feedback for a student not marked present'
      USING ERRCODE = 'check_violation',
            DETAIL = format('feedback_not_present|%s', coalesce(v_mark, 'none'));
  END IF;

  IF club_today() > v_on + lesson_feedback_window() THEN
    RAISE EXCEPTION 'The feedback window has closed'
      USING ERRCODE = 'check_violation',
            DETAIL = format('feedback_window_closed|%s', to_char(v_on + lesson_feedback_window(), 'YYYY-MM-DD'));
  END IF;
  RETURN NEW;
END;
$fn$;

DROP FUNCTION IF EXISTS lesson_feedback_closes_on(uuid, uuid, timestamptz);
