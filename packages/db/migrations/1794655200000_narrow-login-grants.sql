-- Up Migration

/*
 * Go-live review, 10-11-2026: four grants that had grown wider than anything
 * reads or writes through them.
 *
 * 1. `poolse_platform` read every column of `membership`. The grant dates from
 *    when the row held ids and a status; staff-record, staff-identity and
 *    staff-details later put NIF, NISS, address, birth date, emergency contact,
 *    notes and the encrypted ID number on it — for staff, guardians and
 *    students — and none of them narrowed the platform. It now reads the
 *    columns `/admin`, support, the trial clock and the alerts actually use.
 *
 * 2. `poolse_app` could UPDATE the licence on its own `organization` row —
 *    plan, trial, suspension, read-only, seat and site ceilings, billing mode,
 *    paid-through, the Stripe state — and INSERT organizations. The platform
 *    and the Stripe webhook write those through `poolse_platform`; signup goes
 *    through the definer. One mass-assignment bug in an Owner route would have
 *    let a club lift its own suspension or mark itself paid.
 *
 * 3. `poolse_app` held INSERT, UPDATE and DELETE on `app_user`, which is one
 *    row per person across every club. Rewriting `clerk_user_id` would hand a
 *    person's memberships in every club to another login. The cache columns are
 *    written by the definer functions; the app writes only `birth_date` and
 *    `contact_phone`.
 *
 * 4. `poolse_app` could read and rewrite `schema_migration`, so a bug could
 *    make a deploy skip or re-run a migration. And DELETE on six tables that
 *    are history or money, which the app only ever archives.
 *
 * `invoice_series.next_number` stays writable: `allocate_invoice_number` runs
 * as the caller. `student_fee_payment` and `attendance` keep DELETE: the app
 * deletes from both today.
 */

-- 1 ───────────────────────────────────────────────────────────────────────────
REVOKE SELECT ON membership FROM poolse_platform;
GRANT SELECT (id, organization_id, app_user_id, status, created_at, updated_at,
              archived_at, first_name, last_name, email, merged_into,
              support_grant_id, sports)
  ON membership TO poolse_platform;

-- 2 ───────────────────────────────────────────────────────────────────────────
REVOKE INSERT ON organization FROM poolse_app;
REVOKE UPDATE (id, kind, created_at, plan, subscription_status, trial_ends_at,
               suspended_at, suspension_reason, read_only_at, pending_delete_at,
               max_management_users, max_facilities, billing_mode, paid_through,
               stripe_subscription_id, subscription_current_period_end,
               subscription_cancel_at_period_end, billing_interval,
               stripe_event_at, archived_at)
  ON organization FROM poolse_app;

-- 3 ───────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON app_user FROM poolse_app;
GRANT UPDATE (birth_date, contact_phone) ON app_user TO poolse_app;

-- 4 ───────────────────────────────────────────────────────────────────────────
REVOKE ALL ON schema_migration FROM poolse_app;
REVOKE DELETE ON invoice_payment, staff_compensation, guardian_link,
                 student, student_sensitive, membership
  FROM poolse_app;

-- Down Migration

GRANT DELETE ON invoice_payment, staff_compensation, guardian_link,
                student, student_sensitive, membership
  TO poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON schema_migration TO poolse_app;

REVOKE UPDATE (birth_date, contact_phone) ON app_user FROM poolse_app;
GRANT INSERT, UPDATE, DELETE ON app_user TO poolse_app;

GRANT UPDATE (id, kind, created_at, plan, subscription_status, trial_ends_at,
              suspended_at, suspension_reason, read_only_at, pending_delete_at,
              max_management_users, max_facilities, billing_mode, paid_through,
              stripe_subscription_id, subscription_current_period_end,
              subscription_cancel_at_period_end, billing_interval,
              stripe_event_at, archived_at)
  ON organization TO poolse_app;
GRANT INSERT ON organization TO poolse_app;

REVOKE SELECT (id, organization_id, app_user_id, status, created_at, updated_at,
               archived_at, first_name, last_name, email, merged_into,
               support_grant_id, sports)
  ON membership FROM poolse_platform;
GRANT SELECT ON membership TO poolse_platform;
