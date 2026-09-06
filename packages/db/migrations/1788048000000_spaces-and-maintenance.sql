-- Up Migration
--
-- Espaços, the cleaning log, and the first maintenance requests.
--
-- A facility has always had tanks. It has never had the rest of itself: the
-- balneários, the sala de máquinas, the arrecadação, the receção, the car park.
-- Those are where most of the work of running a pool actually happens, and none
-- of it was recordable.
--
-- This is deliberately the seed of Módulo 2 (manutenção) rather than a
-- self-contained feature. The shape that matters is `maintenance_request`: it is
-- keyed on a facility and carries three *nullable* targets — a space, a tank, an
-- inventory item — so that when Módulo 2 arrives with equipment faults and pool
-- faults it extends this table instead of replacing it. Getting that wrong now
-- would mean a second issues table later, and two places to look for "what is
-- broken at this site" is the failure mode the module exists to prevent.
--
-- ---------------------------------------------------------------------------
-- What is deliberately absent
-- ---------------------------------------------------------------------------
--
-- **There is no `is_overdue` column and no `cleaning_status`.** Overdue is
-- `now() - last cleaning > interval`, computed in the query that renders the
-- list. A stored flag would need something to keep it true — a cron job or a
-- background worker — and per-tenant running cost is a design constraint on this
-- project, not a later optimisation. A derived answer costs one index; a stored
-- one costs a process that has to run forever and can be wrong in between.
--
-- `cleaning_log_latest` below is that index.

CREATE TYPE space_type AS ENUM (
  'changing_room',
  'technical',
  'storage',
  'reception',
  'outdoor',
  'other'
);

/*
 * `fault` and `restock`, in English, and the second one on purpose.
 *
 * The operator reads "Avaria" and "Reposição" — those are i18n keys, resolved in
 * the interface. The stored value is English because every other enum here is
 * (`indoor`, `not_started`, `past_due`), and because *reposição* is already
 * taken: `reposicao_mode`, `reposicao_credit`, `reposicao_booking_status` are a
 * whole module about make-up lessons owed to families. One word meaning two
 * unrelated things in one schema is how somebody joins the wrong table at
 * midnight.
 */
CREATE TYPE maintenance_request_type AS ENUM ('fault', 'restock');

CREATE TYPE maintenance_request_status AS ENUM ('open', 'resolved');

-- ---------------------------------------------------------------------------
-- space
-- ---------------------------------------------------------------------------
--
-- Not `room`: the concept has to hold the car park and the plant room as
-- comfortably as it holds a changing room.

CREATE TABLE space (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  name            text NOT NULL,
  type            space_type NOT NULL DEFAULT 'other',
  description     text,

  /*
   * `active` and `archived_at` are not two names for the same thing.
   *
   * `active = false` is "out of service" — the balneário is shut for building
   * works. It still exists, it still opens, its history is still there, and it
   * is **not overdue**, because nobody is going to clean a room that is closed.
   * That last part is the whole reason the flag earns its place.
   *
   * `archived_at` is deletion, Owner/Admin only, and it leaves the list.
   */
  active          boolean NOT NULL DEFAULT true,

  /*
   * Null means no schedule, and therefore never overdue — not "overdue
   * immediately". A car park nobody set an interval for must not shout.
   */
  expected_cleaning_interval_hours integer,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  -- The key `maintenance_request` and `inventory_item` hang off, so a row can be
  -- proved to sit at the same *site*, not merely in the same tenant.
  UNIQUE (organization_id, facility_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CHECK (btrim(name) <> ''),
  CHECK (description IS NULL OR btrim(description) <> ''),
  CHECK (expected_cleaning_interval_hours IS NULL
         OR expected_cleaning_interval_hours > 0)
);

COMMENT ON TABLE space IS
  'A non-pool area of a facility — balneário, sala de máquinas, arrecadação, receção, exterior. Cleaned and reported against; tanks live in pool.';

COMMENT ON COLUMN space.active IS
  'False means out of service: still listed, still openable, never overdue. Deletion is archived_at.';

COMMENT ON COLUMN space.expected_cleaning_interval_hours IS
  'Null means no cleaning schedule, and therefore never overdue. Never treat null as zero.';

-- Accent- and case-insensitive, matching inventory_item_name_uq, so "Balneário"
-- and "balneario" are one space. Partial, as every unique index on a
-- soft-deletable table here is: archiving a space and re-adding it next season
-- must not collide with a row nobody can see.
CREATE UNIQUE INDEX space_name_uq
  ON space (organization_id, facility_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX space_facility_idx
  ON space (organization_id, facility_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER space_updated_at BEFORE UPDATE ON space
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- cleaning_log
-- ---------------------------------------------------------------------------
--
-- Append-only from the interface: there is no edit control anywhere, because a
-- cleaning record is a claim about a moment and editing one is rewriting what
-- somebody said they did. Correcting a mistake means archiving the row, which is
-- Owner/Admin.

CREATE TABLE cleaning_log (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  /*
   * NOT NULL for now, and the "for now" is real: Módulo 2 may want to log a tank
   * clean or an equipment service against this table. Widening a column is a
   * one-line migration; splitting a table that grew two meanings is not.
   */
  space_id        uuid NOT NULL,

  -- The membership, never app_user. Who did this is a fact about a person *in
  -- this organization*, and the composite key is what stops it naming somebody
  -- from another tenant.
  performed_by    uuid NOT NULL,
  performed_at    timestamptz NOT NULL DEFAULT now(),
  note            text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, space_id)     REFERENCES space (organization_id, id),
  FOREIGN KEY (organization_id, performed_by) REFERENCES membership (organization_id, id),

  CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE cleaning_log IS
  'One row per cleaning of a space. Append-only from the UI; a mistake is archived, never edited.';

/*
 * The index the whole overdue calculation rides on.
 *
 * `WHERE archived_at IS NULL` is not an optimisation — it is the rule. An
 * archived log did not happen, so a space whose only cleaning was deleted goes
 * back to being overdue. If archived rows counted, deleting a wrong entry would
 * leave the space looking clean, which is the exact outcome a cleaning log
 * exists to prevent.
 */
CREATE INDEX cleaning_log_latest
  ON cleaning_log (organization_id, space_id, performed_at DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER cleaning_log_updated_at BEFORE UPDATE ON cleaning_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- maintenance_request
-- ---------------------------------------------------------------------------

CREATE TABLE maintenance_request (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  /*
   * Módulo 2's room to grow. Today only `space_id` is written; the other two are
   * here so that an equipment fault and a tank fault join this table rather than
   * arriving with a table of their own.
   *
   * Nothing yet requires exactly one of them to be set. A request naming only a
   * facility is a legitimate answer — "the front door lock is broken" belongs to
   * the site, not to a room — and a rule that guessed otherwise would have to be
   * unpicked by Módulo 2 on its first day.
   */
  space_id          uuid,
  pool_id           uuid,
  inventory_item_id uuid,

  type            maintenance_request_type NOT NULL,
  description     text NOT NULL,

  reported_by     uuid NOT NULL,
  reported_at     timestamptz NOT NULL DEFAULT now(),

  status          maintenance_request_status NOT NULL DEFAULT 'open',
  resolved_by     uuid,
  resolved_at     timestamptz,
  resolution_note text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  /*
   * All three target keys route through `facility_id`, so a present target is
   * proved to be at this site and not merely inside this tenant.
   *
   * They are MATCH SIMPLE, which is Postgres's default and is exactly what is
   * wanted here: when any column of the key is NULL the constraint is not
   * checked at all. A request with no space skips the space key entirely; one
   * *with* a space must satisfy it in full.
   */
  FOREIGN KEY (organization_id, facility_id, space_id)
    REFERENCES space (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, facility_id, pool_id)
    REFERENCES pool (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, facility_id, inventory_item_id)
    REFERENCES inventory_item (organization_id, facility_id, id),

  FOREIGN KEY (organization_id, reported_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, resolved_by) REFERENCES membership (organization_id, id),

  CHECK (btrim(description) <> ''),
  CHECK (resolution_note IS NULL OR btrim(resolution_note) <> ''),

  /*
   * The status and its evidence cannot disagree. An open request carrying a
   * resolver, or a resolved one carrying nobody, is a state no screen could
   * render honestly — so the database refuses it rather than leaving every
   * reader to guess which half is true.
   */
  CONSTRAINT maintenance_request_resolution_coherent CHECK (
    (status = 'open'
      AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR
    (status = 'resolved'
      AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

COMMENT ON TABLE maintenance_request IS
  'An issue reported at a facility. space_id, pool_id and inventory_item_id are nullable targets so Módulo 2 extends this table rather than replacing it.';

-- The open-issue count on the Espaços list, and the open-first ordering on the
-- space detail screen.
CREATE INDEX maintenance_request_open_idx
  ON maintenance_request (organization_id, space_id)
  WHERE status = 'open' AND archived_at IS NULL;

CREATE INDEX maintenance_request_facility_idx
  ON maintenance_request (organization_id, facility_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER maintenance_request_updated_at BEFORE UPDATE ON maintenance_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- USING governs what can be read and which rows may be changed; WITH CHECK
-- governs what may be written. Both, on all three — USING alone would let a row
-- be written into another tenant.

ALTER TABLE space               ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY space_tenant ON space
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY cleaning_log_tenant ON cleaning_log
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY maintenance_request_tenant ON maintenance_request
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON space               TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cleaning_log        TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_request TO poolse_app;

-- ---------------------------------------------------------------------------
-- The free-text inventory locations become spaces
-- ---------------------------------------------------------------------------
--
-- `inventory_item.location` was free text on purpose — round 5 decided a club
-- knows "balneário masculino" as a word, not as a record, and that the words it
-- types are the data that would tell us what to model. This is that data being
-- read: the words the clubs actually used are now the spaces.
--
-- **`location` is deliberately left in place.** Dropping it is a separate
-- follow-up, so the result of this backfill can be eyeballed against the
-- original text before anything becomes unrecoverable.

ALTER TABLE inventory_item
  ADD COLUMN space_id uuid,
  ADD FOREIGN KEY (organization_id, facility_id, space_id)
    REFERENCES space (organization_id, facility_id, id);

COMMENT ON COLUMN inventory_item.space_id IS
  'Where the item lives, once locations became spaces. Null is a real answer: an item nobody placed.';

CREATE INDEX inventory_item_space_idx
  ON inventory_item (organization_id, space_id)
  WHERE archived_at IS NULL AND space_id IS NOT NULL;

/*
 * One space per distinct location, per facility.
 *
 * Matched on `lower(strip_accents(btrim(...)))` — the same expression as
 * `space_name_uq`, and it has to be: grouping less strictly than the index would
 * make this INSERT fail on the first club that wrote both "Balneário" and
 * "balneario".
 *
 * The surviving spelling is the one on the earliest-created item. Deterministic,
 * re-runnable, and nothing to explain later; a most-common-spelling rule would
 * need a tie-break nobody would remember the reason for.
 *
 * Only non-archived items mint a space, so a location used once in 2023 by
 * something long since archived does not appear in the operator's list as a room
 * that no longer means anything. Archived items are still *linked* below where a
 * space exists, so nothing is lost when `location` is eventually dropped.
 */
INSERT INTO space (organization_id, facility_id, name, type)
SELECT
  i.organization_id,
  i.facility_id,
  (array_agg(btrim(i.location) ORDER BY i.created_at, i.id))[1],
  'other'
  FROM inventory_item i
 WHERE i.location IS NOT NULL
   AND btrim(i.location) <> ''
   AND i.archived_at IS NULL
 GROUP BY i.organization_id, i.facility_id, lower(strip_accents(btrim(i.location)))
    ON CONFLICT (organization_id, facility_id, lower(strip_accents(name)))
       WHERE archived_at IS NULL
       DO NOTHING;

-- Every item with a location that now has a space points at it, archived ones
-- included. An item with a null or blank location stays null — a space is never
-- invented for an item nobody placed.
UPDATE inventory_item i
   SET space_id = s.id
  FROM space s
 WHERE s.organization_id = i.organization_id
   AND s.facility_id     = i.facility_id
   AND s.archived_at IS NULL
   AND i.location IS NOT NULL
   AND btrim(i.location) <> ''
   AND lower(strip_accents(btrim(i.location))) = lower(strip_accents(s.name));

-- Down Migration
--
-- Clean: `inventory_item.location` was never modified, so the old shape returns
-- intact and the spaces minted from it simply go away.

DROP INDEX IF EXISTS inventory_item_space_idx;

ALTER TABLE inventory_item
  DROP CONSTRAINT IF EXISTS inventory_item_organization_id_facility_id_space_id_fkey,
  DROP COLUMN IF EXISTS space_id;

DROP POLICY IF EXISTS maintenance_request_tenant ON maintenance_request;
DROP POLICY IF EXISTS cleaning_log_tenant        ON cleaning_log;
DROP POLICY IF EXISTS space_tenant               ON space;

DROP TABLE IF EXISTS maintenance_request;
DROP TABLE IF EXISTS cleaning_log;
DROP TABLE IF EXISTS space;

DROP TYPE IF EXISTS maintenance_request_status;
DROP TYPE IF EXISTS maintenance_request_type;
DROP TYPE IF EXISTS space_type;
