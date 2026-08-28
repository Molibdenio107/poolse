import pg from 'pg';
import { pool, withOrg, withoutTenantScope, type Tx } from '@poolse/db';
import { authStorage } from '../auth/auth.context.js';
import { tenantStorage } from '../tenant/tenant.context.js';
import type { MemberRole } from '../tenant/roles.js';

/**
 * A harness for testing controllers against a real database — POOLSE, QA gap.
 *
 * Everything up to now has been proved either in SQL (`packages/db/test`) or as
 * pure functions. That left the layer where most of the product's *rules* live
 * untested: controllers, the permission checks inside them, and the repository
 * queries as the controllers actually call them. Typecheck cannot see any of it.
 *
 * **What this does and does not cover.**
 *
 * It runs the real controller methods, against the real repositories, against a
 * real Postgres, with a real tenant context — so a role check, a query, an
 * outcome mapping and a status code are all exercised together.
 *
 * It does **not** go through HTTP, which means Nest's routing and the two
 * middleware rings are outside it. Both are thin and both are verified another
 * way: the routing table is printed at boot (every route is visible in the dev
 * log), and `ClerkAuthMiddleware` is the one place a token is checked, which no
 * test should be able to weaken. That last point is deliberate — a test seam
 * that lets a request skip authentication is a seam production can skip it
 * through too, and no amount of coverage is worth that.
 *
 * So: permissions are tested here at the layer that decides them, `requireRole`
 * reading `currentTenant()`, which is the same call the middleware feeds.
 *
 * **Fixtures are built through the application's own connection; only teardown
 * uses the owner's.** A fixture built as the table owner bypasses row-level
 * security, so it can create state the product itself cannot — and a test
 * resting on that passes while the real path is refused. Setup therefore goes
 * through `withOrg` and the same two SECURITY DEFINER functions sign-up uses.
 *
 * Teardown cannot. `audit_log` and `consent` carry no DELETE grant for the app
 * role *by design*: an audit trail the application can erase is not an audit
 * trail, and consent history is GDPR-relevant. The harness discovered that by
 * failing on it, which is the schema being right. Cleaning up after a test is
 * not a product operation, so it is the one thing here that connects as the
 * owner — and it does nothing else.
 */

/**
 * Every tenant-scoped table, child-first.
 *
 * Teardown deletes in this order because a scratch tenant has to leave nothing
 * behind: these tests run against the same development database somebody is
 * about to click around in, and a pile of "Clube de Teste" rows in their Alunos
 * list is a worse outcome than no tests at all.
 *
 * Generated from `information_schema` when this was written; if a migration adds
 * a tenant table, add it here. A forgotten one shows up immediately as a foreign
 * key violation during teardown rather than as silent litter.
 */
const TENANT_TABLES = [
  /*
   * First, not last. `audit_log.actor_membership_id` points at `membership`, so
   * deleting memberships before the trail they are named in fails on the foreign
   * key — which is the key doing its job: "who did this" is meant to outlive the
   * membership, and only a teardown has any business removing it.
   */
  'audit_log',
  // Bookings point at credits, credits point at the attendance row that minted
  // them, and attendance points at the session. Child first, all the way down.
  'reposicao_booking',
  'reposicao_credit',
  'attendance',
  'skill_progress',
  'transfer_proposal',
  'student_record',
  'student_sensitive',
  'consent',
  'guardian_link',
  'enrollment',
  'class_session',
  'class_schedule',
  'class_group',
  'skill',
  'student',
  'student_level',
  'vacation_day',
  'vacation_request',
  'closure',
  'season',
  'pool_photo',
  'pool',
  'facility_photo',
  'facility',
  'invitation',
  'membership_role',
  'membership',
] as const;

export interface ScratchTenant {
  organizationId: string;
  /** The owner's membership, created by `provision_organization`. */
  ownerMembershipId: string;
  facilityId: string;
  /**
   * The season provisioning already created.
   *
   * Exposed because `season_one_active` allows exactly one per club, so a test
   * that inserts its own is refused — correctly. Use this one.
   */
  seasonId: string;
  /**
   * Raw access for building fixtures, scoped to this tenant like every other
   * write in the product. RLS applies, which is the point.
   */
  sql: <T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<T[]>;
}

/**
 * The owner connection, used for teardown and nothing else.
 *
 * Lazy, so a run with no integration tests never opens it.
 */
let ownerPool: pg.Pool | undefined;
const owner = (): pg.Pool =>
  (ownerPool ??= new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 }));

let scratchCount = 0;
let swept = false;

/**
 * Removes scratch tenants an earlier run left behind.
 *
 * Teardown lives in a `finally` and should not leak — but it *did*, while this
 * harness was being written: a table missing from the list below made teardown
 * throw before it reached the organization, and six failing runs left thirty-two
 * "Clube de Teste" rows in the development database. That is the failure mode
 * worth engineering against, because the person who finds it is somebody
 * scrolling their own Alunos list wondering what happened.
 *
 * Only tenants older than an hour, so a run happening in parallel is never
 * swept out from under itself. Once per process, and best-effort: a sweep that
 * fails must not fail the tests it is tidying up for.
 */
async function sweepStaleScratchTenants(): Promise<void> {
  if (swept) return;
  swept = true;

  try {
    const client = await owner().connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM organization
          WHERE name LIKE 'Clube de Teste %' AND created_at < now() - interval '1 hour'`,
      );

      for (const { id } of rows) {
        await client.query('BEGIN');
        for (const table of TENANT_TABLES) {
          await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [id]);
        }
        await client.query('DELETE FROM organization WHERE id = $1', [id]);
        await client.query('COMMIT');
      }

      await client.query(
        `DELETE FROM app_user
          WHERE clerk_user_id LIKE 'user_test_%'
            AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.app_user_id = app_user.id)`,
      );

      if (rows.length > 0) {
        console.log(`harness: swept ${rows.length} stale scratch tenant(s) from an earlier run`);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn(`harness: could not sweep stale scratch tenants: ${String(error)}`);
  }
}

/**
 * Stands up a throwaway organization, runs `fn`, and removes every trace of it.
 *
 * Provisioned through `provision_organization` rather than by inserting an
 * organization row, because that is the sanctioned path and the one production
 * uses — a fixture built a different way is a fixture that can pass while the
 * real path is broken.
 *
 * The teardown runs in `finally`, so a failing assertion still cleans up.
 */
export async function withScratchTenant<T>(fn: (tenant: ScratchTenant) => Promise<T>): Promise<T> {
  await sweepStaleScratchTenants();

  scratchCount += 1;
  const stamp = `${process.pid}-${scratchCount}-${Math.floor(performance.now())}`;
  const clerkUserId = `user_test_${stamp}`;

  /*
   * Provisioning happens outside any tenant scope, exactly as sign-up does: the
   * caller belongs to no organization yet, so there is no GUC to satisfy — which
   * is why both of these are SECURITY DEFINER and granted to the app role.
   */
  const provisioned = await withoutTenantScope(async (tx: Tx) => {
    await tx.query(`SELECT provision_app_user($1, $2, 'Teste', 'Harness', NULL, now())`, [
      clerkUserId,
      `${clerkUserId}@example.test`,
    ]);

    /*
     * `SELECT *`, not `SELECT fn(...)`. The function returns a TABLE, so calling
     * it in the select list collapses all four columns into one composite value
     * and the uuid cast fails on a row that looks like `(id,id,id,slug)`.
     */
    const { rows } = await tx.query<{
      o_organization_id: string;
      o_membership_id: string;
      o_facility_id: string;
    }>(`SELECT * FROM provision_organization($1, $2, 'pt-PT', 'Piscina de Teste')`, [
      clerkUserId,
      `Clube de Teste ${stamp}`,
    ]);
    return rows[0]!;
  });

  const organizationId = provisioned.o_organization_id;

  const sql = async <R extends object = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<R[]> =>
    withOrg(organizationId, async (tx) => (await tx.query(text, values)).rows as R[]);

  try {
    const [season] = await sql<{ id: string }>(
      'SELECT id FROM season WHERE organization_id = $1 AND archived_at IS NULL LIMIT 1',
      [organizationId],
    );

    return await fn({
      organizationId,
      ownerMembershipId: provisioned.o_membership_id,
      facilityId: provisioned.o_facility_id,
      seasonId: season!.id,
      sql,
    });
  } finally {
    /*
     * One transaction for the whole teardown, so a scratch tenant is either gone
     * or still whole — never half-deleted, which is the state that leaves a
     * foreign key dangling and the next run failing for the wrong reason.
     */
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      for (const table of TENANT_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
      }
      await client.query('DELETE FROM organization WHERE id = $1', [organizationId]);
      await client.query('DELETE FROM app_user WHERE clerk_user_id = $1', [clerkUserId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Runs `fn` as somebody holding `roles`.
 *
 * Both storages are populated, because that is what the two middleware rings
 * install and what `currentAuth()` and `currentTenant()` read. A controller
 * cannot tell the difference between this and a real request — which is the
 * point: the permission check being exercised is the production one.
 */
export async function actingAs<T>(
  tenant: ScratchTenant,
  options: { membershipId?: string; roles: MemberRole[]; clerkUserId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const membershipId = options.membershipId ?? tenant.ownerMembershipId;

  const [row] = await tenant.sql<{ app_user_id: string | null }>(
    'SELECT app_user_id FROM membership WHERE id = $1',
    [membershipId],
  );

  return authStorage.run(
    {
      clerkUserId: options.clerkUserId ?? `user_test_${membershipId}`,
      sessionId: `sess_test_${membershipId}`,
    } as never,
    () =>
      tenantStorage.run(
        {
          organizationId: tenant.organizationId,
          membershipId,
          appUserId: row?.app_user_id ?? '',
          roles: options.roles,
        },
        fn,
      ),
  );
}

/**
 * A membership with the given roles, for testing what somebody may not do.
 *
 * No `app_user_id`: most people in a club have no login, and a fixture that gave
 * everybody one would quietly avoid the case the schema is built around.
 *
 * **An email, though.** The first version of this omitted one and the database
 * refused every guardian with "an encarregado de educação needs a NIF or an
 * email address" — POOLSE-17's rule that somebody typed in by hand must carry a
 * key duplicates can be found by. The harness catching that is the point: a
 * fixture the product would not accept is a fixture that proves nothing.
 */
export async function addMember(
  tenant: ScratchTenant,
  firstName: string,
  lastName: string,
  roles: MemberRole[],
): Promise<string> {
  const local = `${firstName}.${lastName}.${Math.floor(performance.now())}`
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');

  const [membership] = await tenant.sql<{ id: string }>(
    `INSERT INTO membership (organization_id, status, first_name, last_name, email)
     VALUES ($1, 'active', $2, $3, $4::citext) RETURNING id`,
    [tenant.organizationId, firstName, lastName, `${local}@example.test`],
  );

  for (const role of roles) {
    await tenant.sql(
      `INSERT INTO membership_role (organization_id, membership_id, role)
       VALUES ($1, $2, $3::member_role)`,
      [tenant.organizationId, membership!.id, role],
    );
  }

  return membership!.id;
}

/**
 * Asserts that `fn` is refused, and refused for the right reason.
 *
 * A test that only checks "it threw" passes when a permission check is replaced
 * by a typo that throws a TypeError. The status is what makes the assertion
 * mean what it says.
 */
export async function expectStatus(fn: () => Promise<unknown>, status: number): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { status?: number }).status;
    if (actual !== status) {
      throw new Error(`Expected HTTP ${status}, got ${actual ?? 'a non-HTTP error'}: ${error}`);
    }
    return;
  }
  throw new Error(`Expected HTTP ${status}, but the call succeeded`);
}

/** Closes both pools so `node --test` can exit. */
export async function closeHarness(): Promise<void> {
  await pool.end();
  await ownerPool?.end();
}

export { withoutTenantScope };
