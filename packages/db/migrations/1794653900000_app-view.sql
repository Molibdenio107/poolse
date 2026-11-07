-- Up Migration

-- POOLSE-188 — an owner, an admin or Poolse support sees the app as a real person
-- of the club, read-only.
--
-- **The row is the view.** No cookie and no header: `resolve_memberships` looks
-- for a live row on every request, so a request that forgot to say so is still
-- under the view. It runs on every request already, so this costs no round trip.
--
-- `hat` is the home chosen. Only that home's roles apply, so the view never
-- carries a viewed person's `admin` or `owner`.
--
-- **Only `ended_at` may change** afterwards, by column grant: who looked at whom
-- is a record. No DELETE grant, and no `archived_at`, for the same reason. A view
-- that simply ran out keeps a null `ended_at`, and read as ended at `expires_at`.
--
-- `viewer_support_grant_id` exists because a support membership is reused from
-- grant to grant (`support_session`): without it a view left open would come
-- back under the next grant.

CREATE TYPE app_view_hat AS ENUM ('family', 'teaching', 'maintenance');

/** Which roles each home is. One definition, read by the lookup and the picker. */
CREATE FUNCTION app_view_hat_roles(p_hat app_view_hat) RETURNS member_role[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_hat
           WHEN 'family'      THEN ARRAY['guardian', 'student']::member_role[]
           WHEN 'teaching'    THEN ARRAY['instructor']::member_role[]
           WHEN 'maintenance' THEN ARRAY['maintenance']::member_role[]
         END;
$$;

CREATE TABLE app_view (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization (id),
  viewer_membership_id    uuid NOT NULL,
  viewed_membership_id    uuid NOT NULL,
  hat                     app_view_hat NOT NULL,
  viewer_support_grant_id uuid,
  reason                  text,
  started_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  ended_at                timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, viewer_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, viewed_membership_id) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, viewer_support_grant_id) REFERENCES support_grant (organization_id, id),
  CONSTRAINT app_view_not_self CHECK (viewer_membership_id <> viewed_membership_id),
  -- Rule 11: never longer than an hour, whatever a caller sends.
  CONSTRAINT app_view_one_hour CHECK (expires_at > started_at AND expires_at <= started_at + interval '1 hour'),
  -- Rule 6: support says why.
  CONSTRAINT app_view_support_reason CHECK (
    viewer_support_grant_id IS NULL OR length(btrim(coalesce(reason, ''))) BETWEEN 1 AND 500
  )
);

-- One open view per reader, and the index the lookup reads.
CREATE UNIQUE INDEX app_view_one_open ON app_view (organization_id, viewer_membership_id)
  WHERE ended_at IS NULL;
CREATE INDEX app_view_recent ON app_view (organization_id, started_at DESC);

CREATE TRIGGER app_view_updated_at BEFORE UPDATE ON app_view
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE app_view ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_view_tenant ON app_view
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

REVOKE ALL ON app_view FROM poolse_app;
GRANT SELECT, INSERT ON app_view TO poolse_app;
GRANT UPDATE (ended_at) ON app_view TO poolse_app;

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE FUNCTION resolve_memberships(p_clerk_user_id text)
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
  o_support_expires_at  timestamptz,
  -- POOLSE-87: what this club has switched off.
  o_disabled_modules    text[],
  -- POOLSE-124: the sports this club has switched on.
  o_enabled_sports      text[],
  -- POOLSE-145: the sports this person belongs to.
  o_sports              text[],
  -- POOLSE-188: a live view. All null when there is none, and "live" is decided
  -- here, on every request, so nothing has to run for a view to end.
  o_view_id              uuid,
  o_view_hat             text,
  o_view_expires_at      timestamptz,
  o_viewed_membership_id uuid,
  o_viewed_app_user_id   uuid,
  o_viewed_roles         text[],
  o_viewed_sports        text[]
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
         sg.expires_at,
         o.disabled_modules::text[],
         o.enabled_sports,
         m.sports,
         v.id,
         v.hat::text,
         v.expires_at,
         v.viewed_membership_id,
         v.viewed_app_user_id,
         v.viewed_roles,
         v.viewed_sports
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
    /*
     * POOLSE-188. Everybody is re-read on every request: an Admin demoted, a
     * person who left, a grant replaced all end the view with nothing to run.
     * The roles are only the chosen home's, so a person who teaches and also
     * administers is viewed as an instructor, never with `admin`.
     */
    LEFT JOIN LATERAL (
      SELECT av.id, av.hat, av.expires_at, av.viewed_membership_id,
             vm.app_user_id AS viewed_app_user_id,
             vm.sports      AS viewed_sports,
             ARRAY(
               SELECT vr.role::text FROM membership_role vr
                WHERE vr.organization_id = vm.organization_id
                  AND vr.membership_id = vm.id
                  AND vr.archived_at IS NULL
                  AND vr.role = ANY (app_view_hat_roles(av.hat))
                ORDER BY vr.role::text
             ) AS viewed_roles
        FROM app_view av
        JOIN membership vm ON vm.organization_id = av.organization_id
                          AND vm.id = av.viewed_membership_id
                          AND vm.archived_at IS NULL
                          AND vm.status = 'active'
                          AND vm.support_grant_id IS NULL
        JOIN app_user vu ON vu.id = vm.app_user_id AND vu.deleted_at IS NULL
       WHERE av.organization_id = m.organization_id
         AND av.viewer_membership_id = m.id
         AND av.ended_at IS NULL
         AND av.started_at <= now()
         AND av.expires_at > now()
         -- The same support session: its membership is reused from grant to grant.
         AND av.viewer_support_grant_id IS NOT DISTINCT FROM m.support_grant_id
         -- The reader may still view: support, or a live owner or admin.
         AND (m.support_grant_id IS NOT NULL OR EXISTS (
               SELECT 1 FROM membership_role own
                WHERE own.organization_id = m.organization_id
                  AND own.membership_id = m.id
                  AND own.archived_at IS NULL
                  AND own.role IN ('owner', 'admin')))
         -- Only the Owner may view the Owner.
         AND (NOT EXISTS (
               SELECT 1 FROM membership_role tgt
                WHERE tgt.organization_id = vm.organization_id
                  AND tgt.membership_id = vm.id
                  AND tgt.archived_at IS NULL
                  AND tgt.role = 'owner')
              OR (m.support_grant_id IS NULL AND EXISTS (
               SELECT 1 FROM membership_role own
                WHERE own.organization_id = m.organization_id
                  AND own.membership_id = m.id
                  AND own.archived_at IS NULL
                  AND own.role = 'owner')))
         -- The person viewed still holds the home's role.
         AND EXISTS (
               SELECT 1 FROM membership_role vr
                WHERE vr.organization_id = vm.organization_id
                  AND vr.membership_id = vm.id
                  AND vr.archived_at IS NULL
                  AND vr.role = ANY (app_view_hat_roles(av.hat)))
       LIMIT 1
    ) v ON true
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
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at,
         o.disabled_modules, o.enabled_sports, m.sports,
         v.id, v.hat, v.expires_at, v.viewed_membership_id, v.viewed_app_user_id,
         v.viewed_roles, v.viewed_sports
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS resolve_memberships(text);

CREATE FUNCTION resolve_memberships(p_clerk_user_id text)
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
  o_support_expires_at  timestamptz,
  -- POOLSE-87: what this club has switched off.
  o_disabled_modules    text[],
  -- POOLSE-124: the sports this club has switched on.
  o_enabled_sports      text[],
  -- POOLSE-145: the sports this person belongs to.
  o_sports              text[]
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
         sg.expires_at,
         o.disabled_modules::text[],
         o.enabled_sports,
         m.sports
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
         o.suspension_reason, o.read_only_at, o.pending_delete_at, sg.expires_at,
         o.disabled_modules, o.enabled_sports, m.sports
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

DROP TABLE app_view;
DROP FUNCTION app_view_hat_roles(app_view_hat);
DROP TYPE app_view_hat;
