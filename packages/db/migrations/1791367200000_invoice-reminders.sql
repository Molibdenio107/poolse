-- Up Migration
--
-- POOLSE-86 slice 3.0b — an invoice reminder by email.
--
-- **A person sends it, never a schedule** (Rui, 19-10-2026), from Em dívida, to
-- the payer of each selected document. One email per payer lists every one of
-- their **overdue** documents at that site, then the club's own *Como pagar*.
--
-- **`invoice_reminder` is the email**, one row per payer per send: the address,
-- the language and the documents it listed, snapshotted — so the hourly retry
-- (3.0a) re-renders exactly what the first attempt said, even if a payment
-- arrived in between. Insert-only bar its delivery columns, like every record of
-- something sent.
--
-- **It is also a chase.** Each document it listed gets an ordinary
-- `invoice_chase` row with the new channel `poolse_email` and `reminder_id`
-- pointing at it, so Em dívida's "last asked" and the document's history count
-- it with nothing new to read. A chase row names a reminder exactly when its
-- channel is `poolse_email`.
--
-- **It counts against the club's daily address ceiling**, the one messages use
-- (2,000 a Lisbon day), under the same advisory lock: a reminder is one address,
-- and a message's own check now counts reminders too. It is not one of the 20
-- messages — a reminder is a chase, not an announcement.

ALTER TYPE invoice_chase_channel ADD VALUE IF NOT EXISTS 'poolse_email';

-- ---------------------------------------------------------------------------
-- organization.payment_instructions — Como pagar
-- ---------------------------------------------------------------------------

ALTER TABLE organization
  ADD COLUMN payment_instructions text,
  ADD CONSTRAINT organization_payment_instructions_shape
    CHECK (payment_instructions IS NULL
           OR (btrim(payment_instructions) <> '' AND length(payment_instructions) <= 1000));

COMMENT ON COLUMN organization.payment_instructions IS
  'POOLSE-86: the club''s own words on how to pay (IBAN, MB WAY, office hours), shown '
  'verbatim under an invoice reminder. Null: the reminder says to contact the club.';

-- ---------------------------------------------------------------------------
-- invoice_reminder
-- ---------------------------------------------------------------------------

CREATE TABLE invoice_reminder (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization (id),
  facility_id         uuid NOT NULL,
  -- The payer, as on the invoice: a guardian's membership, or the adult student.
  payer_membership_id uuid,
  payer_student_id    uuid,
  payer_name          text NOT NULL,
  email               citext NOT NULL,
  -- The language it was written in, chosen when it was sent.
  locale              text NOT NULL,
  -- What it listed: [{ invoiceId, documentNo, issuedOn, dueOn, outstandingCents }].
  lines               jsonb NOT NULL,
  sent_by             uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  delivered_at        timestamptz,
  delivery_attempts   smallint NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, payer_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, payer_student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, sent_by) REFERENCES membership (organization_id, id),
  CONSTRAINT invoice_reminder_payer_is_one CHECK ((payer_membership_id IS NULL) <> (payer_student_id IS NULL)),
  CONSTRAINT invoice_reminder_lines_listed CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0),
  CONSTRAINT invoice_reminder_locale CHECK (locale IN ('pt-PT', 'en'))
);

COMMENT ON TABLE invoice_reminder IS
  'POOLSE-86: one invoice reminder email to one payer — what it listed, snapshotted, and '
  'whether it left. Its chase rows name it.';

CREATE INDEX invoice_reminder_recent_idx ON invoice_reminder (organization_id, created_at DESC);

ALTER TABLE invoice_reminder ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_reminder_tenant ON invoice_reminder
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON invoice_reminder FROM poolse_app;
GRANT SELECT, INSERT ON invoice_reminder TO poolse_app;
GRANT UPDATE (delivered_at, delivery_attempts, last_attempt_at) ON invoice_reminder TO poolse_app;

-- ---------------------------------------------------------------------------
-- invoice_chase.reminder_id
-- ---------------------------------------------------------------------------

ALTER TABLE invoice_chase
  ADD COLUMN reminder_id uuid,
  ADD CONSTRAINT invoice_chase_reminder_fkey
    FOREIGN KEY (organization_id, reminder_id) REFERENCES invoice_reminder (organization_id, id),
  -- Text comparison: the new enum value cannot be named in the transaction that adds it.
  ADD CONSTRAINT invoice_chase_reminder_is_poolse_email
    CHECK ((channel::text = 'poolse_email') = (reminder_id IS NOT NULL));

CREATE INDEX invoice_chase_reminder_idx ON invoice_chase (organization_id, reminder_id)
  WHERE reminder_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- One daily address ceiling for messages and reminders
-- ---------------------------------------------------------------------------

CREATE FUNCTION email_addresses_today(p_org uuid, p_at timestamptz) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT (SELECT coalesce(sum(address_count), 0) FROM message
           WHERE organization_id = p_org AND sent_at >= message_day_start(p_at))::integer
       + (SELECT count(*) FROM invoice_reminder
           WHERE organization_id = p_org AND created_at >= message_day_start(p_at))::integer
$$;

CREATE OR REPLACE FUNCTION message_quota_respected() RETURNS trigger AS $$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*) INTO v_messages
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at);
  -- Since POOLSE-86 the address ceiling is shared with invoice reminders.
  v_addresses := email_addresses_today(NEW.organization_id, NEW.sent_at);

  IF v_messages + 1 > message_daily_limit() THEN
    RAISE EXCEPTION 'Daily message limit reached: % of %', v_messages, message_daily_limit()
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|messages|%s|%s|1', message_daily_limit(), v_messages);
  END IF;

  IF v_addresses + NEW.address_count > message_daily_address_limit() THEN
    RAISE EXCEPTION 'Daily address limit reached: % of %, this message asks for %',
      v_addresses, message_daily_address_limit(), NEW.address_count
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|addresses|%s|%s|%s',
                            message_daily_address_limit(), v_addresses, NEW.address_count);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION invoice_reminder_quota_respected() RETURNS trigger AS $$
DECLARE
  v_addresses integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));
  v_addresses := email_addresses_today(NEW.organization_id, NEW.created_at);
  IF v_addresses + 1 > message_daily_address_limit() THEN
    RAISE EXCEPTION 'Daily address limit reached: % of %', v_addresses, message_daily_address_limit()
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|addresses|%s|%s|1', message_daily_address_limit(), v_addresses);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_reminder_quota BEFORE INSERT ON invoice_reminder
  FOR EACH ROW EXECUTE FUNCTION invoice_reminder_quota_respected();

-- Down Migration

DROP TRIGGER IF EXISTS invoice_reminder_quota ON invoice_reminder;
DROP FUNCTION IF EXISTS invoice_reminder_quota_respected();

CREATE OR REPLACE FUNCTION message_quota_respected() RETURNS trigger AS $$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*), coalesce(sum(address_count), 0)
    INTO v_messages, v_addresses
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at);

  IF v_messages + 1 > message_daily_limit() THEN
    RAISE EXCEPTION 'Daily message limit reached: % of %', v_messages, message_daily_limit()
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|messages|%s|%s|1', message_daily_limit(), v_messages);
  END IF;

  IF v_addresses + NEW.address_count > message_daily_address_limit() THEN
    RAISE EXCEPTION 'Daily address limit reached: % of %, this message asks for %',
      v_addresses, message_daily_address_limit(), NEW.address_count
      USING ERRCODE = 'check_violation',
            DETAIL = format('message_quota|addresses|%s|%s|%s',
                            message_daily_address_limit(), v_addresses, NEW.address_count);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS email_addresses_today(uuid, timestamptz);
DROP INDEX IF EXISTS invoice_chase_reminder_idx;
ALTER TABLE invoice_chase DROP CONSTRAINT IF EXISTS invoice_chase_reminder_is_poolse_email,
  DROP CONSTRAINT IF EXISTS invoice_chase_reminder_fkey,
  DROP COLUMN IF EXISTS reminder_id;
DROP TABLE IF EXISTS invoice_reminder;
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_payment_instructions_shape,
  DROP COLUMN IF EXISTS payment_instructions;
-- The enum value 'poolse_email' stays: Postgres cannot drop one, and nothing uses it once the rows are gone.
