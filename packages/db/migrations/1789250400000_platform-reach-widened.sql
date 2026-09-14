-- Up Migration
--
-- The platform login reaches two things it deliberately could not — Rui's call,
-- 14 September 2026, and a reversal of two written rules rather than a gap.
--
-- Both rules are in CLAUDE.md and both were load-bearing, so what they cost is
-- written here rather than in a chat log:
--
--   1. "`archived_at` is not among them, so signup stays the only way a tenant
--      comes into being and **deleting one is not an operator action**."
--   2. "`poolse_platform` ... is named in a `FOR SELECT` policy on seven tables
--      and holds no privilege on the rest of the schema, so a mistake leaks those
--      seven rather than `student_sensitive` — and reaching an eighth is a
--      reviewed line of SQL."
--
-- This is that reviewed line, twice. **What changes is the blast radius of a
-- mistake in the platform area**: it now includes removing a club from every
-- list, and reading the e-mail of every person in every club. Neither is
-- theoretical — the operator area is one guard away from both.
--
-- Two things keep the cost as small as the decision allows, and neither is a
-- narrowing of it:
--
-- **Column grants, not table grants.** `UPDATE (archived_at)` and
-- `SELECT (id, cached_email)`, because a bare `GRANT UPDATE ON organization`
-- would hand over the name and the slug with it, and a bare
-- `GRANT SELECT ON app_user` would hand over every person's name and avatar as
-- well as their address. The capability asked for is exactly what is granted.
--
-- **`archived_at` is still not `DELETE`.** Archiving is a soft delete and is
-- reversible by the same login; nothing here destroys a row, and the purge
-- remains its own ticket.

-- ---------------------------------------------------------------------------
-- 1. The clock may archive a tenant on day 75
-- ---------------------------------------------------------------------------

GRANT UPDATE (archived_at) ON organization TO poolse_platform;

COMMENT ON COLUMN organization.archived_at IS
  'Filed away: invisible to every list, and reversible. Writable by '
  'poolse_platform since 14-09-2026 so the trial clock can close the ladder at '
  'day 75 — which makes removing a club something the operator area can do, and '
  'is why that was a decision rather than a grant. Never a DELETE.';

/*
 * The transition the clock could not record, because it could not make it.
 *
 * `ADD VALUE IF NOT EXISTS` and used by nothing in this transaction — Postgres
 * will add an enum value inside one and will not let the same one use it.
 */
ALTER TYPE trial_transition ADD VALUE IF NOT EXISTS 'archived';

-- ---------------------------------------------------------------------------
-- 2. A notice can say who it was owed to
-- ---------------------------------------------------------------------------
--
-- An owner's address lives in `app_user.cached_email` and not on their
-- membership row, so recording recipients means reading that table. It is the
-- eighth.
--
-- **Two columns and no more.** `cached_first_name`, `cached_last_name` and
-- `cached_avatar_url` are not on the grant: a notice needs an address, and a
-- name in a log is a second copy of something Clerk owns.

GRANT SELECT (id, cached_email) ON app_user TO poolse_platform;

/*
 * The grant is half of it; RLS is the other half.
 *
 * `app_user` has row-level security on with a policy that resolves a person
 * through their membership — correct for the tenant login and useless for this
 * one, which has no tenant. Without a policy naming it, the platform role holds a
 * grant that returns nothing, which is the failure mode that looks like a bug in
 * whatever asked.
 *
 * `FOR SELECT` only. The platform login reads addresses; Clerk owns them and the
 * webhook writes them, and nothing about this decision changes that.
 */
CREATE POLICY app_user_platform ON app_user
  FOR SELECT TO poolse_platform USING (true);

-- Down Migration
--
-- The reach goes back to what it was. A tenant already archived by the clock
-- stays archived — reversing a grant must not resurrect clubs — and the enum
-- keeps its value, because rebuilding `trial_transition` would mean rewriting
-- rows that legitimately record an archive that happened.

DROP POLICY IF EXISTS app_user_platform ON app_user;

REVOKE SELECT (id, cached_email) ON app_user FROM poolse_platform;

REVOKE UPDATE (archived_at) ON organization FROM poolse_platform;

COMMENT ON COLUMN organization.archived_at IS NULL;
