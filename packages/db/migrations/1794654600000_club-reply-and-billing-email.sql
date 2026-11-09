-- Up Migration

/*
 * POOLSE-209 (Rui, 09-11-2026): where families' replies go, and where Poolse's
 * own invoices go.
 *
 * `reply_email` — every email a club sends leaves from Poolse's verified address
 * under the club's name, with Reply-To this address. Never the From: a club's
 * Gmail as the sender fails DMARC, and a club's own domain needs DNS records and
 * a paid provider plan. Null on clubs made before this ticket, and then the
 * owner's address answers (resolved in the notifier, not stored twice).
 *
 * `billing_email` — the Stripe customer's email: invoices and receipts for the
 * subscription, often an accountant. Null means the owner's.
 *
 * Both are the club's own data, written by the app login through column grants
 * like `payment_iban`; neither is a platform column.
 */

ALTER TABLE organization
  ADD COLUMN reply_email citext,
  ADD COLUMN billing_email citext,
  ADD CONSTRAINT organization_reply_email_format
    CHECK (reply_email IS NULL OR reply_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  ADD CONSTRAINT organization_billing_email_format
    CHECK (billing_email IS NULL OR billing_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

GRANT UPDATE (reply_email, billing_email) ON organization TO poolse_app;

-- Down Migration

REVOKE UPDATE (reply_email, billing_email) ON organization FROM poolse_app;

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_billing_email_format,
  DROP CONSTRAINT IF EXISTS organization_reply_email_format,
  DROP COLUMN IF EXISTS billing_email,
  DROP COLUMN IF EXISTS reply_email;
