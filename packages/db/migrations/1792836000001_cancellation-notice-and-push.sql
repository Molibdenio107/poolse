-- Up Migration

-- POOLSE-90 slice 4: the cancellation notice and the push channel.
--
-- **A cancelled lesson is a message** (Rui, 27-10-2026: always, automatically).
-- `message.class_session_id` names the lesson; recipients are its turma's
-- families through `message_recipients()`, which gains one branch, so the email,
-- the push and the history cannot disagree about who was told. Like a closure
-- warning it ignores the opt-out, and unlike anything else it is **exempt from
-- the daily ceiling** (Rui): a rainy Saturday's twenty-five cancellations still
-- reach every family, and the ceiling exists to stop a person mass-mailing.
--
-- **Push is a second channel, never instead.** `push_subscription` is one row per
-- device a person turned *Avisos neste telemóvel* on for; a push is sent once
-- after commit, and the email is what is retried. A 404 or 410 from the push
-- service revokes the row.

ALTER TABLE message
  ADD COLUMN class_session_id uuid,
  ADD FOREIGN KEY (organization_id, class_session_id) REFERENCES class_session (organization_id, id);

ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
      (audience = 'class_group') = (class_group_id IS NOT NULL)
  AND (audience = 'level')       = (level_id IS NOT NULL)
  AND (audience = 'facility')    = (facility_id IS NOT NULL)
  AND (audience = 'closure')     = (closure_id IS NOT NULL)
  AND (audience = 'session')     = (class_session_id IS NOT NULL)
);

COMMENT ON COLUMN message.class_session_id IS
  'POOLSE-90: the lesson a cancellation notice is about, for the session audience — that '
  'turma''s families, told automatically when one lesson is cancelled.';

CREATE TABLE push_subscription (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization (id),
  membership_id    uuid NOT NULL,
  endpoint         text NOT NULL,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  -- "iPhone · Safari": so a person can tell their own devices apart.
  label            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  revoked_at       timestamptz,

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES membership (organization_id, id),
  CONSTRAINT push_subscription_endpoint CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 2000),
  CONSTRAINT push_subscription_label CHECK (label IS NULL OR char_length(label) <= 120)
);

CREATE UNIQUE INDEX push_subscription_device_uq ON push_subscription (organization_id, membership_id, endpoint)
  WHERE revoked_at IS NULL;

CREATE TRIGGER push_subscription_updated_at BEFORE UPDATE ON push_subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subscription_tenant ON push_subscription
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON push_subscription FROM poolse_app;
GRANT SELECT, INSERT ON push_subscription TO poolse_app;
GRANT UPDATE (p256dh, auth, label, last_success_at, revoked_at) ON push_subscription TO poolse_app;

COMMENT ON TABLE push_subscription IS
  'POOLSE-90: a device a person turned push on for. Revoked, never deleted: by the person, '
  'or when the push service answers 404/410.';

CREATE OR REPLACE FUNCTION message_recipients_all(
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
  lead_id                uuid
)
LANGUAGE sql
STABLE
AS $$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             -- POOLSE-90 slice 4: one cancelled lesson's turma (the caller passes it).
             WHEN 'session'      THEN cg.id = p_class_group_id
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$$;

CREATE OR REPLACE FUNCTION message_recipients(
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
         -- A closure or cancellation warning always goes; anything else respects the address's choice.
         (p_audience NOT IN ('closure', 'session')
          AND r.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM email_preference ep
                       WHERE ep.organization_id = p_organization_id
                         AND ep.email = r.email
                         AND ep.messages_opted_out_at IS NOT NULL)) AS opted_out
    FROM message_recipients_all(p_organization_id, p_audience, p_class_group_id,
                                p_level_id, p_facility_id, p_closure_id) r
$$;

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
  -- A cancellation notice is the club telling families a lesson is off, never a
  -- person mass-mailing: it is not counted and never refused (Rui, 27-10-2026).
  IF NEW.audience = 'session' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('message_quota:' || NEW.organization_id::text, 0));

  SELECT count(*) INTO v_messages
    FROM message
   WHERE organization_id = NEW.organization_id
     AND sent_at >= message_day_start(NEW.sent_at)
     AND audience <> 'session';
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

CREATE OR REPLACE FUNCTION message_recipients_all(
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
  lead_id                uuid
)
LANGUAGE sql
STABLE
AS $$
  WITH closed AS (
    -- The sessions the closure's form cancelled: every closure in its batch.
    SELECT cs.id, cs.class_group_id, sch.class_group_id AS schedule_group_id,
           sch.partner_group_id
      FROM closure k0
      JOIN closure k
        ON k.organization_id = k0.organization_id AND k.batch_id = k0.batch_id
      JOIN class_session cs
        ON cs.closure_id = k.id AND cs.organization_id = k.organization_id
      LEFT JOIN class_schedule sch
        ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
     WHERE p_audience = 'closure'
       AND k0.id = p_closure_id
       AND k0.organization_id = p_organization_id
  ),
  audience AS (
    SELECT DISTINCT s.id, s.membership_id, s.contact_email,
           btrim(s.first_name || ' ' || s.last_name) AS student_name
      FROM enrollment e
      JOIN class_group cg
        ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
      JOIN student s
        ON s.id = e.student_id AND s.organization_id = e.organization_id
      LEFT JOIN season se
        ON se.id = cg.season_id AND se.organization_id = cg.organization_id
     WHERE e.organization_id = p_organization_id
       AND e.status = 'active'
       AND cg.archived_at IS NULL
       AND s.archived_at IS NULL
       AND (se.id IS NULL OR se.status <> 'archived')
       AND CASE p_audience
             WHEN 'class_group'  THEN cg.id = p_class_group_id
             WHEN 'level'        THEN cg.level_id = p_level_id
             WHEN 'facility'     THEN cg.facility_id = p_facility_id
             WHEN 'organization' THEN true
             WHEN 'closure'      THEN EXISTS (
               SELECT 1 FROM closed
                WHERE coalesce(closed.class_group_id, closed.schedule_group_id) = cg.id)
           END
  ),
  guardians AS (
    SELECT a.id AS student_id, g.guardian_membership_id
      FROM audience a
      JOIN guardian_link g
        ON g.student_id = a.id AND g.organization_id = p_organization_id
      JOIN membership m
        ON m.id = g.guardian_membership_id AND m.organization_id = g.organization_id
     WHERE g.archived_at IS NULL
       AND m.archived_at IS NULL
  ),
  partners AS (
    SELECT DISTINCT pa.id, pa.name
      FROM closed
      JOIN partner_group pg
        ON pg.id = closed.partner_group_id AND pg.organization_id = p_organization_id
      JOIN partner pa
        ON pa.id = pg.partner_id AND pa.organization_id = pg.organization_id
     WHERE pa.archived_at IS NULL
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext,
         NULL::uuid, NULL::uuid
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
  UNION ALL
  -- A partner is written to at its contacts' addresses; with none it is one row
  -- with no address, counted as not reachable rather than skipped.
  SELECT NULL::uuid, pa.name, NULL::uuid, coalesce(pc.name, pa.name),
         nullif(btrim(pc.email), '')::citext,
         pa.id, NULL::uuid
    FROM partners pa
    LEFT JOIN LATERAL (
      SELECT c.name, c.email
        FROM partner_contact c
       WHERE c.partner_id = pa.id
         AND c.organization_id = p_organization_id
         AND c.archived_at IS NULL
         AND nullif(btrim(coalesce(c.email, '')), '') IS NOT NULL
    ) pc ON true
  UNION ALL
  SELECT NULL::uuid,
         btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name),
         NULL::uuid,
         coalesce(nullif(btrim(l.guardian_name), ''),
                  btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name)),
         nullif(btrim(l.email), '')::citext,
         NULL::uuid, l.id
    FROM lead l
   WHERE l.organization_id = p_organization_id
     AND l.status = 'trial_booked'
     AND l.archived_at IS NULL
     AND l.anonymised_at IS NULL
     AND l.trial_session_id IN (SELECT closed.id FROM closed)
$$;

CREATE OR REPLACE FUNCTION message_recipients(
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

CREATE OR REPLACE FUNCTION email_addresses_today(p_org uuid, p_at timestamptz) RETURNS integer
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

DROP TABLE IF EXISTS push_subscription;
ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
      (audience = 'class_group') = (class_group_id IS NOT NULL)
  AND (audience = 'level')       = (level_id IS NOT NULL)
  AND (audience = 'facility')    = (facility_id IS NOT NULL)
  AND (audience = 'closure')     = (closure_id IS NOT NULL)
);
ALTER TABLE message DROP COLUMN IF EXISTS class_session_id;
