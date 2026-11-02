-- Up Migration

-- ---------------------------------------------------------------------------
-- A lesson can be cancelled until it ends, marks or not (Rui, 02-11-2026).
--
-- `refuse_cancelling_marked_session` (1787860800000) refused cancelling any
-- lesson with a row in `attendance`, at any time. Rui's rule: a lesson that is
-- still running may be called off "anyway, until the end of the class" — the
-- pool fouled, a storm — and the marks already taken are kept, because the
-- swimmers were there. Once it has ended, a marked lesson is a record and
-- nobody cancels it.
--
-- So the refusal now needs both: marked, and already ended (`now() >=
-- ends_at`, the lesson as it stood — OLD, because this trigger runs before the
-- one that re-derives `ends_at`). The role half of the rule (after the end only
-- an owner or an admin may cancel, and only an unmarked lesson) is the API's.
--
-- Closures (`apply_closures`) and "every future week" skip marked lessons
-- themselves, so neither changes. Restoring is still unaffected.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refuse_cancelling_marked_session() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND now() >= OLD.ends_at THEN
    IF EXISTS (
      SELECT 1 FROM attendance a
       WHERE a.class_session_id = NEW.id
         AND a.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'Attendance has been recorded for this class'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION refuse_cancelling_marked_session() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    IF EXISTS (
      SELECT 1 FROM attendance a
       WHERE a.class_session_id = NEW.id
         AND a.organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'Attendance has been recorded for this class'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
