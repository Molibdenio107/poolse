-- Up Migration
--
-- POOLSE-79 slice 2: support asks, and support forces.
--
-- **A request** is the operator asking a club's Owner to open a window. It is
-- not a grant: it opens nothing until the Owner approves it, and the approval
-- is an ordinary Owner grant (`source = 'request'`) written on the tenant
-- connection. So the platform inserts a request and never a membership or a
-- live window on the club's behalf. An unanswered request lapses after 7 days,
-- derived and never written, like a grant's expiry.
--
-- **An override** is the 08:00 case: the club is broken and the Owner is not
-- answering. It is the one grant the platform writes itself, held to the
-- narrowest shape by the schema:
--
--   * `source = 'override'`, by the policy that lets the platform insert at all;
--   * exactly 4 hours, by CHECK, so renewing one means writing another, with
--     its reason again;
--   * a reason (already required by `support_grant_reasoned`).
--
-- It records a notice to the Owner with the reason verbatim: who it was owed to,
-- snapshotted, and `notice_delivered_at` null until an email provider exists.
-- That is the same honesty `trial_notice` keeps about what Poolse has and has
-- not sent.

CREATE TYPE support_request_answer AS ENUM ('approved', 'declined');

CREATE TABLE support_request (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 uuid NOT NULL REFERENCES organization (id),
  requested_by_platform_admin_id  uuid NOT NULL REFERENCES platform_admin (id),
  reason                          text NOT NULL,

  answered_at                     timestamptz,
  answer                          support_request_answer,
  answered_by_membership_id       uuid,
  -- The window an approval opened.
  grant_id                        uuid,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, answered_by_membership_id)
    REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, grant_id) REFERENCES support_grant (organization_id, id),

  CONSTRAINT support_request_reason CHECK (btrim(reason) <> '' AND char_length(reason) <= 500),
  CONSTRAINT support_request_answered CHECK (
    (answered_at IS NULL) = (answer IS NULL)
    AND (answered_at IS NULL) = (answered_by_membership_id IS NULL)
  ),
  CONSTRAINT support_request_approval_opens CHECK ((answer = 'approved') = (grant_id IS NOT NULL))
);

COMMENT ON TABLE support_request IS
  'Poolse support asking a club''s Owner to open a window (POOLSE-79). Pending means unanswered '
  'and younger than 7 days; lapsing is derived, never written.';

CREATE INDEX support_request_org_idx ON support_request (organization_id, created_at DESC);

CREATE TRIGGER support_request_updated_at BEFORE UPDATE ON support_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE support_request ENABLE ROW LEVEL SECURITY;

-- `TO poolse_app`, unlike most tenant policies: the platform holds INSERT here,
-- and permissive policies OR together, so an unscoped tenant policy would let
-- the platform write any row whose club matched the GUC.
CREATE POLICY support_request_tenant ON support_request
  TO poolse_app
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- The club reads requests and answers them; it never writes or deletes one.
REVOKE INSERT, UPDATE, DELETE ON support_request FROM poolse_app;
GRANT SELECT ON support_request TO poolse_app;
GRANT UPDATE (answered_at, answer, answered_by_membership_id, grant_id) ON support_request TO poolse_app;

-- The platform asks, and reads what became of it.
CREATE POLICY support_request_operators_read ON support_request
  FOR SELECT TO poolse_platform USING (true);
CREATE POLICY support_request_operators_ask ON support_request
  FOR INSERT TO poolse_platform WITH CHECK (answered_at IS NULL);
GRANT SELECT, INSERT ON support_request TO poolse_platform;

-- ---------------------------------------------------------------------------
-- The override
-- ---------------------------------------------------------------------------

ALTER TABLE support_grant
  ADD COLUMN notice_recipients text[],
  ADD COLUMN notice_delivered_at timestamptz;

COMMENT ON COLUMN support_grant.notice_recipients IS
  'An override only: the Owner addresses the notice was owed to, snapshotted. '
  'notice_delivered_at stays null until an email provider exists.';

ALTER TABLE support_grant ADD CONSTRAINT support_grant_override_is_four_hours CHECK (
  source <> 'override' OR expires_at - starts_at = interval '4 hours'
);
ALTER TABLE support_grant ADD CONSTRAINT support_grant_override_owes_notice CHECK (
  (source = 'override') = (notice_recipients IS NOT NULL)
);

-- Now that the platform may INSERT, the tenant policy is narrowed to the tenant
-- role. Permissive policies OR together: left unscoped, it would let the
-- platform write an Owner's grant whenever the club GUC happened to match.
-- Caught by support-access.sql test 5b.
ALTER POLICY support_grant_tenant ON support_grant TO poolse_app;

-- The one grant the platform writes is an override, and only an override.
CREATE POLICY support_grant_operators_override ON support_grant
  FOR INSERT TO poolse_platform WITH CHECK (source = 'override' AND ended_at IS NULL);
GRANT INSERT ON support_grant TO poolse_platform;

-- Down Migration

REVOKE INSERT ON support_grant FROM poolse_platform;
DROP POLICY IF EXISTS support_grant_operators_override ON support_grant;
ALTER POLICY support_grant_tenant ON support_grant TO public;
ALTER TABLE support_grant DROP CONSTRAINT IF EXISTS support_grant_override_owes_notice;
ALTER TABLE support_grant DROP CONSTRAINT IF EXISTS support_grant_override_is_four_hours;
ALTER TABLE support_grant DROP COLUMN IF EXISTS notice_delivered_at;
ALTER TABLE support_grant DROP COLUMN IF EXISTS notice_recipients;

DROP TABLE IF EXISTS support_request;
DROP TYPE IF EXISTS support_request_answer;
