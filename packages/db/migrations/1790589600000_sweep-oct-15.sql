-- Up Migration
--
-- Security and correctness sweep, 15 October 2026.
--
-- 1. **merge_memberships** could hand an Admin the club: absorbing the Owner's
--    record moved the `owner` role to the survivor and archived the Owner. It now
--    refuses to absorb the Owner, to merge two records that each have a login,
--    and to touch a support membership. And it had never worked as the app login:
--    its sweep of every `*membership_id` column issued an UPDATE on audit_log and
--    the other insert-only tables, which poolse_app may not update, so every merge
--    from the duplicates page failed with 42501. It now repoints only columns the
--    caller may update; history stays with the absorbed record (`merged_into`).
--    `apps/api/src/students/people-merge.integration.test.ts` runs it as the app.
--
-- 2. **resolve_memberships** kept a support membership's admin role for the life
--    of its grant even after the operator was removed from platform_admin. It now
--    also needs a live platform_admin row.
--
-- 3. **Eight functions still read `current_date`** — the server's day, an hour off
--    Lisbon's around midnight — after the 13-10 sweep moved column defaults to
--    `club_today()`: invoice_status, current_period_start, end_fees_with_enrollment,
--    student_is_adult_path, quota_band_for, skill_progress_stamps,
--    skill_thresholds_met, transfer_candidates. Rewritten in place from their own
--    current definitions, and asserted afterwards.

CREATE OR REPLACE FUNCTION merge_memberships(
  p_organization_id uuid,
  p_keep_id         uuid,
  p_absorb_id       uuid
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_moved integer := 0;
  v_count integer;
  r       RECORD;
BEGIN
  IF p_keep_id = p_absorb_id THEN
    RAISE EXCEPTION 'A person cannot be merged into themselves';
  END IF;

  -- Both must be live and in this tenant. This is also what makes the function
  -- idempotent: the second run finds the absorbed record archived and stops.
  PERFORM 1 FROM membership
   WHERE id = p_keep_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM 1 FROM membership
   WHERE id = p_absorb_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  /*
   * What is not a duplicate — sweep of 15-10-2026.
   *
   * Absorbing the Owner moved the `owner` row onto the survivor and archived the
   * Owner: an Admin could merge themselves with the Owner and be the Owner, the
   * invite matrix and `transfer_ownership` walked round. Ownership changes hands
   * only by transfer. Two records that each have their own login are two
   * people, and a support membership is Poolse's, never the club's.
   */
  IF EXISTS (
    SELECT 1 FROM membership_role
     WHERE membership_id = p_absorb_id AND role = 'owner' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'merge_absorbs_owner' USING ERRCODE = 'P0001';
  END IF;

  IF (SELECT count(*) FROM membership
       WHERE id IN (p_keep_id, p_absorb_id) AND app_user_id IS NOT NULL) = 2 THEN
    RAISE EXCEPTION 'merge_two_logins' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM membership
     WHERE id IN (p_keep_id, p_absorb_id) AND support_grant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'merge_support' USING ERRCODE = 'P0001';
  END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership k
     SET first_name = CASE WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         email      = coalesce(k.email, a.email),
         -- A login is identity, and the survivor's own wins. Two people with two
         -- logins is not a duplicate this function should be resolving.
         app_user_id = coalesce(k.app_user_id, a.app_user_id)
    FROM membership a
   WHERE k.id = p_keep_id
     AND a.id = p_absorb_id
     -- The identity constraint refuses club-held names on somebody Clerk names.
     -- Where the survivor gains a login, its own columns must go.
     AND true;

  -- Clerk owns the name and email where there is a login; clear ours rather than
  -- leave two answers to the same question.
  UPDATE membership
     SET first_name = NULL, last_name = NULL, email = NULL
   WHERE id = p_keep_id AND app_user_id IS NOT NULL;

  -- Roles the survivor does not already hold.
  UPDATE membership_role mr
     SET membership_id = p_keep_id
   WHERE mr.membership_id = p_absorb_id
     AND mr.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM membership_role keep
        WHERE keep.membership_id = p_keep_id
          AND keep.role = mr.role
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  -- Whatever is left is a role both held. Archive rather than delete.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = p_absorb_id AND archived_at IS NULL;

  -- Guardianships the survivor does not already have over the same student.
  UPDATE guardian_link gl
     SET guardian_membership_id = p_keep_id
   WHERE gl.guardian_membership_id = p_absorb_id
     AND gl.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link keep
        WHERE keep.guardian_membership_id = p_keep_id
          AND keep.student_id = gl.student_id
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE guardian_link SET archived_at = now()
   WHERE guardian_membership_id = p_absorb_id AND archived_at IS NULL;

  /*
   * Everything else, discovered rather than listed.
   *
   * Excludes the two handled above, and `membership` itself — the merged_into
   * pointer is set deliberately below and must not be swept up by a loop that
   * repoints every reference.
   */
  FOR r IN
    SELECT DISTINCT cl.relname AS table_name, att.attname AS column_name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
     WHERE c.contype = 'f'
       AND ref.relname = 'membership'
       AND att.attname LIKE '%membership_id'
       AND cl.relname NOT IN ('membership', 'membership_role', 'guardian_link')
       /*
        * Only what the caller may change. The insert-only history tables
        * (audit_log, invoice, incident, …) hold no UPDATE for poolse_app, and one
        * UPDATE statement against them failed the whole merge with 42501 — it had
        * never run as the app login. Their rows stay with the absorbed record,
        * which points at the survivor through `merged_into`: history is not
        * rewritten, which is also what an insert-only table is for.
        */
       AND has_column_privilege(current_user, c.conrelid, att.attname, 'UPDATE')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE %I = $2 AND organization_id = $3',
      r.table_name, r.column_name, r.column_name
    ) USING p_keep_id, p_absorb_id, p_organization_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved + v_count;
  END LOOP;

  -- And the student side of the relation, which points at a person by a column
  -- that does not end in `membership_id` on every table.
  UPDATE student SET membership_id = p_keep_id
   WHERE membership_id = p_absorb_id AND organization_id = p_organization_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE membership
     SET archived_at = now(), merged_into = p_keep_id
   WHERE id = p_absorb_id;

  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  VALUES (
    p_organization_id, 'person.merged', 'membership', p_keep_id,
    jsonb_build_object('absorbed', p_absorb_id, 'rowsRepointed', v_moved)
  );

  RETURN v_moved;
END;
$fn$;

CREATE OR REPLACE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id         uuid,
  o_organization_id     uuid,
  o_organization_name   text,
  o_organization_slug   text,
  o_organization_kind   text,
  o_membership_id       uuid,
  o_roles               text[],
  o_subscription_status text,
  o_trial_ends_at       timestamptz,
  o_suspended_at        timestamptz,
  o_suspension_reason   text,
  o_read_only_at        timestamptz,
  o_pending_delete_at   timestamptz,
  -- Set only on a support membership: when its session ends, for the banner.
  o_support_expires_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         o.slug,
         o.kind::text,
         m.id,
         CASE
           WHEN m.support_grant_id IS NOT NULL THEN ARRAY['admin']::text[]
           ELSE coalesce(
             array_agg(mr.role::text ORDER BY mr.role::text)
               FILTER (WHERE mr.archived_at IS NULL),
             '{}'::text[]
           )
         END,
         o.subscription_status::text,
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason,
         o.read_only_at,
         o.pending_delete_at,
         sg.expires_at
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN support_grant sg ON sg.organization_id = m.organization_id
                              AND sg.id = m.support_grant_id
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
     -- A support membership only while its grant is live. Read at every
     -- request, so expiry and revocation need nothing to run.
     AND (
       m.support_grant_id IS NULL
       OR (
         sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now()
         -- And only while the operator is still a platform admin — sweep of
         -- 15-10-2026: removing one left them an admin of every club they had
         -- entered until the grant ran out.
         AND EXISTS (
           SELECT 1 FROM platform_admin pa
            WHERE pa.clerk_user_id = u.clerk_user_id AND pa.archived_at IS NULL
         )
       )
     )
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         m.support_grant_id, o.subscription_status, o.trial_ends_at, o.suspended_at,
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at
ORDER BY m.created_at;
$$;

DO $do$
DECLARE
  f record;
  def text;
  rewritten text;
BEGIN
  -- Every `current_date` in these eight becomes the club's day.
  FOR f IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('invoice_status', 'current_period_start', 'end_fees_with_enrollment', 'student_is_adult_path', 'quota_band_for', 'skill_progress_stamps', 'skill_thresholds_met', 'transfer_candidates')
  LOOP
    def := pg_get_functiondef(f.oid);
    rewritten := regexp_replace(def, '\mcurrent_date\M', 'club_today()', 'gi');
    IF rewritten <> def THEN
      EXECUTE rewritten;
    END IF;
  END LOOP;
END
$do$;

DO $do$
DECLARE
  left_over text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO left_over
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('invoice_status', 'current_period_start', 'end_fees_with_enrollment', 'student_is_adult_path', 'quota_band_for', 'skill_progress_stamps', 'skill_thresholds_met', 'transfer_candidates')
     AND pg_get_functiondef(p.oid) ~* '\mcurrent_date\M';
  IF left_over IS NOT NULL THEN
    RAISE EXCEPTION 'still reading current_date: %', left_over;
  END IF;
END
$do$;

-- Down Migration

DO $do$
DECLARE
  f record;
  def text;
  rewritten text;
BEGIN
  -- Back to the server's day.
  FOR f IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('invoice_status', 'current_period_start', 'end_fees_with_enrollment', 'student_is_adult_path', 'quota_band_for', 'skill_progress_stamps', 'skill_thresholds_met', 'transfer_candidates')
  LOOP
    def := pg_get_functiondef(f.oid);
    rewritten := regexp_replace(def, 'club_today\(\)', 'current_date', 'gi');
    IF rewritten <> def THEN
      EXECUTE rewritten;
    END IF;
  END LOOP;
END
$do$;

CREATE OR REPLACE FUNCTION resolve_memberships(p_clerk_user_id text)
RETURNS TABLE (
  o_app_user_id         uuid,
  o_organization_id     uuid,
  o_organization_name   text,
  o_organization_slug   text,
  o_organization_kind   text,
  o_membership_id       uuid,
  o_roles               text[],
  o_subscription_status text,
  o_trial_ends_at       timestamptz,
  o_suspended_at        timestamptz,
  o_suspension_reason   text,
  o_read_only_at        timestamptz,
  o_pending_delete_at   timestamptz,
  -- Set only on a support membership: when its session ends, for the banner.
  o_support_expires_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         m.organization_id,
         o.name,
         o.slug,
         o.kind::text,
         m.id,
         CASE
           WHEN m.support_grant_id IS NOT NULL THEN ARRAY['admin']::text[]
           ELSE coalesce(
             array_agg(mr.role::text ORDER BY mr.role::text)
               FILTER (WHERE mr.archived_at IS NULL),
             '{}'::text[]
           )
         END,
         o.subscription_status::text,
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason,
         o.read_only_at,
         o.pending_delete_at,
         sg.expires_at
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN support_grant sg ON sg.organization_id = m.organization_id
                              AND sg.id = m.support_grant_id
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
     -- A support membership only while its grant is live. Read at every
     -- request, so expiry and revocation need nothing to run.
     AND (
       m.support_grant_id IS NULL
       OR (sg.ended_at IS NULL AND sg.starts_at <= now() AND sg.expires_at > now())
     )
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         m.support_grant_id, o.subscription_status, o.trial_ends_at, o.suspended_at,
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at
ORDER BY m.created_at;
$$;

CREATE OR REPLACE FUNCTION merge_memberships(
  p_organization_id uuid,
  p_keep_id         uuid,
  p_absorb_id       uuid
) RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_moved integer := 0;
  v_count integer;
  r       RECORD;
BEGIN
  IF p_keep_id = p_absorb_id THEN
    RAISE EXCEPTION 'A person cannot be merged into themselves';
  END IF;

  -- Both must be live and in this tenant. This is also what makes the function
  -- idempotent: the second run finds the absorbed record archived and stops.
  PERFORM 1 FROM membership
   WHERE id = p_keep_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM 1 FROM membership
   WHERE id = p_absorb_id AND organization_id = p_organization_id AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  /*
   * Field-level merge, stated once: non-null wins over null, and on a genuine
   * conflict the more recently updated record wins. The discarded value is not
   * lost — `merge_candidates` reported it before this ran, and the absorbed row
   * keeps it.
   */
  UPDATE membership k
     SET first_name = CASE WHEN k.first_name IS NULL THEN a.first_name
                           WHEN a.updated_at > k.updated_at AND a.first_name IS NOT NULL
                             THEN a.first_name ELSE k.first_name END,
         last_name  = CASE WHEN k.last_name IS NULL THEN a.last_name
                           WHEN a.updated_at > k.updated_at AND a.last_name IS NOT NULL
                             THEN a.last_name ELSE k.last_name END,
         phone      = coalesce(k.phone, a.phone),
         address    = coalesce(k.address, a.address),
         tax_number = coalesce(k.tax_number, a.tax_number),
         birth_date = coalesce(k.birth_date, a.birth_date),
         email      = coalesce(k.email, a.email),
         -- A login is identity, and the survivor's own wins. Two people with two
         -- logins is not a duplicate this function should be resolving.
         app_user_id = coalesce(k.app_user_id, a.app_user_id)
    FROM membership a
   WHERE k.id = p_keep_id
     AND a.id = p_absorb_id
     -- The identity constraint refuses club-held names on somebody Clerk names.
     -- Where the survivor gains a login, its own columns must go.
     AND true;

  -- Clerk owns the name and email where there is a login; clear ours rather than
  -- leave two answers to the same question.
  UPDATE membership
     SET first_name = NULL, last_name = NULL, email = NULL
   WHERE id = p_keep_id AND app_user_id IS NOT NULL;

  -- Roles the survivor does not already hold.
  UPDATE membership_role mr
     SET membership_id = p_keep_id
   WHERE mr.membership_id = p_absorb_id
     AND mr.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM membership_role keep
        WHERE keep.membership_id = p_keep_id
          AND keep.role = mr.role
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  -- Whatever is left is a role both held. Archive rather than delete.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = p_absorb_id AND archived_at IS NULL;

  -- Guardianships the survivor does not already have over the same student.
  UPDATE guardian_link gl
     SET guardian_membership_id = p_keep_id
   WHERE gl.guardian_membership_id = p_absorb_id
     AND gl.archived_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM guardian_link keep
        WHERE keep.guardian_membership_id = p_keep_id
          AND keep.student_id = gl.student_id
          AND keep.archived_at IS NULL
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE guardian_link SET archived_at = now()
   WHERE guardian_membership_id = p_absorb_id AND archived_at IS NULL;

  /*
   * Everything else, discovered rather than listed.
   *
   * Excludes the two handled above, and `membership` itself — the merged_into
   * pointer is set deliberately below and must not be swept up by a loop that
   * repoints every reference.
   */
  FOR r IN
    SELECT DISTINCT cl.relname AS table_name, att.attname AS column_name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum
     WHERE c.contype = 'f'
       AND ref.relname = 'membership'
       AND att.attname LIKE '%membership_id'
       AND cl.relname NOT IN ('membership', 'membership_role', 'guardian_link')
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE %I = $2 AND organization_id = $3',
      r.table_name, r.column_name, r.column_name
    ) USING p_keep_id, p_absorb_id, p_organization_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_moved := v_moved + v_count;
  END LOOP;

  -- And the student side of the relation, which points at a person by a column
  -- that does not end in `membership_id` on every table.
  UPDATE student SET membership_id = p_keep_id
   WHERE membership_id = p_absorb_id AND organization_id = p_organization_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_moved := v_moved + v_count;

  UPDATE membership
     SET archived_at = now(), merged_into = p_keep_id
   WHERE id = p_absorb_id;

  INSERT INTO audit_log (organization_id, action, entity_type, entity_id, data)
  VALUES (
    p_organization_id, 'person.merged', 'membership', p_keep_id,
    jsonb_build_object('absorbed', p_absorb_id, 'rowsRepointed', v_moved)
  );

  RETURN v_moved;
END;
$fn$;
