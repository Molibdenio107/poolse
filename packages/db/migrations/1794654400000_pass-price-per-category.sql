-- Up Migration
--
-- A free-swim pass has a price per category, and per combination where the
-- club types one — POOLSE-203 (Rui, 08-11-2026).
--
-- The base price stays on `pass_product`. A `pass_product_price` row is a price
-- for one set of categories: one category (*Sénior* 30 €) or a combination the
-- club typed (*Sénior + Sócio* 27 €). Nothing combines unless the club says so.
--
-- **The precedence is `pass_price_for()` and nowhere else.** Of the price rows
-- whose set the person holds entirely (their valid categories, POOLSE-202), the
-- largest set wins; on a tie, the set whose categories rank higher. A single
-- category is a set of one, so with no typed combination this is "the
-- top-ranked category that has a price" — and a category without a price is
-- skipped, never a reason to fall to the base (Rui, 08-11-2026). No set held:
-- the base price.
--
-- **The sale snapshots it.** The invoice line keeps the amount and the category
-- names (`fee_category_name`, as fee lines do), so a later change to this table
-- never touches a sold pass.

/* A category set in its one spelling: sorted, no repeats. Immutable, so a CHECK may call it. */
CREATE FUNCTION category_set_is_canonical(p_ids uuid[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_ids = ARRAY(SELECT DISTINCT x FROM unnest(p_ids) AS x ORDER BY 1)
$$;

CREATE TABLE pass_product_price (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  facility_id      uuid NOT NULL,
  product_id       uuid NOT NULL,

  /*
   * The set, sorted and without repeats (CHECK), so one set has one spelling
   * and the unique index below means "per exact set". An array rather than a
   * child table because the set *is* the key; the trigger below does for each
   * element what a composite foreign key does for a column.
   */
  category_ids     uuid[] NOT NULL,
  amount_cents     integer NOT NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, facility_id, product_id)
    REFERENCES pass_product (organization_id, facility_id, id),

  CONSTRAINT pass_product_price_amount_sane CHECK (amount_cents >= 0),
  CONSTRAINT pass_product_price_set_not_empty CHECK (cardinality(category_ids) >= 1),
  CONSTRAINT pass_product_price_set_sorted CHECK (category_set_is_canonical(category_ids))
);

COMMENT ON TABLE pass_product_price IS
  'POOLSE-203: a pass product''s price for one set of categories (one, or a '
  'combination the club typed). The base price stays on pass_product. Resolved '
  'only by pass_price_for(); snapshotted on the sale.';

CREATE TRIGGER pass_product_price_updated_at BEFORE UPDATE ON pass_product_price
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX pass_product_price_set_uq
  ON pass_product_price (organization_id, product_id, category_ids)
  WHERE archived_at IS NULL;

/*
 * Every category in the set is a category of this club. What a composite key
 * would say per column, said per element: an id from another club, or one that
 * does not exist, is refused as a foreign-key violation.
 */
CREATE FUNCTION pass_product_price_categories_are_ours() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A set with repeats is the CHECK's to refuse, in its own words.
  IF category_set_is_canonical(NEW.category_ids)
     AND (SELECT count(*) FROM fee_category c
       WHERE c.organization_id = NEW.organization_id
         AND c.id = ANY (NEW.category_ids)) <> cardinality(NEW.category_ids) THEN
    RAISE EXCEPTION 'A pass price names a category this club does not have'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pass_product_price_categories
  BEFORE INSERT OR UPDATE OF category_ids, organization_id ON pass_product_price
  FOR EACH ROW EXECUTE FUNCTION pass_product_price_categories_are_ours();

ALTER TABLE pass_product_price ENABLE ROW LEVEL SECURITY;

CREATE POLICY pass_product_price_tenant ON pass_product_price
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- A removed price is archived; history is never deleted.
REVOKE ALL ON pass_product_price FROM poolse_app;
GRANT SELECT, INSERT, UPDATE ON pass_product_price TO poolse_app;

-- ---------------------------------------------------------------------------
-- The precedence, once
-- ---------------------------------------------------------------------------

/*
 * What `p_membership_id` pays for `p_product_id` today, and why.
 *
 * `category_ids` / `category_names` are the set that produced the price, the
 * names in rank order joined by " + " (*Sénior + Sócio*); both null at the base
 * price. A null person (an anonymous single entry) pays the base.
 *
 * Invoker, so RLS applies; `p_org` keeps it on one club besides.
 */
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
     -- The largest set held; on a tie, the one whose categories rank higher.
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

COMMENT ON FUNCTION pass_price_for(uuid, uuid, uuid) IS
  'POOLSE-203: the price a person pays for a pass product and the category set '
  'behind it. Largest held set wins, ties to the higher-ranked; else the base. '
  'The one definition of the precedence.';

-- Down Migration

DROP FUNCTION IF EXISTS pass_price_for(uuid, uuid, uuid);
DROP TRIGGER IF EXISTS pass_product_price_categories ON pass_product_price;
DROP FUNCTION IF EXISTS pass_product_price_categories_are_ours();
DROP POLICY IF EXISTS pass_product_price_tenant ON pass_product_price;
DROP TABLE IF EXISTS pass_product_price;
DROP FUNCTION IF EXISTS category_set_is_canonical(uuid[]);
