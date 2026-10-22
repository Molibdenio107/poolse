-- POOLSE-94 — where families pay the club: IBAN and MB WAY as fields of their own.
--
-- *Como pagar* was one free-text box (POOLSE-86 3.0b). A typo in an IBAN inside
-- prose goes unnoticed, and a family looking at what they owe saw nowhere to pay
-- to. So the two destinations become columns of the club, each checked, and the
-- free text stays as the third card for everything else (office hours, cash at
-- reception).
--
-- **One account per club, not per site** (Rui, 22-10-2026): a column on
-- `organization`, not a table. A club with two sites banking separately is a
-- later ticket if one asks.
--
-- **Shape here, checksum in the API.** The CHECKs hold the stored shape — PT50
-- and twenty-one digits, a Portuguese mobile as +3519 and eight digits — so no
-- path can store a value the screens would mis-render. The IBAN's mod-97 check
-- is `ibanChecksumOk` in @poolse/rules, where its refusal can be translated.
--
-- **A changed IBAN is the classic fraud vector**, so every change is a row in
-- `payment_change_notice`: who, when, the last four digits before and after,
-- and the owners told. The email leaves after the commit and is retried hourly
-- (POOLSE-86 3.0a), rendered from the row. The full values are in `audit_log`.

-- Up Migration

ALTER TABLE organization
  ADD COLUMN payment_iban text,
  ADD COLUMN payment_account_holder text,
  ADD COLUMN payment_mbway_phone text,
  ADD CONSTRAINT organization_payment_iban_shape
    CHECK (payment_iban IS NULL OR payment_iban ~ '^PT50[0-9]{21}$'),
  ADD CONSTRAINT organization_payment_holder_shape
    CHECK (payment_account_holder IS NULL
           OR (btrim(payment_account_holder) <> '' AND length(payment_account_holder) <= 70)),
  ADD CONSTRAINT organization_payment_mbway_shape
    CHECK (payment_mbway_phone IS NULL OR payment_mbway_phone ~ '^\+3519[0-9]{8}$');

COMMENT ON COLUMN organization.payment_iban IS
  'POOLSE-94: the account families pay into, PT50 + 21 digits, no spaces. Checksum checked by the API. A change emails every owner.';
COMMENT ON COLUMN organization.payment_account_holder IS
  'POOLSE-94: the name on that account; null shows the club''s own name.';
COMMENT ON COLUMN organization.payment_mbway_phone IS
  'POOLSE-94: the MB WAY number families pay to, +3519xxxxxxxx.';

-- The app writes organization column by column since POOLSE-87; these three are the club's.
GRANT UPDATE (payment_iban, payment_account_holder, payment_mbway_phone) ON organization TO poolse_app;

CREATE TABLE payment_change_notice (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization (id),
  changed_by        uuid NOT NULL,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  -- The last four digits, enough to recognise an account and not enough to use one.
  old_iban_end      text,
  new_iban_end      text,
  recipients        text[] NOT NULL DEFAULT '{}',
  delivered_at      timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, changed_by) REFERENCES membership (organization_id, id),
  CHECK (old_iban_end IS NULL OR old_iban_end ~ '^[0-9]{4}$'),
  CHECK (new_iban_end IS NULL OR new_iban_end ~ '^[0-9]{4}$'),
  CHECK (delivered_at IS NULL OR cardinality(recipients) > 0)
);

COMMENT ON TABLE payment_change_notice IS
  'POOLSE-94: an IBAN changed, and the owners told about it. Written once by the change; only the delivery columns move after.';

CREATE TRIGGER payment_change_notice_updated_at BEFORE UPDATE ON payment_change_notice
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE payment_change_notice ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_change_notice_tenant ON payment_change_notice
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Insert-only, bar its delivery: a notice is what happened, and nobody rewrites that.
REVOKE ALL ON payment_change_notice FROM poolse_app;
GRANT SELECT, INSERT ON payment_change_notice TO poolse_app;
GRANT UPDATE (delivered_at, delivery_attempts, last_attempt_at) ON payment_change_notice TO poolse_app;

-- Down Migration

DROP TABLE IF EXISTS payment_change_notice;
ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_payment_mbway_shape,
  DROP CONSTRAINT IF EXISTS organization_payment_holder_shape,
  DROP CONSTRAINT IF EXISTS organization_payment_iban_shape,
  DROP COLUMN IF EXISTS payment_mbway_phone,
  DROP COLUMN IF EXISTS payment_account_holder,
  DROP COLUMN IF EXISTS payment_iban;
