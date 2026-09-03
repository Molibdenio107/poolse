-- Up Migration
--
-- Parcerias: partners, contacts, agreements and groups — POOLSE-47.
--
-- A municipal pool sells most of its water in blocks to organisations, not to
-- families. The reference club's whole morning is `ES D. Dinis` booked per
-- school class, `EPA`, `Teresianas`, `Misericórdia (Hidroterapia)`, `JI Vinha`,
-- `CAID` and `Andebol Sub 16` — none of which has a single student record, and
-- none of which Poolse could represent. So the product showed a club its pool
-- was empty all morning when in fact it was full and paid for.
--
-- Five tables, each keyed compositely to its parent, and one long-promised
-- foreign key: `class_schedule.partner_group_id` has been a column with no
-- reference since POOLSE-46, which said in a comment that this migration would
-- close it. It does.
--
-- **The group is the bookable thing, not the partner.** `6A` goes on the grid;
-- `ES D. Dinis` does not. A school books thirty class-groups across a week and
-- each is its own row with its own size, level and instructor arrangement —
-- booking "the school" would be one cell that means thirty different things.
--
-- **A partner belongs to one facility.** A school using two of the club's pools
-- is two partner rows. Considered and accepted: the agreement, the price and the
-- contact are all per building, and one partner spanning sites would turn every
-- one of those into a list.

-- ---------------------------------------------------------------------------
-- The three closed sets
-- ---------------------------------------------------------------------------
--
-- Enums rather than lookup tables, and the test is the one this repo already
-- uses: does an operator add a value, or does a developer? A club does not
-- invent a ninth kind of counterparty on a Tuesday, and `outro` is the escape
-- hatch that keeps the list closed honestly. Same for billing: the four models
-- are how lane time is sold, and a fifth is a schema change with an invoice
-- shape behind it, not a row.

CREATE TYPE partner_type AS ENUM (
  'escola',
  'agrupamento',
  'ipss_misericordia',
  'jardim_infancia',
  'clube',
  'camara',
  'empresa',
  'outro'
);

CREATE TYPE partner_status AS ENUM ('ativa', 'inativa');

CREATE TYPE partner_billing_model AS ENUM (
  'por_hora_pista',
  'por_bloco',
  'por_participante',
  'mensal_fixo'
);

-- ---------------------------------------------------------------------------
-- partner
-- ---------------------------------------------------------------------------

CREATE TABLE partner (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  facility_id     uuid NOT NULL,

  name            text NOT NULL,
  type            partner_type NOT NULL,

  nif             text,
  address         text,
  notes           text,

  /*
   * `inativa` hides a partner from the pickers without destroying its history —
   * criterion 7. A partnership that lapsed in June still explains last season's
   * grid, and archiving it would take the explanation away with it. Two
   * different retirements, deliberately: `status` is "not currently selling them
   * water", `archived_at` is "this row was a mistake".
   */
  status          partner_status NOT NULL DEFAULT 'ativa',

  /*
   * Drives the partner's cells on the lane grid. Never the only cue — the cell
   * carries the group name as text as well, which is the standing rule and the
   * reason this column is allowed to exist at all.
   */
  color           text NOT NULL DEFAULT '#67a6b6',

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  -- What makes the child tables' composite keys possible. Must exist before they
  -- are created, which is why it is here and not an afterthought.
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CONSTRAINT partner_name_not_blank CHECK (btrim(name) <> ''),
  -- Nine digits, the Portuguese NIF. Blank is not a NIF; absent is.
  CONSTRAINT partner_nif_shape CHECK (nif IS NULL OR nif ~ '^[0-9]{9}$'),
  CONSTRAINT partner_color_shape CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

COMMENT ON TABLE partner IS
  'An organisation that buys pool time at one facility. Its groups are what get booked.';
COMMENT ON COLUMN partner.status IS
  'inativa hides it from pickers and keeps its history. Not the same as archived.';

-- Partial, as every unique index on a soft-deletable table here is, and on
-- lower(strip_accents(...)) because "Misericórdia" and "misericordia" are the
-- same counterparty typed by two different people — criterion 3.
CREATE UNIQUE INDEX partner_name_uq
  ON partner (organization_id, facility_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX partner_facility_idx
  ON partner (organization_id, facility_id, status)
  WHERE archived_at IS NULL;

CREATE TRIGGER partner_updated_at BEFORE UPDATE ON partner
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- partner_contact
-- ---------------------------------------------------------------------------
--
-- Several per partner, because a school has a head of department who agrees the
-- timetable and an office that pays the invoice, and ringing the wrong one
-- wastes a morning.

CREATE TABLE partner_contact (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  partner_id      uuid NOT NULL,

  name            text NOT NULL,
  role            text,
  email           text,
  phone           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, partner_id) REFERENCES partner (organization_id, id),

  CONSTRAINT partner_contact_name_not_blank CHECK (btrim(name) <> ''),
  /*
   * A contact with neither an email nor a telephone is a name in a box.
   *
   * Deliberately *not* the guardian rule — `guardian_needs_a_key` demands a NIF
   * or an email because a guardian has to be deduplicable against other people.
   * A partner contact is not a person in the register and is never merged, so a
   * telephone number is a perfectly good way to reach them.
   */
  CONSTRAINT partner_contact_reachable
    CHECK (nullif(btrim(coalesce(email, '')), '') IS NOT NULL
        OR nullif(btrim(coalesce(phone, '')), '') IS NOT NULL)
);

COMMENT ON TABLE partner_contact IS
  'A person to ring at a partner organisation. Not a membership and never merged.';

CREATE INDEX partner_contact_partner_idx
  ON partner_contact (organization_id, partner_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER partner_contact_updated_at BEFORE UPDATE ON partner_contact
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- partner_agreement
-- ---------------------------------------------------------------------------

CREATE TABLE partner_agreement (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  partner_id      uuid NOT NULL,

  /*
   * Nullable, meaning "runs until it is ended" — the ticket's open question,
   * answered its recommended way.
   *
   * A two-year contract with a school does not stop existing because the club
   * rolled its season over in September, and making somebody re-enter it every
   * year is how a contract quietly goes missing. `start_date` and `end_date` are
   * the truth about when it applies; `season_id` only says which season's
   * planning it was entered against, when it was entered against one.
   */
  season_id       uuid,

  start_date      date NOT NULL,
  end_date        date,

  billing_model   partner_billing_model NOT NULL,

  /*
   * A **unit** price, and therefore `numeric(12,6)` — not cents.
   *
   * This is the thing the ticket says is most likely to be got wrong, and it is
   * worth the sentence: a lane-hour at €14.375 stored as 1437 cents is wrong by
   * half a cent an hour, which is nothing, until it is multiplied by six lanes
   * by thirty weeks and becomes real money in the report whose entire job is to
   * be the number the club invoices. CLAUDE.md's rule, and this is the case it
   * exists for.
   *
   * Gross, IVA included, exactly as `fee_plan.amount_cents` is — the club quotes
   * a partner the price it will charge, not a net figure plus arithmetic.
   */
  unit_price      numeric(12,6) NOT NULL,

  /*
   * Null means isento — criterion 5.
   *
   * `fee_plan` deliberately has no rate column, and that decision stands for
   * mensalidades: a family's price is advertised gross, Art. 9.º CIVA exempts
   * most sports tuition, and a rate nobody maintains is a rate something
   * eventually trusts. A partnership is the case that reasoning does not cover.
   * It invoices an *organisation* against a NIF — `empresa` is one of the eight
   * types — where the exemption often does not apply, and the rate is a
   * negotiated term written on a signed contract, so somebody does maintain it.
   *
   * Stored as a fraction: 0.2300 is 23%. Null is not "unknown", it is isento,
   * and the interface says so in words rather than leaving a blank cell.
   */
  vat_rate        numeric(5,4),

  -- How often it is invoiced. The same vocabulary the fee periods use, but by
  -- name rather than by foreign key: a partnership's cadence is a term of its
  -- own contract and must not move when somebody edits the facility's default.
  payment_period  text,

  notes           text,

  /*
   * The signed contract — criterion 6.
   *
   * Modelled now, written by nothing, and the control that would fill it is
   * visibly disabled with the reason named. Exactly the position `pool_photo`,
   * `facility_photo` and the student photograph are in: one storage decision
   * unblocks all four, and a picker that opened and then lost the file would be
   * worse than a control that says why it cannot.
   */
  document_key    text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, partner_id) REFERENCES partner (organization_id, id),
  FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),

  CONSTRAINT partner_agreement_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT partner_agreement_price_sane CHECK (unit_price >= 0),
  CONSTRAINT partner_agreement_vat_sane
    CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate < 1)),
  CONSTRAINT partner_agreement_document_key_not_blank
    CHECK (document_key IS NULL OR btrim(document_key) <> '')
);

COMMENT ON TABLE partner_agreement IS
  'What a partner pays and on what basis. Gross unit price; a null vat_rate means isento.';
COMMENT ON COLUMN partner_agreement.unit_price IS
  'A unit price, numeric(12,6) — never cents. A lane-hour at 14.375 must survive multiplication.';
COMMENT ON COLUMN partner_agreement.vat_rate IS
  'Fraction: 0.2300 is 23%. Null is isento, not unknown.';

CREATE INDEX partner_agreement_partner_idx
  ON partner_agreement (organization_id, partner_id, start_date DESC)
  WHERE archived_at IS NULL;

CREATE TRIGGER partner_agreement_updated_at BEFORE UPDATE ON partner_agreement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- partner_group — the bookable thing
-- ---------------------------------------------------------------------------

CREATE TABLE partner_group (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization (id),
  partner_id            uuid NOT NULL,

  -- `6A`, `10G 11B`, `Hidroterapia`. Whatever the school calls it on its own
  -- timetable, because that is what the two sides will say on the telephone.
  name                  text NOT NULL,

  /*
   * Zero is a real answer, not a missing one.
   *
   * A club agrees the timetable in July and finds out in September how many
   * children actually turn up. `NOT NULL DEFAULT 0` says "not sized yet" without
   * inventing a number, and the occupancy reports can tell zero from null
   * because there is no null to tell it from.
   */
  participant_count     integer NOT NULL DEFAULT 0,

  -- Optional, and a suggestion rather than a constraint — the same relationship
  -- `fee_plan.level_id` has. A school class pointed at a level inherits its
  -- capacity guidance; one that is not is perfectly ordinary.
  level_id              uuid,

  /*
   * The school sends its own teacher.
   *
   * This is what makes a booking's `instructor_status` `external` — POOLSE-46
   * defined the enum, and this is the column that decides it. A partner group
   * with its own instructor must never appear in the "sem professor" alert
   * POOLSE-53 raises, because it is not missing one.
   */
  brings_own_instructor boolean NOT NULL DEFAULT false,
  own_instructor_name   text,

  -- `DE` for desporto escolar, and whatever else a club writes in the margin.
  tag                   text,
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, partner_id) REFERENCES partner (organization_id, id),
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),

  CONSTRAINT partner_group_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT partner_group_count_sane CHECK (participant_count >= 0),
  -- A name is only kept for a group that brings somebody. Otherwise it is a
  -- leftover from a flag somebody turned off, and it would still be printed.
  CONSTRAINT partner_group_own_instructor
    CHECK (brings_own_instructor OR own_instructor_name IS NULL)
);

COMMENT ON TABLE partner_group IS
  'A partner''s class or squad. This — not the partner — is what a booking references.';

CREATE UNIQUE INDEX partner_group_name_uq
  ON partner_group (organization_id, partner_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX partner_group_partner_idx
  ON partner_group (organization_id, partner_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER partner_group_updated_at BEFORE UPDATE ON partner_group
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- The nominal roster, modelled and unused
-- ---------------------------------------------------------------------------
--
-- Criterion 10. Names only — a school's swimmers have no Poolse accounts and are
-- not people in the register, which is the whole point: the club is selling lane
-- time, not enrolling thirty children.
--
-- Shipped with the control visibly disabled, because the club may simply not
-- have the list, and a screen that demands data nobody holds reads as broken.
-- The table exists so that turning the control on later is a UI change rather
-- than a migration during a support call.

CREATE TABLE partner_group_member (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  partner_group_id uuid NOT NULL,

  full_name        text NOT NULL,
  notes            text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, partner_group_id)
    REFERENCES partner_group (organization_id, id),

  CONSTRAINT partner_group_member_name_not_blank CHECK (btrim(full_name) <> '')
);

COMMENT ON TABLE partner_group_member IS
  'Nominal roster of a partner group. Names only, no accounts. Modelled; the UI is disabled.';

CREATE INDEX partner_group_member_group_idx
  ON partner_group_member (organization_id, partner_group_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER partner_group_member_updated_at BEFORE UPDATE ON partner_group_member
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Five tables, five policies, both USING and WITH CHECK on every one. USING
-- alone governs reads and would leave a write into another tenant unopposed.

ALTER TABLE partner ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_tenant ON partner
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON partner TO poolse_app;

ALTER TABLE partner_contact ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_contact_tenant ON partner_contact
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON partner_contact TO poolse_app;

ALTER TABLE partner_agreement ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_agreement_tenant ON partner_agreement
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON partner_agreement TO poolse_app;

ALTER TABLE partner_group ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_group_tenant ON partner_group
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON partner_group TO poolse_app;

ALTER TABLE partner_group_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_group_member_tenant ON partner_group_member
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON partner_group_member TO poolse_app;

-- ---------------------------------------------------------------------------
-- The foreign key POOLSE-46 promised
-- ---------------------------------------------------------------------------
--
-- `class_schedule.partner_group_id` has been a bare uuid since the bookings
-- migration, which said in a comment that the reference would arrive with this
-- ticket. Nothing has written a non-null value in the meantime — the subject
-- CHECK requires `subject_type = 'parceria'` and no writer set that — so there
-- is nothing to backfill and nothing to clean up.

ALTER TABLE class_schedule
  ADD CONSTRAINT class_schedule_partner_group_fkey
    FOREIGN KEY (organization_id, partner_group_id)
      REFERENCES partner_group (organization_id, id);

CREATE INDEX class_schedule_partner_group_idx
  ON class_schedule (organization_id, partner_group_id)
  WHERE archived_at IS NULL AND partner_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Which season a booking belongs to
-- ---------------------------------------------------------------------------
--
-- A gap POOLSE-46 left that this ticket is the first to fall into.
--
-- A turma booking's season is its turma's — `class_group.season_id`, NOT NULL
-- since POOLSE-07. A parceria booking has no turma, so until now it had no
-- season at all, and criterion 8 asks for horas/semana "computed over the
-- published season". There was nothing to compute it against.
--
-- **The column is null for a turma and required for a parceria**, which is the
-- one arrangement that does not create a second answer to a question that
-- already has one. Deriving it from `slot_id` was the alternative and does not
-- work: a booking matching no slot renders "fora da grelha" with a null slot,
-- and those are exactly the bookings a club improvises mid-season.
--
--   the season of a booking := coalesce(class_schedule.season_id, class_group.season_id)
--
-- **An evento or a manutenção may have a season, or may not.** That is not
-- laxness left over from the turma rule — a maintenance window in the August gap
-- between two seasons genuinely belongs to neither, and demanding one would make
-- the club attach the shutdown to a season it does not fall in. A gala inside the
-- year is the other case and is free to name its season. Only a parceria is
-- required to, because a partnership is contracted per season and criterion 8
-- counts its hours against one.
--
-- Written down here because it becomes load-bearing for every occupancy query in
-- POOLSE-49 through 52.

ALTER TABLE class_schedule ADD COLUMN season_id uuid;

ALTER TABLE class_schedule
  ADD CONSTRAINT class_schedule_season_fkey
    FOREIGN KEY (organization_id, season_id) REFERENCES season (organization_id, id),
  /*
   * A turma never carries a season; a parceria always does.
   *
   * Both halves matter. Without the first, a turma booking could grow a season
   * that disagrees with its class_group's and nothing could say which one
   * occupancy should believe. Without the second, a partnership's hours cannot
   * be attributed to the season they were contracted for, which is criterion 8.
   *
   * Evento and manutenção sit between the two deliberately — see the header.
   */
  ADD CONSTRAINT class_schedule_season_source CHECK (
    CASE subject_type
      WHEN 'turma'    THEN season_id IS NULL
      WHEN 'parceria' THEN season_id IS NOT NULL
      ELSE true
    END
  );

COMMENT ON COLUMN class_schedule.season_id IS
  'Null for a turma — its season is its class_group''s. Required for a parceria; optional otherwise.';

CREATE INDEX class_schedule_season_idx
  ON class_schedule (organization_id, season_id)
  WHERE archived_at IS NULL AND season_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS class_schedule_season_idx;
ALTER TABLE class_schedule
  DROP CONSTRAINT IF EXISTS class_schedule_season_source,
  DROP CONSTRAINT IF EXISTS class_schedule_season_fkey,
  DROP COLUMN IF EXISTS season_id;

DROP INDEX IF EXISTS class_schedule_partner_group_idx;
ALTER TABLE class_schedule
  DROP CONSTRAINT IF EXISTS class_schedule_partner_group_fkey;

DROP TABLE IF EXISTS partner_group_member;
DROP TABLE IF EXISTS partner_group;
DROP TABLE IF EXISTS partner_agreement;
DROP TABLE IF EXISTS partner_contact;
DROP TABLE IF EXISTS partner;

DROP TYPE IF EXISTS partner_billing_model;
DROP TYPE IF EXISTS partner_status;
DROP TYPE IF EXISTS partner_type;
