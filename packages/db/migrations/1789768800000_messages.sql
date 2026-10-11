-- Up Migration
--
-- Messages to a turma, a level, a site or the whole club — POOLSE-67, roadmap 7.1.
--
-- Tomorrow's 18:00 class is cancelled and forty families have to be told. Poolse
-- knows who is in the turma and who answers for each child; what was missing is a
-- way to write to them and **a record that it happened**. This is that record.
--
-- **The audience is a rule, the recipients are a snapshot.** Who a message reaches
-- is decided once, at send time, by `message_recipients()` below — and the people
-- it resolved to are then written down with their names and addresses as they were,
-- because "who was told" is not recoverable later from a guardian who has since been
-- unlinked. The same argument as `pool_analysis_alert.recipients` and every snapshot
-- on an invoice line.
--
-- **Written in the transaction, sent after the commit.** The 4.2 water alert's
-- division: a slow mail server must never roll back the record, and an email is not
-- idempotent. `delivered_at` null means recorded and not sent, which the screens say
-- in words.
--
-- **A daily ceiling, in the database.** 20 messages or 2,000 addresses per club per
-- Lisbon day, whichever comes first (decisions, 11-10-2026). A trigger under a
-- per-tenant advisory lock, so two sends at once cannot both fit, raising with the
-- numbers in DETAIL as `pool_capacity_respected` does.
--
-- **Nothing here is ever destroyed, and almost nothing is ever changed.** A message
-- may be archived (hidden from the list); its words may not be edited, and a
-- recipient row may only be stamped delivered. Both by column grant rather than by
-- trigger: a missing privilege cannot be forgotten by application code.

CREATE TYPE message_audience AS ENUM ('class_group', 'level', 'facility', 'organization');

COMMENT ON TYPE message_audience IS
  'Who a message is for: one turma, one level (club-wide), one site, or everybody. '
  'Exactly one of class_group_id / level_id / facility_id is set to match, or none '
  'for the whole club.';

CREATE TABLE message (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization (id),

  audience              message_audience NOT NULL,
  class_group_id        uuid,
  level_id              uuid,
  facility_id           uuid,

  subject               text NOT NULL,
  body                  text NOT NULL,

  sent_by_membership_id uuid NOT NULL,
  sent_at               timestamptz NOT NULL DEFAULT now(),

  -- The distinct addresses this message was written to. Stored rather than counted
  -- because the daily ceiling reads it on every send, and checked against the
  -- recipient rows at commit by `message_address_count_agrees` — a copy with
  -- neither a source nor a check is a copy that drifts.
  address_count         integer NOT NULL,

  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, class_group_id) REFERENCES class_group (organization_id, id),
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, sent_by_membership_id) REFERENCES membership (organization_id, id),

  -- The audience names exactly the one target it is about.
  CONSTRAINT message_audience_target CHECK (
        (audience = 'class_group') = (class_group_id IS NOT NULL)
    AND (audience = 'level')       = (level_id IS NOT NULL)
    AND (audience = 'facility')    = (facility_id IS NOT NULL)
  ),
  CONSTRAINT message_subject_length CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  CONSTRAINT message_body_length    CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  CHECK (address_count >= 0)
);

COMMENT ON TABLE message IS
  'One message written to families — POOLSE-67. The words and the audience; who it '
  'reached is in message_recipient. Archived, never deleted, never edited.';
COMMENT ON COLUMN message.address_count IS
  'Distinct addresses written to. Read by the daily ceiling; checked against '
  'message_recipient at commit.';

-- The history list, newest first, and the daily ceiling's window.
CREATE INDEX message_sent_idx ON message (organization_id, sent_at DESC);
-- An instructor's list: messages to their own turmas.
CREATE INDEX message_class_group_idx ON message (organization_id, class_group_id)
  WHERE class_group_id IS NOT NULL;

CREATE TRIGGER message_updated_at BEFORE UPDATE ON message
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE message_recipient (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organization (id),
  message_id             uuid NOT NULL,

  -- Whom the address was resolved *for*. A guardian of two siblings is two rows
  -- and one email: the record says the message reached both children's families,
  -- and the send folds them on the address.
  student_id             uuid NOT NULL,
  -- Null means the student themselves — the adult path, or a student nobody has
  -- given a guardian yet.
  guardian_membership_id uuid,

  -- Snapshots, as they were when the message was sent.
  student_name           text NOT NULL,
  name                   text NOT NULL,
  -- Null means nobody could be written to for this row. Recorded, never dropped:
  -- "3 alunos sem contacto" is part of what the club needs to know.
  email                  citext,

  -- Null means recorded and not sent: no provider configured, or it refused.
  delivered_at           timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  FOREIGN KEY (organization_id, message_id) REFERENCES message (organization_id, id),
  FOREIGN KEY (organization_id, student_id) REFERENCES student (organization_id, id),
  FOREIGN KEY (organization_id, guardian_membership_id) REFERENCES membership (organization_id, id),

  -- Delivered to nobody is not delivered.
  CHECK (delivered_at IS NULL OR email IS NOT NULL)
);

COMMENT ON TABLE message_recipient IS
  'Who a message was written to, one row per student × address, snapshotted. No '
  'DELETE and no archive: it says somebody was written to, and that happened or not.';
COMMENT ON COLUMN message_recipient.delivered_at IS
  'When the email actually left. Null means recorded but not sent, which the screens say plainly.';

CREATE INDEX message_recipient_message_idx ON message_recipient (organization_id, message_id);

CREATE TRIGGER message_recipient_updated_at BEFORE UPDATE ON message_recipient
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Who a message reaches — the one definition
--
-- Read by the preview (a SELECT) and by the send (an INSERT … SELECT), so the
-- count somebody confirmed and the rows written come from one query.
--
-- A student is in the audience with an `active` enrolment in a live turma whose
-- season has not ended. `waiting` is not in the turma and `ended` has left it. A
-- level means the *turma's* level, not `student.level_id`: a message about Nível
-- 3's pool time is for the people in Nível 3's turmas.
--
-- For each student: every live guardian, else the student themselves — the order
-- the invoice payer uses. The adult path *is* the absence of a live guardian edge,
-- so `student_is_adult_path` is not re-derived here; a minor nobody has linked a
-- guardian to yet is reached at the address reception typed, which beats nobody.
--
-- STABLE and SECURITY INVOKER: it runs under the caller's RLS like any query.
-- ---------------------------------------------------------------------------

CREATE FUNCTION message_recipients(
  p_organization_id uuid,
  p_audience        message_audience,
  p_class_group_id  uuid,
  p_level_id        uuid,
  p_facility_id     uuid
) RETURNS TABLE (
  student_id             uuid,
  student_name           text,
  guardian_membership_id uuid,
  name                   text,
  email                  citext
)
LANGUAGE sql
STABLE
AS $$
  WITH audience AS (
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
  )
  SELECT a.id, a.student_name, gu.guardian_membership_id,
         coalesce(person_name(gu.guardian_membership_id), a.student_name),
         nullif(btrim(person_email(gu.guardian_membership_id)::text), '')::citext
    FROM guardians gu
    JOIN audience a ON a.id = gu.student_id
  UNION ALL
  SELECT a.id, a.student_name, NULL::uuid, a.student_name,
         nullif(btrim(coalesce(person_email(a.membership_id), a.contact_email)::text), '')::citext
    FROM audience a
   WHERE NOT EXISTS (SELECT 1 FROM guardians gu WHERE gu.student_id = a.id)
$$;

COMMENT ON FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid) IS
  'POOLSE-67: who a message reaches — live guardians, else the student — one row per '
  'student × address, null email where there is none. Read by preview and send alike.';

-- ---------------------------------------------------------------------------
-- The daily ceiling
-- ---------------------------------------------------------------------------

CREATE FUNCTION message_daily_limit() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 20 $$;

CREATE FUNCTION message_daily_address_limit() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 2000 $$;

COMMENT ON FUNCTION message_daily_limit() IS
  'POOLSE-67: messages a club may send per Lisbon day. The one definition.';
COMMENT ON FUNCTION message_daily_address_limit() IS
  'POOLSE-67: addresses a club may write to per Lisbon day. The one definition.';

-- The club's day is the Lisbon day, which is `APP_TIME_ZONE` in the web app — the
-- calendar a person reads "today" from. A UTC day would reset the count at 01:00
-- for half the year.
CREATE FUNCTION message_day_start(p_at timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('day', p_at AT TIME ZONE 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon'
$$;

CREATE FUNCTION message_quota_respected() RETURNS trigger AS $$
DECLARE
  v_messages  integer;
  v_addresses integer;
BEGIN
  -- Serialise this club's sends so the count below includes a racing send that
  -- committed first. Each statement in a plpgsql function takes a fresh snapshot
  -- under READ COMMITTED, so the SELECT after the lock sees it.
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

CREATE TRIGGER message_quota BEFORE INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION message_quota_respected();

-- `address_count` must say what the recipient rows say, checked at commit once
-- both have been written.
CREATE FUNCTION message_address_count_agrees() RETURNS trigger AS $$
DECLARE
  v_actual integer;
BEGIN
  SELECT count(DISTINCT email) INTO v_actual
    FROM message_recipient
   WHERE organization_id = NEW.organization_id
     AND message_id = NEW.id
     AND email IS NOT NULL;

  IF v_actual <> NEW.address_count THEN
    RAISE EXCEPTION 'message % claims % addresses and has %', NEW.id, NEW.address_count, v_actual
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER message_address_count_agrees
  AFTER INSERT ON message
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION message_address_count_agrees();

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------

ALTER TABLE message ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_tenant ON message
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

ALTER TABLE message_recipient ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_recipient_tenant ON message_recipient
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- A REVOKE and then a narrow GRANT, because `core-tenancy` sets default
-- privileges granting all four on every new table. A message may be archived and
-- nothing else; a recipient may be stamped delivered and nothing else.
REVOKE UPDATE, DELETE ON message FROM poolse_app;
GRANT SELECT, INSERT ON message TO poolse_app;
GRANT UPDATE (archived_at) ON message TO poolse_app;

REVOKE UPDATE, DELETE ON message_recipient FROM poolse_app;
GRANT SELECT, INSERT ON message_recipient TO poolse_app;
GRANT UPDATE (delivered_at) ON message_recipient TO poolse_app;

-- Down Migration

DROP TRIGGER IF EXISTS message_address_count_agrees ON message;
DROP TRIGGER IF EXISTS message_quota ON message;
DROP FUNCTION IF EXISTS message_address_count_agrees();
DROP FUNCTION IF EXISTS message_quota_respected();
DROP FUNCTION IF EXISTS message_day_start(timestamptz);
DROP FUNCTION IF EXISTS message_daily_address_limit();
DROP FUNCTION IF EXISTS message_daily_limit();
DROP FUNCTION IF EXISTS message_recipients(uuid, message_audience, uuid, uuid, uuid);

DROP POLICY IF EXISTS message_recipient_tenant ON message_recipient;
DROP POLICY IF EXISTS message_tenant ON message;

DROP TABLE IF EXISTS message_recipient;
DROP TABLE IF EXISTS message;
DROP TYPE IF EXISTS message_audience;
