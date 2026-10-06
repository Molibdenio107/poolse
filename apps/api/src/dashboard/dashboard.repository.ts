import { withOrg } from '@poolse/db';

/**
 * The two queries the dashboard itself needs, before any widget runs — POOLSE-66.
 *
 * Both are scoped by `withOrg`, like every query in this product: the isolation
 * is the database's and this file is not where it is decided.
 */

export interface FacilityOption {
  id: string;
  name: string;
}

export interface DashboardShape {
  /** `business` or `personal` — the registry's `kinds` reads this. */
  kind: 'business' | 'personal';
  /** The reader's own language, falling back to the club's. */
  locale: string;
  facilities: FacilityOption[];
  /**
   * The site this reader's dashboard was last scoped to — POOLSE-66 AC 10.
   * Null is "every site", and so is a remembered site that has since been
   * archived: it is filtered against the live list rather than trusted.
   */
  rememberedFacilityId: string | null;
}

/**
 * What the page needs before any widget runs — the club's shape and its sites.
 *
 * **One transaction, two statements**, rather than two transactions or five
 * queries scattered through the resolvers. The sites are read once and used
 * twice: they are the selector's list, and their count is the empty-tenant rule,
 * known before a single resolver starts.
 *
 * The locale is the *reader's*, falling back to the club's — nothing in slice 1
 * formats anything with it, and it is on the context because a resolver that
 * ever phrases a sentence must not reach for a different answer than the rest of
 * the product.
 */
export async function readDashboardShape(
  organizationId: string,
  membershipId: string,
): Promise<DashboardShape> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ kind: string; locale: string; remembered: string | null }>(
      `SELECT o.kind::text AS kind,
              coalesce(u.locale, o.locale) AS locale,
              m.dashboard_facility_id AS remembered
         FROM organization o
         LEFT JOIN membership m ON m.id = $2 AND m.organization_id = o.id
         LEFT JOIN app_user   u ON u.id = m.app_user_id
        WHERE o.id = $1`,
      [organizationId, membershipId],
    );

    const { rows: facilities } = await tx.query<FacilityOption>(
      `SELECT id, name FROM facility
        WHERE archived_at IS NULL
        ORDER BY name`,
    );

    const row = rows[0];

    return {
      // An unknown kind reads as a club: every tenant that predates
      // `organization.kind` is one, and a personal tenant is the narrower page.
      kind: row?.kind === 'personal' ? 'personal' : 'business',
      locale: row?.locale ?? 'pt-PT',
      facilities,
      rememberedFacilityId: facilities.some((site) => site.id === row?.remembered)
        ? (row?.remembered ?? null)
        : null,
    };
  });
}

export interface SetupProgress {
  facilities: number;
  pools: number;
  feePlans: number;
  staff: number;
  students: number;
}

/**
 * How far a new club has got — five counts, **one query**.
 *
 * Five scalar sub-selects rather than five round trips, which is the rule this
 * ticket sets for every aggregate on this screen: the dashboard is the thing
 * most likely to become the product's slow page, and it is cheaper to write it
 * this way than to find it later. Each sub-select is a bare count over a
 * tenant-scoped table, so RLS supplies the `where` clause that matters.
 *
 * "Staff" is a management membership other than the owner's own — a club that
 * has invited nobody has exactly one, and telling the founder they have already
 * added staff because they exist would make the step meaningless.
 */
export async function readSetupProgress(organizationId: string): Promise<SetupProgress> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      facilities: string;
      pools: string;
      fee_plans: string;
      staff: string;
      students: string;
    }>(
      `SELECT
         (SELECT count(*) FROM facility WHERE archived_at IS NULL)  AS facilities,
         (SELECT count(*) FROM pool     WHERE archived_at IS NULL)  AS pools,
         (SELECT count(*) FROM fee_plan WHERE archived_at IS NULL)  AS fee_plans,
         (SELECT count(*)
            FROM membership m
            JOIN membership_role r
              ON r.membership_id = m.id AND r.organization_id = m.organization_id
           WHERE m.archived_at IS NULL
             AND r.archived_at IS NULL
             AND r.role IN ('admin', 'instructor', 'maintenance'))  AS staff,
         (SELECT count(*) FROM student  WHERE archived_at IS NULL)  AS students`,
    );

    const row = rows[0]!;
    return {
      facilities: Number(row.facilities),
      pools: Number(row.pools),
      feePlans: Number(row.fee_plans),
      staff: Number(row.staff),
      students: Number(row.students),
    };
  });
}

/**
 * Remembers which site this person's dashboard shows. Null is every site.
 *
 * Written to the reader's own membership and nobody else's — the id comes from
 * the request context, never from the body. The composite key on the column is
 * what refuses another club's site, and `tenant-isolation.sql` test 22 asserts
 * it; the caller has already checked the site is one of this club's live ones,
 * so a refusal here is a race, not a request.
 */
export async function rememberDashboardFacility(
  organizationId: string,
  membershipId: string,
  facilityId: string | null,
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(`UPDATE membership SET dashboard_facility_id = $2 WHERE id = $1`, [
      membershipId,
      facilityId,
    ]);
  });
}
