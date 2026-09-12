import { withPlatform } from '@poolse/db';
import {
  TOTAL_COUNT,
  windowed,
  type Paginated,
  type PageQuery,
} from '../common/pagination.js';
import { searchPredicate } from '../common/search.js';

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
}

export interface TenantQuery {
  search: string | null;
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
             ) AS last_activity_at

        FROM organization o
       WHERE ${searchPredicate('o.name', '$2')}
       /*
        * Newest first. An operator opens this to see who signed up, and the
        * tenant that needs looking at is almost always the most recent one.
        * The id breaks the tie so a page boundary is stable — two clubs created in
        * the same millisecond would otherwise swap between page 1 and page 2.
        */
       ORDER BY o.created_at DESC, o.id
       LIMIT $3 OFFSET $4
    `, [MANAGEMENT_ROLES, query.search, limit, offset]);

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
    }));
  });
}
