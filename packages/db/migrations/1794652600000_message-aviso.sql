-- Up Migration

/*
 * Avisos — POOLSE-166 (Rui, 04-11-2026).
 *
 * A notice a family or a student sees on opening the app, between two dates. It
 * is a `message` with `channel = 'app'`: the same audiences, the same
 * `message_recipients()`, the same archive — and never an email. Its recipient
 * rows are a snapshot of who it reached when it was posted, **written with no
 * address**: nothing is sent, so no address is kept, which also means the
 * delivery retry (it reads rows with an email) can never pick one up. Its
 * `address_count` is therefore 0, and the daily ceiling does not count it.
 */

CREATE TYPE message_channel AS ENUM ('email', 'app');

COMMENT ON TYPE message_channel IS
  'How a message reaches people: email (POOLSE-67) or shown in the app between two dates (POOLSE-166).';

ALTER TABLE message
  ADD COLUMN channel     message_channel NOT NULL DEFAULT 'email',
  ADD COLUMN shown_from  date,
  ADD COLUMN shown_until date,
  -- A window exactly when it is an aviso, and never backwards.
  ADD CONSTRAINT message_app_window CHECK (
        (channel = 'app') = (shown_from IS NOT NULL)
    AND (channel = 'app') = (shown_until IS NOT NULL)
    AND (shown_from IS NULL OR shown_from <= shown_until)
  ),
  -- An aviso goes to people the club teaches: never a closure's or a lesson's list.
  ADD CONSTRAINT message_app_audience CHECK (
    channel = 'email' OR audience IN ('class_group', 'level', 'facility', 'organization', 'sport')
  ),
  -- Nothing to an address: an aviso writes none.
  ADD CONSTRAINT message_app_no_addresses CHECK (channel = 'email' OR address_count = 0);

COMMENT ON COLUMN message.channel IS
  'email: sent after commit (deliverMessage). app: an aviso, shown in the app from shown_from to shown_until '
  '(club days, inclusive) and never emailed — POOLSE-166.';
COMMENT ON COLUMN message.shown_from IS 'An aviso''s first day in the app (club day). Null for an email.';
COMMENT ON COLUMN message.shown_until IS 'An aviso''s last day in the app (club day, inclusive). Null for an email.';

CREATE INDEX message_aviso_window_idx ON message (organization_id, shown_until)
  WHERE channel = 'app' AND archived_at IS NULL;

-- The column grant on `message` stays: INSERT sets the new columns, and the only
-- UPDATE the app may make is archived_at. An aviso is ended, never edited.

/*
 * The ceiling counts email only. Same bodies as 1792836000001 with the channel
 * added — an aviso is neither a message sent nor an address written to.
 */
CREATE OR REPLACE FUNCTION email_addresses_today(p_org uuid, p_at timestamptz) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT (SELECT coalesce(sum(address_count), 0) FROM message
           WHERE organization_id = p_org AND sent_at >= message_day_start(p_at)
             AND audience <> 'session' AND channel = 'email')::integer
       + (SELECT count(*) FROM invoice_reminder
           WHERE organization_id = p_org AND created_at >= message_day_start(p_at))::integer
$$;

CREATE OR REPLACE FUNCTION message_quota_respected() RETURNS trigger AS $$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  -- A cancellation notice is the club telling families a lesson is off, never a
  -- person mass-mailing: it is not counted and never refused (Rui, 27-10-2026).
  -- An aviso is not mail at all (POOLSE-166).
  IF NEW.audience = 'session' OR NEW.channel = 'app' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*) INTO v_messages
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at)
     AND audience <> 'session'
     AND channel = 'email';
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

-- Down Migration

CREATE OR REPLACE FUNCTION email_addresses_today(p_org uuid, p_at timestamptz) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT (SELECT coalesce(sum(address_count), 0) FROM message
           WHERE organization_id = p_org AND sent_at >= message_day_start(p_at)
             AND audience <> 'session')::integer
       + (SELECT count(*) FROM invoice_reminder
           WHERE organization_id = p_org AND created_at >= message_day_start(p_at))::integer
$$;

CREATE OR REPLACE FUNCTION message_quota_respected() RETURNS trigger AS $$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  IF NEW.audience = 'session' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*) INTO v_messages
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at)
     AND audience <> 'session';
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

DROP INDEX IF EXISTS message_aviso_window_idx;
ALTER TABLE message
  DROP CONSTRAINT IF EXISTS message_app_no_addresses,
  DROP CONSTRAINT IF EXISTS message_app_audience,
  DROP CONSTRAINT IF EXISTS message_app_window,
  DROP COLUMN IF EXISTS shown_until,
  DROP COLUMN IF EXISTS shown_from,
  DROP COLUMN IF EXISTS channel;
DROP TYPE IF EXISTS message_channel;
