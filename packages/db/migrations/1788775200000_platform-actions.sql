-- Up Migration
--
-- Platform actions — the first thing on the operator's side that writes.
--
-- Slices 1 and 2 were read-only, and the platform role was granted SELECT and
-- nothing else on purpose. This is where that has to give, and the whole
-- question is how far.
--
-- ---------------------------------------------------------------------------
-- Not a SECURITY DEFINER function
-- ---------------------------------------------------------------------------
--
-- The obvious move — and the one this migration was going to make — is a named
-- function the platform role may execute. The migration checklist says
-- otherwise, in as many words: "If a second SECURITY DEFINER function seems
-- necessary, stop and reconsider — that is almost always a sign the problem is
-- somewhere else." It was.
--
-- Postgres grants UPDATE **per column**. So the platform role is given UPDATE on
-- exactly the six columns an operator may change and on nothing else, plus a
-- FOR UPDATE policy admitting every tenant. The result is narrower than a
-- function would be and needs no function body to review:
--
--   * `UPDATE organization SET name = …`      → permission denied. Still.
--   * `UPDATE organization SET archived_at = …` → permission denied. Deleting a
--     tenant is not an operator action and this is not the ticket that makes it
--     one.
--   * `INSERT INTO organization`               → no grant. Signup is the only way in.
--   * `DELETE FROM organization`               → no grant.
--
-- `packages/db/test/platform-admin.sql` test 5a asserted "the platform role
-- cannot write to organization" by trying to rewrite a tenant's *name*. It
-- passes unchanged, which is the point: the reach widened by exactly six columns
-- and the assertion that guards the rest never moved.
--
-- ---------------------------------------------------------------------------
-- Suspension is its own pair of columns, not a subscription status
-- ---------------------------------------------------------------------------
--
-- `past_due` and `suspended` are the two most tempting things to conflate here
-- and the most expensive. A club whose card expired on Tuesday is past due; it
-- is also mid-lesson with thirty children in the water, and cutting its register
-- off is not what "the payment bounced" should mean. Billing state and access
-- state are two facts, they move at different times and for different reasons,
-- and a column carrying both is a column somebody reads wrongly at midnight.
--
-- So: `subscription_status` says what the tenant is paying, and `suspended_at`
-- says whether the door is open. Only the second is enforced.

ALTER TABLE organization
  ADD COLUMN suspended_at      timestamptz,
  ADD COLUMN suspension_reason text;

/*
 * A suspension always carries a reason, and a reason never stands alone.
 *
 * Not tidiness. The person who meets this is a club owner at 08:00 being told
 * their account is closed, and "suspended" with no sentence beneath it is a
 * support call that starts from nothing. The reason is shown to them verbatim,
 * which is also why it is bounded — it is a sentence, not a paste of a ticket.
 */
ALTER TABLE organization
  ADD CONSTRAINT organization_suspension_pair CHECK (
    (suspended_at IS NULL) = (suspension_reason IS NULL)
  ),
  ADD CONSTRAINT organization_suspension_reason_sane CHECK (
    suspension_reason IS NULL
    OR (btrim(suspension_reason) <> '' AND length(suspension_reason) <= 500)
  );

COMMENT ON COLUMN organization.suspended_at IS
  'Set by a platform administrator: the tenant''s API is closed until this is '
  'cleared. Deliberately NOT the same thing as subscription_status = past_due — '
  'billing state and access state move at different times. Distinct from '
  'archived_at, which is deletion and is not an operator action.';

COMMENT ON COLUMN organization.suspension_reason IS
  'Shown verbatim to the suspended tenant. Required whenever suspended_at is '
  'set; a closed door with no sentence on it is a support call starting from '
  'nothing.';

-- ---------------------------------------------------------------------------
-- What the operator may change
-- ---------------------------------------------------------------------------

CREATE POLICY organization_platform_write ON organization
  FOR UPDATE TO poolse_platform USING (true) WITH CHECK (true);

/*
 * Six columns, named one at a time.
 *
 * A bare `GRANT UPDATE ON organization` would be one word shorter and would hand
 * over the name, the slug, the VAT number, the invoice series prefix and
 * `archived_at` along with them. Listing them is the difference between a role
 * that can adjust a plan and a role that can rename somebody's club.
 *
 * `updated_at` is not on the list and does not need to be: column privileges are
 * checked against the columns the statement names, and the BEFORE trigger sets
 * that one itself.
 */
GRANT UPDATE (
  trial_ends_at,
  subscription_status,
  max_facilities,
  max_management_users,
  suspended_at,
  suspension_reason
) ON organization TO poolse_platform;

-- ---------------------------------------------------------------------------
-- Enforcement, where the tenant is resolved
--
-- `resolve_memberships` is the one query every authenticated request already
-- makes, so suspension rides along on it rather than costing a second round trip
-- per request. The return type changes, so the function is dropped and recreated
-- — the same dance 1788422400000 did when it added the kind.
--
-- It still returns the membership. Refusing here would make a suspended tenant
-- indistinguishable from somebody who belongs to no organization, and `/me` has
-- to keep answering so the web app can draw the screen that says what happened
-- and why. The refusal belongs one layer up, in TenantMiddleware, where it can
-- carry a code and a sentence.
-- ---------------------------------------------------------------------------

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
  o_suspension_reason   text
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
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         ),
         o.subscription_status::text,
         o.trial_ends_at,
         o.suspended_at,
         o.suspension_reason
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         o.subscription_status, o.trial_ends_at, o.suspended_at, o.suspension_reason
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
  o_trial_ends_at       timestamptz
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
         coalesce(
           array_agg(mr.role::text ORDER BY mr.role::text)
             FILTER (WHERE mr.archived_at IS NULL),
           '{}'::text[]
         ),
         o.subscription_status::text,
         o.trial_ends_at
    FROM app_user u
    JOIN membership m    ON m.app_user_id = u.id
                        AND m.archived_at IS NULL
                        AND m.status = 'active'
    JOIN organization o  ON o.id = m.organization_id
                        AND o.archived_at IS NULL
    LEFT JOIN membership_role mr ON mr.organization_id = m.organization_id
                                AND mr.membership_id = m.id
   WHERE u.clerk_user_id = p_clerk_user_id
     AND u.deleted_at IS NULL
GROUP BY u.id, m.organization_id, o.name, o.slug, o.kind, m.id, m.created_at,
         o.subscription_status, o.trial_ends_at
ORDER BY m.created_at;
$$;

REVOKE ALL ON FUNCTION resolve_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_memberships(text) TO poolse_app;

REVOKE UPDATE (
  trial_ends_at,
  subscription_status,
  max_facilities,
  max_management_users,
  suspended_at,
  suspension_reason
) ON organization FROM poolse_platform;

DROP POLICY IF EXISTS organization_platform_write ON organization;

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_suspension_reason_sane,
  DROP CONSTRAINT IF EXISTS organization_suspension_pair,
  DROP COLUMN IF EXISTS suspension_reason,
  DROP COLUMN IF EXISTS suspended_at;
