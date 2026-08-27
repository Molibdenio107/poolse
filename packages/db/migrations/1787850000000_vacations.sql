-- Up Migration
--
-- Vacations — backlog round 3, stories 6, 7 and 8.
--
-- Four changes, and three of them are decisions worth reading before the SQL:
--
-- **Days are rows, not a range.** Staff take odd single days. A start/end pair
-- forces awkward splitting the first time somebody books the Monday and the
-- Friday of one week, and every balance calculation then has to reason about
-- ranges with holes in them. One row per day is more rows and less arithmetic.
--
-- **Municipal holidays join `closure`; they do not get a table.** `closure`
-- already stores per-organization holidays with `source = 'national_holiday'`,
-- computed including the moveable feasts, each one a visible deletable row. A
-- `public_holiday` table would hold the same dates a second time and the two
-- would drift. Adding a `source` is the whole change.
--
-- The distinction that has to survive: a closure for *obras* is not a public
-- holiday and must not make a vacation day free. Everything reading holidays
-- filters on `source`, never on "is there a closure".
--
-- **Entitlement lives on the membership.** Portugal's statutory minimum is 22
-- working days, but clubs vary and part-time staff differ, so it is a per-person
-- number an admin can change, defaulted rather than assumed.
--
-- Carry-over to the 30th of April is deliberately NOT modelled. Portuguese
-- practice allows it; v1 does not track it, and the balance summary says so
-- rather than being quietly wrong for two months of the year.

-- ---------------------------------------------------------------------------
-- Municipal holidays
-- ---------------------------------------------------------------------------

ALTER TABLE closure DROP CONSTRAINT closure_source_check;
ALTER TABLE closure
  ADD CONSTRAINT closure_source_check
  CHECK (source IN ('manual', 'national_holiday', 'municipal_holiday'));

COMMENT ON COLUMN closure.source IS
  'manual | national_holiday | municipal_holiday. The two holiday kinds are the '
  'days that do not count against a vacation balance; a manual closure is not.';

-- The same idempotence the national seeder relies on. A municipal holiday is one
-- day per organization per year — Aveiro takes the 12th of May, and re-running
-- anything must not produce two of them.
CREATE UNIQUE INDEX closure_municipal_holiday_uq
  ON closure (organization_id, starts_on)
  WHERE source = 'municipal_holiday' AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Entitlement
-- ---------------------------------------------------------------------------

ALTER TABLE membership
  ADD COLUMN vacation_days_per_year integer NOT NULL DEFAULT 22;

COMMENT ON COLUMN membership.vacation_days_per_year IS
  'Portugal''s statutory minimum is 22 working days; part-time and generous clubs differ.';

ALTER TABLE membership
  ADD CONSTRAINT membership_vacation_days_range
  CHECK (vacation_days_per_year >= 0 AND vacation_days_per_year <= 365);

-- ---------------------------------------------------------------------------
-- vacation_request
-- ---------------------------------------------------------------------------

CREATE TYPE vacation_status AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

CREATE TABLE vacation_request (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization (id),
  membership_id            uuid NOT NULL,

  status                   vacation_status NOT NULL DEFAULT 'pending',
  requested_at             timestamptz NOT NULL DEFAULT now(),

  decided_at               timestamptz,
  decided_by_membership_id uuid,
  decision_note            text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,

  -- Lets other tenant tables reference this one with a composite key.
  UNIQUE (organization_id, id),

  -- Carries membership_id so `vacation_day` can hold a denormalised copy that
  -- the database itself keeps honest — see the foreign key on that table.
  UNIQUE (organization_id, id, membership_id),

  FOREIGN KEY (organization_id, membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, decided_by_membership_id)
    REFERENCES membership (organization_id, id),

  -- A pending request has not been decided; a decided one has a moment attached.
  -- Without this, "pending" and "approved on no particular date" are both
  -- storable and the approval screen cannot tell them apart.
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by_membership_id IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  ),

  -- Approving and rejecting are somebody's act. Withdrawing is the requester's
  -- own, and needs no approver.
  CHECK (
    status NOT IN ('approved', 'rejected') OR decided_by_membership_id IS NOT NULL
  ),

  -- Story 7: rejection requires a note. "No" without a reason generates the
  -- conversation anyway, and the database is the only place this cannot be
  -- forgotten by a second caller written later.
  CHECK (status <> 'rejected' OR btrim(coalesce(decision_note, '')) <> '')
);

CREATE INDEX vacation_request_person_idx
  ON vacation_request (organization_id, membership_id, requested_at DESC)
  WHERE archived_at IS NULL;

-- The approval queue, which is the one read that happens on every visit to the
-- decision screen.
CREATE INDEX vacation_request_pending_idx
  ON vacation_request (organization_id, requested_at)
  WHERE status = 'pending' AND archived_at IS NULL;

CREATE TRIGGER vacation_request_updated_at BEFORE UPDATE ON vacation_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE vacation_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY vacation_request_tenant ON vacation_request
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- vacation_day
-- ---------------------------------------------------------------------------

CREATE TABLE vacation_day (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),
  vacation_request_id uuid NOT NULL,

  -- Denormalised from the request, and the composite key below is what stops the
  -- copy from ever disagreeing with the original. It is here so the "one person
  -- cannot book the same day twice" rule can be a plain unique index rather than
  -- a trigger that joins.
  membership_id       uuid NOT NULL,

  day                 date NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,

  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, vacation_request_id, membership_id)
    REFERENCES vacation_request (organization_id, id, membership_id),

  -- Sundays are not working days and story 6 makes them unselectable. Enforced
  -- here as well, because a rule the interface applies and the database does not
  -- is a rule the second caller breaks. `isodow` is 7 for Sunday.
  --
  -- Public holidays are NOT enforced here: they are rows in `closure`, and a
  -- CHECK constraint cannot read another table. That rule lives in the
  -- application, which is the honest place for it — and it is only ever a
  -- convenience, since a person taking a holiday as leave loses nothing but a
  -- day of their own balance.
  CHECK (EXTRACT(isodow FROM day) <> 7)
);

-- One person, one day, once — story 6's `unique (organization_id, membership_id,
-- day)`, made partial because that is the rule for every soft-deletable table
-- here. A rejected or withdrawn request archives its days (see the trigger
-- below), which is what lets somebody ask again for a day they were refused.
CREATE UNIQUE INDEX vacation_day_uq
  ON vacation_day (organization_id, membership_id, day)
  WHERE archived_at IS NULL;

-- The team map reads a year across everybody at once.
CREATE INDEX vacation_day_calendar_idx
  ON vacation_day (organization_id, day) WHERE archived_at IS NULL;

CREATE INDEX vacation_day_request_idx
  ON vacation_day (organization_id, vacation_request_id);

CREATE TRIGGER vacation_day_updated_at BEFORE UPDATE ON vacation_day
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE vacation_day ENABLE ROW LEVEL SECURITY;
CREATE POLICY vacation_day_tenant ON vacation_day
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- A refused day is a free day again
--
-- Rejecting or withdrawing a request archives its days, which releases them from
-- the partial unique index above. Without it, being refused the 3rd of August
-- would block you from ever asking for the 3rd of August again — and the person
-- refusing would have created that trap without knowing.
--
-- A trigger rather than two lines in a repository method, because there are
-- already two callers (reject, withdraw) and story 7 adds a third. The one that
-- forgets is the one that ships.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vacation_days_follow_request() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('rejected', 'withdrawn') AND OLD.status NOT IN ('rejected', 'withdrawn') THEN
    UPDATE vacation_day
       SET archived_at = now()
     WHERE vacation_request_id = NEW.id
       AND archived_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER vacation_request_days AFTER UPDATE OF status ON vacation_request
  FOR EACH ROW EXECUTE FUNCTION vacation_days_follow_request();

GRANT SELECT, INSERT, UPDATE, DELETE ON vacation_request TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON vacation_day TO poolse_app;

-- Down Migration

DROP TRIGGER IF EXISTS vacation_request_days ON vacation_request;
DROP FUNCTION IF EXISTS vacation_days_follow_request();

DROP TABLE IF EXISTS vacation_day;
DROP TABLE IF EXISTS vacation_request;
DROP TYPE IF EXISTS vacation_status;

ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_vacation_days_range;
ALTER TABLE membership DROP COLUMN IF EXISTS vacation_days_per_year;

DROP INDEX IF EXISTS closure_municipal_holiday_uq;
ALTER TABLE closure DROP CONSTRAINT IF EXISTS closure_source_check;
ALTER TABLE closure
  ADD CONSTRAINT closure_source_check
  CHECK (source IN ('manual', 'national_holiday'));
