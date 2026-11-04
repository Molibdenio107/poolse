-- Up Migration

-- POOLSE-162 (Rui, 04-11-2026) — a payment recorded against an invoice the club
-- issued outside Poolse.
--
-- The reception bills a family in its own invoicing program and the club still
-- wants the Poolse document to read paid. The payment's source says so, and its
-- `reference` is the external document's number — required, by CHECK, because a
-- payment "by an external invoice" that does not say which one is unverifiable.
--
-- **The CHECK reads `source::text`.** The runner applies a migration in one
-- transaction, and Postgres refuses a new enum value's literal in the transaction
-- that added it; the text comparison is the same rule without the literal.
--
-- POOLSE-163 (an occurrence invoiced elsewhere, so no Poolse document at all) is
-- the other shape of the same need and has its own ticket.

ALTER TYPE payment_source ADD VALUE IF NOT EXISTS 'external_invoice';

ALTER TABLE invoice_payment
  ADD CONSTRAINT invoice_payment_external_has_number CHECK (
    source::text <> 'external_invoice'
    OR (reference IS NOT NULL AND length(reference) <= 60)
  );

COMMENT ON CONSTRAINT invoice_payment_external_has_number ON invoice_payment IS
  'POOLSE-162: a payment by an external invoice names that invoice''s number, at most 60 characters.';

-- Down Migration

-- An enum value cannot be dropped; the rows that used it go back to "manual",
-- keeping their number as the reference, and the value stays unused.
UPDATE invoice_payment SET source = 'manual' WHERE source::text = 'external_invoice';
ALTER TABLE invoice_payment DROP CONSTRAINT IF EXISTS invoice_payment_external_has_number;
