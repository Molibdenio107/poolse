-- Up Migration

-- POOLSE-146 slice a — a message can be written to every family in one sport
-- (Rui, 01-11-2026): "tell every tennis family the courts are closed without
-- picking six turmas".
--
-- **`message.sport_id`** names the sport, a plain FK to the platform's `sport`
-- catalogue (as `playing_area.sport_id`), and the CHECK that a message names
-- exactly its audience's target extends to it.
--
-- **The recipients stay one function** (`message_recipients_all`, wrapped by
-- `message_recipients` for the opt-out), so the preview and the send still
-- share it. Its new branch: an active enrolment in a live turma whose recinto
-- has that sport; a turma with no recinto is swimming's, as the student list
-- reads it. Both functions gain a trailing `p_sport_id`, which changes their
-- signature, so they are dropped and made again — keeping the six-argument
-- versions beside them would make every existing call ambiguous. Their bodies
-- are the live ones (`pg_get_functiondef`, 02-11-2026) with only the sport added.
--
-- The daily ceiling stays per club (out of scope: per-sport quotas).

ALTER TABLE message ADD COLUMN sport_id text REFERENCES sport (id);

COMMENT ON COLUMN message.sport_id IS
  'POOLSE-146: the sport a `sport` message was written to — every family with an active turma in it.';

ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
  ((audience = 'class_group'::message_audience) = (class_group_id IS NOT NULL)) AND ((audience = 'level'::message_audience) = (level_id IS NOT NULL)) AND ((audience = 'facility'::message_audience) = (facility_id IS NOT NULL)) AND ((audience = 'closure'::message_audience) = (closure_id IS NOT NULL)) AND ((audience = 'session'::message_audience) = (class_session_id IS NOT NULL))
  AND ((audience = 'sport'::message_audience) = (sport_id IS NOT NULL))
);

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid);
DROP FUNCTION message_recipients_all(uuid, message_audience, uuid, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.message_recipients_all(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
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
      -- POOLSE-146: the turma's sport is its recinto's; a turma with none is swimming's.
      LEFT JOIN playing_area pa
        ON pa.id = cg.playing_area_id AND pa.organization_id = cg.organization_id
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
             -- POOLSE-146: everybody in one sport — a student in two is one row (DISTINCT).
             WHEN 'sport'        THEN coalesce(pa.sport_id, 'pool') = p_sport_id
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
$function$;

CREATE OR REPLACE FUNCTION public.message_recipients(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid, p_sport_id text DEFAULT NULL::text)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid, opted_out boolean)
 LANGUAGE sql
 STABLE
AS $function$
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
                                p_level_id, p_facility_id, p_closure_id, p_sport_id) r
$function$;

-- Down Migration

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid, text);
DROP FUNCTION message_recipients_all(uuid, message_audience, uuid, uuid, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.message_recipients_all(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.message_recipients(p_organization_id uuid, p_audience message_audience, p_class_group_id uuid, p_level_id uuid, p_facility_id uuid, p_closure_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(student_id uuid, student_name text, guardian_membership_id uuid, name text, email citext, partner_id uuid, lead_id uuid, opted_out boolean)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$;

-- A sport message left behind makes the narrower CHECK refuse the down.
ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
  ((audience = 'class_group'::message_audience) = (class_group_id IS NOT NULL)) AND ((audience = 'level'::message_audience) = (level_id IS NOT NULL)) AND ((audience = 'facility'::message_audience) = (facility_id IS NOT NULL)) AND ((audience = 'closure'::message_audience) = (closure_id IS NOT NULL)) AND ((audience = 'session'::message_audience) = (class_session_id IS NOT NULL))
);
ALTER TABLE message DROP COLUMN IF EXISTS sport_id;
