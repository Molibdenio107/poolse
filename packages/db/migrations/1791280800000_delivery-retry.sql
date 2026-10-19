-- Up Migration
--
-- POOLSE-86 slice 3.0a — the recorded notices go out, and a failed send is retried.
--
-- **Every sender here was fire-once.** It sends after the commit and stamps
-- `delivered_at` when mail left; a Resend outage at that minute left the row
-- "recorded, not sent" for ever. An hourly job now retries what is unsent and
-- recent, and these two columns are its bookkeeping: how many retries, and when
-- the last one was. `delivery_attempts` counts retries only — the first send is
-- the one every sender already makes — and the job stops at five.
--
-- Invitations are deliberately not here: the join link is stored as a hash, so
-- a retry could not rebuild the email, and *Novo link* already re-sends one.
--
-- **The support override notice is the one new write.** `poolse_platform`
-- records the override and the Owners it is owed to; stamping that it was sent
-- needs UPDATE on three named columns of an override row, by column grant and a
-- policy that matches overrides only — nothing else on `support_grant` becomes
-- writable by the platform login.

ALTER TABLE pool_analysis_alert
  ADD COLUMN delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE lab_result_alert
  ADD COLUMN delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE qualification_alert
  ADD COLUMN delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE message_recipient
  ADD COLUMN delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE platform_alert
  ADD COLUMN delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE trial_notice
  ADD COLUMN delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE support_grant
  ADD COLUMN notice_delivery_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN notice_last_attempt_at timestamptz;

-- The tenant tables whose UPDATE is a column grant gain the two columns.
-- (`pool_analysis_alert` carries a table-wide UPDATE already.)
GRANT UPDATE (delivery_attempts, last_attempt_at) ON lab_result_alert TO poolse_app;
GRANT UPDATE (delivery_attempts, last_attempt_at) ON qualification_alert TO poolse_app;
GRANT UPDATE (delivery_attempts, last_attempt_at) ON message_recipient TO poolse_app;
GRANT UPDATE (delivery_attempts, last_attempt_at) ON platform_alert TO poolse_platform;
-- `trial_notice` already carries a table-wide UPDATE for poolse_platform.

GRANT UPDATE (notice_delivered_at, notice_delivery_attempts, notice_last_attempt_at)
  ON support_grant TO poolse_platform;
CREATE POLICY support_grant_operators_notice ON support_grant
  FOR UPDATE TO poolse_platform
  USING (source = 'override') WITH CHECK (source = 'override');

COMMENT ON COLUMN trial_notice.recipients IS
  'The owners the notice was owed to, resolved by role when it fell due (POOLSE-61). '
  'Since POOLSE-86 the notice is emailed to them and delivered_at stamped.';
COMMENT ON COLUMN support_grant.notice_recipients IS
  'An override only: the Owner addresses the notice was owed to, snapshotted. '
  'Emailed since POOLSE-86; notice_delivered_at says whether it left.';

-- Down Migration

DROP POLICY IF EXISTS support_grant_operators_notice ON support_grant;
REVOKE UPDATE (notice_delivered_at, notice_delivery_attempts, notice_last_attempt_at)
  ON support_grant FROM poolse_platform;
REVOKE UPDATE (delivery_attempts, last_attempt_at) ON platform_alert FROM poolse_platform;
REVOKE UPDATE (delivery_attempts, last_attempt_at) ON message_recipient FROM poolse_app;
REVOKE UPDATE (delivery_attempts, last_attempt_at) ON qualification_alert FROM poolse_app;
REVOKE UPDATE (delivery_attempts, last_attempt_at) ON lab_result_alert FROM poolse_app;

ALTER TABLE support_grant DROP COLUMN IF EXISTS notice_last_attempt_at,
  DROP COLUMN IF EXISTS notice_delivery_attempts;
ALTER TABLE trial_notice DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS delivery_attempts;
ALTER TABLE platform_alert DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS delivery_attempts;
ALTER TABLE message_recipient DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS delivery_attempts;
ALTER TABLE qualification_alert DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS delivery_attempts;
ALTER TABLE lab_result_alert DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS delivery_attempts;
ALTER TABLE pool_analysis_alert DROP COLUMN IF EXISTS last_attempt_at, DROP COLUMN IF EXISTS delivery_attempts;
