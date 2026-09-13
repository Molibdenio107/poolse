-- Up Migration
--
-- Staff salaries — POOLSE-58, roadmap slice 2.5.
--
-- What the club pays the people who teach in it. Poolse has always known every
-- hour they work and nothing about what they earn, so the one figure an owner
-- needs before opening a Saturday morning turma — what an hour in the water
-- costs in wages — lived in a spreadsheet nobody else could open.
--
-- **Gross only.** No IRS, no Segurança Social, no subsídio de alimentação, no
-- net pay. This records what somebody is paid; it does not compute what they
-- receive and it does not pay them. A product that gets a retenção na fonte
-- wrong is worse than one that never offered.
--
-- **`staff_membership_id`, not `staff_id`.** `membership` is the person in this
-- schema (see docs/data-model.md, "one person, many roles"), every reference to
-- one is named `*_membership_id`, and `staff_id` would read as a key into a
-- `staff` table that does not exist and must not be invented.
--
-- **Effective-dated, one rate live at a time.** A raise is a new row and the
-- previous one closes the day before; a correction is an UPDATE of the row that
-- was wrong. That is what makes "what did we pay in March" a question with an
-- answer, and it is why the overlap is enforced here rather than in a repository
-- method written tired.
--
-- **Derivation is display-only.** Monthly ↔ hourly is computed from the contract
-- every time it is shown — `packages/rules/src/compensation.ts`, one definition,
-- read by the API for the per-row figures and for the roll-up alike. A stored
-- hourly rate is a second definition that drifts from the first the day somebody
-- changes their hours, which is why there is no column for it, exactly as there
-- is no `is_overdue` and no `next_due_at`.
--
-- **Who may read it is not in this file, and cannot be.** An Admin may see every
-- staff member except the Owner (POOLSE-58). RLS answers "which tenant"; it does
-- not answer "which row within it", and pretending otherwise by writing the role
-- test into a policy would put an authorisation rule somewhere no test reads and
-- no error message can explain. It is resolved once in
-- `apps/api/src/staff/compensation.repository.ts` and fed to the list, the
-- history, the roll-up and the export, so those four cannot disagree.

CREATE TYPE compensation_kind AS ENUM ('monthly', 'hourly');

COMMENT ON TYPE compensation_kind IS
  'How the amount is expressed: a monthly salary, or a rate per hour. Named like fee_kind, and closed for the same reason — a third shape is a developer decision, not an operator one.';

CREATE TABLE staff_compensation (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),

  -- The person. A membership holding a staff role — owner, admin, instructor or
  -- maintenance — which is a rule the API enforces and the schema cannot: the
  -- roles are a child table, and a CHECK cannot read one.
  staff_membership_id uuid NOT NULL,

  kind            compensation_kind NOT NULL,

  /*
   * Gross, in integer minor units, like every other amount in this schema.
   *
   * For `monthly` this is the salary for one pay period. For `hourly` it is the
   * rate for one hour — cents rather than `numeric(12,6)`, unlike a per-kWh
   * tariff, because an hourly wage is quoted in cents and rounding one to the
   * cent loses nothing. €7.15/hour is 715 and is exact.
   */
  amount_cents    integer NOT NULL,

  /*
   * EUR today, and the column exists because the currency belongs to where the
   * club is rather than to this row.
   *
   * The CHECK is a guard, not a statement about the future: until `organization`
   * carries a currency of its own there is no path by which a non-EUR row could
   * be written deliberately, and a row no screen can render is worse than a
   * migration. Removing it is one ALTER on the day a club outside the euro area
   * signs up — decided 2026-09-13.
   */
  currency        char(3) NOT NULL DEFAULT 'EUR',

  /*
   * Contracted hours per week. Null means "not measured", as a null ceiling does
   * everywhere in this schema — it enforces nothing and it is never read as
   * zero. Without it the derived figure is `—` rather than a number, because a
   * monthly cost computed from unknown hours would read as free.
   */
  weekly_hours    numeric(5,2),

  /*
   * 14 is the Portuguese year — twelve months, subsídio de férias, subsídio de
   * Natal. 12 is the club that pays duodécimos. Nothing else is accepted,
   * because the two derivations above are wrong for any other value and a typo
   * here silently changes every figure on the roll-up.
   */
  pay_periods_per_year smallint NOT NULL DEFAULT 14,

  effective_from  date NOT NULL,
  /*
   * The LAST DAY at this rate, inclusive — what an operator means by "until the
   * 31st" — and null while it is the live one. The exclusion constraint below
   * ranges over `effective_to + 1` precisely because of this; see the note there.
   */
  effective_to    date,

  note            text,

  -- Who set it. Not nullable: a pay change with no author is not a record, and
  -- unlike `audit_log.actor_app_user_id` there is no legitimate way to reach
  -- this table without a membership.
  created_by_membership_id uuid NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, staff_membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES membership (organization_id, id),

  CONSTRAINT staff_compensation_amount_positive
    CHECK (amount_cents > 0),
  CONSTRAINT staff_compensation_hours_positive
    CHECK (weekly_hours IS NULL OR weekly_hours > 0),
  CONSTRAINT staff_compensation_periods_supported
    CHECK (pay_periods_per_year IN (12, 14)),
  CONSTRAINT staff_compensation_currency_eur
    CHECK (currency = 'EUR'),
  CONSTRAINT staff_compensation_dates_ordered
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE staff_compensation IS
  'What a staff member is paid, gross, effective-dated. One live rate per person at a time, enforced by staff_compensation_no_overlap. Owner and Admin only, and an Admin may not see the Owner''s — POOLSE-58.';

COMMENT ON COLUMN staff_compensation.effective_to IS
  'The last day at this rate, inclusive. Null while it is the live one.';

COMMENT ON COLUMN staff_compensation.weekly_hours IS
  'Contracted hours per week. Null means not measured: the derived figure becomes a dash, never zero.';

COMMENT ON COLUMN staff_compensation.archived_at IS
  'Soft delete. Archiving the live rate leaves the person with no live rate — the previous one stays closed and does not reopen, because a closed rate reopening is a pay change nobody made.';

/*
 * One live rate per person at a time.
 *
 * `btree_gist` supplies the uuid equality; two earlier migrations already create
 * it and this one creates it again, because a migration that depends on another
 * migration's extension is a migration that fails on a fresh database the day
 * the order changes.
 *
 * **The `+ 1` is the whole point.** `effective_to` is the last day at that rate,
 * so a rate ending 31 October covers the 31st and the next may start on
 * 1 November. A bare `daterange(effective_from, effective_to)` is half-open at
 * the top, which would read the closing date as exclusive and happily admit a
 * second rate starting on the 31st — two live rates for one person on one day,
 * which is the single thing this constraint exists to prevent. Same shape as
 * `student_medical_leave_no_overlap`.
 *
 * Archived rows are outside it: a rate archived in error and re-entered must not
 * collide with the row nobody can see, which is the partial-index rule this
 * schema applies to every soft-deletable unique constraint.
 */
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE staff_compensation
  ADD CONSTRAINT staff_compensation_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    staff_membership_id WITH =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (archived_at IS NULL);

-- The read every screen makes: this person's rates, newest first. Also the read
-- the list makes once per row, looking for the live one.
CREATE INDEX staff_compensation_person_idx
  ON staff_compensation (organization_id, staff_membership_id, effective_from DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER staff_compensation_updated_at
  BEFORE UPDATE ON staff_compensation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE staff_compensation ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_compensation_tenant ON staff_compensation
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_compensation TO poolse_app;

-- Down Migration

DROP POLICY IF EXISTS staff_compensation_tenant ON staff_compensation;
DROP TABLE IF EXISTS staff_compensation;
DROP TYPE IF EXISTS compensation_kind;
