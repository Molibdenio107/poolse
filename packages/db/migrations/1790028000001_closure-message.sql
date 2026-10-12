-- Up Migration
--
-- A closure can warn the families it affects — Rui, 12 October 2026.
--
-- **A new audience, not a new mechanism.** `message` gains `closure_id` and the
-- `closure` audience, and `message_recipients()` learns one more branch: the
-- students actively enrolled in a turma that had a lesson cancelled by this
-- closure (`class_session.closure_id`, set by `apply_closure` when the closure
-- is made). Everything else is POOLSE-67's as it stands: the preview and the
-- send read the same function, the daily ceiling counts it, recipients are
-- snapshotted and email leaves after the commit.
--
-- **Only those with a lesson cancelled** (Rui's call): a closure on a Tuesday
-- does not write to the Saturday families.

-- A cross-tenant-safe reference needs the composite key, which closure lacked.
ALTER TABLE closure ADD CONSTRAINT closure_organization_id_id_key UNIQUE (organization_id, id);

ALTER TABLE message
  ADD COLUMN closure_id uuid,
  ADD FOREIGN KEY (organization_id, closure_id) REFERENCES closure (organization_id, id);

ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
      (audience = 'class_group') = (class_group_id IS NOT NULL)
  AND (audience = 'level')       = (level_id IS NOT NULL)
  AND (audience = 'facility')    = (facility_id IS NOT NULL)
  AND (audience = 'closure')     = (closure_id IS NOT NULL)
);

COMMENT ON COLUMN message.closure_id IS
  'The closure a message warned about, for the closure audience: the families of '
  'turmas with a lesson that closure cancelled.';

DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid);

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
             -- The turmas this closure took a lesson from: a session it
             -- cancelled names it in `closure_id`. A parceria's session carries
             -- no students, so a school is never written to by this.
             WHEN 'closure'      THEN EXISTS (
               SELECT 1
                 FROM class_session cs
                 LEFT JOIN class_schedule sch
                   ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
                WHERE cs.organization_id = p_organization_id
                  AND cs.closure_id = p_closure_id
                  AND coalesce(cs.class_group_id, sch.class_group_id) = cg.id)
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

COMMENT ON FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid) IS
  'POOLSE-67: who a message reaches — live guardians, else the student — one row per '
  'student × address, null email where there is none. Read by preview and send alike. '
  'The closure audience reaches turmas with a lesson that closure cancelled.';

-- Down Migration

-- Refused while a closure message exists: the older CHECK cannot describe it,
-- and a message is a record that is never deleted.
DROP FUNCTION message_recipients(uuid, message_audience, uuid, uuid, uuid, uuid);

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

ALTER TABLE message DROP CONSTRAINT message_audience_target;
ALTER TABLE message ADD CONSTRAINT message_audience_target CHECK (
      (audience = 'class_group') = (class_group_id IS NOT NULL)
  AND (audience = 'level')       = (level_id IS NOT NULL)
  AND (audience = 'facility')    = (facility_id IS NOT NULL)
);
ALTER TABLE message DROP COLUMN closure_id;
ALTER TABLE closure DROP CONSTRAINT closure_organization_id_id_key;
