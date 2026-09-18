-- Up Migration
--
-- The same club, under a different address — POOLSE-62, second half.
--
-- The first half blocks one *person* signing up twice: one live claim per
-- normalised e-mail. This blocks one *club* doing it, which is the harder case
-- and the more likely one — a second address costs nothing, and the thing that
-- does not change is the legal entity.
--
-- **The NIPC is asked for in the club's own settings, not at signup.** Settled
-- 13 September 2026 and unchanged: signup stays three fields and thirty seconds,
-- and a tax number is the most intrusive question you can put to somebody who has
-- not decided yet — and the one they cannot answer from memory. It belongs where
-- invoicing already needs it, because a fatura's issuer is the club.
--
-- **`organization.vat_number` has existed since the first migration and nothing
-- has ever read or written it.** This is the migration that gives it a meaning:
-- a shape, and a claim.
--
-- ---------------------------------------------------------------------------
-- Why a trigger, and why a second SECURITY DEFINER function
-- ---------------------------------------------------------------------------
--
-- The migration checklist says to stop and reconsider before writing a second
-- `SECURITY DEFINER` function. Reconsidered, and here is the argument.
--
-- The check has to be **cross-tenant** — "does another club already hold this
-- number" — and the club's own save runs on `poolse_app`, which cannot read
-- `trial_claim` and must not be able to. That leaves three shapes:
--
--   1. **A unique index on `organization.vat_number` instead.** Simplest, no new
--      function — and it breaks the override. `poolse_platform` cannot write
--      another club's `vat_number`, so freeing a false positive would mean asking
--      the *other* club to clear their number: exactly the support thread
--      POOLSE-62 says a block must never cost. It also silently makes "two clubs
--      may never share a NIPC" true for ever, which is a stronger rule than *one
--      trial per entity* and was never decided.
--   2. **The API writing both sides on two connections.** Not atomic: a save
--      that claimed the number and then failed would leave a number claimed by
--      nobody, and the compensating write is a second failure path to get wrong.
--   3. **This.** A trigger on the column the club writes, maintaining the claim
--      the ledger already holds. One transaction, one write path, and the
--      partial unique index is the enforcement exactly as it is for the address.
--
-- It is the same table the same ledger already writes through
-- `provision_organization`, from the other end of the same fact. The reach it
-- adds is one column of one row that already belongs to the tenant doing the
-- writing — it cannot read another club's claim, cannot release one, and cannot
-- touch any other column.
--
-- **And the override keeps working for free**: releasing a claim frees the
-- address *and* the number in one act, because both unique indexes are partial on
-- `released_at`.

-- ---------------------------------------------------------------------------
-- A number is nine digits, and one shape
-- ---------------------------------------------------------------------------
--
-- Stored normalised — digits only — so the ledger compares numbers rather than
-- spellings. `500 123 456` and `500123456` are one club.
--
-- **The checksum is not here.** `isValidNif` in `@poolse/rules` is the one
-- definition (nine digits, mod-11 check digit), shared by the form and the API so
-- a screen cannot accept what the server refuses. SQL enforces the *shape*, which
-- is what a constraint can say without a second implementation of the arithmetic.

CREATE FUNCTION normalize_tax_number(p_number text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g'), '')
$$;

COMMENT ON FUNCTION normalize_tax_number(text) IS
  'Digits only, null for nothing. The one definition of what makes two tax '
  'numbers the same number. POOLSE-62.';

ALTER TABLE organization
  ADD CONSTRAINT organization_vat_number_shape CHECK (
    vat_number IS NULL OR vat_number ~ '^[0-9]{9}$'
  );

COMMENT ON COLUMN organization.vat_number IS
  'The club''s NIPC, nine digits, normalised. Read by invoicing as the issuer''s '
  'number, and claimed in trial_claim so the same entity cannot start a second '
  'trial under another address — POOLSE-62. The checksum lives in @poolse/rules.';

-- ---------------------------------------------------------------------------
-- Saving a number claims it
-- ---------------------------------------------------------------------------
--
-- `AFTER`, not `BEFORE`: the club's own row is written either way, and what this
-- decides is whether the *transaction* survives — the unique index raises, the
-- statement rolls back, and the API turns `23505` into a sentence beside the
-- field.
--
-- **A tenant with no live claim gets no protection, and that is stated rather
-- than hidden.** A claim needs a normalised address and a pre-ledger tenant has
-- none; inventing one would put a row in the book that no signup ever wrote. Every
-- organization created since POOLSE-62 has a claim, so this is a closed set that
-- only shrinks.

CREATE FUNCTION claim_tax_number() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  /*
   * Clearing the number releases the hold on it, which is the club's to do:
   * somebody correcting a typo should not have to write in. It is not a release
   * of the *claim* — the address stays held, and only an operator frees that.
   */
  UPDATE trial_claim
     SET tax_number = NEW.vat_number
   WHERE organization_id = NEW.id
     AND released_at IS NULL;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION claim_tax_number() IS
  'Keeps trial_claim.tax_number in step with the club''s own vat_number, so one '
  'legal entity cannot start a second trial under another address. SECURITY '
  'DEFINER because the check is cross-tenant and the club writes on poolse_app; '
  'see the migration header for the two shapes this was chosen over.';

/*
 * `UPDATE OF vat_number`, so the ordinary UPDATE that every platform action and
 * every other settings save performs does not touch the ledger — a trigger
 * firing on every write to `organization` would take a row lock in `trial_claim`
 * on paths that have nothing to do with tax numbers.
 */
CREATE TRIGGER organization_tax_number_claimed
  AFTER INSERT OR UPDATE OF vat_number ON organization
  FOR EACH ROW
  EXECUTE FUNCTION claim_tax_number();

/*
 * No `WHEN` clause, deliberately: a trigger declared for INSERT *and* UPDATE
 * cannot reference `OLD` in one, and half a condition is worse than none. The
 * body's UPDATE matches nothing when there is no live claim — which is every
 * INSERT, since `provision_organization` writes the claim afterwards.
 */

REVOKE ALL ON FUNCTION claim_tax_number() FROM PUBLIC;

-- Down Migration
--
-- The trigger and the shape go; the numbers already claimed stay on their claims,
-- because a claim is the ledger's row and reversing a trigger must not un-say
-- what a club told us about itself.

DROP TRIGGER IF EXISTS organization_tax_number_claimed ON organization;
DROP FUNCTION IF EXISTS claim_tax_number();

ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_vat_number_shape;

COMMENT ON COLUMN organization.vat_number IS NULL;

DROP FUNCTION IF EXISTS normalize_tax_number(text);
