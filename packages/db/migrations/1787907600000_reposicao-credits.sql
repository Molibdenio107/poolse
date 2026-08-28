-- Aula de reposição as a credit object — POOLSE-21, first slice.
--
-- A reposição owed to a family is currently a note somebody remembers, which
-- means it is either forgotten or honoured twice. This makes it a row: something
-- the family can be shown, and something the office can count at the end of the
-- época.
--
-- **This migration mints and revokes. It does not book.** Redemption — the
-- eligibility filter, the backfill-only rule, the two approval modes and the
-- guest roster — is the next slice and lands in its own migration. The split is
-- at a real boundary: a credit that exists and expires correctly is useful on
-- its own (the office can already answer "what do we owe this family?"), and a
-- booking table with nothing reliable to book against is not.
--
-- **Only a *falta justificada* mints.** `attendance_status` calls it `excused`.
-- A plain `absent` mints nothing, and an occurrence cancelled by a closure is not
-- an absence at all — POOLSE-31 decided that a closure cancels the class and
-- mints nothing, so no attendance row exists to fire this.

-- Up Migration

-- ---------------------------------------------------------------------------
-- The settings, at two levels
--
-- Criterion 1 asks for minting configurable per tenant *and* per turma, with the
-- turma winning. `class_group.reposicao_enabled` is therefore nullable, and null
-- means "inherit" rather than "off" — a three-state column, which is the only
-- shape that can express "this turma does not follow the club's rule" separately
-- from "nobody has said".
-- ---------------------------------------------------------------------------

CREATE TYPE reposicao_mode AS ENUM ('self_service', 'request');

ALTER TABLE organization
  ADD COLUMN reposicao_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN reposicao_window_days    smallint NOT NULL DEFAULT 60,
  ADD COLUMN reposicao_cap_per_season smallint,
  ADD COLUMN reposicao_backfill_only  boolean NOT NULL DEFAULT false,
  ADD COLUMN reposicao_mode           reposicao_mode NOT NULL DEFAULT 'request';

COMMENT ON COLUMN organization.reposicao_enabled IS
  'Whether a falta justificada mints a reposição credit — POOLSE-21 criterion 1. '
  'Off by default: a club that has not thought about it should not start issuing '
  'credits it did not decide to owe.';

COMMENT ON COLUMN organization.reposicao_cap_per_season IS
  'Credits per student per época, or null for no cap — criterion 9.';

COMMENT ON COLUMN organization.reposicao_backfill_only IS
  'Read by the redemption filter in the next slice — criterion 4. Stored now so '
  'the settings are one migration rather than two.';

ALTER TABLE organization
  ADD CONSTRAINT organization_reposicao_window_sane
    CHECK (reposicao_window_days BETWEEN 1 AND 365),
  ADD CONSTRAINT organization_reposicao_cap_sane
    CHECK (reposicao_cap_per_season IS NULL OR reposicao_cap_per_season > 0);

ALTER TABLE class_group ADD COLUMN reposicao_enabled boolean;

COMMENT ON COLUMN class_group.reposicao_enabled IS
  'Overrides the club setting for this turma. **Null means inherit, not off** — '
  'POOLSE-21 criterion 1. A two-state column could not tell "this turma is an '
  'exception" apart from "nobody has said".';

-- ---------------------------------------------------------------------------
-- reposicao_credit
--
-- **The rule is copied onto the row at mint time.** `window_days` and
-- `capped_at_season_end` are not read from the organization when the credit is
-- used; they are the snapshot the ticket asks for, and the reason is that a club
-- shortening its window in March must not silently shorten credits it already
-- issued. A family told "you have until 11 May" has been told something, and a
-- setting change is not permission to un-tell them.
--
-- `expires_on` is likewise stored rather than computed. It is derivable from the
-- snapshot, but every read would have to re-derive it identically — and it is
-- the sort order for criterion 5, so it wants an index.
-- ---------------------------------------------------------------------------

CREATE TYPE reposicao_credit_status AS ENUM ('available', 'booked', 'used', 'expired');

CREATE TABLE reposicao_credit (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organization (id),
  student_id           uuid NOT NULL,

  /*
   * The época the credit belongs to.
   *
   * Denormalised from class_group deliberately: the cap in criterion 9 is per
   * season, and answering "how many this época" through two joins on every mint
   * would make the cap check the expensive part of marking a register.
   */
  season_id            uuid NOT NULL,

  -- What minted it. The attendance row rather than only the session, because the
  -- credit follows the *mark* — correcting the mark revokes the credit.
  attendance_id        uuid NOT NULL,
  class_session_id     uuid NOT NULL,

  issued_on            date NOT NULL,
  expires_on           date NOT NULL,
  status               reposicao_credit_status NOT NULL DEFAULT 'available',
  redeemed_at          timestamptz,

  -- The rule as it stood when this was minted. Never re-read from settings.
  source_window_days   smallint NOT NULL,
  source_capped_at_season_end boolean NOT NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  /* Revocation. A mark corrected from excused back to absent takes its credit
   * with it — hidden, never deleted, because "we owed you a class in March" is
   * something a family may well ask about later. */
  archived_at          timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, student_id)        REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, season_id)         REFERENCES season (organization_id, id),
  FOREIGN KEY (organization_id, attendance_id)     REFERENCES attendance (organization_id, id),
  FOREIGN KEY (organization_id, class_session_id)  REFERENCES class_session (organization_id, id),

  CHECK (expires_on >= issued_on),
  CHECK (source_window_days > 0),
  -- A redemption timestamp and a status that says it was never redeemed cannot
  -- both be true.
  CHECK ((redeemed_at IS NULL) = (status <> 'used'))
);

/*
 * One live credit per absence — criterion 1's "exactly one".
 *
 * Partial, per the convention: a mark corrected excused → absent → excused again
 * archives one credit and mints another, and a total unique index would refuse
 * the second against a row nobody can see.
 */
CREATE UNIQUE INDEX reposicao_credit_absence_uq
  ON reposicao_credit (attendance_id)
  WHERE archived_at IS NULL;

/*
 * The hot query, in the order criterion 5 asks for: a student's live credits,
 * oldest expiry first, ties broken by oldest issue.
 */
CREATE INDEX reposicao_credit_student_idx
  ON reposicao_credit (organization_id, student_id, status, expires_on, issued_on)
  WHERE archived_at IS NULL;

-- The cap check, and the office's end-of-época count.
CREATE INDEX reposicao_credit_season_idx
  ON reposicao_credit (organization_id, season_id, student_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER reposicao_credit_updated_at BEFORE UPDATE ON reposicao_credit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE reposicao_credit ENABLE ROW LEVEL SECURITY;
CREATE POLICY reposicao_credit_tenant ON reposicao_credit
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON reposicao_credit TO poolse_app;

-- ---------------------------------------------------------------------------
-- reposicao_expiry — the date a credit minted today would die
--
-- Your call in the backlog round: a window from the absence, **capped at the end
-- of the época it was earned in**. Every family gets the same window, and no
-- credit outlives the turma, the level or the enrolment that produced it.
--
-- IMMUTABLE and pure, so the trigger below, the tests and any later backfill all
-- agree by construction rather than by three people implementing `least()`.
-- ---------------------------------------------------------------------------

CREATE FUNCTION reposicao_expiry(
  p_issued_on   date,
  p_window_days smallint,
  p_season_ends date
) RETURNS date
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT least(p_issued_on + p_window_days, p_season_ends);
$fn$;

COMMENT ON FUNCTION reposicao_expiry(date, smallint, date) IS
  'A window from the absence, capped at the end of the época — POOLSE-21. An '
  'absence in the last week of the season gets the days that remain, not 60.';

-- ---------------------------------------------------------------------------
-- Minting, as a trigger on the mark itself
--
-- **A trigger rather than application code, and that is the load-bearing
-- choice.** The ticket asks for minting to be transactional with the attendance
-- row so that a mark and its credit cannot diverge. A repository method achieves
-- that only for the write paths that remember to call it — and the register
-- screen, an importer, a correction endpoint and a future mobile app are four
-- chances to forget. Here there is one write path by construction: whatever
-- changes the mark mints the credit, including psql.
--
-- The same trigger revokes. Correcting excused → absent takes the credit back if
-- nobody has spent it, and **refuses** if they have: a family that has already
-- booked and attended a reposição cannot have the entitlement retracted under
-- them by an office correcting a typo. That is an exception rather than a silent
-- no-op, because the office needs to know the correction did not happen.
-- ---------------------------------------------------------------------------

CREATE FUNCTION reposicao_on_attendance() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_enabled     boolean;
  v_window      smallint;
  v_cap         smallint;
  v_season      uuid;
  v_season_ends date;
  v_issued      date;
  v_held        int;
  v_existing    reposicao_credit%ROWTYPE;
BEGIN
  -- ------------------------------------------------------------------ revoke
  -- The mark is no longer a justified absence, so whatever it minted goes.
  IF NEW.status <> 'excused' THEN
    SELECT * INTO v_existing FROM reposicao_credit
     WHERE attendance_id = NEW.id AND archived_at IS NULL;

    IF FOUND THEN
      IF v_existing.status IN ('booked', 'used') THEN
        RAISE EXCEPTION
          'reposicao_credit_spent: the reposição credit for this absence is % and cannot be revoked',
          v_existing.status
          USING ERRCODE = 'restrict_violation';
      END IF;

      UPDATE reposicao_credit SET archived_at = now() WHERE id = v_existing.id;

      INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
      VALUES (NEW.organization_id, 'reposicao.revoked', 'reposicao_credit', v_existing.id,
              jsonb_build_object('attendanceId', NEW.id, 'newStatus', NEW.status));
    END IF;

    RETURN NEW;
  END IF;

  -- ------------------------------------------------------------------- mint
  -- Already minted for this mark: excused → excused with a changed note must not
  -- issue a second credit.
  IF EXISTS (
    SELECT 1 FROM reposicao_credit
     WHERE attendance_id = NEW.id AND archived_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  /*
   * The effective rule: the turma's setting where it has one, the club's
   * otherwise. Resolved here, at mint time, and the parts that matter later are
   * copied onto the row — criterion 1's "resolvable at mint time and stored on
   * the credit, so changing the setting later does not retroactively rewrite
   * history".
   */
  SELECT coalesce(cg.reposicao_enabled, o.reposicao_enabled),
         o.reposicao_window_days,
         o.reposicao_cap_per_season,
         se.id,
         se.ends_on,
         session_local_date(cs.organization_id, cs.pool_id, cs.starts_at)
    INTO v_enabled, v_window, v_cap, v_season, v_season_ends, v_issued
    FROM class_session cs
    JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
    JOIN season se      ON se.id = cg.season_id      AND se.organization_id = cg.organization_id
    JOIN organization o ON o.id = cs.organization_id
   WHERE cs.id = NEW.class_session_id;

  IF NOT coalesce(v_enabled, false) THEN
    RETURN NEW;
  END IF;

  /*
   * The cap — criterion 9, and QA 21.11 asks for the refusal to be *explainable*
   * rather than merely silent. Nothing is minted and a row says why, so the front
   * desk can answer "why did we not get a credit for that one?" without anybody
   * reconstructing it from settings.
   */
  IF v_cap IS NOT NULL THEN
    SELECT count(*) INTO v_held FROM reposicao_credit
     WHERE organization_id = NEW.organization_id
       AND student_id = NEW.student_id
       AND season_id = v_season
       AND archived_at IS NULL;

    IF v_held >= v_cap THEN
      INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
      VALUES (NEW.organization_id, 'reposicao.capped', 'student', NEW.student_id,
              jsonb_build_object('attendanceId', NEW.id, 'seasonId', v_season,
                                 'cap', v_cap, 'held', v_held));
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO reposicao_credit (
    organization_id, student_id, season_id, attendance_id, class_session_id,
    issued_on, expires_on, source_window_days, source_capped_at_season_end
  ) VALUES (
    NEW.organization_id, NEW.student_id, v_season, NEW.id, NEW.class_session_id,
    v_issued, reposicao_expiry(v_issued, v_window, v_season_ends), v_window, true
  );

  RETURN NEW;
END;
$fn$;

/*
 * `OF status` on the update, so re-saving a note does not re-run this. INSERT is
 * unqualified because a register marked straight to "falta justificada" is the
 * ordinary case, not a correction.
 */
CREATE TRIGGER attendance_reposicao
  AFTER INSERT OR UPDATE OF status ON attendance
  FOR EACH ROW EXECUTE FUNCTION reposicao_on_attendance();

-- ---------------------------------------------------------------------------
-- Expiring, as a function the scheduled job calls
--
-- Criterion 7 wants unused credits expired and the expiry recorded. The status
-- could have been derived on read — `expires_on < today` — and that would never
-- need a job. It is written instead, for one reason: criterion 7 says *recorded*,
-- and a derived status has no moment to hang a notification on and no row to
-- show an auditor.
--
-- **Evaluated per tenant, against a date the caller passes.** The ticket is
-- explicit that expiry is a date in the club's timezone, not an instant in UTC:
-- a credit expiring on the 30th is alive all day on the 30th in Lisbon, and
-- `now() AT TIME ZONE 'UTC'` would kill it an hour early for half the year.
--
-- Idempotent and safe to re-run: only `available` rows move, so a second pass in
-- the same minute finds nothing and notifies nobody.
-- ---------------------------------------------------------------------------

CREATE FUNCTION expire_reposicao_credits(p_organization_id uuid, p_today date)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_expired int;
BEGIN
  WITH gone AS (
    UPDATE reposicao_credit
       SET status = 'expired'
     WHERE organization_id = p_organization_id
       AND archived_at IS NULL
       AND status = 'available'
       AND expires_on < p_today
    RETURNING id, student_id, expires_on
  ),
  logged AS (
    INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
    SELECT p_organization_id, 'reposicao.expired', 'reposicao_credit', gone.id,
           jsonb_build_object('studentId', gone.student_id,
                              'expiredOn', gone.expires_on,
                              'evaluatedOn', p_today)
      FROM gone
    RETURNING 1
  )
  SELECT count(*)::int INTO v_expired FROM logged;

  RETURN v_expired;
END;
$fn$;

COMMENT ON FUNCTION expire_reposicao_credits(uuid, date) IS
  'Expires available credits whose date has passed, in the club''s own calendar — '
  'POOLSE-21 criterion 7. Idempotent: a second run finds nothing.';

REVOKE ALL ON FUNCTION expire_reposicao_credits(uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION expire_reposicao_credits(uuid, date) TO poolse_app;

-- Down Migration

DROP TRIGGER IF EXISTS attendance_reposicao ON attendance;
DROP FUNCTION IF EXISTS reposicao_on_attendance();
DROP FUNCTION IF EXISTS expire_reposicao_credits(uuid, date);
DROP FUNCTION IF EXISTS reposicao_expiry(date, smallint, date);

DROP TABLE IF EXISTS reposicao_credit;
DROP TYPE IF EXISTS reposicao_credit_status;

ALTER TABLE class_group DROP COLUMN IF EXISTS reposicao_enabled;

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_reposicao_cap_sane,
  DROP CONSTRAINT IF EXISTS organization_reposicao_window_sane;

ALTER TABLE organization
  DROP COLUMN IF EXISTS reposicao_mode,
  DROP COLUMN IF EXISTS reposicao_backfill_only,
  DROP COLUMN IF EXISTS reposicao_cap_per_season,
  DROP COLUMN IF EXISTS reposicao_window_days,
  DROP COLUMN IF EXISTS reposicao_enabled;

DROP TYPE IF EXISTS reposicao_mode;
