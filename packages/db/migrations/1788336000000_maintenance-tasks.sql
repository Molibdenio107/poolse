-- Up Migration
--
-- Planned maintenance — slice 4.3.
--
-- Round 6 built the *unplanned* half: `maintenance_request` is somebody noticing
-- that a shower is broken, with a reporter, a resolver and no schedule. Cleaning
-- built the *recurring* half, but only for spaces and only for one kind of work —
-- `space.expected_cleaning_interval_hours` and `cleaning_log`.
--
-- What has never existed is the thing between them: a job that comes round
-- again, belongs to somebody, and can be about a tank, a room, a piece of kit or
-- the site itself. Contralavagem every Monday. Service the dosing pump every
-- quarter. Check the emergency lighting monthly.
--
-- **Two tables, and the second is what makes the first answerable.** A task with
-- no record of having been done cannot say when it is next due, which is why
-- 4.4's completion log arrives here rather than in a slice of its own — the
-- roadmap split them, and the split does not survive contact with the schema.
--
-- **`interval_days` is NOT NULL, and that is the boundary with
-- `maintenance_request`.** A job with no cadence is a request: raised once, done
-- once, closed. That table exists and does it well. Making the interval optional
-- here would produce a second, worse way of expressing the same thing, and then
-- two screens would disagree about where a one-off job lives. `active` is how a
-- task is paused, exactly as `space.active` pauses a room.
--
-- **Due-ness is derived, never stored.** The same rule as overdue cleaning, in
-- the same order, for the same reason: a stored flag needs a worker to keep it
-- true and that is a per-tenant cost. See `maintenance.repository.ts`.
--
-- **No `next_due_at` column** for the same reason, and one more: a completion
-- backdated to when the work actually happened has to move the next due date
-- with it. A stored date would have to be recomputed by whoever remembered to.

CREATE TABLE maintenance_task (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  /*
   * The same three optional targets `maintenance_request` carries, deliberately.
   *
   * A task may name a room, a tank, a piece of kit, or none of them — "test the
   * emergency lighting" belongs to the site rather than to any one room, exactly
   * as "the front door lock is broken" does. Nothing requires one to be set, and
   * a rule that guessed otherwise would have to be unpicked the first time a
   * club wrote a site-wide job.
   */
  space_id          uuid,
  pool_id           uuid,
  inventory_item_id uuid,

  title           text NOT NULL,
  description     text,

  -- Days rather than the hours cleaning uses, because these are different
  -- cadences and one unit would be wrong for one of them: a balneário is cleaned
  -- twice a day, a dosing pump is serviced quarterly. Asking a club to type 2160
  -- hours would be arithmetic in place of a schedule.
  interval_days   integer NOT NULL,

  /*
   * Who it is for. Null means anybody at the site.
   *
   * A person and not a role, unlike the alert recipients in 4.2 — and the
   * difference is the point of each. An alert has to reach *somebody* who can
   * act, so a role is right and turnover must not orphan it. A task is a to-do
   * list: "Sandra does the Monday backwash" is how a club actually works, and a
   * job assigned to three people is a job none of them does. A role column can
   * be added beside this one later; un-picking a role-only design could not.
   */
  assigned_to     uuid,

  -- Paused, not deleted. A task suspended while a tank is drained is still part
  -- of the club's plan, and a paused task is never due — the same statement
  -- `space.active` makes about a room shut for works.
  active          boolean NOT NULL DEFAULT true,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  /*
   * All three target keys route through `facility_id`, so a named target is
   * proved to be at this site rather than merely inside this tenant. MATCH
   * SIMPLE — Postgres's default — is what makes them optional: with any column
   * of the key null the constraint is not checked at all, and a task *with* a
   * space must satisfy it in full. `maintenance_request` does exactly this.
   */
  FOREIGN KEY (organization_id, facility_id, space_id)
    REFERENCES space (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, facility_id, pool_id)
    REFERENCES pool (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, facility_id, inventory_item_id)
    REFERENCES inventory_item (organization_id, facility_id, id),

  FOREIGN KEY (organization_id, assigned_to) REFERENCES membership (organization_id, id),

  CHECK (btrim(title) <> ''),
  CHECK (description IS NULL OR btrim(description) <> ''),
  -- Zero days is not a schedule, and a negative one is a typo that would make
  -- every task permanently overdue.
  CHECK (interval_days > 0)
);

COMMENT ON TABLE maintenance_task IS
  'A recurring maintenance job: what, how often, and whose. A one-off job is a maintenance_request instead.';
COMMENT ON COLUMN maintenance_task.interval_days IS
  'How often the job comes round. Days, not hours: these are quarterly jobs, not twice-daily ones.';
COMMENT ON COLUMN maintenance_task.assigned_to IS
  'The membership responsible, or null for anybody at the site.';
COMMENT ON COLUMN maintenance_task.active IS
  'False means paused — still listed, still editable, never due. Deletion is archived_at.';

-- No unique index on the title, deliberately. "Verificar dosagem" is a
-- legitimate name for two tasks on one site when they name two different tanks,
-- and a constraint that refused the second would be a constraint an operator
-- works around by typing "Verificar dosagem 2".

CREATE INDEX maintenance_task_facility_idx
  ON maintenance_task (organization_id, facility_id)
  WHERE archived_at IS NULL;

-- "What is mine", which is the question the dashboard asks on every load.
CREATE INDEX maintenance_task_assignee_idx
  ON maintenance_task (organization_id, assigned_to)
  WHERE archived_at IS NULL AND assigned_to IS NOT NULL;

CREATE TRIGGER maintenance_task_updated_at BEFORE UPDATE ON maintenance_task
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- maintenance_task_completion — the history, and what due-ness is derived from
-- ---------------------------------------------------------------------------
--
-- Slice 4.4's "who did what, when", arriving with 4.3 because a task cannot say
-- when it is next due without it.
--
-- Soft-deleted, and `archived_at IS NULL` is the rule rather than an
-- optimisation: **a deleted completion did not happen.** Remove one logged
-- against the wrong task and that task goes straight back to overdue, which is
-- the only honest answer — the alternative leaves a job looking done because
-- somebody corrected a mistake. `cleaning_log` says the same thing.

CREATE TABLE maintenance_task_completion (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  task_id         uuid NOT NULL,

  -- When the work happened, which is not when somebody typed it in. A
  -- backdated completion moves the next due date back with it, which is why
  -- there is no stored next-due column to fall out of step.
  performed_at    timestamptz NOT NULL DEFAULT now(),
  performed_by    uuid NOT NULL,
  note            text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, task_id)
    REFERENCES maintenance_task (organization_id, id),
  FOREIGN KEY (organization_id, performed_by)
    REFERENCES membership (organization_id, id),

  CHECK (note IS NULL OR btrim(note) <> ''),
  CHECK (performed_at > TIMESTAMPTZ '2000-01-01')
);

COMMENT ON TABLE maintenance_task_completion IS
  'One time a recurring task was done. The only input to whether it is due again.';
COMMENT ON COLUMN maintenance_task_completion.performed_at IS
  'When the work happened, UTC — not when it was recorded. A backdated entry moves the next due date.';

-- The read every due calculation makes: this task's most recent completion.
CREATE INDEX maintenance_task_completion_task_idx
  ON maintenance_task_completion (organization_id, task_id, performed_at DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER maintenance_task_completion_updated_at
  BEFORE UPDATE ON maintenance_task_completion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE maintenance_task            ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_task_completion ENABLE ROW LEVEL SECURITY;

CREATE POLICY maintenance_task_tenant ON maintenance_task
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY maintenance_task_completion_tenant ON maintenance_task_completion
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_task            TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_task_completion TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS maintenance_task_completion_tenant ON maintenance_task_completion;
DROP POLICY IF EXISTS maintenance_task_tenant            ON maintenance_task;

DROP TABLE IF EXISTS maintenance_task_completion;
DROP TABLE IF EXISTS maintenance_task;
