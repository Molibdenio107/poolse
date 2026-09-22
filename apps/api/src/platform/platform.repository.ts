import { BadRequestException } from '@nestjs/common';
import { withPlatform } from '@poolse/db';
import { currentAuth } from '../auth/auth.context.js';
import {
  TOTAL_COUNT,
  windowed,
  type Paginated,
  type PageQuery,
} from '../common/pagination.js';
import { searchPredicate } from '../common/search.js';
import { deliverAlert, recordAlert } from './platform-alert.js';
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
 * poolse_platform` policy on eight named tables — the eighth is two columns of
 * `app_user`, added 14 September 2026 — and blind to everything else in the
 * schema. There is no `withOrg` here and no GUC to set, which is the one
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
  /** Set by the trial clock when `trial_ends_at` passes — POOLSE-61. */
  | 'expired'
  /**
   * Readable, never written — POOLSE-63.
   *
   * `billing_mode` owns comped since 18 September 2026: a free pilot is
   * `billing_mode = 'comped'`, `subscription_status = 'active'`, which is the
   * more honest pair. The value stays in the enum because removing one is a
   * rebuild, and the type keeps it so a row written before the backfill still
   * types rather than falling through a switch.
   */
  | 'comped';

/**
 * How a club pays — POOLSE-63.
 *
 * Beside the status rather than inside it: the mode says *how*, the status says
 * *whether*, and `suspended_at` says whether the door is open. Three facts that
 * move at different times for different reasons.
 */
export type BillingMode = 'stripe' | 'manual' | 'comped';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  kind: 'business' | 'personal';
  createdAt: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  /**
   * Which plan they pay for, from Stripe — slice 2.4 filled this in.
   *
   * It was deliberately null until then: a column invented to fill the cell
   * would have been a second answer to a question Stripe answers. Still
   * *descriptive*, and deliberately beside the ceilings rather than deciding
   * them — a club on Clube whose `maxFacilities` says 1 is a real state, reached
   * by somebody buying a plan without the operator widening the licence, and an
   * operator seeing both figures is how that gets noticed.
   */
  planTier: 'starter' | 'club' | 'network' | null;
  /**
   * How they pay, and what they are paid up to — POOLSE-63.
   *
   * `paidThrough` is a `YYYY-MM-DD` day and means the last day covered,
   * inclusive. It is only ever moved by recording a payment, which is why there
   * is no action that writes it on its own: a date typed by hand is a date that
   * disagrees with the money.
   */
  billingMode: BillingMode;
  paidThrough: string | null;
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
  /**
   * Read-only, and how long the data is kept — POOLSE-61.
   *
   * Beside suspension rather than folded into it: a club can be read-only and
   * open, suspended and not read-only, or both, and the operator's screen has to
   * be able to say which. `suspended_at` beats `read_only_at` beats open.
   */
  readOnlyAt: string | null;
  pendingDeleteAt: string | null;
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

/**
 * What an operator is looking for on the list — POOLSE-62.
 *
 * Three, and each one is a question somebody actually opens `/admin` to ask:
 * who is still evaluating, whose trial ran out, and whose data is about to go.
 * Anything else is the search box.
 */
export type TenantFilter = 'trialing' | 'expired' | 'pending_delete';

export const TENANT_FILTERS: readonly TenantFilter[] = ['trialing', 'expired', 'pending_delete'];

export interface TenantQuery {
  search: string | null;
  /** Null is every tenant, which is what the page opens on. */
  filter?: TenantFilter | null;
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
    { search: null, organizationId, filter: null },
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
      plan: 'starter' | 'club' | 'network' | null;
      billing_mode: BillingMode;
      paid_through: string | null;
      trial_ends_at: Date | null;
      management_seats_used: number;
      max_management_users: number | null;
      facility_count: number;
      max_facilities: number | null;
      pool_count: number;
      last_activity_at: Date | null;
      archived_at: Date | null;
      suspended_at: Date | null;
      read_only_at: Date | null;
      pending_delete_at: Date | null;
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
             o.plan::text AS plan,
             o.billing_mode::text AS billing_mode,
             /*
              * Cast to text, not the bare column. node-postgres parses a date
              * into a Date at local midnight, and in Lisbon that is 23:00 UTC
              * the day before for half the year — the off-by-one that day() in
              * compensation.repository.ts was written to close. A day has no
              * timezone; the string is the day.
              */
             o.paid_through::text AS paid_through,
             o.trial_ends_at,
             o.max_management_users,
             o.max_facilities,
             o.archived_at,
             o.suspended_at,
             o.read_only_at,
             o.pending_delete_at,
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
         /*
          * The filter, as three named states rather than a column name a caller
          * passes in. Pending-delete is a date being set rather than a status,
          * which is exactly why it cannot be expressed as one.
          */
         AND ($7::text IS NULL
              OR ($7 = 'trialing'       AND o.subscription_status = 'trialing')
              OR ($7 = 'expired'        AND o.subscription_status = 'expired')
              OR ($7 = 'pending_delete' AND o.pending_delete_at IS NOT NULL))
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
      query.filter ?? null,
    ]);

    return windowed(page, run, (row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      createdAt: row.created_at.toISOString(),
      subscriptionStatus: row.subscription_status,
      trialEndsAt: row.trial_ends_at?.toISOString() ?? null,
      planTier: row.plan,
      billingMode: row.billing_mode,
      paidThrough: row.paid_through,
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
      readOnlyAt: row.read_only_at?.toISOString() ?? null,
      pendingDeleteAt: row.pending_delete_at?.toISOString() ?? null,
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

/** What an action may set. Every key is one of the granted columns. */
interface TenantChange {
  trial_ends_at?: string | null;
  subscription_status?: SubscriptionStatus;
  max_facilities?: number;
  max_management_users?: number | null;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  read_only_at?: string | null;
  pending_delete_at?: string | null;
  billing_mode?: BillingMode;
  paid_through?: string | null;
  /*
   * On the grant since 14 September 2026, and on this list since POOLSE-64 —
   * although nothing here writes it yet. The trial clock archives a tenant on
   * day 75 and does it in its own transaction, because it has no person and its
   * transitions go to `trial_event`. What this entry buys is the day an operator
   * can archive one from `/admin`: it arrives audited, and the typed-name gate
   * below already names the column, rather than both being remembered.
   */
  archived_at?: string | null;
}

/**
 * The columns an audit entry is worth carrying, and how each is read.
 *
 * A map rather than a list because one of them needs a cast: `paid_through` is a
 * `date`, and reading it as a Date and stamping it with `toISOString()` would
 * record the day before for half the year. The key is the column name — which is
 * what the trail is keyed on — and the value is the expression that reads it.
 */
const AUDITED: Record<string, string> = {
  trial_ends_at: 'trial_ends_at',
  subscription_status: 'subscription_status',
  max_facilities: 'max_facilities',
  max_management_users: 'max_management_users',
  suspended_at: 'suspended_at',
  suspension_reason: 'suspension_reason',
  read_only_at: 'read_only_at',
  pending_delete_at: 'pending_delete_at',
  billing_mode: 'billing_mode',
  paid_through: 'paid_through::text',
  archived_at: 'archived_at',
};

const AUDITED_KEYS = Object.keys(AUDITED);

/** `a, b, c::text AS c` — usable in a SELECT and in a RETURNING alike. */
const AUDITED_SELECT = AUDITED_KEYS.map((key) =>
  AUDITED[key] === key ? key : `${AUDITED[key]} AS ${key}`,
).join(', ');

/** The row a change is decided against: every audited column, as it stands. */
export type TenantBefore = Record<string, unknown>;

/**
 * A change that has to read the tenant before it can say what it is.
 *
 * Recording a payment is the case that needed it: `paid_through` becomes the
 * *greater* of what is there and what the money buys, and the payment row itself
 * has to be written in the same transaction as the columns it moves. Running it
 * inside `changeTenant` is what keeps "there is exactly one write path, and it
 * audits itself" true — the alternative was a second helper with its own
 * transaction and its own audit insert, which is how two books come to disagree.
 *
 * Throwing from here rolls the whole thing back, so a guard that refuses a
 * combination the CHECK would refuse anyway can do it in a sentence.
 */
type PrepareChange = (
  before: TenantBefore,
  tx: Tx,
) => Promise<{ change: TenantChange; detail?: Record<string, unknown> }>;

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
  plan: TenantChange | PrepareChange,
  options: { confirmName?: string | undefined } = {},
): Promise<TenantChangeResult | null> {
  const clerkUserId = currentAuth().clerkUserId;

  const done = await withPlatform(async (tx) => {
    const { rows: before } = await tx.query<TenantBefore>(
      `SELECT name, ${AUDITED_SELECT} FROM organization WHERE id = $1`,
      [organizationId],
    );
    if (before.length === 0) return null;

    /*
     * The change is decided inside the transaction that applies it, so a plan
     * that reads the tenant reads the row it is about to write — not the row as
     * it was when the screen was drawn.
     */
    const prepared =
      typeof plan === 'function' ? await plan(before[0]!, tx) : { change: plan };

    const change = prepared.change;
    const columns = Object.keys(change) as (keyof TenantChange)[];
    if (columns.length === 0) {
      throw new Error(`Platform action "${action}" asked to change nothing`);
    }

    /*
     * The name, typed — POOLSE-64 AC 3.
     *
     * **Decided by what the change writes, not by which function called.** A
     * future endpoint that archives a club inherits this without anybody
     * remembering to ask for it, which is the same instinct as the column grant
     * behind it: a rule enforced by the shape of the thing cannot be forgotten by
     * a code review. It is checked here rather than in the controller because
     * this is where the change is finally known — a `PrepareChange` decides
     * inside the transaction what columns it will move.
     *
     * Only *entering* one of these states is guarded. Restoring a club, letting
     * it write again, un-archiving it — nothing is made safer by slowing down the
     * direction that undoes harm, and a confirmation on everything is a
     * confirmation nobody reads.
     */
    const irreversible = IRREVERSIBLE.filter(
      (column) => column in change && change[column] !== null,
    );

    if (irreversible.length > 0 && !nameMatches(options.confirmName, before[0]!['name'])) {
      throw new BadRequestException({
        fields: { confirmName: 'admin.error.nameMismatch' },
      });
    }

    // Built from a fixed key list, never from caller-supplied names: these
    // become identifiers, which cannot be parameterised.
    const assignments = columns.map((column, index) => `${column} = $${index + 2}`);

    const { rows: after } = await tx.query<TenantBefore>(
      `UPDATE organization SET ${assignments.join(', ')}
        WHERE id = $1
        RETURNING ${AUDITED_SELECT}`,
      [organizationId, ...columns.map((column) => change[column] ?? null)],
    );

    const changed: TenantChangeResult['changed'] = {};
    for (const column of AUDITED_KEYS) {
      const was = normalise(before[0]![column]);
      const now = normalise(after[0]![column]);
      if (was !== now) changed[column] = { before: was, after: now };
    }

    const detail = { changed, ...(prepared.detail ?? {}) };

    await tx.query(
      `INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
            VALUES ($1, $2, $3, $4::jsonb)`,
      [clerkUserId, action, organizationId, JSON.stringify(detail)],
    );

    /*
     * And somebody is told — POOLSE-64 item 5.
     *
     * Every write, not a chosen few: there are a handful a day, and the one an
     * operator would want to hear about is by definition the one nobody thought
     * to put on a list. In this transaction, so an alert can never describe a
     * change that rolled back; sent after it, so a mail server can never roll one
     * back.
     */
    const alert = await recordAlert(tx, {
      kind: 'write',
      action,
      clerkUserId,
      organizationId,
      organizationName: typeof before[0]!['name'] === 'string' ? before[0]!['name'] : null,
      detail,
    });

    return { result: { organizationId, changed }, alert };
  });

  if (done === null) return null;

  await deliverAlert(done.alert);
  return done.result;
}

/**
 * The three columns whose *setting* is not something to do by accident.
 *
 * `suspended_at` shuts a club's door; `pending_delete_at` schedules the end of
 * its data; `archived_at` files it away. Nothing else on this side of the
 * product reaches that far — a trial date, a plan ceiling, a billing mode and a
 * subscription status are all one click and one click back, and asking a person
 * to type a club's name to extend a trial is how they learn to type it without
 * reading.
 *
 * `archived_at` is on the list although no endpoint writes it yet: the trial
 * clock does, and it runs with no person and no request, so it never reaches
 * `changeTenant` at all. The entry is here for the day an operator can archive
 * one from `/admin`, which POOLSE-61 left as the clock's own act.
 */
const IRREVERSIBLE = ['suspended_at', 'pending_delete_at', 'archived_at'] as const;

/**
 * "The same name", for somebody typing it under a dialog that shows it.
 *
 * Trimmed, inner whitespace collapsed, case-folded and stripped of accents. The
 * friction that makes this worth having is *reading the name and typing it* —
 * being sure which club is about to lose its morning — and none of that is
 * weakened by accepting `clube nautico` for `Clube Náutico`. Refusing over a
 * capital or a circumflex would only teach somebody to paste the name, which
 * removes the reading; it would also refuse a keyboard that has no `á` on it.
 *
 * An unsupplied name never matches, which is what makes the check fail closed: a
 * caller that forgets to ask gets a refusal naming the field, not a write.
 */
function nameMatches(typed: string | undefined, actual: unknown): boolean {
  if (typed === undefined || typeof actual !== 'string') return false;

  // NFD splits an accented letter into the letter and its mark, so the marks can
  // be dropped by range rather than by a table of pairs somebody maintains.
  const fold = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-PT');

  return fold(typed) !== '' && fold(typed) === fold(actual);
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
 * Move a tenant's trial end date, and optionally free the address behind it.
 *
 * A date in the past is allowed and is how a trial is ended early — an operator
 * who wants that should not have to find another screen for it. What is refused
 * is a date far enough out to be a typo; `2027` typed for `2026` is the mistake
 * this catches, and it is silent otherwise.
 *
 * **`releaseClaim` is *conceder novo período* — POOLSE-62.** One trial per
 * address is a hard block with no appeal inside the product, so the override has
 * to cost one click rather than a support thread: a club that genuinely left and
 * came back is refused by exactly the same index as somebody on their fourth
 * free fortnight, and only a person can tell those apart.
 *
 * **It extends the action that already exists rather than adding a second.**
 * Granting a fresh trial is a new end date *and* a freed address; two buttons
 * would mean an operator doing half of it and a club being let back in with a
 * trial that ran out in March.
 *
 * The release is a row, not a DELETE: "this person was given a second trial, by
 * whom, when" is exactly what somebody asks six months later. Both unique indexes
 * are partial on `released_at`, so releasing genuinely frees the address.
 */
export async function extendTrial(
  organizationId: string,
  endsAt: string,
  releaseClaim = false,
): Promise<TenantChangeResult | null> {
  if (!releaseClaim) {
    return changeTenant(organizationId, 'tenant.trial.set', { trial_ends_at: endsAt });
  }

  return changeTenant(organizationId, 'tenant.trial.set', async (_before, tx) => {
    const clerkUserId = currentAuth().clerkUserId;

    /*
     * Every live claim this tenant made, which in practice is one. Written in
     * the same transaction as the date, so an operator never ends up with a
     * freed address and an unmoved trial — or the reverse, which is worse: the
     * club could sign up again and be refused by the date they were promised.
     */
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE trial_claim
          SET released_at = now(),
              released_by_clerk_user_id = $2
        WHERE organization_id = $1
          AND released_at IS NULL
        RETURNING id`,
      [organizationId, clerkUserId],
    );

    return {
      change: { trial_ends_at: endsAt },
      // Zero is a real answer worth recording: a tenant created before the
      // ledger existed has no claim to free, and the operator should be able to
      // see that is why nothing happened.
      detail: { claimsReleased: rows.length },
    };
  });
}

/**
 * Set the subscription state — whether they are paying, never how.
 *
 * `comped` used to be settable here and is not since POOLSE-63: a free pilot is
 * `billing_mode = 'comped'` with an ordinary `active` status, so the word has one
 * home. `readSubscriptionStatus` refuses it on the way in.
 */
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
  suspension: { reason: string; confirmName: string | undefined } | null,
): Promise<TenantChangeResult | null> {
  return changeTenant(
    organizationId,
    suspension === null ? 'tenant.restored' : 'tenant.suspended',
    suspension === null
      ? { suspended_at: null, suspension_reason: null }
      : { suspended_at: new Date().toISOString(), suspension_reason: suspension.reason },
    // Typed only in the direction that shuts the door — POOLSE-64 AC 3. Passing
    // it on a restore would be harmless and meaningless; `changeTenant` decides
    // from the columns, not from here.
    { ...(suspension === null ? {} : { confirmName: suspension.confirmName }) },
  );
}

/**
 * Put a tenant into read-only, or let it write again — POOLSE-61.
 *
 * One handler for both directions, like suspension above and for the same
 * reason: they write the same columns and must stay each other's exact inverse.
 *
 * **Lifting clears the delete date too.** They are set together by the clock and
 * they mean one thing between them — "this club stopped paying, and here is how
 * long we keep its data". Clearing the first and leaving the second would leave a
 * club writing normally with a deletion still scheduled, which is the worst of
 * the two states and the one nobody would think to check for.
 *
 * **It does not touch `subscription_status`.** Billing state and access state
 * were separated on purpose in the platform slice, and an operator lifting
 * read-only because a bank transfer arrived is making an access decision; the
 * billing one is Stripe's to report or the operator's to make on the other
 * screen. Merging them here would undo that distinction quietly.
 */
export async function setReadOnly(
  organizationId: string,
  readOnly: { dataKeptUntil: string | null; confirmName: string | undefined } | null,
): Promise<TenantChangeResult | null> {
  return changeTenant(
    organizationId,
    readOnly === null ? 'tenant.write_restored' : 'tenant.read_only',
    readOnly === null
      ? { read_only_at: null, pending_delete_at: null }
      : {
          read_only_at: new Date().toISOString(),
          pending_delete_at: readOnly.dataKeptUntil,
        },
    /*
     * **Read-only itself is one click; a deletion date is not** — POOLSE-64 AC 3,
     * and Rui's call on which acts are irreversible. Putting a club into
     * read-only is what happens on its own the day a trial ends, and an operator
     * doing it by hand is usually correcting something. Scheduling the end of its
     * data is the other kind of act, and `changeTenant` sees the difference in
     * the columns without this function having to describe it.
     */
    { ...(readOnly === null ? {} : { confirmName: readOnly.confirmName }) },
  );
}

// ---------------------------------------------------------------------------
// Paid outside Stripe — POOLSE-63
//
// Some clubs pay in cash, by transfer, on a handshake. Everything below is the
// operator's half of that: what mode a club is on, what money actually arrived,
// and what is falling due.
//
// **Recording a payment is the only thing that moves `paid_through`.** There is
// no action that sets that date on its own, deliberately: the payment is the
// fact and the date is derived from it, and a field somebody fills in by hand is
// a field that disagrees with the money.
// ---------------------------------------------------------------------------

/** The transaction handle `withPlatform` hands out. */
type Tx = Parameters<Parameters<typeof withPlatform>[0]>[0];

export type PaymentMethod = 'cash' | 'bank_transfer' | 'other';

export interface ManualPaymentInput {
  amountCents: number;
  /** The day the money arrived. */
  receivedOn: string;
  method: PaymentMethod;
  /** Optional: an operator recording last month's cash may not know it. */
  coversFrom: string | null;
  /** Required — a payment that covers no period cannot extend one. */
  coversTo: string;
  note: string | null;
}

export interface ManualPaymentRow extends ManualPaymentInput {
  id: string;
  currency: string;
  recordedByClerkUserId: string;
  createdAt: string;
}

/**
 * Turn a club's billing mode over.
 *
 * The guard is the CHECK said in a sentence: an *active manual* subscription
 * must know what it is paid up to, and a club that has never paid outside Stripe
 * has no such date. Refusing here rather than letting the constraint fire is
 * what puts a message beside the field instead of a constraint name in a 500 —
 * and the constraint still stands behind it, which is what makes this a courtesy
 * rather than the enforcement.
 *
 * Nothing about the mode touches access or the status. A club moved to `manual`
 * that has lapsed stays lapsed; a comped one is simply a club that does not pay.
 */
export async function setBillingMode(
  organizationId: string,
  mode: BillingMode,
): Promise<TenantChangeResult | null> {
  return changeTenant(organizationId, 'tenant.billing_mode.set', (before) => {
    if (
      mode === 'manual' &&
      before['subscription_status'] === 'active' &&
      before['paid_through'] === null
    ) {
      throw new BadRequestException({
        fields: { billingMode: 'admin.error.manualNeedsPayment' },
      });
    }
    return Promise.resolve({ change: { billing_mode: mode } });
  });
}

/**
 * Record money that arrived outside Stripe, and move what it paid for.
 *
 * One transaction: the `manual_payment` row, the columns it implies, and the
 * audit entry commit together or none of them do. It goes through `changeTenant`
 * rather than beside it so there stays exactly one write path to a tenant's
 * billing state, and so nothing can move `paid_through` without leaving a trail.
 *
 * **Recording a payment is what makes a club hand-managed.** The mode goes to
 * `manual` and the status to `active` in the same breath, because that is what
 * the money means and because the CHECK refuses the alternative anyway — a club
 * whose cash has arrived is not a club on a trial.
 *
 * **`paid_through` is the greater of what is there and what this buys**, so a
 * payment recorded out of order extends cover and never shortens it. The
 * comparison is between two `YYYY-MM-DD` strings, which sort as days precisely
 * because they are days rather than instants.
 *
 * **It lifts read-only and clears any deletion date**, which is the point of the
 * grace: the money that closed the door has arrived. It deliberately does *not*
 * clear `suspended_at` — a suspension is an operator's own decision with a reason
 * attached, and a payment is not an argument against it.
 */
export async function recordManualPayment(
  organizationId: string,
  payment: ManualPaymentInput,
): Promise<TenantChangeResult | null> {
  return changeTenant(organizationId, 'tenant.payment.recorded', async (before, tx) => {
    const clerkUserId = currentAuth().clerkUserId;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO manual_payment (
         organization_id, amount_cents, received_on, method,
         covers_from, covers_to, note, recorded_by_clerk_user_id
       ) VALUES ($1, $2, $3::date, $4, $5::date, $6::date, $7, $8)
       RETURNING id`,
      [
        organizationId,
        payment.amountCents,
        payment.receivedOn,
        payment.method,
        payment.coversFrom,
        payment.coversTo,
        payment.note,
        clerkUserId,
      ],
    );

    const held = before['paid_through'];
    const paidThrough =
      typeof held === 'string' && held > payment.coversTo ? held : payment.coversTo;

    return {
      change: {
        billing_mode: 'manual',
        subscription_status: 'active',
        paid_through: paidThrough,
        read_only_at: null,
        pending_delete_at: null,
      },
      /*
       * The amount is in the trail and not in the path, the query string or a
       * log line — the rule `docs/features/salaries.md` sets about money and
       * URLs. `platform_audit_log` is exactly where a figure belongs.
       */
      detail: {
        paymentId: rows[0]!.id,
        amountCents: payment.amountCents,
        method: payment.method,
        receivedOn: payment.receivedOn,
        coversTo: payment.coversTo,
      },
    };
  });
}

/**
 * What a club has actually paid, newest first.
 *
 * Paginated like every other list that grows with time — a club paying monthly
 * writes twelve rows a year and an operator wants this year, not all of them.
 */
export async function listManualPayments(
  organizationId: string,
  page: PageQuery,
): Promise<Paginated<ManualPaymentRow>> {
  return withPlatform(async (tx) => {
    const run = (limit: number, offset: number) =>
      tx.query<{
        total_count: number;
        id: string;
        amount_cents: number;
        currency: string;
        received_on: string;
        method: PaymentMethod;
        covers_from: string | null;
        covers_to: string;
        note: string | null;
        recorded_by_clerk_user_id: string;
        created_at: Date;
      }>(
        `SELECT ${TOTAL_COUNT},
                id,
                amount_cents,
                currency,
                -- Days as days. Every date column in this statement is read as
                -- text for the reason paid_through is: a Date at local midnight
                -- is the previous day in Lisbon for half the year.
                received_on::text AS received_on,
                method::text      AS method,
                covers_from::text AS covers_from,
                covers_to::text   AS covers_to,
                note,
                recorded_by_clerk_user_id,
                created_at
           FROM manual_payment
          WHERE organization_id = $1
          ORDER BY received_on DESC, created_at DESC, id
          LIMIT $2 OFFSET $3`,
        [organizationId, limit, offset],
      );

    return windowed(page, run, (row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      currency: row.currency,
      receivedOn: row.received_on,
      method: row.method,
      coversFrom: row.covers_from,
      coversTo: row.covers_to,
      note: row.note,
      recordedByClerkUserId: row.recorded_by_clerk_user_id,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

/** How far ahead the renewals list looks. */
export const RENEWALS_WINDOW_DAYS = 30;

export interface RenewalDue {
  organizationId: string;
  name: string;
  paidThrough: string;
  /** Negative once cover has run out, which is when it matters most. */
  daysLeft: number;
  subscriptionStatus: SubscriptionStatus;
  readOnlyAt: string | null;
}

export interface BillingOverview {
  /** Live tenants per mode. Counts, never one summed figure. */
  tenantsByMode: Record<BillingMode, number>;
  /**
   * Trials started against trials converted — POOLSE-62 AC 8.
   *
   * **Started is the ledger's count, not the count of clubs still here**, which
   * is the point: a trial that lapsed and was archived still happened, and a
   * conversion rate computed over survivors would flatter itself. Converted is a
   * club that has ever left `trialing` for something that pays — active, past
   * due or comped-by-mode — which is why it is counted off the organization
   * rather than off the claim.
   *
   * It is what makes "is fifteen days the right number" an argument with
   * evidence rather than an instinct.
   */
  trialsStarted: number;
  trialsConverted: number;
  trialsStillRunning: number;
  /**
   * Money Poolse actually holds a record of, in cents.
   *
   * **Manual payments only, and the screen says so.** Nothing stores what a
   * Stripe subscription is worth — the prices live in Stripe and are read back
   * for display — so a "Stripe revenue" figure here would be this product
   * guessing at its own income. Counts are honest; a made-up total is not.
   */
  manualCentsAllTime: number;
  manualCentsLast12Months: number;
  manualPaymentCount: number;
  renewals: RenewalDue[];
  renewalsWindowDays: number;
}

/**
 * The operator's own billing picture — POOLSE-63.
 *
 * Three counts and one sum, never one number. `docs/financials.md` forbids
 * summing across provenances into an unlabelled figure, and this is a stronger
 * case than that: a comped tenant is worth nothing on purpose and a Stripe one is
 * worth something nobody here knows.
 */
export async function readBillingOverview(): Promise<BillingOverview> {
  return withPlatform(async (tx) => {
    const { rows: modes } = await tx.query<{ billing_mode: BillingMode; tenants: string }>(
      `SELECT billing_mode::text AS billing_mode, count(*) AS tenants
         FROM organization
        WHERE archived_at IS NULL
        GROUP BY billing_mode`,
    );

    /*
     * Started, converted, still running. One statement over two tables, and the
     * "converted" test is deliberately about where a club *is* rather than about
     * a transition nobody recorded: `trial_event` only knows about trials that
     * ran out, so counting conversions from it would count none of them.
     */
    const { rows: trials } = await tx.query<{
      started: string;
      converted: string;
      running: string;
    }>(
      `SELECT (SELECT count(*) FROM trial_claim) AS started,
              (SELECT count(*) FROM organization
                WHERE billing_mode <> 'comped'
                  AND subscription_status IN ('active', 'past_due')) AS converted,
              (SELECT count(*) FROM organization
                WHERE archived_at IS NULL
                  AND subscription_status = 'trialing') AS running`,
    );

    const { rows: money } = await tx.query<{
      all_time: string | null;
      last_year: string | null;
      payments: string;
    }>(
      `SELECT sum(amount_cents)                       AS all_time,
              sum(amount_cents) FILTER (
                WHERE received_on >= current_date - interval '1 year'
              )                                       AS last_year,
              count(*)                                AS payments
         FROM manual_payment`,
    );

    /*
     * Everything manual that runs out inside the window — **and everything that
     * already has**. A renewals list that hides the club whose cover lapsed last
     * week is the screen failing at the one job it has; those sort first, because
     * a negative number of days left is the most urgent row there is.
     */
    const { rows: renewals } = await tx.query<{
      id: string;
      name: string;
      paid_through: string;
      days_left: number;
      subscription_status: SubscriptionStatus;
      read_only_at: Date | null;
    }>(
      `SELECT o.id,
              o.name,
              o.paid_through::text AS paid_through,
              (o.paid_through - current_date) AS days_left,
              o.subscription_status::text AS subscription_status,
              o.read_only_at
         FROM organization o
        WHERE o.archived_at IS NULL
          AND o.billing_mode = 'manual'
          AND o.paid_through IS NOT NULL
          AND o.paid_through <= current_date + make_interval(days => $1)
        ORDER BY o.paid_through, o.name`,
      [RENEWALS_WINDOW_DAYS],
    );

    const tenantsByMode: Record<BillingMode, number> = { stripe: 0, manual: 0, comped: 0 };
    for (const row of modes) tenantsByMode[row.billing_mode] = Number(row.tenants);

    return {
      tenantsByMode,
      trialsStarted: Number(trials[0]?.started ?? 0),
      trialsConverted: Number(trials[0]?.converted ?? 0),
      trialsStillRunning: Number(trials[0]?.running ?? 0),
      manualCentsAllTime: Number(money[0]?.all_time ?? 0),
      manualCentsLast12Months: Number(money[0]?.last_year ?? 0),
      manualPaymentCount: Number(money[0]?.payments ?? 0),
      renewals: renewals.map((row) => ({
        organizationId: row.id,
        name: row.name,
        paidThrough: row.paid_through,
        daysLeft: Number(row.days_left),
        subscriptionStatus: row.subscription_status,
        readOnlyAt: row.read_only_at?.toISOString() ?? null,
      })),
      renewalsWindowDays: RENEWALS_WINDOW_DAYS,
    };
  });
}

// ---------------------------------------------------------------------------
// One person, one trial — POOLSE-62
// ---------------------------------------------------------------------------

export interface TenantClaim {
  /** The address as the ledger keyed it: lowercased, +tags and gmail dots gone. */
  normalizedEmail: string;
  emailDomain: string;
  claimedAt: string;
  releasedAt: string | null;
  releasedByClerkUserId: string | null;
  /**
   * **Soft flags, and they block nothing** — POOLSE-62.
   *
   * How many *other* live claims share this signup's domain, and its address
   * hash. Clubs share offices and NAT is real, and a municipality has many
   * pools: a hard block on either would catch real customers, so these are
   * numbers on a screen for a person to weigh.
   *
   * Null for the address where no salt is configured, which is a different fact
   * from zero: nothing was recorded rather than nothing matched.
   */
  sameDomainCount: number;
  sameIpCount: number | null;
}

/**
 * The claim this tenant made when it signed up, and what it shares with others.
 *
 * Null for a tenant provisioned before the ledger existed, which is a real state
 * and says so on screen rather than looking like a failed read.
 *
 * **It never returns the raw address.** The ledger holds the normalised one, and
 * the IP is a salted digest that this endpoint reports only as a count — an
 * operator needs to know *that* two signups came from one address, never what it
 * was.
 */
export async function readTenantClaim(organizationId: string): Promise<TenantClaim | null> {
  return withPlatform(async (tx) => {
    const { rows } = await tx.query<{
      normalized_email: string;
      email_domain: string;
      created_at: Date;
      released_at: Date | null;
      released_by_clerk_user_id: string | null;
      signup_ip_hash: string | null;
      same_domain: string;
      same_ip: string | null;
    }>(
      `SELECT c.normalized_email,
              c.email_domain,
              c.created_at,
              c.released_at,
              c.released_by_clerk_user_id,
              c.signup_ip_hash,
              (
                SELECT count(*) FROM trial_claim other
                 WHERE other.email_domain = c.email_domain
                   AND other.organization_id <> c.organization_id
                   AND other.released_at IS NULL
              ) AS same_domain,
              CASE WHEN c.signup_ip_hash IS NULL THEN NULL ELSE (
                SELECT count(*) FROM trial_claim other
                 WHERE other.signup_ip_hash = c.signup_ip_hash
                   AND other.organization_id <> c.organization_id
                   AND other.released_at IS NULL
              ) END AS same_ip
         FROM trial_claim c
        WHERE c.organization_id = $1
        /*
         * The live one if there is one, else the most recent release — an
         * operator looking at a club that was granted a fresh trial should see
         * that it was, rather than an empty panel.
         */
        ORDER BY c.released_at NULLS FIRST, c.created_at DESC
        LIMIT 1`,
      [organizationId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      normalizedEmail: row.normalized_email,
      emailDomain: row.email_domain,
      claimedAt: row.created_at.toISOString(),
      releasedAt: row.released_at?.toISOString() ?? null,
      releasedByClerkUserId: row.released_by_clerk_user_id,
      sameDomainCount: Number(row.same_domain),
      sameIpCount: row.same_ip === null ? null : Number(row.same_ip),
    };
  });
}
