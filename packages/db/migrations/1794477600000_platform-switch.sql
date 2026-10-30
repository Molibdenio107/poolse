-- Up Migration
--
-- A platform-wide switch, set from /admin — Rui, 30-10-2026: reading an ID
-- document's photograph with the model is turned on and off there rather than
-- by an environment variable and a redeploy.
--
-- One row per switch, named by a CHECK rather than an enum, so a second switch
-- is one line of SQL and a reviewed migration. Off by default: a metered call
-- stays off until somebody turns it on (CLAUDE.md, the free-pilot cost rule).
-- `ANTHROPIC_API_KEY` is still required beside it — the switch says "Poolse
-- wants this", the key says "it can".
--
-- Not tenant-scoped. Every club reads the same answer, so poolse_app may SELECT
-- (/me carries it); only poolse_platform writes, through a column grant, and
-- nothing inserts or deletes: the rows are this migration's.

CREATE TABLE platform_switch (
  name        text PRIMARY KEY CHECK (name IN ('id_document_ai')),
  enabled     boolean NOT NULL DEFAULT false,
  -- Who moved it last, and when. The before-and-after lives in
  -- platform_audit_log, written in the same transaction.
  changed_at  timestamptz,
  changed_by  text
);

INSERT INTO platform_switch (name) VALUES ('id_document_ai');

REVOKE ALL ON platform_switch FROM poolse_app;
GRANT SELECT ON platform_switch TO poolse_app;
GRANT SELECT ON platform_switch TO poolse_platform;
GRANT UPDATE (enabled, changed_at, changed_by) ON platform_switch TO poolse_platform;

ALTER TABLE platform_switch ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_switch_read ON platform_switch
  FOR SELECT TO poolse_app, poolse_platform USING (true);
CREATE POLICY platform_switch_write ON platform_switch
  FOR UPDATE TO poolse_platform USING (true) WITH CHECK (true);

COMMENT ON TABLE platform_switch IS
  'Platform-wide on/off switches set from /admin (id_document_ai: read an ID '
  'photo with the model). Readable by every club, written only by '
  'poolse_platform, audited in platform_audit_log — Rui, 30-10-2026.';

-- Down Migration

DROP TABLE IF EXISTS platform_switch;
