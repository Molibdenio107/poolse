-- Advancement by age at the end of a season — POOLSE-112.
--
-- POOLSE-19's queue is driven by skills: a trigger proposes when a child
-- completes every required skill of their level. Most clubs record no skills
-- most of the time, so the queue sat empty and the page read as useless. A real
-- club advances for a second reason — a child has outgrown the level's age band
-- when the season turns, whatever their skills — and this migration adds that
-- reason beside the first.
--
-- Three decisions worth reading before the SQL.
--
-- **1. One queue, one table, a `reason` column.** An age proposal is the same
-- thing as a skill proposal to the person working the queue: a child, a level
-- to leave, a level to join, and a turma still to pick. A second table would be
-- a second queue, a second confirm path and a second set of bugs. The reason is
-- carried so the card can say why, and the partial unique index on
-- `(student_id, from_level_id)` keeps generation idempotent for both reasons
-- alike — a child proposed by skills is not proposed again by age.
--
-- **2. Applying is a timestamp on the proposal, never a new status.** In
-- *Aplicar automaticamente* the level moves on the season's first day and the
-- person only picks the turma afterwards. The proposal stays `pending` with
-- `applied_at` set: still in the queue, still confirmed into a turma by the
-- same path, with one step already taken. A new status would have needed every
-- reader of `status = 'pending'` to learn a second word.
--
-- **3. The target is the first level whose band fits, in the club's order.**
-- A nine-year-old in a level that stops at eight skips a level that stops at
-- eight-and-a-half too (BA rule 1). `age_fit_level()` walks `sort_order`, which
-- is what POOLSE-05 writes and what `next_level()` already reads; it never
-- proposes *down* (BA rule 5), and a child whose age fits nowhere above gets no
-- proposal rather than a guessed one.

-- Up Migration

-- ---------------------------------------------------------------------------
-- Why a proposal exists, and which season asked for it
-- ---------------------------------------------------------------------------

CREATE TYPE transfer_reason AS ENUM ('skills', 'age');

ALTER TABLE transfer_proposal
  ADD COLUMN reason     transfer_reason NOT NULL DEFAULT 'skills',
  ADD COLUMN season_id  uuid,
  -- Set by the automatic application on the season's first day: the level
  -- already moved, the turma is still to pick. Null for every proposal a person
  -- confirms whole.
  ADD COLUMN applied_at timestamptz,
  ADD CONSTRAINT transfer_proposal_season_fkey
    FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  -- A skill proposal has no season to name; an age proposal always does.
  ADD CONSTRAINT transfer_proposal_age_names_season
    CHECK ((reason = 'age') = (season_id IS NOT NULL));

COMMENT ON COLUMN transfer_proposal.reason IS
  'Why the proposal exists — POOLSE-112. skills: every required skill attained '
  '(POOLSE-19). age: above the level''s age band on the season''s first day.';
COMMENT ON COLUMN transfer_proposal.season_id IS
  'The season whose first day the age was judged on. Null for a skill proposal.';
COMMENT ON COLUMN transfer_proposal.applied_at IS
  'When the club''s automatic mode moved the level, leaving only the turma to '
  'pick — POOLSE-112 BA 2. Null when a person confirms the whole thing.';

-- ---------------------------------------------------------------------------
-- The club's choice — BA rule 2
--
-- `propose` is the default and the conservative one: proposals land in the
-- queue and a person confirms, which is what POOLSE-19 criterion 7 promised.
-- `apply` moves the level on the season's first day and leaves the turma.
-- ---------------------------------------------------------------------------

CREATE TYPE advancement_mode AS ENUM ('propose', 'apply');

ALTER TABLE organization
  ADD COLUMN advancement_mode advancement_mode NOT NULL DEFAULT 'propose';

COMMENT ON COLUMN organization.advancement_mode IS
  'How an age proposal is handled at the season change — POOLSE-112 BA 2. '
  'propose: queued for a person. apply: the level moves on the first day, audited.';

-- The club writes its own choice. Column by column, as every organization
-- column the club may write has been since POOLSE-87.
GRANT UPDATE (advancement_mode) ON organization TO poolse_app;

-- ---------------------------------------------------------------------------
-- age_fit_level — the first level above this one whose band fits
--
-- Strictly after the current level in the club's order, like `next_level()`.
-- A level with no bound on one side accepts any age on that side; a level that
-- does not admit the child's sex is skipped. Null when nothing above fits,
-- which is "no proposal", never "propose the last one anyway".
-- ---------------------------------------------------------------------------

CREATE FUNCTION age_fit_level(
  p_organization_id uuid,
  p_from_level_id   uuid,
  p_age_months      integer,
  p_gender          student_gender
) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT n.id
    FROM student_level cur
    JOIN student_level n
      ON n.organization_id = cur.organization_id
     AND n.archived_at IS NULL
     AND (n.sort_order, n.name) > (cur.sort_order, cur.name)
   WHERE cur.id = p_from_level_id
     AND cur.organization_id = p_organization_id
     AND (n.min_age_months IS NULL OR n.min_age_months <= p_age_months)
     AND (n.max_age_months IS NULL OR n.max_age_months >= p_age_months)
     AND (p_gender IS NULL
          OR (p_gender = 'male' AND n.admits_male)
          OR (p_gender = 'female' AND n.admits_female))
   ORDER BY n.sort_order, n.name
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION age_fit_level(uuid, uuid, integer, student_gender) IS
  'The first level after this one, in the club''s order, whose age band admits '
  'this age — POOLSE-112 BA 1. Null when none above fits: no proposal is made.';

-- ---------------------------------------------------------------------------
-- age_band_standing — who is outside their level's band on a given day
--
-- One definition, read three ways: the counts the queue shows for *today*, the
-- sentence about the next season change, and the generator itself. `above`
-- means older than the level's maximum; `below` younger than its minimum,
-- which is flagged and never proposed (BA rule 5). `fits` is the level an
-- `above` child would be proposed into, null when none fits.
--
-- Only students still with the club: not archived, and `student_left_on()`
-- null — a child who left in June is not advanced in September.
-- ---------------------------------------------------------------------------

CREATE FUNCTION age_band_standing(p_organization_id uuid, p_on date)
RETURNS TABLE (
  student_id uuid,
  level_id   uuid,
  age_months integer,
  standing   text,
  fits       uuid
)
LANGUAGE sql STABLE
AS $fn$
  SELECT s.id,
         l.id,
         age_in_months(s.birth_date, p_on),
         CASE
           WHEN l.max_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) > l.max_age_months THEN 'above'
           WHEN l.min_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) < l.min_age_months THEN 'below'
           ELSE 'within'
         END,
         CASE
           WHEN l.max_age_months IS NOT NULL
            AND age_in_months(s.birth_date, p_on) > l.max_age_months
             THEN age_fit_level(p_organization_id, l.id,
                                age_in_months(s.birth_date, p_on), s.gender)
         END
    FROM student s
    JOIN student_level l
      ON l.id = s.level_id AND l.organization_id = s.organization_id
   WHERE s.organization_id = p_organization_id
     AND s.archived_at IS NULL
     AND s.birth_date IS NOT NULL
     AND l.archived_at IS NULL
     AND student_left_on(s.id) IS NULL;
$fn$;

COMMENT ON FUNCTION age_band_standing(uuid, date) IS
  'Each live student against their level''s age band on a day — POOLSE-112. '
  'above / below / within, and the level an above child would move to.';

-- ---------------------------------------------------------------------------
-- propose_age_advancements — the generator
--
-- Judged on the season's first day (BA rule 1). Idempotent by the partial
-- unique index: a child already waiting at this level — by skills or by an
-- earlier run — is not queued twice, and a child dismissed by a person is not
-- re-proposed over that decision (a dismissed row is not live, so the index
-- does not refuse; the NOT EXISTS below does, for this season).
--
-- Returns how many it queued, so the publish and the *Propor* button can say.
-- ---------------------------------------------------------------------------

CREATE FUNCTION propose_age_advancements(
  p_organization_id uuid,
  p_season_id       uuid,
  p_level_id        uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_on    date;
  v_count integer;
BEGIN
  SELECT starts_on INTO v_on
    FROM season
   WHERE id = p_season_id AND organization_id = p_organization_id
     AND archived_at IS NULL;
  IF v_on IS NULL THEN
    RAISE EXCEPTION 'propose_age_advancements: no such season %', p_season_id
      USING ERRCODE = 'no_data_found';
  END IF;

  WITH queued AS (
    INSERT INTO transfer_proposal
      (organization_id, student_id, from_level_id, to_level_id, reason, season_id)
    SELECT p_organization_id, st.student_id, st.level_id, st.fits, 'age', p_season_id
      FROM age_band_standing(p_organization_id, v_on) st
     WHERE st.standing = 'above'
       AND st.fits IS NOT NULL
       AND (p_level_id IS NULL OR st.level_id = p_level_id)
       AND NOT EXISTS (
             SELECT 1 FROM transfer_proposal d
              WHERE d.student_id = st.student_id
                AND d.from_level_id = st.level_id
                AND d.season_id = p_season_id
                AND d.status = 'dismissed'
                AND d.archived_at IS NULL
           )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM queued;

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION propose_age_advancements(uuid, uuid, uuid) IS
  'Queues an age proposal for every live student above their level''s band on '
  'the season''s first day — POOLSE-112 BA 1. Idempotent; a person''s dismissal '
  'for that season is kept. Optionally one level only (the queue''s Propor button).';

-- ---------------------------------------------------------------------------
-- level_change_notice — the family is told (BA rule 4)
--
-- The `payment_change_notice` shape: written inside the transaction that moved
-- the level, with the addresses snapshotted, and emailed after the commit by a
-- by-id sender the hourly retry calls too. Not a `message`: a message is a
-- club's own words to an audience, under a daily quota; this is account mail
-- about one child, which no opt-out reads.
-- ---------------------------------------------------------------------------

CREATE TABLE level_change_notice (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization (id),
  student_id        uuid NOT NULL,
  proposal_id       uuid,
  -- Snapshots: a level renamed next year must not rewrite what the family read.
  from_level_name   text NOT NULL,
  to_level_name     text NOT NULL,
  reason            transfer_reason NOT NULL,
  recipients        text[] NOT NULL DEFAULT '{}',
  delivered_at      timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, student_id)  REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, proposal_id) REFERENCES transfer_proposal (organization_id, id),
  CHECK (delivered_at IS NULL OR cardinality(recipients) > 0)
);

COMMENT ON TABLE level_change_notice IS
  'POOLSE-112: a child''s level changed and the family told. Written once by the '
  'change; only the delivery columns move after.';

CREATE INDEX level_change_notice_pending_idx
  ON level_change_notice (organization_id, created_at)
  WHERE delivered_at IS NULL;

CREATE TRIGGER level_change_notice_updated_at BEFORE UPDATE ON level_change_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE level_change_notice ENABLE ROW LEVEL SECURITY;
CREATE POLICY level_change_notice_tenant ON level_change_notice
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON level_change_notice FROM poolse_app;
GRANT SELECT, INSERT ON level_change_notice TO poolse_app;
GRANT UPDATE (delivered_at, delivery_attempts, last_attempt_at) ON level_change_notice TO poolse_app;

-- Who hears about a child: the live guardians, else the student — the same
-- answer `message_recipients()` gives, for one child.
CREATE FUNCTION level_change_recipients(p_organization_id uuid, p_student_id uuid)
RETURNS text[]
LANGUAGE sql STABLE
AS $fn$
  WITH guardians AS (
    SELECT nullif(btrim(person_email(g.guardian_membership_id)::text), '') AS email
      FROM guardian_link g
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.student_id = p_student_id
       AND g.organization_id = p_organization_id
       AND g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  own AS (
    SELECT nullif(btrim(coalesce(person_email(s.membership_id), s.contact_email)::text), '') AS email
      FROM student s
     WHERE s.id = p_student_id AND s.organization_id = p_organization_id
  )
  SELECT coalesce(array_agg(DISTINCT email), '{}')
    FROM (
      SELECT email FROM guardians WHERE email IS NOT NULL
      UNION ALL
      SELECT email FROM own
       WHERE email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM guardians)
    ) addresses;
$fn$;

COMMENT ON FUNCTION level_change_recipients(uuid, uuid) IS
  'The addresses told about one child''s level — live guardians, else the '
  'student — POOLSE-112 BA 4. Empty when nobody has an address.';

-- Down Migration

DROP FUNCTION IF EXISTS level_change_recipients(uuid, uuid);
DROP TABLE IF EXISTS level_change_notice;
DROP FUNCTION IF EXISTS propose_age_advancements(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS age_band_standing(uuid, date);
DROP FUNCTION IF EXISTS age_fit_level(uuid, uuid, integer, student_gender);

ALTER TABLE organization DROP COLUMN IF EXISTS advancement_mode;
DROP TYPE IF EXISTS advancement_mode;

ALTER TABLE transfer_proposal
  DROP CONSTRAINT IF EXISTS transfer_proposal_age_names_season,
  DROP CONSTRAINT IF EXISTS transfer_proposal_season_fkey,
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS season_id,
  DROP COLUMN IF EXISTS reason;
DROP TYPE IF EXISTS transfer_reason;
