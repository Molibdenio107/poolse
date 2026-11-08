-- Up Migration
--
-- A family pack, who swam on each entry, and packs bought from the phone —
-- POOLSE-204 (Rui, 08-11-2026).
--
-- * `pass_product.shareable` — a *Pack família*: its pass is used by the
--   payer and the children they guard today (`pass_family()`). It sells at its
--   own base price: a category-priced pass is personal (POOLSE-203), so
--   `pass_price_for()` never applies a category price to a shareable product.
-- * `pass_product.sold_in_app` — the club offers it on the phone.
-- * `pass.student_id` — a child may hold a personal pass (Rui, 08-11-2026);
--   a pass is held by a login **or** a student, never both.
-- * `pass.shared`, `pass.sold_via`, `pass.purchase_key` — snapshotted at the
--   sale like everything else on a pass. An `app` pass works only once its
--   line is paid; the key makes a double tap one document.
-- * `pass_check_in.membership_id` / `student_id` — who swam. One check-in per
--   person: on a shared pass two people may be in the water at once, never the
--   same person twice. The entry count stays derived.

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

ALTER TABLE pass_product
  ADD COLUMN shareable   boolean NOT NULL DEFAULT false,
  ADD COLUMN sold_in_app boolean NOT NULL DEFAULT false;

-- A single entry is one person on one day; nothing to share.
ALTER TABLE pass_product
  ADD CONSTRAINT pass_product_shareable_not_single CHECK (NOT shareable OR kind <> 'single');

COMMENT ON COLUMN pass_product.shareable IS
  'POOLSE-204: a Pack família. Its pass is used by the holder and the children they '
  'guard today (pass_family). Sold at its base price; categories never price it.';
COMMENT ON COLUMN pass_product.sold_in_app IS
  'POOLSE-204: offered for purchase in the family app.';

-- ---------------------------------------------------------------------------
-- Passes
-- ---------------------------------------------------------------------------

CREATE TYPE pass_sold_via AS ENUM ('reception', 'app');

ALTER TABLE pass
  ADD COLUMN student_id   uuid,
  ADD COLUMN shared       boolean NOT NULL DEFAULT false,
  ADD COLUMN sold_via     pass_sold_via NOT NULL DEFAULT 'reception',
  ADD COLUMN purchase_key uuid;

ALTER TABLE pass
  ADD CONSTRAINT pass_student_fkey
    FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id);

ALTER TABLE pass DROP CONSTRAINT pass_owner_unless_single;
ALTER TABLE pass
  ADD CONSTRAINT pass_owner_unless_single
    CHECK (membership_id IS NOT NULL OR student_id IS NOT NULL OR kind = 'single'),
  ADD CONSTRAINT pass_one_holder CHECK (membership_id IS NULL OR student_id IS NULL),
  -- The family is the holder's: a shared pass is held by a login, the payer.
  ADD CONSTRAINT pass_shared_held_by_a_login CHECK (NOT shared OR membership_id IS NOT NULL),
  ADD CONSTRAINT pass_app_sale_has_key CHECK (sold_via = 'reception' OR purchase_key IS NOT NULL);

CREATE UNIQUE INDEX pass_purchase_key_uq
  ON pass (organization_id, purchase_key) WHERE purchase_key IS NOT NULL;

CREATE INDEX pass_student_idx
  ON pass (organization_id, student_id, sold_at DESC) WHERE student_id IS NOT NULL;

COMMENT ON COLUMN pass.student_id IS
  'POOLSE-204: a child''s personal pass. Exactly one of membership_id and student_id '
  'holds a pass, or neither for an anonymous single entry.';
COMMENT ON COLUMN pass.sold_via IS
  'POOLSE-204: reception (paid at the counter) or app (owed; refused at check-in until paid).';

-- ---------------------------------------------------------------------------
-- Who swam
-- ---------------------------------------------------------------------------

ALTER TABLE pass_check_in
  ADD COLUMN membership_id uuid,
  ADD COLUMN student_id    uuid;

ALTER TABLE pass_check_in
  ADD CONSTRAINT pass_check_in_membership_fkey
    FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  ADD CONSTRAINT pass_check_in_student_fkey
    FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  ADD CONSTRAINT pass_check_in_one_swimmer CHECK (membership_id IS NULL OR student_id IS NULL);

-- Every entry so far was the holder's: a pass was personal until now.
UPDATE pass_check_in c
   SET membership_id = p.membership_id
  FROM pass p
 WHERE p.id = c.pass_id AND p.organization_id = c.organization_id
   AND p.membership_id IS NOT NULL;

COMMENT ON COLUMN pass_check_in.membership_id IS
  'POOLSE-204: who swam, a login; or student_id; neither only on an anonymous single entry.';

-- ---------------------------------------------------------------------------
-- Who may use a pass
-- ---------------------------------------------------------------------------

/*
 * The holder; and on a shared pass, also every child the holder is a live
 * guardian of today. Read at check-in time, so an archived guardian link takes
 * the child off the family pack at once. Invoker, so RLS applies.
 */
CREATE FUNCTION pass_family(p_org uuid, p_pass_id uuid)
RETURNS TABLE (membership_id uuid, student_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT p.membership_id, p.student_id
    FROM pass p
   WHERE p.organization_id = p_org AND p.id = p_pass_id
     AND (p.membership_id IS NOT NULL OR p.student_id IS NOT NULL)
  UNION
  SELECT NULL::uuid, g.student_id
    FROM pass p
    JOIN guardian_link g
      ON g.organization_id = p.organization_id
     AND g.guardian_membership_id = p.membership_id
     AND g.archived_at IS NULL
    JOIN student s
      ON s.organization_id = g.organization_id AND s.id = g.student_id
     AND s.archived_at IS NULL
   WHERE p.organization_id = p_org AND p.id = p_pass_id AND p.shared
$$;

COMMENT ON FUNCTION pass_family(uuid, uuid) IS
  'POOLSE-204: who may check in on a pass — its holder, plus on a shared pass the '
  'children the holder guards today. The one definition.';

-- ---------------------------------------------------------------------------
-- Whether a pass is paid
-- ---------------------------------------------------------------------------

-- New columns at the end, as CREATE OR REPLACE VIEW requires.
CREATE OR REPLACE VIEW pass_current WITH (security_invoker = true) AS
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
        AND p.valid_until < (now() AT TIME ZONE f.timezone)::date) AS expired,
       p.student_id,
       p.shared,
       p.sold_via,
       -- Paid: what was taken against the sale's document covers its lines.
       (coalesce(money.paid, 0) >= coalesce(money.total, 0)) AS paid
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
  ) used ON true
  LEFT JOIN LATERAL (
    SELECT (SELECT sum(l.amount_cents) FROM invoice_line l
             WHERE l.invoice_id = sale.invoice_id AND l.organization_id = p.organization_id) AS total,
           (SELECT sum(pay.amount_cents) FROM invoice_payment pay
             WHERE pay.invoice_id = sale.invoice_id AND pay.organization_id = p.organization_id
               AND pay.archived_at IS NULL) AS paid
  ) money ON true;

-- ---------------------------------------------------------------------------
-- The check-in rules
-- ---------------------------------------------------------------------------

/*
 * The body of 1790848800000 (closures), with three POOLSE-204 additions:
 *
 * 1. **Who swam.** Not named: a personal pass is its holder's; a shared pass
 *    must name the person. Named: they must be in `pass_family()`.
 * 2. **Paid before use** for a pass bought on the phone.
 * 3. **One check-in per person**: on a shared pass the in-water test is per
 *    swimmer, so a parent and a child may swim together on one pack.
 */
CREATE OR REPLACE FUNCTION pass_check_in_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pass      record;
  v_facility  uuid;
  v_timezone  text;
  v_day       date;
  v_used      integer;
  v_occ       record;
  v_closed    record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pass:' || NEW.pass_id::text, 0));

  SELECT p.* INTO v_pass
    FROM pass p
   WHERE p.id = NEW.pass_id AND p.organization_id = NEW.organization_id;

  IF v_pass.id IS NULL THEN
    RAISE EXCEPTION 'No such pass' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- POOLSE-204, 1: who swam.
  IF NEW.membership_id IS NULL AND NEW.student_id IS NULL THEN
    IF v_pass.shared THEN
      RAISE EXCEPTION 'Say who is swimming on this family pack'
        USING ERRCODE = 'check_violation', DETAIL = 'pass_who_required';
    END IF;
    NEW.membership_id := v_pass.membership_id;
    NEW.student_id := v_pass.student_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pass_family(NEW.organization_id, v_pass.id) fam
     WHERE (NEW.membership_id IS NOT NULL AND fam.membership_id = NEW.membership_id)
        OR (NEW.student_id IS NOT NULL AND fam.student_id = NEW.student_id)
  ) THEN
    RAISE EXCEPTION 'This person may not use this pass'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_not_family';
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

  -- POOLSE-204, 2: a pack bought on the phone works once it is paid.
  IF v_pass.sold_via = 'app' AND NOT EXISTS (
    SELECT 1 FROM pass_current pc
     WHERE pc.id = v_pass.id AND pc.organization_id = NEW.organization_id AND pc.paid
  ) THEN
    RAISE EXCEPTION 'This pack is not paid yet'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_unpaid';
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

  -- One body in the water per pass, or per person on a shared pass (POOLSE-204, 3).
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
       AND (NOT v_pass.shared
            OR (c.membership_id IS NOT DISTINCT FROM NEW.membership_id
                AND c.student_id IS NOT DISTINCT FROM NEW.student_id))
  ) THEN
    RAISE EXCEPTION 'This pass is already in the water'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_in_water';
  END IF;

  PERFORM 1 FROM pool pl
    WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id
      FOR UPDATE;

  SELECT * INTO v_closed FROM pool_closure_at(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);
  IF v_closed.closure_id IS NOT NULL THEN
    RAISE EXCEPTION 'This tank is closed until %', v_closed.until
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_closed|%s|%s', v_closed.until,
                            coalesce(v_closed.part_of_day::text, ''));
  END IF;

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

-- ---------------------------------------------------------------------------
-- The price, for a child too
-- ---------------------------------------------------------------------------

/*
 * POOLSE-203's precedence, with the person as a login or a student (a child's
 * personal pack is priced by the child's categories), and a shareable product
 * always at its base: a category-priced pass is personal.
 */
DROP FUNCTION pass_price_for(uuid, uuid, uuid);

CREATE FUNCTION pass_price_for(
  p_org           uuid,
  p_product_id    uuid,
  p_membership_id uuid,
  p_student_id    uuid DEFAULT NULL
) RETURNS TABLE (
  amount_cents   integer,
  category_ids   uuid[],
  category_names text
)
LANGUAGE sql STABLE AS $$
  WITH product AS (
    SELECT p.amount_cents, p.shareable
      FROM pass_product p
     WHERE p.organization_id = p_org AND p.id = p_product_id
  ),
  mine AS (
    SELECT pc.fee_category_id,
           pc.name,
           row_number() OVER (ORDER BY pc.rank, lower(pc.name)) AS pos
      FROM person_categories(p_org, p_membership_id, p_student_id) pc
     WHERE (p_membership_id IS NOT NULL OR p_student_id IS NOT NULL)
       AND NOT coalesce((SELECT shareable FROM product), false)
  ),
  held AS (
    SELECT coalesce(array_agg(fee_category_id), '{}'::uuid[]) AS ids FROM mine
  ),
  candidate AS (
    SELECT pp.amount_cents,
           pp.category_ids,
           cardinality(pp.category_ids) AS size,
           (SELECT array_agg(m.pos ORDER BY m.pos) FROM mine m
             WHERE m.fee_category_id = ANY (pp.category_ids)) AS ranks,
           (SELECT string_agg(m.name, ' + ' ORDER BY m.pos) FROM mine m
             WHERE m.fee_category_id = ANY (pp.category_ids)) AS names
      FROM pass_product_price pp, held
     WHERE pp.organization_id = p_org
       AND pp.product_id = p_product_id
       AND pp.archived_at IS NULL
       AND cardinality(held.ids) > 0
       AND pp.category_ids <@ held.ids
     ORDER BY size DESC, ranks ASC
     LIMIT 1
  )
  SELECT c.amount_cents, c.category_ids, c.names FROM candidate c
  UNION ALL
  SELECT product.amount_cents, NULL::uuid[], NULL::text
    FROM product
   WHERE NOT EXISTS (SELECT 1 FROM candidate)
$$;

COMMENT ON FUNCTION pass_price_for(uuid, uuid, uuid, uuid) IS
  'POOLSE-203/204: the price a person (login or student) pays for a pass product and '
  'the category set behind it. Largest held set wins, ties to the higher-ranked; else '
  'the base. A shareable product is always its base. The one definition.';

-- Down Migration

DROP FUNCTION IF EXISTS pass_price_for(uuid, uuid, uuid, uuid);

CREATE FUNCTION pass_price_for(
  p_org           uuid,
  p_product_id    uuid,
  p_membership_id uuid
) RETURNS TABLE (
  amount_cents   integer,
  category_ids   uuid[],
  category_names text
)
LANGUAGE sql STABLE AS $$
  WITH mine AS (
    SELECT pc.fee_category_id,
           pc.name,
           row_number() OVER (ORDER BY pc.rank, lower(pc.name)) AS pos
      FROM person_categories(p_org, p_membership_id, NULL) pc
     WHERE p_membership_id IS NOT NULL
  ),
  held AS (
    SELECT coalesce(array_agg(fee_category_id), '{}'::uuid[]) AS ids FROM mine
  ),
  candidate AS (
    SELECT pp.amount_cents,
           pp.category_ids,
           cardinality(pp.category_ids) AS size,
           (SELECT array_agg(m.pos ORDER BY m.pos) FROM mine m
             WHERE m.fee_category_id = ANY (pp.category_ids)) AS ranks,
           (SELECT string_agg(m.name, ' + ' ORDER BY m.pos) FROM mine m
             WHERE m.fee_category_id = ANY (pp.category_ids)) AS names
      FROM pass_product_price pp, held
     WHERE pp.organization_id = p_org
       AND pp.product_id = p_product_id
       AND pp.archived_at IS NULL
       AND cardinality(held.ids) > 0
       AND pp.category_ids <@ held.ids
     ORDER BY size DESC, ranks ASC
     LIMIT 1
  )
  SELECT c.amount_cents, c.category_ids, c.names FROM candidate c
  UNION ALL
  SELECT p.amount_cents, NULL::uuid[], NULL::text
    FROM pass_product p
   WHERE p.organization_id = p_org AND p.id = p_product_id
     AND NOT EXISTS (SELECT 1 FROM candidate)
$$;

-- The trigger as 1790848800000 left it.
CREATE OR REPLACE FUNCTION pass_check_in_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_pass      record;
  v_facility  uuid;
  v_timezone  text;
  v_day       date;
  v_used      integer;
  v_occ       record;
  v_closed    record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pass:' || NEW.pass_id::text, 0));
  SELECT p.* INTO v_pass FROM pass p
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
  IF EXISTS (SELECT 1 FROM pass_current pc
              WHERE pc.id = v_pass.id AND pc.organization_id = NEW.organization_id AND pc.voided) THEN
    RAISE EXCEPTION 'This pass was credited' USING ERRCODE = 'check_violation', DETAIL = 'pass_void';
  END IF;
  v_day := (NEW.checked_in_at AT TIME ZONE v_timezone)::date;
  IF v_day < v_pass.valid_from THEN
    RAISE EXCEPTION 'This pass starts on %', v_pass.valid_from
      USING ERRCODE = 'check_violation', DETAIL = format('pass_not_yet|%s', v_pass.valid_from);
  END IF;
  IF v_pass.valid_until IS NOT NULL AND v_day > v_pass.valid_until THEN
    RAISE EXCEPTION 'This pass ended on %', v_pass.valid_until
      USING ERRCODE = 'check_violation', DETAIL = format('pass_expired|%s', v_pass.valid_until);
  END IF;
  IF v_pass.entries IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM pass_check_in c
     WHERE c.pass_id = v_pass.id AND c.organization_id = NEW.organization_id AND c.archived_at IS NULL;
    IF v_used >= v_pass.entries THEN
      RAISE EXCEPTION 'All % entries on this pass are used', v_pass.entries
        USING ERRCODE = 'check_violation', DETAIL = format('pass_used_up|%s', v_pass.entries);
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pass_check_in c
      JOIN pool pl ON pl.id = c.pool_id AND pl.organization_id = c.organization_id
      JOIN facility f ON f.id = pl.facility_id AND f.organization_id = pl.organization_id
     WHERE c.pass_id = v_pass.id AND c.organization_id = NEW.organization_id
       AND c.archived_at IS NULL AND c.checked_in_at <= NEW.checked_in_at
       AND coalesce(c.checked_out_at, c.checked_in_at + make_interval(mins => f.free_swim_stay_minutes))
           > NEW.checked_in_at
  ) THEN
    RAISE EXCEPTION 'This pass is already in the water'
      USING ERRCODE = 'check_violation', DETAIL = 'pass_in_water';
  END IF;
  PERFORM 1 FROM pool pl WHERE pl.id = NEW.pool_id AND pl.organization_id = NEW.organization_id FOR UPDATE;
  SELECT * INTO v_closed FROM pool_closure_at(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);
  IF v_closed.closure_id IS NOT NULL THEN
    RAISE EXCEPTION 'This tank is closed until %', v_closed.until
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_closed|%s|%s', v_closed.until, coalesce(v_closed.part_of_day::text, ''));
  END IF;
  SELECT * INTO v_occ FROM pool_occupancy(NEW.organization_id, NEW.pool_id, NEW.checked_in_at);
  IF v_occ.capacity IS NOT NULL AND v_occ.swimmers + v_occ.in_classes + 1 > v_occ.capacity THEN
    RAISE EXCEPTION 'The tank holds %; % are in the water', v_occ.capacity, v_occ.swimmers + v_occ.in_classes
      USING ERRCODE = 'check_violation',
            DETAIL = format('pool_occupancy|%s|%s|1', v_occ.capacity, v_occ.swimmers + v_occ.in_classes);
  END IF;
  RETURN NEW;
END;
$$;

-- The view as 1789941600000 left it (dropped and recreated: columns cannot be removed by REPLACE).
DROP VIEW pass_current;
CREATE VIEW pass_current WITH (security_invoker = true) AS
SELECT p.id, p.organization_id, p.facility_id, p.product_id, p.membership_id, p.kind, p.entries,
       p.valid_from, p.valid_until, p.sold_at,
       sale.id AS sale_line_id, sale.invoice_id AS sale_invoice_id,
       (credit.id IS NOT NULL) AS voided,
       coalesce(used.n, 0)::integer AS entries_used,
       CASE WHEN p.entries IS NULL THEN NULL
            ELSE greatest(p.entries - coalesce(used.n, 0), 0) END::integer AS entries_left,
       (p.valid_until IS NOT NULL AND p.valid_until < (now() AT TIME ZONE f.timezone)::date) AS expired
  FROM pass p
  JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
  LEFT JOIN invoice_line sale
    ON sale.pass_id = p.id AND sale.organization_id = p.organization_id AND sale.document_kind = 'invoice'
  LEFT JOIN invoice_line credit
    ON credit.credits_invoice_line_id = sale.id AND credit.organization_id = p.organization_id
   AND credit.document_kind = 'credit_note'
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM pass_check_in c
     WHERE c.pass_id = p.id AND c.organization_id = p.organization_id AND c.archived_at IS NULL
  ) used ON true;
GRANT SELECT ON pass_current TO poolse_app;

DROP FUNCTION IF EXISTS pass_family(uuid, uuid);

ALTER TABLE pass_check_in
  DROP CONSTRAINT IF EXISTS pass_check_in_one_swimmer,
  DROP CONSTRAINT IF EXISTS pass_check_in_student_fkey,
  DROP CONSTRAINT IF EXISTS pass_check_in_membership_fkey,
  DROP COLUMN IF EXISTS student_id,
  DROP COLUMN IF EXISTS membership_id;

DROP INDEX IF EXISTS pass_student_idx;
DROP INDEX IF EXISTS pass_purchase_key_uq;
ALTER TABLE pass
  DROP CONSTRAINT IF EXISTS pass_app_sale_has_key,
  DROP CONSTRAINT IF EXISTS pass_shared_held_by_a_login,
  DROP CONSTRAINT IF EXISTS pass_one_holder,
  DROP CONSTRAINT IF EXISTS pass_owner_unless_single,
  DROP CONSTRAINT IF EXISTS pass_student_fkey,
  DROP COLUMN IF EXISTS purchase_key,
  DROP COLUMN IF EXISTS sold_via,
  DROP COLUMN IF EXISTS shared,
  DROP COLUMN IF EXISTS student_id;
ALTER TABLE pass
  ADD CONSTRAINT pass_owner_unless_single CHECK (membership_id IS NOT NULL OR kind = 'single');
DROP TYPE IF EXISTS pass_sold_via;

ALTER TABLE pass_product
  DROP CONSTRAINT IF EXISTS pass_product_shareable_not_single,
  DROP COLUMN IF EXISTS sold_in_app,
  DROP COLUMN IF EXISTS shareable;
