-- Up Migration
--
-- An alert on the operator's own area — POOLSE-64, slice E1, item 5.
--
-- `platform_audit_log` already records every request that reaches
-- `PlatformModule`, reads included. What it does not do is *tell anybody*, and
-- the ticket's sentence for that is the reason this table exists: **a trail
-- nobody reads is not a control**. The realistic risk on this side of the
-- product was never somebody breaking the guard — it is somebody becoming Rui —
-- and the thing that catches that is a message arriving at an address the
-- attacker does not hold, a few seconds after the act.
--
-- ---------------------------------------------------------------------------
-- Why a second table rather than a column on platform_audit_log
-- ---------------------------------------------------------------------------
--
-- Three reasons, and the third is the one that settles it:
--
--   1. The audit log is *every* request. This is the handful worth waking
--      somebody for — a refusal, and a write. A `delivered_at` on the audit
--      table would be null on ten thousand reads and mean nothing there.
--   2. A delivery stamp is an UPDATE, and `platform_audit_log` holds no UPDATE
--      grant at all — deliberately, because an audit entry that can be rewritten
--      is not one. Widening that grant to carry a send stamp would trade the
--      stronger property for the weaker one.
--   3. They answer different questions. "What happened" is the log; "who was
--      told, and did it arrive" is this. `pool_analysis_alert` is the same shape
--      for the same reason, and its `delivered_at` comment is the model: null
--      means recorded and nothing left the building, said in words rather than
--      implied.
--
-- ---------------------------------------------------------------------------
-- Not tenant-scoped
-- ---------------------------------------------------------------------------
--
-- Like `platform_admin` and `platform_audit_log`, this is the platform's own
-- book. `organization_id` is a plain reference and **not** a tenant key: a row
-- here is *about* a club rather than belonging to one, and no club may ever read
-- it. Null for an alert that names no tenant, which every refusal at the door
-- does.

CREATE TYPE platform_alert_kind AS ENUM ('denied', 'write');

COMMENT ON TYPE platform_alert_kind IS
  'What kind of event raised a platform alert: a refused request at the guard, '
  'or a write to a tenant''s billing or access state. An enum rather than a '
  'lookup table because only a developer adds to this set — POOLSE-64.';

CREATE TABLE platform_alert (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            platform_alert_kind NOT NULL,

  -- Who did it. Text and not a foreign key, for the reason `platform_admin` is
  -- keyed the same way: the guard runs before any tenant is resolved, and the
  -- person who was *refused* is by definition not in `platform_admin` and may
  -- have no `app_user` row at all.
  clerk_user_id   text NOT NULL,

  -- Which club it was about, when there was one. Null at the door.
  organization_id uuid REFERENCES organization (id),

  -- The dotted machine key the audit trail uses: 'platform.denied',
  -- 'tenant.suspended'. Same vocabulary on purpose — an alert and its audit
  -- entry describe one event and should be greppable as one.
  action          text NOT NULL,

  -- What moved, or what was asked for. The same `changed` shape the audit entry
  -- carries, so the message can name the columns without a second reader of the
  -- tenant row.
  --
  -- **Never an amount.** Nothing here writes one: the columns a platform action
  -- moves are dates, statuses and ceilings, and `manual_payment` keeps the euros
  -- in its own insert-only table. The standing rule from docs/financials.md §9 —
  -- money stays out of paths, logs and trails — is a property of what is written
  -- here rather than a filter applied on the way out.
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- When it happened. Distinct from `created_at` for the reason
  -- `pool_analysis_alert` separates them: the two are microseconds apart today
  -- and would not be if a queue ever sat between them.
  raised_at       timestamptz NOT NULL DEFAULT now(),

  -- The addresses written to, as they were at the time. One env var today
  -- (`PLATFORM_ALERT_EMAIL`) rather than a list resolved from `platform_admin`:
  -- that table is keyed on the Clerk user id, and the platform grant on
  -- `app_user` is `(id, cached_email)` — no `clerk_user_id` — so the join an
  -- operator's address would need does not exist and widening the grant to make
  -- it exist is the ninth-table conversation, not a convenience taken inside a
  -- feature. An ops mailbox is also the right recipient: this is a control, not
  -- a personal notification.
  recipients      text[] NOT NULL DEFAULT '{}',

  -- Null means recorded and nothing left the building — no provider configured,
  -- no address to write to, the provider refused, or the send was suppressed as
  -- a repeat (`detail.delivery` says which). Never implied as sent.
  delivered_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (action <> '')
);

-- No `updated_at` and no `archived_at`, for the reason `platform_audit_log` has
-- neither: a row here is a record of a moment. The one thing that changes about
-- it is whether the message went, which is the column grant below.

-- The reads this will get: newest first, and "what has not gone out".
CREATE INDEX platform_alert_time_idx ON platform_alert (raised_at DESC);
CREATE INDEX platform_alert_undelivered_idx ON platform_alert (raised_at DESC)
  WHERE delivered_at IS NULL;

-- ---------------------------------------------------------------------------
-- No tenant may see it
--
-- `ALTER DEFAULT PRIVILEGES` in the core migration hands poolse_app all four
-- verbs on every table created since, so this one arrived readable by the tenant
-- connection. It goes back, and RLS is enabled with no policy naming poolse_app
-- — two independent reasons a tenant query returns nothing, as with the other
-- two platform tables.
-- ---------------------------------------------------------------------------

REVOKE ALL ON platform_alert FROM poolse_app;

ALTER TABLE platform_alert ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_alert_operators ON platform_alert
  FOR ALL TO poolse_platform USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- The grant: insert, read, and stamp the delivery. Nothing else.
--
-- A **column** grant for the UPDATE, the same instrument the six billing columns
-- on `organization` use and for the same reason: what an alert says happened is
-- not editable, and a missing privilege cannot be forgotten by application code
-- the way a code review can. `recipients` is in the list because it is written
-- *after* the send — "we tried to write to these three and the provider refused"
-- is worth more than an empty column — and `delivered_at` because that is the
-- one fact that changes.
--
-- **No DELETE**, here as everywhere else on this role. POOLSE-64 item 4: the
-- platform login destroys nothing, and an alert somebody could remove is an
-- alert an attacker removes first.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON platform_alert TO poolse_platform;
GRANT UPDATE (recipients, delivered_at) ON platform_alert TO poolse_platform;

COMMENT ON TABLE platform_alert IS
  'One row per refused platform request and per platform write, emailed to '
  'PLATFORM_ALERT_EMAIL after the transaction commits. delivered_at null means '
  'recorded and not sent. Platform-scoped: no tenant can read it — POOLSE-64.';

-- Down Migration

DROP POLICY IF EXISTS platform_alert_operators ON platform_alert;
DROP TABLE IF EXISTS platform_alert;
DROP TYPE IF EXISTS platform_alert_kind;
