-- Automatic level advancement — POOLSE-19, the differentiator.
--
-- Today a student can finish every skill in their level and sit there until a
-- human notices. The instructor marks the last skill poolside, nothing happens,
-- and the family waits — often a whole época.
--
-- **The mechanic, in one line:** marking the last required skill *Adquirido*
-- puts a transfer proposal in a queue. A human still confirms it (criterion 7);
-- what changes is that nobody has to notice first.
--
-- Three decisions worth reading before the SQL.
--
-- **1. `skill.required`, not a `level_required_skill` join table.** The ticket
-- proposes the join table, and it would be right if a skill could belong to
-- several levels. It cannot: `skill.level_id` is already NOT NULL and singular.
-- A join table would model a many-to-many that does not exist, and would let a
-- skill be required for a level it is not part of.
--
-- **2. "Next level" is the drag-and-drop order, never the id or creation
-- order.** The ticket names this as the thing most likely to be got wrong, and
-- the failure is silent: reordering levels in Settings would quietly reroute
-- every future proposal while every screen kept looking correct. `next_level()`
-- reads `sort_order`, which is what POOLSE-05 writes.
--
-- **3. Candidate turmas are computed when the queue is read, never stored.** The
-- ticket describes ranked candidates as part of the proposal record. Storing
-- them would mean a ranked list that was true when the last skill was marked and
-- is wrong by the time anybody opens the queue — seats fill. The proposal is
-- stored; `transfer_candidates()` answers the ranking live, and confirmation
-- re-checks the seat inside its own transaction anyway.
--
-- **Open, and deliberately unbuilt:** what happens when the completed level is
-- the last in the ladder. No proposal is generated and no new state is invented,
-- pending a business decision — it may turn out to be a student's choice, or to
-- follow from age. Recorded in the ticket rather than guessed at here.

-- Up Migration

-- ---------------------------------------------------------------------------
-- Which skills gate a level — criterion 1
--
-- Default true, and that is the conservative direction: every skill a club has
-- already written counts until somebody says otherwise. Defaulting to false
-- would make every level instantly complete for every student and fill the queue
-- with proposals nobody asked for, on the day this deploys.
-- ---------------------------------------------------------------------------

ALTER TABLE skill ADD COLUMN required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN skill.required IS
  'Whether this skill gates completion of its level — POOLSE-19 criterion 1. '
  'Optional skills are taught and tracked but never hold a student back.';

-- ---------------------------------------------------------------------------
-- next_level — the ladder, in the club's own order
-- ---------------------------------------------------------------------------

CREATE FUNCTION next_level(p_organization_id uuid, p_level_id uuid) RETURNS uuid
LANGUAGE sql STABLE
AS $fn$
  SELECT n.id
    FROM student_level cur
    JOIN student_level n
      ON n.organization_id = cur.organization_id
     AND n.archived_at IS NULL
     -- Strictly after, in the order the club dragged them into. Ties on
     -- sort_order break on name so the answer is total and stable.
     AND (n.sort_order, n.name) > (cur.sort_order, cur.name)
   WHERE cur.id = p_level_id
     AND cur.organization_id = p_organization_id
   ORDER BY n.sort_order, n.name
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION next_level(uuid, uuid) IS
  'The level after this one in the club''s drag-and-drop order — POOLSE-19, and '
  'POOLSE-05 is what writes that order. Null at the end of the ladder.';

-- ---------------------------------------------------------------------------
-- level_is_complete — criterion 1
--
-- Every *required* skill of the level at `attained`. A level with no required
-- skills is not complete: "nothing to do" is a level nobody has configured yet,
-- and treating it as finished would advance the whole club.
-- ---------------------------------------------------------------------------

CREATE FUNCTION level_is_complete(p_student_id uuid, p_level_id uuid) RETURNS boolean
LANGUAGE sql STABLE
AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM skill s
            WHERE s.level_id = p_level_id AND s.required AND s.archived_at IS NULL
         )
     AND NOT EXISTS (
           SELECT 1
             FROM skill s
             LEFT JOIN skill_progress sp
               ON sp.skill_id = s.id
              AND sp.student_id = p_student_id
              AND sp.organization_id = s.organization_id
            WHERE s.level_id = p_level_id
              AND s.required
              AND s.archived_at IS NULL
              AND (sp.state IS DISTINCT FROM 'attained')
         );
$fn$;

COMMENT ON FUNCTION level_is_complete(uuid, uuid) IS
  'Every required skill of the level at Adquirido — POOLSE-19 criterion 1. '
  'False for a level with no required skills: that is unconfigured, not finished.';

-- ---------------------------------------------------------------------------
-- transfer_proposal
--
-- `invalidated` is the state criterion in QA 19.8: a skill corrected back down
-- takes the proposal with it, and it leaves the queue without enrolling anybody.
-- It is a status rather than a delete so the queue can explain what happened
-- rather than a row simply vanishing between two glances.
-- ---------------------------------------------------------------------------

CREATE TYPE transfer_proposal_status AS ENUM
  ('pending', 'confirmed', 'dismissed', 'invalidated');

CREATE TABLE transfer_proposal (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  student_id         uuid NOT NULL,
  from_level_id      uuid NOT NULL,
  to_level_id        uuid NOT NULL,

  status             transfer_proposal_status NOT NULL DEFAULT 'pending',
  generated_at       timestamptz NOT NULL DEFAULT now(),

  /* Set on confirm: who, into what, from when. */
  confirmed_by_membership_id uuid,
  confirmed_at       timestamptz,
  to_class_group_id  uuid,
  effective_on       date,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, student_id)     REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, from_level_id)  REFERENCES student_level (organization_id, id),
  FOREIGN KEY (organization_id, to_level_id)    REFERENCES student_level (organization_id, id),
  FOREIGN KEY (organization_id, to_class_group_id)
    REFERENCES class_group (organization_id, id),
  FOREIGN KEY (organization_id, confirmed_by_membership_id)
    REFERENCES membership (organization_id, id),

  -- A confirmed proposal says all four things or none of them.
  CHECK (
    status <> 'confirmed'
    OR (confirmed_by_membership_id IS NOT NULL AND confirmed_at IS NOT NULL
        AND to_class_group_id IS NOT NULL AND effective_on IS NOT NULL)
  ),
  -- Nobody advances into the level they just finished.
  CHECK (from_level_id <> to_level_id)
);

/*
 * One live proposal per student per level.
 *
 * This is what makes generation idempotent, and it has to be: the poolside grid
 * saves incrementally over a flaky connection (POOLSE-20 AC5), so the last skill
 * can be written more than once. Deduplicating in the trigger would be a race
 * between two saves; deduplicating here is a guarantee.
 */
CREATE UNIQUE INDEX transfer_proposal_live_uq
  ON transfer_proposal (student_id, from_level_id)
  WHERE status = 'pending' AND archived_at IS NULL;

-- The queue read: pending first, oldest first, per tenant.
CREATE INDEX transfer_proposal_queue_idx
  ON transfer_proposal (organization_id, status, generated_at)
  WHERE archived_at IS NULL;

CREATE TRIGGER transfer_proposal_updated_at BEFORE UPDATE ON transfer_proposal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE transfer_proposal ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_proposal_tenant ON transfer_proposal
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON transfer_proposal TO poolse_app;

-- ---------------------------------------------------------------------------
-- class_group_free_seats — the seat rule for a turma
--
-- The companion to `session_free_seats()`, which answers the same question for
-- one occurrence. This one is about the turma as a whole, which is what an
-- enrolment needs.
--
-- **Reposição guests are not counted, and that is free rather than careful** —
-- QA 19.10. A guest has no `enrollment` row at all, so a count of enrolments
-- cannot see them. The ticket warns that counting them "consumes seats that do
-- not exist"; the schema makes that impossible rather than merely discouraged.
--
-- Null capacity means no limit, and stays null so the caller decides what that
-- means rather than this pretending it is zero.
-- ---------------------------------------------------------------------------

CREATE FUNCTION class_group_free_seats(p_class_group_id uuid) RETURNS integer
LANGUAGE sql STABLE
AS $fn$
  SELECT cg.capacity
         - (
             SELECT count(*)
               FROM enrollment e
              WHERE e.class_group_id = cg.id
                AND e.organization_id = cg.organization_id
                AND e.status = 'active'
           )
    FROM class_group cg
   WHERE cg.id = p_class_group_id;
$fn$;

COMMENT ON FUNCTION class_group_free_seats(uuid) IS
  'Places open in a turma — POOLSE-19. Reposição guests are invisible here '
  'because they have no enrolment row, which is QA 19.10 by construction.';

-- ---------------------------------------------------------------------------
-- transfer_candidates — criterion 3's ranking
--
-- Strictly: (1) same weekday **and** same start time as the student's current
-- turma, (2) same instructor, (3) anything else eligible. Ties break on most
-- open seats, then name.
--
-- The rank is returned rather than only the order, so the queue can say *why* a
-- turma is first — "mesmo dia e hora" is the sentence that makes an admin trust
-- the suggestion instead of re-deriving it.
-- ---------------------------------------------------------------------------

CREATE FUNCTION transfer_candidates(p_proposal_id uuid)
RETURNS TABLE (
  class_group_id uuid,
  class_name     text,
  level_name     text,
  instructor_membership_id uuid,
  free_seats     integer,
  rank_reason    text,
  rank_order     integer
)
LANGUAGE sql STABLE
AS $fn$
  WITH proposal AS (
    SELECT p.id, p.organization_id, p.student_id, p.to_level_id,
           s.birth_date
      FROM transfer_proposal p
      JOIN student s ON s.id = p.student_id AND s.organization_id = p.organization_id
     WHERE p.id = p_proposal_id
  ),
  -- What the student attends now, which is what "same day and time" compares to.
  current_slot AS (
    SELECT cs.weekday, cs.start_time, cg.instructor_membership_id
      FROM proposal
      JOIN enrollment e
        ON e.student_id = proposal.student_id
       AND e.organization_id = proposal.organization_id
       AND e.status = 'active'
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN class_schedule cs
        ON cs.class_group_id = cg.id AND cs.organization_id = cg.organization_id
       AND cs.archived_at IS NULL
     LIMIT 1
  )
  SELECT cg.id,
         cg.name,
         l.name,
         cg.instructor_membership_id,
         class_group_free_seats(cg.id),
         CASE
           WHEN EXISTS (
             SELECT 1 FROM class_schedule cs2, current_slot
              WHERE cs2.class_group_id = cg.id
                AND cs2.archived_at IS NULL
                AND cs2.weekday = current_slot.weekday
                AND cs2.start_time = current_slot.start_time
           ) THEN 'same_slot'
           WHEN cg.instructor_membership_id IS NOT NULL
            AND cg.instructor_membership_id
                = (SELECT instructor_membership_id FROM current_slot)
             THEN 'same_instructor'
           ELSE 'available'
         END,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM class_schedule cs2, current_slot
              WHERE cs2.class_group_id = cg.id
                AND cs2.archived_at IS NULL
                AND cs2.weekday = current_slot.weekday
                AND cs2.start_time = current_slot.start_time
           ) THEN 1
           WHEN cg.instructor_membership_id IS NOT NULL
            AND cg.instructor_membership_id
                = (SELECT instructor_membership_id FROM current_slot)
             THEN 2
           ELSE 3
         END
    FROM proposal
    JOIN class_group cg
      ON cg.organization_id = proposal.organization_id
     AND cg.level_id = proposal.to_level_id
     AND cg.archived_at IS NULL
    JOIN season se
      ON se.id = cg.season_id AND se.organization_id = cg.organization_id
     AND se.archived_at IS NULL
    JOIN student_level l
      ON l.id = cg.level_id AND l.organization_id = cg.organization_id
   WHERE coalesce(class_group_free_seats(cg.id), 1) > 0
     -- The student's age against the target level's range, in months —
     -- POOLSE-06's months and POOLSE-16's ceiling of 100, so a 61-year-old is
     -- eligible for a senior turma rather than filtered out (QA 19.7).
     AND (
       proposal.birth_date IS NULL
       OR (
         (l.min_age_months IS NULL
          OR age_in_months(proposal.birth_date, current_date) >= l.min_age_months)
         AND
         (l.max_age_months IS NULL
          OR age_in_months(proposal.birth_date, current_date) <= l.max_age_months)
       )
     )
   ORDER BY 7, class_group_free_seats(cg.id) DESC NULLS LAST, cg.name;
$fn$;

COMMENT ON FUNCTION transfer_candidates(uuid) IS
  'Turmas a proposal could move a student into, ranked same-slot, then '
  'same-instructor, then anything eligible — POOLSE-19 criterion 3. Computed '
  'live: a stored ranking is wrong by the time the queue is opened.';

-- ---------------------------------------------------------------------------
-- Generating and invalidating, on the skill-progress write path
--
-- A trigger for the reason minting a reposição is a trigger: the poolside grid
-- is not the only thing that will ever write a skill, and a rule that lives in
-- one caller is a rule the second caller forgets.
--
-- Both directions, because criterion 19.8 needs the reverse: correcting the last
-- skill back down takes the pending proposal with it.
-- ---------------------------------------------------------------------------

CREATE FUNCTION advancement_on_skill_progress() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_level uuid;
  v_next  uuid;
BEGIN
  SELECT level_id INTO v_level FROM skill WHERE id = NEW.skill_id;
  IF v_level IS NULL THEN RETURN NEW; END IF;

  IF level_is_complete(NEW.student_id, v_level) THEN
    v_next := next_level(NEW.organization_id, v_level);

    /*
     * No next level: nothing happens, deliberately.
     *
     * What a club owes a student who has finished the whole programme is a
     * business decision that is still open — it may be the student's choice, or
     * it may follow from their age. Inventing a state here would be guessing,
     * and a guess in the schema is expensive to unpick.
     */
    IF v_next IS NULL THEN RETURN NEW; END IF;

    /*
     * ON CONFLICT DO NOTHING against the partial unique index, which is what
     * makes this idempotent under the grid's incremental saves. Marking the last
     * skill twice proposes once.
     */
    INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id)
    VALUES (NEW.organization_id, NEW.student_id, v_level, v_next)
    ON CONFLICT DO NOTHING;

  ELSE
    /*
     * The level is no longer complete — a skill was corrected back down. Any
     * pending proposal is invalidated rather than deleted, so the queue can say
     * what happened instead of a row disappearing between two glances. A
     * proposal already confirmed is history and is left alone.
     */
    UPDATE transfer_proposal
       SET status = 'invalidated'
     WHERE organization_id = NEW.organization_id
       AND student_id = NEW.student_id
       AND from_level_id = v_level
       AND status = 'pending'
       AND archived_at IS NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER skill_progress_advancement
  AFTER INSERT OR UPDATE OF state ON skill_progress
  FOR EACH ROW EXECUTE FUNCTION advancement_on_skill_progress();

-- Down Migration

DROP TRIGGER IF EXISTS skill_progress_advancement ON skill_progress;
DROP FUNCTION IF EXISTS advancement_on_skill_progress();
DROP FUNCTION IF EXISTS transfer_candidates(uuid);
DROP FUNCTION IF EXISTS class_group_free_seats(uuid);

DROP TABLE IF EXISTS transfer_proposal;
DROP TYPE IF EXISTS transfer_proposal_status;

DROP FUNCTION IF EXISTS level_is_complete(uuid, uuid);
DROP FUNCTION IF EXISTS next_level(uuid, uuid);

ALTER TABLE skill DROP COLUMN IF EXISTS required;
