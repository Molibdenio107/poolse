-- Up Migration
--
-- Free swim, entry passes and reception check-in — POOLSE-68, slice 1.
--
-- Somebody walks in, pays for one entry or a pack of ten, and swims. Until now
-- that was a paper ticket book at reception, and nobody knew how many people
-- were in the water at 19:00. Three tables and one definition:
--
--   * `pass_product` — what a site sells: a single entry, a pack of N, or a
--     pass valid between two dates. One table, the three shapes held by CHECK,
--     never a table per shape (the `fee_kind` reasoning, decisions 2026-09-08).
--   * `pass` — one sold pass, belonging to a person (`membership`) or, for a
--     single entry only, to nobody in particular.
--   * `pass_check_in` — one entry into one tank.
--   * `pool_occupancy()` — who is in the water now, read by the check-in
--     refusal, the reception screen and (slice 2) the dashboard card alike.
--
-- **A sale is an invoice line, never a parallel money table.** `invoice_line`
-- gains `pass_id`, beside `student_fee_id` and exactly as that one attaches: a
-- line charges a fee occurrence **or** a pass, by CHECK, never both and never
-- neither. A credit note on the sale line voids the pass — derived, never a
-- flag — because 2.2 already says a correction is a credit note.
--
-- **An anonymous single entry is a document with no payer.** The Portuguese
-- convention is "Consumidor final"; that phrase is the interface's to say in
-- the reader's language, so the document stores no name at all rather than a
-- Portuguese string a club reading in English would see. `payer_name` is null
-- exactly when both payer columns are, by CHECK.
--
-- **Uses remaining and expiry are derived.** `pass_current` computes both, and
-- there is no `uses_remaining` column: a counter is a second home for a fact the
-- check-in rows already hold, and the two drift the first time a mistaken entry
-- is cancelled.
--
-- **"In the water" is a default stay** — decisions 2026-10-11. A check-in
-- counts from `checked_in_at` until `checked_out_at`, or until the site's
-- `free_swim_stay_minutes` (90) has passed when nobody recorded one. Reception
-- may check somebody out early; nobody has to.

-- ---------------------------------------------------------------------------
-- The site's default stay
-- ---------------------------------------------------------------------------

ALTER TABLE facility
  ADD COLUMN free_swim_stay_minutes smallint NOT NULL DEFAULT 90,
  ADD CONSTRAINT facility_free_swim_stay_sane
    CHECK (free_swim_stay_minutes BETWEEN 15 AND 720);

COMMENT ON COLUMN facility.free_swim_stay_minutes IS
  'POOLSE-68: how long a free-swim check-in counts as in the water when nobody '
  'records a check-out. Read at query time, never copied onto a check-in, so '
  'changing it re-reads the present rather than rewriting history.';

-- ---------------------------------------------------------------------------
-- pass_product — what a site sells
-- ---------------------------------------------------------------------------

CREATE TYPE pass_kind AS ENUM ('single', 'pack', 'period');

COMMENT ON TYPE pass_kind IS
  'POOLSE-68: single = one entry on the day of sale; pack = N entries, '
  'optionally expiring; period = unlimited entries between two dates.';

CREATE TABLE pass_product (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  facility_id        uuid NOT NULL,

  kind               pass_kind NOT NULL,
  name               text NOT NULL,

  /* How many entries a pack holds. Null for the other two shapes: a single
   * entry is one by definition and a period pass has no count. */
  entries            smallint,

  /*
   * How long a sold pass is good for, in days from its first day.
   *
   * Required for a period pass (30 is a month), optional for a pack (null
   * means a pack never expires) and absent for a single entry, which is good
   * on the day it is sold and no other.
   */
  validity_days      smallint,

  -- Priced per docs/financials.md: gross, with the VAT already inside it.
  amount_cents       integer NOT NULL,
  vat_rate           numeric(5,2) NOT NULL DEFAULT 0,
  vat_exempt         boolean NOT NULL DEFAULT false,
  provenance         money_provenance NOT NULL DEFAULT 'contracted',
  amount_low_cents   integer,
  amount_high_cents  integer,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, facility_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),

  CONSTRAINT pass_product_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT pass_product_shape CHECK (
    CASE kind
      WHEN 'single' THEN entries IS NULL AND validity_days IS NULL
      WHEN 'pack'   THEN entries IS NOT NULL
      WHEN 'period' THEN entries IS NULL AND validity_days IS NOT NULL
    END
  ),
  CONSTRAINT pass_product_entries_sane CHECK (entries IS NULL OR entries BETWEEN 2 AND 500),
  CONSTRAINT pass_product_validity_sane CHECK (
    validity_days IS NULL OR validity_days BETWEEN 1 AND 3660
  ),
  CONSTRAINT pass_product_amount_sane CHECK (amount_cents >= 0),
  CONSTRAINT pass_product_vat_sane CHECK (vat_rate BETWEEN 0 AND 100),
  CONSTRAINT pass_product_vat_exempt_is_zero CHECK (NOT vat_exempt OR vat_rate = 0),
  -- A price somebody typed is a known rate, never a fact that happened.
  CONSTRAINT pass_product_not_actual CHECK (provenance <> 'actual'),
  CONSTRAINT pass_product_range_ordered CHECK (
    (amount_low_cents  IS NULL OR amount_low_cents  >= 0)
    AND (amount_high_cents IS NULL OR amount_high_cents >= 0)
    AND (amount_low_cents  IS NULL OR amount_low_cents  <= amount_cents)
    AND (amount_high_cents IS NULL OR amount_high_cents >= amount_cents)
  )
);

COMMENT ON TABLE pass_product IS
  'POOLSE-68: a free-swim product a site sells. One table, three shapes by CHECK. '
  'Editing a product reaches passes sold afterwards and none sold before — the '
  'pass and its invoice line snapshot what was sold.';

CREATE TRIGGER pass_product_updated_at BEFORE UPDATE ON pass_product
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX pass_product_name_uq
  ON pass_product (organization_id, facility_id, lower(name))
  WHERE archived_at IS NULL;

ALTER TABLE pass_product ENABLE ROW LEVEL SECURITY;
CREATE POLICY pass_product_tenant ON pass_product
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

GRANT SELECT, INSERT, UPDATE ON pass_product TO poolse_app;
REVOKE DELETE ON pass_product FROM poolse_app;

-- ---------------------------------------------------------------------------
-- pass — one sold pass
-- ---------------------------------------------------------------------------

CREATE TABLE pass (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  facility_id        uuid NOT NULL,
  product_id         uuid NOT NULL,

  /*
   * Whose it is. Null only for a single entry: a walk-in who comes back is a
   * person the club knows and their pack is theirs, while a one-off entry may
   * be sold to nobody in particular.
   */
  membership_id      uuid,

  /* The product's shape, snapshotted. A product edited from a pack of 10 to a
   * pack of 12 must not hand two free entries to everybody who bought one. */
  kind               pass_kind NOT NULL,
  entries            smallint,
  valid_from         date NOT NULL,
  valid_until        date,

  sold_at            timestamptz NOT NULL DEFAULT now(),
  sold_by            uuid,

  created_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, facility_id, product_id)
    REFERENCES pass_product (organization_id, facility_id, id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, sold_by) REFERENCES membership (organization_id, id),

  CONSTRAINT pass_owner_unless_single CHECK (membership_id IS NOT NULL OR kind = 'single'),
  CONSTRAINT pass_shape CHECK (
    CASE kind
      WHEN 'single' THEN entries = 1 AND valid_until = valid_from
      WHEN 'pack'   THEN entries >= 2
      WHEN 'period' THEN entries IS NULL AND valid_until IS NOT NULL
    END
  ),
  CONSTRAINT pass_dates_ordered CHECK (valid_until IS NULL OR valid_until >= valid_from)
);

COMMENT ON TABLE pass IS
  'POOLSE-68: one sold pass. Written once — its sale is the invoice line whose '
  'pass_id names it, and it ends by a credit note on that line, never an edit. '
  'Uses remaining, expiry and void are derived in pass_current.';
COMMENT ON COLUMN pass.valid_until IS
  'The last day the pass may be used, inclusive. Null only for a pack sold '
  'without an expiry.';

CREATE INDEX pass_membership_idx
  ON pass (organization_id, membership_id, sold_at DESC)
  WHERE membership_id IS NOT NULL;

ALTER TABLE pass ENABLE ROW LEVEL SECURITY;
CREATE POLICY pass_tenant ON pass
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Written once, and the grant is what says so — the same arrangement as
-- `invoice`. A void is a credit note; nothing about a pass is edited.
REVOKE UPDATE, DELETE ON pass FROM poolse_app;
GRANT SELECT, INSERT ON pass TO poolse_app;

-- ---------------------------------------------------------------------------
-- invoice — a document may have no payer
-- ---------------------------------------------------------------------------

ALTER TABLE invoice DROP CONSTRAINT invoice_payer_is_one_person;
ALTER TABLE invoice ALTER COLUMN payer_name DROP NOT NULL;

ALTER TABLE invoice
  ADD CONSTRAINT invoice_payer_at_most_one_person CHECK (
    payer_membership_id IS NULL OR payer_student_id IS NULL
  ),
  /*
   * No payer is "Consumidor final", and it is the only way to have no name.
   *
   * The phrase is the interface's, in the reader's language. Storing it here
   * would freeze a document at the language of whoever pressed the button —
   * the reason `invoice_line.description` holds only the club's own words.
   */
  ADD CONSTRAINT invoice_payer_named_unless_anonymous CHECK (
    (payer_name IS NULL) = (payer_membership_id IS NULL AND payer_student_id IS NULL)
  );

COMMENT ON COLUMN invoice.payer_name IS
  'The payer as the document says it, snapshotted. Null only for a document with '
  'no payer at all (an anonymous free-swim entry), which the interface renders '
  'as Consumidor final / Final consumer.';

-- ---------------------------------------------------------------------------
-- invoice_line — a line charges a fee occurrence or a pass
-- ---------------------------------------------------------------------------

ALTER TABLE invoice_line
  ALTER COLUMN student_id DROP NOT NULL,
  ALTER COLUMN student_fee_id DROP NOT NULL,
  ALTER COLUMN student_name DROP NOT NULL,
  ALTER COLUMN kind DROP NOT NULL,
  ADD COLUMN pass_id uuid,
  ADD FOREIGN KEY (organization_id, pass_id) REFERENCES pass (organization_id, id),
  ADD CONSTRAINT invoice_line_charges_one_thing CHECK (
    (student_fee_id IS NULL) <> (pass_id IS NULL)
  ),
  ADD CONSTRAINT invoice_line_fee_names_its_student CHECK (
    student_fee_id IS NULL
    OR (student_id IS NOT NULL AND student_name IS NOT NULL AND kind IS NOT NULL)
  ),
  ADD CONSTRAINT invoice_line_pass_has_no_student CHECK (
    pass_id IS NULL
    OR (student_id IS NULL AND student_name IS NULL AND kind IS NULL
        AND student_tax_number IS NULL AND lessons_per_week IS NULL)
  );

COMMENT ON COLUMN invoice_line.pass_id IS
  'POOLSE-68: the free-swim pass this line sold, or null for a fee line. Exactly '
  'one of student_fee_id and pass_id is set. A credit on this line voids the pass.';

-- One sale per pass. A pass sold twice would be paid for twice, and "is it
-- void" would have two answers.
CREATE UNIQUE INDEX invoice_line_one_sale_per_pass_uq
  ON invoice_line (pass_id)
  WHERE document_kind = 'invoice' AND pass_id IS NOT NULL;

-- The double-billing trigger is about fee occurrences; a pass line has none.
CREATE OR REPLACE FUNCTION invoice_line_not_already_charged() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_document_no text;
BEGIN
  IF NEW.document_kind <> 'invoice' OR NEW.student_fee_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_document_no := invoice_charged_on(
    NEW.organization_id, NEW.student_fee_id, NEW.period_start, NEW.id);

  IF v_document_no IS NOT NULL THEN
    RAISE EXCEPTION 'This period is already charged on %', v_document_no
      USING ERRCODE = 'unique_violation',
            DETAIL = 'invoice_line_already_charged|' || v_document_no;
  END IF;

  RETURN NULL;
END;
$$;

/*
 * A pass is never without the line that sold it.
 *
 * Deferred to the commit, because the pass has to exist before the line can
 * name it. Without this a sale that wrote the pass and then failed to write
 * the document — a bug, a refactor — would leave somebody holding ten free
 * entries nobody was charged for.
 */
CREATE FUNCTION pass_has_its_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM invoice_line l
     WHERE l.organization_id = NEW.organization_id
       AND l.pass_id = NEW.id
       AND l.document_kind = 'invoice'
  ) THEN
    RAISE EXCEPTION 'A pass is sold on an invoice line'
      USING ERRCODE = 'check_violation',
            DETAIL = 'pass_without_sale';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pass_sold_on_a_line
  AFTER INSERT ON pass
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pass_has_its_sale();

-- ---------------------------------------------------------------------------
-- pass_check_in — one entry into one tank
-- ---------------------------------------------------------------------------

CREATE TABLE pass_check_in (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  pass_id            uuid NOT NULL,
  pool_id            uuid NOT NULL,

  checked_in_at      timestamptz NOT NULL DEFAULT now(),
  /* Recorded only when reception checks somebody out early. Null means the
   * site's default stay decides — see pool_occupancy(). */
  checked_out_at     timestamptz,
  checked_in_by      uuid,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  /* A check-in entered by mistake. It no longer uses an entry or fills the tank,
   * and the row stays as the record of the mistake. */
  archived_at        timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, pass_id) REFERENCES pass (organization_id, id),
  FOREIGN KEY (organization_id, pool_id) REFERENCES pool (organization_id, id),
  FOREIGN KEY (organization_id, checked_in_by) REFERENCES membership (organization_id, id),

  CONSTRAINT pass_check_in_out_after_in CHECK (
    checked_out_at IS NULL OR checked_out_at >= checked_in_at
  )
);

COMMENT ON TABLE pass_check_in IS
  'POOLSE-68: one free-swim entry. A pack''s uses remaining is its entries minus '
  'its live rows here — derived, never a counter. Only checked_out_at and '
  'archived_at may change, and the column grant says so.';

CREATE TRIGGER pass_check_in_updated_at BEFORE UPDATE ON pass_check_in
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX pass_check_in_pass_idx
  ON pass_check_in (organization_id, pass_id)
  WHERE archived_at IS NULL;

CREATE INDEX pass_check_in_pool_idx
  ON pass_check_in (organization_id, pool_id, checked_in_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE pass_check_in ENABLE ROW LEVEL SECURITY;
CREATE POLICY pass_check_in_tenant ON pass_check_in
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE UPDATE, DELETE ON pass_check_in FROM poolse_app;
GRANT SELECT, INSERT ON pass_check_in TO poolse_app;
GRANT UPDATE (checked_out_at, archived_at) ON pass_check_in TO poolse_app;

-- ---------------------------------------------------------------------------
-- pass_current — a pass with everything derived about it
-- ---------------------------------------------------------------------------

CREATE VIEW pass_current WITH (security_invoker = true) AS
SELECT p.id,
       p.organization_id,
       p.facility_id,
       p.product_id,
       p.membership_id,
       p.kind,
       p.entries,
       p.valid_from,
       p.valid_until,
       p.sold_at,
       sale.id AS sale_line_id,
       sale.invoice_id AS sale_invoice_id,
       (credit.id IS NOT NULL) AS voided,
       coalesce(used.n, 0)::integer AS entries_used,
       CASE WHEN p.entries IS NULL THEN NULL
            ELSE greatest(p.entries - coalesce(used.n, 0), 0) END::integer AS entries_left,
       (p.valid_until IS NOT NULL
        AND p.valid_until < (now() AT TIME ZONE f.timezone)::date) AS expired
  FROM pass p
  JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
  LEFT JOIN invoice_line sale
    ON sale.pass_id = p.id AND sale.organization_id = p.organization_id
   AND sale.document_kind = 'invoice'
  LEFT JOIN invoice_line credit
    ON credit.credits_invoice_line_id = sale.id
   AND credit.organization_id = p.organization_id
   AND credit.document_kind = 'credit_note'
  LEFT JOIN LATERAL (
    SELECT count(*) AS n
      FROM pass_check_in c
     WHERE c.pass_id = p.id
       AND c.organization_id = p.organization_id
       AND c.archived_at IS NULL
  ) used ON true;

COMMENT ON VIEW pass_current IS
  'POOLSE-68: each pass with its derived standing — void (its sale line was '
  'credited), entries used and left, and expired against the site''s own date.';

-- ---------------------------------------------------------------------------
-- pool_occupancy — who is in the water, one definition
-- ---------------------------------------------------------------------------

/*
 * Free swimmers in the water plus the classes running now, at one instant.
 *
 * Read by the check-in trigger below, by the reception screen and by the
 * dashboard card, so the number the operator sees and the number that refuses
 * them are one number.
 *
 * **A class counts its people, never its ceiling.** A turma counts its active
 * enrolments — a turma of capacity 12 with 7 children fills the tank with 7.
 * A parceria counts the booking's headcount override, else the partner group's
 * participant count. Anything else counts its override or nothing.
 *
 * **`class_group` is LEFT joined**, and the tank is the session's own, else the
 * turma's, else any lane the session sits in: a parceria session carries no
 * turma and usually no `pool_id`, and an inner join is how partnership hours
 * have silently vanished three times in this schema.
 */
CREATE FUNCTION pool_occupancy(
  p_organization_id uuid,
  p_pool_id         uuid,
  p_at              timestamptz DEFAULT now()
) RETURNS TABLE (capacity integer, swimmers integer, in_classes integer)
LANGUAGE sql
STABLE
AS $$
  SELECT p.max_capacity,
         (SELECT count(*)::integer
            FROM pass_check_in c
           WHERE c.organization_id = p_organization_id
             AND c.pool_id = p_pool_id
             AND c.archived_at IS NULL
             AND c.checked_in_at <= p_at
             AND coalesce(c.checked_out_at,
                          c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
                 > p_at),
         (SELECT coalesce(sum(
                   CASE
                     WHEN cg.id IS NOT NULL THEN (
                       SELECT count(*) FROM enrollment e
                        WHERE e.class_group_id = cg.id
                          AND e.organization_id = s.organization_id
                          AND e.status = 'active')
                     ELSE coalesce(sch.headcount_override, pg.participant_count, 0)
                   END), 0)::integer
            FROM class_session s
            LEFT JOIN class_schedule sch
              ON sch.id = s.schedule_id AND sch.organization_id = s.organization_id
            LEFT JOIN class_group cg
              ON cg.id = coalesce(s.class_group_id, sch.class_group_id)
             AND cg.organization_id = s.organization_id
            LEFT JOIN partner_group pg
              ON pg.id = sch.partner_group_id AND pg.organization_id = s.organization_id
           WHERE s.organization_id = p_organization_id
             AND s.status <> 'cancelled'
             AND s.starts_at <= p_at
             AND s.ends_at > p_at
             AND (coalesce(s.pool_id, cg.pool_id) = p_pool_id
                  OR EXISTS (
                    SELECT 1 FROM class_session_lane sl
                      JOIN lane l ON l.id = sl.lane_id AND l.organization_id = sl.organization_id
                     WHERE sl.session_id = s.id
                       AND sl.organization_id = s.organization_id
                       AND NOT sl.cancelled
                       AND l.pool_id = p_pool_id)))
    FROM pool p
    JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
   WHERE p.id = p_pool_id
     AND p.organization_id = p_organization_id
$$;

COMMENT ON FUNCTION pool_occupancy(uuid, uuid, timestamptz) IS
  'POOLSE-68: free swimmers in the water (check-ins inside the default stay, or '
  'not yet checked out) and people in classes running now, for one tank. The '
  'one definition read by the check-in refusal, reception and the dashboard.';

-- ---------------------------------------------------------------------------
-- The check-in rules
-- ---------------------------------------------------------------------------

/*
 * Every reason an entry is refused, in the order reception would want them.
 *
 * Each refusal carries its figures in DETAIL, pipe-separated, for the API to
 * turn into a 409 with fields — the standing rule for refusals with numbers.
 *
 * **Two locks, always in this order: the pass, then the tank.** The pass lock
 * makes the last entry of a pack go to exactly one of two racing check-ins;
 * the tank lock does the same for the last place in the water, exactly as
 * `pool_capacity_respected` locks the pool for enrolments. The function is
 * volatile, so each count after a lock is a fresh snapshot that sees what the
 * transaction it waited for committed.
 */
CREATE FUNCTION pass_check_in_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pass      record;
  v_facility  uuid;
  v_timezone  text;
  v_day       date;
  v_used      integer;
  v_occ       record;
BEGIN
  -- An advisory lock rather than FOR UPDATE: a row lock needs an UPDATE grant,
  -- and `pass` deliberately has none.
  PERFORM pg_advisory_xact_lock(hashtextextended('pass:' || NEW.pass_id::text, 0));

  SELECT p.* INTO v_pass
    FROM pass p
   WHERE p.id = NEW.pass_id AND p.organization_id = NEW.organization_id;

  IF v_pass.id IS NULL THEN
    RAISE EXCEPTION 'No such pass' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT pl.facility_id, f.timezone INTO v_facility, v_timezone
    FROM pool pl
    JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
   WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
     AND pl.archived_at IS NULL;

  IF v_facility IS NULL OR v_facility <> v_pass.facility_id THEN
    RAISE EXCEPTION 'A pass is used at the site that sold it'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_wrong_site';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pass_current pc
     WHERE pc.id = v_pass.id AND pc.organization_id = NEW.organization_id AND pc.voided
  ) THEN
    RAISE EXCEPTION 'This pass was credited'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_void';
  END IF;

  v_day := (NEW.checked_in_at AT TIME ZONE v_timezone)::date;

  IF v_day < v_pass.valid_from THEN
    RAISE EXCEPTION 'This pass starts on %', v_pass.valid_from
      USING ERRCODE = 'check_violation',
            DETAIL = format('pass_not_yet|%s', v_pass.valid_from);
  END IF;

  IF v_pass.valid_until IS NOT NULL AND v_day > v_pass.valid_until THEN
    RAISE EXCEPTION 'This pass ended on %', v_pass.valid_until
      USING ERRCODE = 'check_violation',
            DETAIL = format('pass_expired|%s', v_pass.valid_until);
  END IF;

  IF v_pass.entries IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM pass_check_in c
     WHERE c.pass_id = v_pass.id
       AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL;

    IF v_used >= v_pass.entries THEN
      RAISE EXCEPTION 'All % entries on this pass are used', v_pass.entries
        USING ERRCODE = 'check_violation',
              DETAIL = format('pass_used_up|%s', v_pass.entries);
    END IF;
  END IF;

  -- One body in the water per pass. A pass belongs to a person, and two entries
  -- at once on one pass is either a mistake or a pass being shared.
  IF EXISTS (
    SELECT 1
      FROM pass_check_in c
      JOIN pool pl ON pl.id = c.pool_id AND pl.organization_id = c.organization_id
      JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
     WHERE c.pass_id = v_pass.id
       AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL
       AND c.checked_in_at <= NEW.checked_in_at
       AND coalesce(c.checked_out_at,
                    c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
           > NEW.checked_in_at
  ) THEN
    RAISE EXCEPTION 'This pass is already in the water'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_in_water';
  END IF;

  PERFORM 1 FROM pool pl
    WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
      FOR UPDATE;

  SELECT * INTO v_occ FROM pool_occupancy(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);

  IF v_occ.capacity IS NOT NULL
     AND v_occ.swimmers + v_occ.in_classes + 1 > v_occ.capacity THEN
    RAISE EXCEPTION 'The tank holds %; % are in the water', v_occ.capacity,
                    v_occ.swimmers + v_occ.in_classes
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_occupancy|%s|%s|1', v_occ.capacity,
                            v_occ.swimmers + v_occ.in_classes);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER pass_check_in_allowed BEFORE INSERT ON pass_check_in
  FOR EACH ROW EXECUTE FUNCTION pass_check_in_allowed();

/*
 * A cancelled check-in stays cancelled.
 *
 * Restoring one would hand back a place in the water and an entry on a pack
 * without either rule above being asked again. A check-in made by mistake and
 * cancelled by mistake is a new check-in.
 */
CREATE FUNCTION pass_check_in_no_restore() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'A cancelled check-in is not restored'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_check_in_cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pass_check_in_no_restore BEFORE UPDATE ON pass_check_in
  FOR EACH ROW EXECUTE FUNCTION pass_check_in_no_restore();

-- Down Migration

DROP TRIGGER IF EXISTS pass_check_in_no_restore ON pass_check_in;
DROP FUNCTION IF EXISTS pass_check_in_no_restore();
DROP TRIGGER IF EXISTS pass_check_in_allowed ON pass_check_in;
DROP FUNCTION IF EXISTS pass_check_in_allowed();
DROP FUNCTION IF EXISTS pool_occupancy(uuid, uuid, timestamptz);
DROP VIEW IF EXISTS pass_current;
DROP TABLE IF EXISTS pass_check_in;

-- Restoring the NOT NULLs below fails while a pass line or an anonymous
-- document exists, which is correct: those rows cannot be described by the
-- older schema, and dropping them silently would destroy invoices.
DROP INDEX IF EXISTS invoice_line_one_sale_per_pass_uq;
ALTER TABLE invoice_line
  DROP CONSTRAINT IF EXISTS invoice_line_pass_has_no_student,
  DROP CONSTRAINT IF EXISTS invoice_line_fee_names_its_student,
  DROP CONSTRAINT IF EXISTS invoice_line_charges_one_thing,
  DROP COLUMN IF EXISTS pass_id,
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN student_name SET NOT NULL,
  ALTER COLUMN student_fee_id SET NOT NULL,
  ALTER COLUMN student_id SET NOT NULL;

CREATE OR REPLACE FUNCTION invoice_line_not_already_charged() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_document_no text;
BEGIN
  IF NEW.document_kind <> 'invoice' THEN
    RETURN NULL;
  END IF;

  v_document_no := invoice_charged_on(
    NEW.organization_id, NEW.student_fee_id, NEW.period_start, NEW.id);

  IF v_document_no IS NOT NULL THEN
    RAISE EXCEPTION 'This period is already charged on %', v_document_no
      USING ERRCODE = 'unique_violation',
            DETAIL = 'invoice_line_already_charged|' || v_document_no;
  END IF;

  RETURN NULL;
END;
$$;

ALTER TABLE invoice
  DROP CONSTRAINT IF EXISTS invoice_payer_named_unless_anonymous,
  DROP CONSTRAINT IF EXISTS invoice_payer_at_most_one_person,
  ALTER COLUMN payer_name SET NOT NULL,
  ADD CONSTRAINT invoice_payer_is_one_person CHECK (
    (payer_membership_id IS NULL) <> (payer_student_id IS NULL)
  );

DROP TRIGGER IF EXISTS pass_sold_on_a_line ON pass;
DROP FUNCTION IF EXISTS pass_has_its_sale();
DROP TABLE IF EXISTS pass;
DROP TABLE IF EXISTS pass_product;
DROP TYPE IF EXISTS pass_kind;

ALTER TABLE facility
  DROP CONSTRAINT IF EXISTS facility_free_swim_stay_sane,
  DROP COLUMN IF EXISTS free_swim_stay_minutes;
