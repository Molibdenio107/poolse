import { withPlatform } from '@poolse/db';
import { currentAuth } from '../auth/auth.context.js';
import {
  TOTAL_COUNT,
  windowed,
  type Paginated,
  type PageQuery,
} from '../common/pagination.js';
import { searchPredicate } from '../common/search.js';
import {
  deriveHealth,
  HEALTH_WINDOW_HOURS,
  type TenantHealth,
} from './tenant-health.js';

/**
 * The operator's view of every tenant — slice 1.
 *
 * Every query in this file runs on the platform connection, which is a different
 * login from the rest of the API: read-only, admitted by a `FOR SELECT TO
 * poolse_platform` policy on seven named tables, and blind to everything else in
 * the schema. There is no `withOrg` here and no GUC to set, which is the one
 * place in this codebase where an unscoped SELECT is the intended thing rather
 * than the bug.
 *
 * It reads no student, no invoice and no medical note. That is not politeness —
 * the grant does not exist, and `packages/db/test/platform-admin.sql` asserts it.
 */

/**
 * The four roles that consume a management seat.
 *
 * Students and encarregados de educação are excluded and scale independently —
 * `docs/decisions.md`, 2026-09-06. A club with four hundred alunos is not a club
 * on a bigger plan.
 */
const MANAGEMENT_ROLES = ['owner', 'admin', 'instructor', 'maintenance'] as const;

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'comped';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  kind: 'business' | 'personal';
  createdAt: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  /**
   * Null, and deliberately so: plan tiers are indicative in `docs/decisions.md`
   * and modelled nowhere. A column invented here to fill the cell would be a
   * second answer to a question Stripe will answer in 2.4.
   */
  planTier: string | null;
  /** Active management memberships plus invitations still outstanding. */
  managementSeatsUsed: number;
  /** Null is unlimited, never zero. */
  maxManagementUsers: number | null;
  facilityCount: number;
  maxFacilities: number | null;
  poolCount: number;
  /**
   * The last thing anybody in this tenant did that the product recorded.
   *
   * `max(audit_log.created_at)`, which is the cheapest correct definition
   * available: `audit_log` already carries `(organization_id, created_at DESC)`,
   * so it is one index lookup per tenant, and it is the only table in the schema
   * that moves on every mutation path — thirty-four call sites across
   * invitations, students, classes, billing and settings.
   *
   * It is honestly named: *last recorded write*, not last login. A club whose
   * staff spent an afternoon reading registers without changing one shows the
   * morning's last edit. That is the right trade for an overview — the
   * alternative is a per-request table, which is slice 2's job and has a
   * retention policy attached for a reason.
   *
   * Null for a tenant that has done nothing at all since signing up.
   */
  lastActivityAt: string | null;
  /** A tenant that has been deleted. Still listed — churn is worth seeing. */
  archivedAt: string | null;
  /**
   * Closed by an operator — slice 3. Distinct from `archivedAt`, which is
   * deletion, and from `subscriptionStatus`, which is what they are paying.
   */
  suspendedAt: string | null;
  /** Non-null exactly when suspended. Shown to the club verbatim. */
  suspensionReason: string | null;

  /**
   * Is this tenant's API behaving — slice 2.
   *
   * Derived at read time from the last `HEALTH_WINDOW_HOURS` of
   * `tenant_request_stats`, never stored. `unknown` means no rows in the window,
   * which is a different fact from healthy: a club that stopped logging in is
   * not a club that worked perfectly.
   */
  health: TenantHealth;
  /** The 24h figures behind the verdict. Shown as text, not only in a tooltip. */
  requestCount24h: number;
  count4xx24h: number;
  count5xx24h: number;
  lastErrorAt: string | null;
}

export interface TenantQuery {
  search: string | null;
  /**
   * One tenant, by id — slice 3.
   *
   * The detail page needs every column the list row has, down to the seat count
   * and the health verdict, and building a second query for it would be two
   * definitions of "a tenant row" that agree until somebody edits one. A filter
   * on the same statement costs a `WHERE` clause and cannot drift.
   */
  organizationId?: string | null;
}

/** One tenant, or null. Same row shape as the list, from the same statement. */
export async function readTenant(organizationId: string): Promise<TenantRow | null> {
  const page = await listTenants(
    { search: null, organizationId },
    { page: 1, limit: 1, offset: 0 },
  );
  return page.items[0] ?? null;
}

export async function listTenants(
  query: TenantQuery,
  page: PageQuery,
): Promise<Paginated<TenantRow>> {
  return withPlatform(async (tx) => {
    const run = (limit: number, offset: number) => tx.query<{
      total_count: number;
      id: string;
      name: string;
      slug: string;
      kind: TenantRow['kind'];
      created_at: Date;
      subscription_status: SubscriptionStatus;
      trial_ends_at: Date | null;
      management_seats_used: number;
      max_management_users: number | null;
      facility_count: number;
      max_facilities: number | null;
      pool_count: number;
      last_activity_at: Date | null;
      archived_at: Date | null;
      suspended_at: Date | null;
      suspension_reason: string | null;
      request_count_24h: number;
      count_4xx_24h: number;
      count_5xx_24h: number;
      last_error_at: Date | null;
      last_request_at: Date | null;
    }>(`
      SELECT ${TOTAL_COUNT},
             o.id,
             o.name,
             o.slug,
             o.kind::text                AS kind,
             o.created_at,
             o.subscription_status::text AS subscription_status,
             o.trial_ends_at,
             o.max_management_users,
             o.max_facilities,
             o.archived_at,
             o.suspended_at,
             o.suspension_reason,

             /*
              * Seats in use = active management memberships + invitations still
              * outstanding.
              *
              * The two halves cannot double-count, and the reason is worth
              * stating: an invitation already creates its membership row, at
              * status 'invited'. Counting only 'active' on the left and only
              * live invitations on the right therefore counts each promised
              * seat exactly once. Count 'invited' memberships as well and every
              * pending invite would be worth two.
              *
              * "Still outstanding" is the 24h window from
              * docs/decisions.md, 2026-09-06 — not accepted, not revoked, not
              * expired. Without the expiry test a tenant could overshoot its
              * quota by inviting, waiting a day, and inviting again.
              */
             (
               SELECT count(DISTINCT m.id)
                 FROM membership m
                 JOIN membership_role mr
                   ON mr.organization_id = m.organization_id
                  AND mr.membership_id   = m.id
                  AND mr.archived_at IS NULL
                WHERE m.organization_id = o.id
                  AND m.status = 'active'
                  AND m.archived_at IS NULL
                  AND mr.role = ANY ($1::member_role[])
             )
             +
             (
               SELECT count(*)
                 FROM invitation i
                WHERE i.organization_id = o.id
                  AND i.accepted_at IS NULL
                  AND i.revoked_at  IS NULL
                  AND i.expires_at  > now()
                  AND i.roles && $1::member_role[]
             ) AS management_seats_used,

             (
               SELECT count(*) FROM facility f
                WHERE f.organization_id = o.id AND f.archived_at IS NULL
             ) AS facility_count,

             (
               SELECT count(*) FROM pool p
                WHERE p.organization_id = o.id AND p.archived_at IS NULL
             ) AS pool_count,

             (
               SELECT max(a.created_at) FROM audit_log a
                WHERE a.organization_id = o.id
             ) AS last_activity_at,

             /*
              * Request health over the last $5 hours — slice 2.
              *
              * A lateral rather than four correlated subqueries: one pass over
              * the tenant's buckets, which is at most twenty-four rows, instead
              * of four. Coalesced to zero so a tenant with no rows comes back
              * as counted-nothing rather than as null, and the verdict is
              * derived in TypeScript from those numbers.
              *
              * last_request_at rides along because "the newest request was an
              * error" means last_error_at >= last_request_at, which cannot be
              * answered from counts. Both are the max across the window, so the
              * comparison is between the newest of each.
              */
             coalesce(health.request_count, 0) AS request_count_24h,
             coalesce(health.count_4xx, 0)     AS count_4xx_24h,
             coalesce(health.count_5xx, 0)     AS count_5xx_24h,
             health.last_error_at,
             health.last_request_at

        FROM organization o

        LEFT JOIN LATERAL (
          SELECT sum(s.request_count)::int AS request_count,
                 sum(s.count_4xx)::int     AS count_4xx,
                 sum(s.count_5xx)::int     AS count_5xx,
                 max(s.last_error_at)      AS last_error_at,
                 max(s.last_request_at)    AS last_request_at
            FROM tenant_request_stats s
           WHERE s.organization_id = o.id
             AND s.bucket >= date_trunc('hour', now() - make_interval(hours => $5))
        ) health ON true

       WHERE ($6::uuid IS NULL OR o.id = $6::uuid)
         AND ${searchPredicate('o.name', '$2')}
       /*
        * Newest first. An operator opens this to see who signed up, and the
        * tenant that needs looking at is almost always the most recent one.
        * The id breaks the tie so a page boundary is stable — two clubs created in
        * the same millisecond would otherwise swap between page 1 and page 2.
        */
       ORDER BY o.created_at DESC, o.id
       LIMIT $3 OFFSET $4
    `, [
      MANAGEMENT_ROLES,
      query.search,
      limit,
      offset,
      HEALTH_WINDOW_HOURS,
      query.organizationId ?? null,
    ]);

    return windowed(page, run, (row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      createdAt: row.created_at.toISOString(),
      subscriptionStatus: row.subscription_status,
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
      planTier: null,
      // `count()` is bigint, which node-postgres hands back as a string; the two
      // halves of the seat sum arrive as one already-added string either way.
      managementSeatsUsed: Number(row.management_seats_used),
      maxManagementUsers: row.max_management_users,
      facilityCount: Number(row.facility_count),
      maxFacilities: row.max_facilities,
      poolCount: Number(row.pool_count),
      lastActivityAt: row.last_activity_at?.toISOString() ?? null,
      archivedAt: row.archived_at?.toISOString() ?? null,
      suspendedAt: row.suspended_at?.toISOString() ?? null,
      suspensionReason: row.suspension_reason,

      health: deriveHealth({
        requestCount: row.request_count_24h,
        count4xx: row.count_4xx_24h,
        count5xx: row.count_5xx_24h,
        /*
         * Exact, not inferred. Both stamps are the max across the window, so
         * `>=` reads "the newest thing that happened was a failure" — and the
         * equality matters: a request that errors writes both in the same
         * flush, at the same instant.
         */
        lastWasError:
          row.last_error_at !== null &&
          row.last_request_at !== null &&
          row.last_error_at >= row.last_request_at,
      }),
      requestCount24h: row.request_count_24h,
      count4xx24h: row.count_4xx_24h,
      count5xx24h: row.count_5xx_24h,
      lastErrorAt: row.last_error_at?.toISOString() ?? null,
    }));
  });
}

/**
 * One tenant's request health over the last week — `/platform/tenants/:id/requests`.
 *
 * Seven days of hourly rows, plus the errors behind them. Two statements in one
 * transaction rather than one clever join: they answer different questions at
 * different shapes, and a join would repeat the last-error columns across every
 * hourly row for the client to deduplicate.
 */

/** How far back the detail page looks. A week of hours is 168 rows at most. */
export const REQUESTS_WINDOW_DAYS = 7;

/** How many distinct failures are worth listing. */
export const RECENT_ERRORS = 20;

export interface RequestBucket {
  /** Hour, as an ISO instant. */
  bucket: string;
  requestCount: number;
  count4xx: number;
  count5xx: number;
  p95LatencyMs: number;
}

export interface RecentError {
  at: string;
  route: string;
  message: string | null;
}

export interface TenantRequests {
  organizationId: string;
  name: string;
  windowDays: number;
  health: TenantHealth;
  requestCount24h: number;
  count4xx24h: number;
  count5xx24h: number;
  /** Oldest first, so a chart can render them without reversing. */
  buckets: RequestBucket[];
  /** Newest first. */
  errors: RecentError[];
}

export async function readTenantRequests(
  organizationId: string,
): Promise<TenantRequests | null> {
  return withPlatform(async (tx) => {
    const { rows: tenants } = await tx.query<{ name: string }>(
      'SELECT name FROM organization WHERE id = $1',
      [organizationId],
    );
    // Null rather than an empty week: a tenant that does not exist and a tenant
    // that made no requests are different answers, and only one of them is a 404.
    const tenant = tenants[0];
    if (!tenant) return null;

    const { rows: buckets } = await tx.query<{
      bucket: Date;
      request_count: number;
      count_4xx: number;
      count_5xx: number;
      p95_latency_ms: number;
    }>(
      `SELECT bucket, request_count, count_4xx, count_5xx, p95_latency_ms
         FROM tenant_request_stats
        WHERE organization_id = $1
          AND bucket >= date_trunc('hour', now() - make_interval(days => $2))
        ORDER BY bucket`,
      [organizationId, REQUESTS_WINDOW_DAYS],
    );

    /*
     * The last N *distinct* errors, not the last N rows.
     *
     * A route failing every minute for an hour writes the same route into sixty
     * buckets, and a list of twenty identical lines tells the operator about one
     * problem while hiding however many others there were. `DISTINCT ON` the
     * route keeps the newest of each, which is the list worth reading.
     */
    const { rows: errors } = await tx.query<{
      at: Date;
      route: string;
      message: string | null;
    }>(
      `SELECT at, route, message FROM (
         SELECT DISTINCT ON (last_error_route)
                last_error_at      AS at,
                last_error_route   AS route,
                last_error_message AS message
           FROM tenant_request_stats
          WHERE organization_id = $1
            AND last_error_at IS NOT NULL
            AND bucket >= date_trunc('hour', now() - make_interval(days => $2))
          ORDER BY last_error_route, last_error_at DESC
       ) newest
       ORDER BY at DESC
       LIMIT $3`,
      [organizationId, REQUESTS_WINDOW_DAYS, RECENT_ERRORS],
    );

    /*
     * The 24-hour verdict, computed from the same buckets the page draws.
     *
     * Deliberately not a second query against the same window as `listTenants`:
     * the detail page and the row in the table must agree, and the way to
     * guarantee that is one rule reading one set of numbers. `deriveHealth` is
     * that rule.
     */
    const since = Date.now() - HEALTH_WINDOW_HOURS * 3_600_000;
    const recent = buckets.filter((row) => row.bucket.getTime() >= hourFloor(since));

    const requestCount = sum(recent.map((row) => row.request_count));
    const count4xx = sum(recent.map((row) => row.count_4xx));
    const count5xx = sum(recent.map((row) => row.count_5xx));

    const { rows: stamps } = await tx.query<{
      last_error_at: Date | null;
      last_request_at: Date | null;
    }>(
      `SELECT max(last_error_at) AS last_error_at, max(last_request_at) AS last_request_at
         FROM tenant_request_stats
        WHERE organization_id = $1
          AND bucket >= date_trunc('hour', now() - make_interval(hours => $2))`,
      [organizationId, HEALTH_WINDOW_HOURS],
    );
    const stamp = stamps[0];

    return {
      organizationId,
      name: tenant.name,
      windowDays: REQUESTS_WINDOW_DAYS,
      health: deriveHealth({
        requestCount,
        count4xx,
        count5xx,
        lastWasError:
          stamp?.last_error_at != null &&
          stamp.last_request_at != null &&
          stamp.last_error_at >= stamp.last_request_at,
      }),
      requestCount24h: requestCount,
      count4xx24h: count4xx,
      count5xx24h: count5xx,
      buckets: buckets.map((row) => ({
        bucket: row.bucket.toISOString(),
        requestCount: row.request_count,
        count4xx: row.count_4xx,
        count5xx: row.count_5xx,
        p95LatencyMs: row.p95_latency_ms,
      })),
      errors: errors.map((row) => ({
        at: row.at.toISOString(),
        route: row.route,
        message: row.message,
      })),
    };
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The start of the hour a millisecond timestamp falls in. */
function hourFloor(ms: number): number {
  return ms - (ms % 3_600_000);
}

// ---------------------------------------------------------------------------
// Actions — slice 3
//
// The first writes on this side of the product, and they go through one helper
// so that none of them can forget the half that matters.
//
// **A write records itself, inside the transaction that performed it.** That is
// the rule `audit.ts` sets out for the tenant app and it applies here for the
// same reason: an audit entry written on its own connection can commit while the
// change rolls back, leaving a log that says a trial was extended when it was
// not — or the reverse, which is worse. `PlatformAuditInterceptor` therefore
// logs reads only; a non-GET request is logged by this function.
//
// **The reach is six columns.** `poolse_platform` holds `UPDATE (trial_ends_at,
// subscription_status, max_facilities, max_management_users, suspended_at,
// suspension_reason)` and nothing else, so a statement here that named `name` or
// `archived_at` would be refused by Postgres rather than by a code review.
// ---------------------------------------------------------------------------

/** What an action may set. Every key is one of the six granted columns. */
interface TenantChange {
  trial_ends_at?: string | null;
  subscription_status?: SubscriptionStatus;
  max_facilities?: number;
  max_management_users?: number | null;
  suspended_at?: string | null;
  suspension_reason?: string | null;
}

/** The columns an audit entry is worth carrying. */
const AUDITED = [
  'trial_ends_at',
  'subscription_status',
  'max_facilities',
  'max_management_users',
  'suspended_at',
  'suspension_reason',
] as const;

export interface TenantChangeResult {
  organizationId: string;
  /** Only the fields that actually moved, before and after. */
  changed: Record<string, { before: unknown; after: unknown }>;
}

/**
 * Apply one change to one tenant, and record it.
 *
 * Null for a tenant that does not exist, so the controller can answer 404 rather
 * than reporting a successful change of nothing.
 *
 * The before-image is read in the same transaction as the write, so the pair in
 * the trail is genuinely the pair — not the row as it was when the screen was
 * drawn. With one operator that is theory; it costs one statement and means the
 * trail cannot be wrong.
 */
async function changeTenant(
  organizationId: string,
  action: string,
  change: TenantChange,
): Promise<TenantChangeResult | null> {
  const clerkUserId = currentAuth().clerkUserId;

  const columns = Object.keys(change) as (keyof TenantChange)[];
  if (columns.length === 0) {
    throw new Error(`Platform action "${action}" asked to change nothing`);
  }

  return withPlatform(async (tx) => {
    const { rows: before } = await tx.query<Record<string, unknown>>(
      `SELECT ${AUDITED.join(', ')} FROM organization WHERE id = $1`,
      [organizationId],
    );
    if (before.length === 0) return null;

    // Built from a fixed key list, never from caller-supplied names: these
    // become identifiers, which cannot be parameterised.
    const assignments = columns.map((column, index) => `${column} = $${index + 2}`);

    const { rows: after } = await tx.query<Record<string, unknown>>(
      `UPDATE organization SET ${assignments.join(', ')}
        WHERE id = $1
        RETURNING ${AUDITED.join(', ')}`,
      [organizationId, ...columns.map((column) => change[column] ?? null)],
    );

    const changed: TenantChangeResult['changed'] = {};
    for (const column of AUDITED) {
      const was = normalise(before[0]![column]);
      const now = normalise(after[0]![column]);
      if (was !== now) changed[column] = { before: was, after: now };
    }

    await tx.query(
      `INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
            VALUES ($1, $2, $3, $4::jsonb)`,
      [clerkUserId, action, organizationId, JSON.stringify({ changed })],
    );

    return { organizationId, changed };
  });
}

/**
 * Dates back as ISO, everything else as itself.
 *
 * Without it every timestamp comparison is `Date !== Date` by identity, so an
 * action that set `trial_ends_at` to the value it already held would be recorded
 * as a change — and the trail would stop meaning "this moved".
 */
function normalise(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Move a tenant's trial end date.
 *
 * A date in the past is allowed and is how a trial is ended early — an operator
 * who wants that should not have to find another screen for it. What is refused
 * is a date far enough out to be a typo; `2027` typed for `2026` is the mistake
 * this catches, and it is silent otherwise.
 */
export async function extendTrial(
  organizationId: string,
  endsAt: string,
): Promise<TenantChangeResult | null> {
  return changeTenant(organizationId, 'tenant.trial.set', { trial_ends_at: endsAt });
}

/** Set the subscription state. `comped` is the free pilot: live, not billed. */
export async function setSubscriptionStatus(
  organizationId: string,
  status: SubscriptionStatus,
): Promise<TenantChangeResult | null> {
  return changeTenant(organizationId, 'tenant.subscription.set', {
    subscription_status: status,
  });
}

/**
 * Set the two plan ceilings.
 *
 * `max_facilities` is enforced by a trigger on `facility`, so lowering it below
 * what a club already has does not retroactively refuse anything — the existing
 * sites stay and the next one is refused. That is deliberate and is what the
 * licence migration chose when it backfilled; the screen marks a tenant over its
 * ceiling in red rather than pretending it cannot happen.
 *
 * `max_management_users` is a soft quota nothing enforces yet, so the same is
 * true of it more loudly.
 */
export async function setPlanLimits(
  organizationId: string,
  limits: { maxFacilities: number; maxManagementUsers: number | null },
): Promise<TenantChangeResult | null> {
  return changeTenant(organizationId, 'tenant.plan.set', {
    max_facilities: limits.maxFacilities,
    max_management_users: limits.maxManagementUsers,
  });
}

/**
 * Close a tenant's door, or open it again.
 *
 * The two columns move together — the schema refuses one without the other —
 * because a closed door with no sentence on it is a support call that starts
 * from nothing. Restoring clears both.
 */
export async function setSuspension(
  organizationId: string,
  suspension: { reason: string } | null,
): Promise<TenantChangeResult | null> {
  return changeTenant(
    organizationId,
    suspension === null ? 'tenant.restored' : 'tenant.suspended',
    suspension === null
      ? { suspended_at: null, suspension_reason: null }
      : { suspended_at: new Date().toISOString(), suspension_reason: suspension.reason },
  );
}
