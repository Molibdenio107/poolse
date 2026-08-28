-- Redeeming a reposição — POOLSE-21, slice 2.
--
-- Slice 1 made the credit: minted by a trigger on the mark, expiring in the
-- club's calendar, visible on the student's record. This spends it.
--
-- **The conflict the ticket flags, and how it is resolved here.** Criterion 3
-- wants an *open seat*; criterion 4 offers a rule that a reposição may only go
-- into a slot another student has vacated. Read naively those are mutually
-- exclusive — a full turma with one absence has no open seat, so backfill-only
-- could never fire on the very occurrence it exists for. The ticket decides it,
-- and this implements that decision:
--
--   for reposição purposes, an occurrence's capacity is
--   **enrolled minus the absences recorded on that occurrence**
--
-- So one absence on a full turma frees exactly one place, for that date only,
-- and both filters hold at once.
--
-- That rule is `session_free_seats()`. The ticket calls the shared eligibility
-- helper "the single most important piece of shared logic", because the roster
-- view and POOLSE-19's proposals will need the same number and a second
-- implementation is how a turma quietly goes one over.

-- Up Migration

-- ---------------------------------------------------------------------------
-- How long a pending request holds a seat
--
-- The ticket asks for a timeout so an abandoned request does not block a slot
-- indefinitely, without naming one. **48 hours**, and it is a column rather than
-- a constant precisely because it is a guess: a club that finds two days too
-- slow changes a number instead of waiting for a deploy.
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN reposicao_hold_hours smallint NOT NULL DEFAULT 48;

ALTER TABLE organization
  ADD CONSTRAINT organization_reposicao_hold_sane
    CHECK (reposicao_hold_hours BETWEEN 1 AND 720);

COMMENT ON COLUMN organization.reposicao_hold_hours IS
  'How long an unanswered reposição request holds its seat — POOLSE-21. A guess '
  'with a default of 48, made changeable rather than compiled in.';

-- ---------------------------------------------------------------------------
-- reposicao_booking
--
-- `pending` is only reachable in request mode; self-service goes straight to
-- `confirmed`. Both hold a seat — that is the point of `pending` rather than
-- "ask and hope" — and `holds_until` is what stops an unanswered request holding
-- one forever.
-- ---------------------------------------------------------------------------

CREATE TYPE reposicao_booking_status AS ENUM
  ('pending', 'confirmed', 'rejected', 'cancelled');

CREATE TABLE reposicao_booking (
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization (id),
  credit_id                 uuid NOT NULL,
  class_session_id          uuid NOT NULL,

  status                    reposicao_booking_status NOT NULL DEFAULT 'pending',

  requested_by_membership_id uuid,
  requested_at              timestamptz NOT NULL DEFAULT now(),
  /* Null once answered. A pending row past this is not holding anything — see
   * release_expired_reposicao_holds(). */
  holds_until               timestamptz,

  decided_by_membership_id  uuid,
  decided_at                timestamptz,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, credit_id)
    REFERENCES reposicao_credit (organization_id, id),
  FOREIGN KEY (organization_id, class_session_id)
    REFERENCES class_session (organization_id, id),
  FOREIGN KEY (organization_id, requested_by_membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, decided_by_membership_id)
    REFERENCES membership (organization_id, id),

  /*
   * Naming a decider without saying when is nonsense; the reverse is not.
   *
   * A hold that lapses is decided by **nobody** — no human answered, a scheduled
   * sweep noticed the time had passed. That is the same "the system did this on
   * nobody's behalf" case `audit_log.actor_membership_id` is nullable for, and
   * inventing a membership to satisfy a stricter constraint would be a lie
   * recorded permanently. So this guards the half that is always wrong.
   */
  CHECK (decided_by_membership_id IS NULL OR decided_at IS NOT NULL),
  CHECK (status IN ('pending', 'confirmed') OR decided_at IS NOT NULL),
  -- Only a pending booking holds a seat on a timer.
  CHECK (status = 'pending' OR holds_until IS NULL)
);

/*
 * One live booking per credit.
 *
 * The guarantee behind "a credit is spent once". Partial on the live statuses
 * rather than on `archived_at`, because a rejected or cancelled booking stays
 * readable — "we asked for the Tuesday and were turned down" is history worth
 * keeping — while leaving the credit free to be booked again.
 */
CREATE UNIQUE INDEX reposicao_booking_one_live
  ON reposicao_booking (credit_id)
  WHERE status IN ('pending', 'confirmed') AND archived_at IS NULL;

-- "Who is coming to this occurrence as a guest", which is the roster read.
CREATE INDEX reposicao_booking_session_idx
  ON reposicao_booking (organization_id, class_session_id, status)
  WHERE archived_at IS NULL;

-- The sweep for holds that have run out.
CREATE INDEX reposicao_booking_holds_idx
  ON reposicao_booking (organization_id, holds_until)
  WHERE status = 'pending' AND archived_at IS NULL;

CREATE TRIGGER reposicao_booking_updated_at BEFORE UPDATE ON reposicao_booking
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE reposicao_booking ENABLE ROW LEVEL SECURITY;
CREATE POLICY reposicao_booking_tenant ON reposicao_booking
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON reposicao_booking TO poolse_app;

-- ---------------------------------------------------------------------------
-- age_in_months — the age rule, in SQL
--
-- The eligibility filter has to ask "is this child inside the level's age range
-- *on the day of that class*", and it has to ask it in SQL because the answer
-- decides which rows come back.
--
-- `apps/web/src/lib/ages.ts` carries the same rule for the browser. Two copies
-- is one more than anybody wants, and the alternative — shipping every candidate
-- occurrence to Node and filtering there — would defeat the point of filtering.
-- They agree on the definition that matters: **whole months lived**, so a child
-- born on the 20th is not a month older on the 19th, which is exactly what
-- `age()` computes.
--
-- IMMUTABLE, so it can be used in an index later if a level filter ever needs one.
-- ---------------------------------------------------------------------------

CREATE FUNCTION age_in_months(p_birth_date date, p_on date) RETURNS integer
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT (extract(YEAR FROM age(p_on, p_birth_date)) * 12
        + extract(MONTH FROM age(p_on, p_birth_date)))::int;
$fn$;

COMMENT ON FUNCTION age_in_months(date, date) IS
  'Whole months lived on a given day — POOLSE-21, mirroring ageInMonths in '
  'apps/web/src/lib/ages.ts. Used by the reposição eligibility filter.';

-- ---------------------------------------------------------------------------
-- session_free_seats — the shared helper
--
-- **Enrolled minus recorded absences, minus reposição guests already coming.**
--
-- The middle term is what resolves criterion 3 against criterion 4: a student
-- marked absent on this date is not in the water on this date, so their place is
-- free *for this occurrence only*. Nothing about their enrolment changes.
--
-- The third term is what stops two families booking the last place. It counts
-- pending as well as confirmed, because a pending request holds its seat — a
-- hold that could be gazumped would not be a hold.
--
-- Null capacity means the turma has no limit, and this returns NULL rather than
-- a number. Callers test `> 0` and a NULL comparison is not true, so `coalesce`
-- at the call site is deliberate and visible rather than a silent zero here.
--
-- STABLE, not IMMUTABLE: it reads tables. It is therefore not indexable, which
-- is fine — it is evaluated over the handful of occurrences in a redemption
-- window, never over the whole session table.
-- ---------------------------------------------------------------------------

CREATE FUNCTION session_free_seats(p_session_id uuid) RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  SELECT cg.capacity
         - (
             SELECT count(*)
               FROM enrollment e
              WHERE e.class_group_id = cs.class_group_id
                AND e.organization_id = cs.organization_id
                AND e.status = 'active'
           )
         + (
             -- Absences recorded on this occurrence give their place back for
             -- this date. Only for students actually enrolled, so a guest marked
             -- absent cannot free a seat they never occupied.
             SELECT count(*)
               FROM attendance a
               JOIN enrollment e
                 ON e.student_id = a.student_id
                AND e.class_group_id = cs.class_group_id
                AND e.organization_id = a.organization_id
                AND e.status = 'active'
              WHERE a.class_session_id = cs.id
                AND a.organization_id = cs.organization_id
                AND a.status IN ('absent', 'excused')
           )
         - (
             SELECT count(*)
               FROM reposicao_booking b
              WHERE b.class_session_id = cs.id
                AND b.organization_id = cs.organization_id
                AND b.status IN ('pending', 'confirmed')
                AND b.archived_at IS NULL
           )
    FROM class_session cs
    JOIN class_group cg
      ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
   WHERE cs.id = p_session_id;
$fn$;

COMMENT ON FUNCTION session_free_seats(uuid) IS
  'Places open on one occurrence: enrolled, minus absences recorded on that date, '
  'minus reposição guests already booked — POOLSE-21. Null when the turma has no '
  'capacity set. The roster view and POOLSE-19 must use this and not recount.';

-- ---------------------------------------------------------------------------
-- Releasing a hold nobody answered
--
-- Idempotent and safe to re-run, like the expiry job it sits beside. A released
-- hold returns the credit to `available` — the family asked, nobody answered,
-- and they should not lose the class over it.
-- ---------------------------------------------------------------------------

CREATE FUNCTION release_expired_reposicao_holds(p_organization_id uuid, p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_released int;
BEGIN
  WITH lapsed AS (
    UPDATE reposicao_booking
       SET status = 'cancelled',
           holds_until = NULL,
           decided_at = p_now,
           decided_by_membership_id = NULL
     WHERE organization_id = p_organization_id
       AND status = 'pending'
       AND archived_at IS NULL
       AND holds_until IS NOT NULL
       AND holds_until < p_now
    RETURNING id, credit_id, class_session_id
  ),
  freed AS (
    UPDATE reposicao_credit c
       SET status = 'available'
      FROM lapsed
     WHERE c.id = lapsed.credit_id AND c.status = 'booked'
    RETURNING c.id
  ),
  logged AS (
    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT p_organization_id, 'reposicao.hold_released', 'reposicao_booking',
           lapsed.id,
           jsonb_build_object('creditId', lapsed.credit_id,
                              'classSessionId', lapsed.class_session_id)
      FROM lapsed
    RETURNING 1
  )
  SELECT count(*)::int INTO v_released FROM logged;

  RETURN v_released;
END;
$fn$;

COMMENT ON FUNCTION release_expired_reposicao_holds(uuid, timestamptz) IS
  'Cancels pending reposição requests whose hold ran out and returns the credit '
  'to available — POOLSE-21. The family asked and nobody answered; they should '
  'not lose the class over it.';

REVOKE ALL ON FUNCTION release_expired_reposicao_holds(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION release_expired_reposicao_holds(uuid, timestamptz) TO poolse_app;

/*
 * The credit's status follows its booking, in the database.
 *
 * The alternative is two writes in the repository and a rule everybody has to
 * remember. This keeps `available / booked / used` true by construction, the
 * same argument as minting in slice 1.
 *
 * `used` is not set here: a booking becomes *used* when the occurrence has
 * happened, which is time passing rather than a row changing. The API sets it
 * when it marks the guest's attendance.
 */
CREATE FUNCTION reposicao_credit_follows_booking() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.status IN ('pending', 'confirmed') THEN
    UPDATE reposicao_credit SET status = 'booked'
     WHERE id = NEW.credit_id AND status = 'available';
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    UPDATE reposicao_credit SET status = 'available'
     WHERE id = NEW.credit_id AND status = 'booked';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER reposicao_booking_syncs_credit
  AFTER INSERT OR UPDATE OF status ON reposicao_booking
  FOR EACH ROW EXECUTE FUNCTION reposicao_credit_follows_booking();

-- ---------------------------------------------------------------------------
-- reposicao_options — where a credit can be spent
--
-- **A SQL function rather than a query string in the repository**, for the same
-- reason `merge_candidates` is one: it is the ticket's "single most important
-- piece of shared logic", the roster view and POOLSE-19's proposals will both
-- want it, and a rule that lives in one application file is a rule the next
-- caller reimplements slightly differently.
--
-- Being a function also makes it testable against a real database rather than
-- through three HTTP calls, which is where the interesting cases actually live —
-- a full turma with one absence, and a class one day past the expiry.
--
-- Every clause is one of criterion 3's filters, plus criterion 4's optional one.
-- ---------------------------------------------------------------------------

CREATE FUNCTION reposicao_options(p_credit_id uuid)
RETURNS TABLE (
  session_id     uuid,
  class_group_id uuid,
  class_name     text,
  level_name     text,
  pool_name      text,
  local_date     text,
  start_time     text,
  free_seats     integer
)
LANGUAGE sql STABLE
AS $fn$
  WITH credit AS (
    SELECT c.id, c.student_id, c.expires_on, c.status,
           s.birth_date, s.level_id,
           o.reposicao_backfill_only
      FROM reposicao_credit c
      JOIN student s      ON s.id = c.student_id AND s.organization_id = c.organization_id
      JOIN organization o ON o.id = c.organization_id
     WHERE c.id = p_credit_id AND c.archived_at IS NULL
  )
  SELECT cs.id AS session_id,
         cg.id AS class_group_id,
         cg.name AS class_name,
         l.name AS level_name,
         p.name AS pool_name,
         session_local_date(cs.organization_id, cs.pool_id, cs.starts_at)::text AS local_date,
         to_char(cs.starts_at, 'HH24:MI') AS start_time,
         session_free_seats(cs.id) AS free_seats
    FROM credit
    JOIN class_session cs ON cs.status = 'scheduled'
    JOIN class_group cg
      ON cg.id = cs.class_group_id
     AND cg.organization_id = cs.organization_id
     AND cg.archived_at IS NULL
    LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
    LEFT JOIN pool p         ON p.id = cs.pool_id  AND p.organization_id = cs.organization_id
   WHERE credit.status = 'available'
     /*
      * Ahead of us, and on or before the day the credit dies — QA 21.7.
      *
      * A closure or a feriado has already set the occurrence to 'cancelled'
      * (POOLSE-31), so the status test on the join is what excludes those. There
      * is no separate holiday clause here on purpose: two places deciding what a
      * closed day is would be two places to fix when the rule changes.
      */
     AND cs.starts_at > now()
     AND session_local_date(cs.organization_id, cs.pool_id, cs.starts_at) <= credit.expires_on
     -- The student's own level. A turma with no level set takes anybody.
     AND (cg.level_id IS NULL OR credit.level_id IS NULL OR cg.level_id = credit.level_id)
     -- Inside the level's age range, measured on the day of that class rather
     -- than today: a child who turns six next month is eligible for the class
     -- after their birthday and not the one before it.
     AND (
       credit.birth_date IS NULL
       OR (
         (l.min_age_months IS NULL OR
          age_in_months(credit.birth_date,
                        session_local_date(cs.organization_id, cs.pool_id, cs.starts_at))
            >= l.min_age_months)
         AND
         (l.max_age_months IS NULL OR
          age_in_months(credit.birth_date,
                        session_local_date(cs.organization_id, cs.pool_id, cs.starts_at))
            <= l.max_age_months)
       )
     )
     -- A place, by the shared rule. A turma with no capacity set is unlimited,
     -- which is why the coalesce is here and visible rather than inside the
     -- function pretending null means zero.
     AND coalesce(session_free_seats(cs.id), 1) > 0
     /*
      * Backfill-only — criterion 4. Offered only where somebody enrolled is
      * recorded absent on that date, so a reposição never adds a body the turma
      * did not already plan for.
      */
     AND (
       NOT credit.reposicao_backfill_only
       OR EXISTS (
         SELECT 1 FROM attendance a
          WHERE a.class_session_id = cs.id
            AND a.organization_id = cs.organization_id
            AND a.status IN ('absent', 'excused')
       )
     )
     -- Not a turma they are already in: they would be going anyway, and the
     -- credit would buy them nothing.
     AND NOT EXISTS (
       SELECT 1 FROM enrollment e
        WHERE e.student_id = credit.student_id
          AND e.class_group_id = cg.id
          AND e.organization_id = cs.organization_id
          AND e.status = 'active'
     )
     -- Nor anywhere they are already booked as a guest.
     AND NOT EXISTS (
       SELECT 1 FROM reposicao_booking b
         JOIN reposicao_credit bc
           ON bc.id = b.credit_id AND bc.organization_id = b.organization_id
        WHERE b.class_session_id = cs.id
          AND b.organization_id = cs.organization_id
          AND b.status IN ('pending', 'confirmed')
          AND b.archived_at IS NULL
          AND bc.student_id = credit.student_id
     )
   ORDER BY cs.starts_at
   LIMIT 50
$fn$;

COMMENT ON FUNCTION reposicao_options(uuid) IS
  'Occurrences a reposição credit may be spent on — POOLSE-21 criteria 3 and 4. '
  'Matching level, inside the age range on the day, a free seat by '
  'session_free_seats(), before the expiry, and not a turma they are already in.';

-- Down Migration

DROP TRIGGER IF EXISTS reposicao_booking_syncs_credit ON reposicao_booking;
DROP FUNCTION IF EXISTS reposicao_credit_follows_booking();
DROP FUNCTION IF EXISTS release_expired_reposicao_holds(uuid, timestamptz);
DROP FUNCTION IF EXISTS reposicao_options(uuid);
DROP FUNCTION IF EXISTS session_free_seats(uuid);
DROP FUNCTION IF EXISTS age_in_months(date, date);

DROP TABLE IF EXISTS reposicao_booking;
DROP TYPE IF EXISTS reposicao_booking_status;

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_reposicao_hold_sane;
ALTER TABLE organization
  DROP COLUMN IF EXISTS reposicao_hold_hours;
