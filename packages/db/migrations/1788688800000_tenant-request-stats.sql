-- Up Migration
--
-- Per-tenant request health — platform admin, slice 2.
--
-- One row per tenant per hour. **Never one row per request**, and that is the
-- whole shape of this table rather than an optimisation of it: a busy club at a
-- hundred requests a minute would write 144,000 rows a day, which is more
-- storage than everything the club actually does, for data whose entire purpose
-- is to answer "is this tenant seeing errors" at a glance.
--
-- The interceptor aggregates in memory and flushes once a minute, so the write
-- rate is one statement per active tenant per minute whatever the traffic is.
--
-- ---------------------------------------------------------------------------
-- Hypertable-shaped, and not yet a hypertable
-- ---------------------------------------------------------------------------
--
-- The same position `energy_reading` took on 2026-09-11, for the same reason and
-- with the same trigger. Timescale requires the partitioning column in every
-- unique index, so the key here is the natural composite `(organization_id,
-- bucket)` with no surrogate id — the one thing that cannot be retrofitted.
--
-- Whether it *is* a hypertable is decided at apply time by the DO block below:
-- where the extension is available it is converted and given a 30-day retention
-- policy; where it is not — the development image is `postgres:16-alpine`, and
-- the hosting question the decisions log defers is still open — it stays an
-- ordinary table with an index, and the API prunes rows past 30 days on the same
-- flush that writes them. Same migration, both worlds, and the day the host is
-- confirmed the conversion is one statement.

CREATE TABLE tenant_request_stats (
  organization_id     uuid NOT NULL REFERENCES organization (id),
  -- The hour this row covers, truncated UTC. `date_trunc('hour', now())`.
  bucket              timestamptz NOT NULL,

  request_count       integer NOT NULL DEFAULT 0,
  count_4xx           integer NOT NULL DEFAULT 0,
  count_5xx           integer NOT NULL DEFAULT 0,

  /*
   * An approximation, deliberately and on the record.
   *
   * Each flush computes p95 over the requests it saw in that minute and merges
   * by taking the larger of the two. A true hourly p95 needs every sample kept
   * for the hour, which is the per-request storage this table exists to avoid.
   * What this answers is "did anything get slow in this hour", which is the
   * question an operator is actually asking; it reads high rather than low,
   * which is the safe direction for a health signal.
   */
  p95_latency_ms      integer NOT NULL DEFAULT 0,

  /*
   * When the last request in this hour arrived, error or not.
   *
   * It exists so that "the most recent request for that tenant was an error" —
   * one of the three ways a tenant goes red — is a fact this table can answer
   * rather than one inferred from aggregates. With both stamps the rule is
   * exactly `last_error_at >= last_request_at`, and without it the best
   * available guess is "there was an error late in the newest bucket", which is
   * a different statement and wrong on a tenant whose next request succeeded.
   */
  last_request_at     timestamptz,

  -- The most recent failure in this hour. Enough to recognise it, never enough
  -- to reconstruct it: no request body, no query values, no names.
  last_error_at       timestamptz,
  last_error_route    text,
  last_error_message  text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- No surrogate id. See the note above — this is the half that cannot be
  -- swapped later.
  PRIMARY KEY (organization_id, bucket),

  -- Truncated at the source, and enforced here so a bad flush cannot quietly
  -- create a second row for the same hour at :17 past.
  CONSTRAINT tenant_request_stats_hourly CHECK (bucket = date_trunc('hour', bucket)),
  CONSTRAINT tenant_request_stats_counts CHECK (
    request_count >= 0 AND count_4xx >= 0 AND count_5xx >= 0 AND p95_latency_ms >= 0
  ),
  -- 500 characters, cut at the source. The constraint is what makes that a
  -- property of the data rather than of whichever code path wrote it.
  CONSTRAINT tenant_request_stats_message_length CHECK (
    last_error_message IS NULL OR length(last_error_message) <= 500
  ),
  CONSTRAINT tenant_request_stats_error_pair CHECK (
    (last_error_at IS NULL) = (last_error_route IS NULL)
  )
);

CREATE TRIGGER tenant_request_stats_updated_at BEFORE UPDATE ON tenant_request_stats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The two reads this gets: one tenant's last 7 days, and every tenant's last 24
-- hours for the health column. The primary key serves the first; this serves the
-- second, which scans by time across tenants.
CREATE INDEX tenant_request_stats_bucket_idx ON tenant_request_stats (bucket DESC);

-- ---------------------------------------------------------------------------
-- Nobody's but the platform's
--
-- This is not tenant data — it is telemetry *about* a tenant, and a club has no
-- more business reading its own error rate here than reading another club's. The
-- default privileges granted poolse_app all four verbs when the table was
-- created; they go back, and RLS is enabled with no policy naming that role, so
-- a tenant query is refused twice over.
--
-- The writer is poolse_app, though — the interceptor runs in the request path
-- and has no business borrowing the platform's login — so it keeps INSERT and
-- UPDATE, admitted by a policy of its own that can only touch its own rows. The
-- flush is an upsert, which needs both verbs and a SELECT for the conflict
-- target, so the write policy is the narrow one: a row for a tenant that
-- actually exists, and nothing else.
-- ---------------------------------------------------------------------------

REVOKE ALL ON tenant_request_stats FROM poolse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_request_stats TO poolse_app;

ALTER TABLE tenant_request_stats ENABLE ROW LEVEL SECURITY;

/*
 * The application writes but does not read.
 *
 * `USING` governs which rows an UPDATE or DELETE may touch and which a SELECT
 * returns; `WITH CHECK` governs what may be written. Splitting them is the whole
 * point here — the app may write a row for the tenant it is scoped to and may
 * upsert over it, and a plain SELECT from a tenant-scoped connection still
 * returns nothing, because no screen in the tenant app has any business showing
 * this.
 *
 * The upsert's ON CONFLICT needs to *find* the existing row, which a policy
 * returning no rows would prevent — so `USING` admits the current tenant's own
 * rows rather than none at all. What it does not admit is another tenant's, and
 * that is what `tenant-isolation.sql` asserts.
 */
CREATE POLICY tenant_request_stats_writer ON tenant_request_stats
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- And the operator, who reads every tenant and writes none.
CREATE POLICY tenant_request_stats_platform ON tenant_request_stats
  FOR SELECT TO poolse_platform USING (true);

GRANT SELECT ON tenant_request_stats TO poolse_platform;

-- ---------------------------------------------------------------------------
-- Timescale, where there is Timescale
--
-- Guarded rather than assumed. `create_hypertable` on a database without the
-- extension is a hard failure, and this migration has to apply to the
-- development image as it stands today.
--
-- `migrate_data => true` is safe and cheap on an empty table and is what makes
-- the block correct if it is ever re-run against a populated one.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;

    PERFORM create_hypertable(
      'tenant_request_stats', 'bucket',
      chunk_time_interval => INTERVAL '7 days',
      migrate_data        => true,
      if_not_exists       => true
    );

    -- 30 days. Long enough to see a pattern across a month's billing cycle,
    -- short enough that this never becomes a table anybody has to think about.
    PERFORM add_retention_policy('tenant_request_stats', INTERVAL '30 days',
                                 if_not_exists => true);

    RAISE NOTICE 'tenant_request_stats: hypertable with a 30-day retention policy';
  ELSE
    RAISE NOTICE
      'tenant_request_stats: timescaledb not available — ordinary table. '
      'Retention is the API flush pruning rows past 30 days. See docs/features/observability.md.';
  END IF;
END
$$;

COMMENT ON TABLE tenant_request_stats IS
  'Per-tenant request health, one row per tenant per hour, written by '
  'RequestStatsInterceptor''s 60s flush. Never one row per request. Retained 30 '
  'days — by a Timescale policy where the extension exists, otherwise by the '
  'flush itself. Read only by poolse_platform.';

-- Down Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM remove_retention_policy('tenant_request_stats', if_exists => true);
  END IF;
END
$$;

DROP POLICY IF EXISTS tenant_request_stats_platform ON tenant_request_stats;
DROP POLICY IF EXISTS tenant_request_stats_writer   ON tenant_request_stats;

DROP TABLE IF EXISTS tenant_request_stats;
