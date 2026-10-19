-- Up Migration
--
-- POOLSE-86 slice 3.0c — a family may stop the club's general messages.
--
-- **Only general club messages** (Rui, 19-10-2026). A closure warning (audience
-- `closure`), an invoice reminder, a safety alert, an invitation and account mail
-- always go: they are about the service, money owed or access.
--
-- **Per club and per address.** `email_preference` is one row per (club,
-- address): an unguessable `token` for the link in every email that can be
-- opted out of, and `messages_opted_out_at` — null is subscribed. Opting back in
-- clears the date; the row is never deleted, so a link stays good for ever.
--
-- **Two ways out, one row.** The link works without a login (most guardians
-- have none) through two `SECURITY DEFINER` functions keyed on the token — the
-- `public_water_page()` pattern — and a signed-in member flips the same row from
-- their profile under the club's own policy.
--
-- **`message_recipients()` stays the one definition of who a message reaches.**
-- The previous body is renamed `message_recipients_all()` and the public name now
-- wraps it with one more column, `opted_out`, true only for a non-closure message
-- to an address that opted out. Preview and send both read it, so the count a
-- person confirms leaves out exactly whom the send leaves out.

CREATE TABLE email_preference (
  organization_id        uuid NOT NULL REFERENCES organization (id),
  email                  citext NOT NULL,
  token                  text NOT NULL,
  messages_opted_out_at  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, email),
  CONSTRAINT email_preference_token_shape CHECK (token ~ '^[A-Za-z0-9_-]{32,}$'),
  CONSTRAINT email_preference_email_present CHECK (btrim(email::text) <> '')
);

CREATE UNIQUE INDEX email_preference_token_uq ON email_preference (token);

COMMENT ON TABLE email_preference IS
  'POOLSE-86: per club and address, whether general club messages are wanted, and the token '
  'behind the opt-out link. Never deleted; opting back in clears messages_opted_out_at.';

CREATE TRIGGER email_preference_updated_at BEFORE UPDATE ON email_preference
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE email_preference ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_preference_tenant ON email_preference
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON email_preference FROM poolse_app;
GRANT SELECT, INSERT ON email_preference TO poolse_app;
GRANT UPDATE (messages_opted_out_at) ON email_preference TO poolse_app;

-- ---------------------------------------------------------------------------
-- The link: read and set by token, with no tenant and no login
-- ---------------------------------------------------------------------------

CREATE FUNCTION public_email_preference(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,}$' THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
           'clubName', o.name,
           'locale', o.locale,
           'optedOut', p.messages_opted_out_at IS NOT NULL)
    INTO v_result
    FROM email_preference p
    JOIN organization o ON o.id = p.organization_id
   WHERE p.token = p_token
     AND o.archived_at IS NULL;
  RETURN v_result;
END;
$fn$;

CREATE FUNCTION set_public_email_preference(p_token text, p_opted_out boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,}$' OR p_opted_out IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE email_preference p
     SET messages_opted_out_at = CASE
           WHEN NOT p_opted_out THEN NULL
           ELSE coalesce(p.messages_opted_out_at, now()) END
    FROM organization o
   WHERE p.token = p_token
     AND o.id = p.organization_id
     AND o.archived_at IS NULL;
  RETURN public_email_preference(p_token);
END;
$fn$;

REVOKE ALL ON FUNCTION public_email_preference(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_public_email_preference(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_email_preference(text) TO poolse_app;
GRANT EXECUTE ON FUNCTION set_public_email_preference(text, boolean) TO poolse_app;

-- ---------------------------------------------------------------------------
-- message_recipients(), with opted_out
-- ---------------------------------------------------------------------------

ALTER FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid)
  RENAME TO message_recipients_all;

COMMENT ON FUNCTION message_recipients_all(uuid, message_audience, uuid, uuid, uuid, uuid) IS
  'POOLSE-67/84: everybody a message is addressed to. Read through message_recipients(), '
  'which adds whether each address opted out (POOLSE-86); never call this directly.';

CREATE FUNCTION message_recipients(
  p_organization_id uuid,
  p_audience        message_audience,
  p_class_group_id  uuid,
  p_level_id        uuid,
  p_facility_id     uuid,
  p_closure_id      uuid DEFAULT NULL
) RETURNS TABLE (
  student_id             uuid,
  student_name           text,
  guardian_membership_id uuid,
  name                   text,
  email                  citext,
  partner_id             uuid,
  lead_id                uuid,
  opted_out              boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT r.student_id, r.student_name, r.guardian_membership_id, r.name, r.email,
         r.partner_id, r.lead_id,
         -- A closure warning always goes; anything else respects the address's choice.
         (p_audience <> 'closure'
          AND r.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM email_preference ep
                       WHERE ep.organization_id = p_organization_id
                         AND ep.email = r.email
                         AND ep.messages_opted_out_at IS NOT NULL)) AS opted_out
    FROM message_recipients_all(p_organization_id, p_audience, p_class_group_id,
                                p_level_id, p_facility_id, p_closure_id) r
$$;

COMMENT ON FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid) IS
  'POOLSE-67: who a message reaches — one row per subject × address. POOLSE-86: opted_out is '
  'true for a non-closure message to an address that opted out; preview and send leave those out.';

-- Down Migration

DROP FUNCTION IF EXISTS message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid);
ALTER FUNCTION message_recipients_all(uuid, message_audience, uuid, uuid, uuid, uuid)
  RENAME TO message_recipients;
COMMENT ON FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid) IS
  'POOLSE-67: who a message reaches — live guardians, else the student — one row per '
  'student × address, null email where there is none. Read by preview and send alike. '
  'POOLSE-84: the closure audience is everybody its batch took a lesson from — turma '
  'families, parceria partners (partner_id) and trial leads (lead_id).';
DROP FUNCTION IF EXISTS set_public_email_preference(text, boolean);
DROP FUNCTION IF EXISTS public_email_preference(text);
DROP TABLE IF EXISTS email_preference;
