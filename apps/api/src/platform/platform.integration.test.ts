import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { authStorage } from '../auth/auth.context.js';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { PlatformAuditInterceptor } from './platform-audit.interceptor.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';

/**
 * Platform administration — that it is not a tenant role, and that the numbers
 * on the overview are the right numbers.
 *
 * The first half is the one that matters. Every other permission in this product
 * is a `member_role` and is wrong by a screen if it slips; this one is wrong by
 * every tenant in the database. So the two assertions the ticket names are here
 * verbatim — an owner of a real club is refused, and an operator who belongs to
 * no club at all is admitted — and they run against the real guard, the real
 * `platform_admin` table and the real platform connection.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const guard = new PlatformAdminGuard();
const controller = new PlatformController();
const interceptor = new PlatformAuditInterceptor(new Reflector());

/**
 * The owner connection, for the two writes nobody else may make: granting
 * platform access, and reading the trail back.
 *
 * `poolse_app` is refused both tables outright and `poolse_platform` may only
 * read `platform_admin` — which is the schema being right, and is why a test
 * that wants to *create* an operator has to come in as the owner, exactly as
 * `pnpm db:platform-admin` does.
 */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });

after(async () => {
  await owner.end();
  await closeHarness();
});

/**
 * A request context with an identity and deliberately no tenant.
 *
 * This is the shape `/platform` actually runs in: `ClerkAuthMiddleware` has
 * populated `authStorage`, and `TenantMiddleware` was excluded, so
 * `currentTenant()` would throw. A guard that reached for it would fail here,
 * which is the point — it must not.
 */
function asOperator<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, fn);
}

/** Just enough ExecutionContext for the guard and the interceptor. */
function context(path: string, handler: () => unknown = (): null => null): ExecutionContext {
  const request = {
    method: 'GET',
    path,
    originalUrl: path,
    params: {} as Record<string, string>,
    query: {} as Record<string, unknown>,
    route: { path },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => PlatformController,
  } as unknown as ExecutionContext;
}

async function grantPlatformAccess(clerkUserId: string): Promise<void> {
  await owner.query(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'integration test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
}

async function removePlatformAccess(clerkUserId: string): Promise<void> {
  await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
}

async function auditRows(clerkUserId: string): Promise<{ action: string; detail: unknown }[]> {
  const { rows } = await owner.query<{ action: string; detail: unknown }>(
    'SELECT action, detail FROM platform_audit_log WHERE clerk_user_id = $1 ORDER BY created_at',
    [clerkUserId],
  );
  return rows;
}

async function clearAudit(clerkUserId: string): Promise<void> {
  await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
}

/** A pending invitation, of the shape `createInvitation` writes. */
async function inviteMember(
  tenant: ScratchTenant,
  email: string,
  roles: string[],
  options: { expiresInHours?: number; revoked?: boolean } = {},
): Promise<void> {
  const [membership] = await tenant.sql<{ id: string }>(
    `INSERT INTO membership (organization_id, status, first_name, last_name, email)
     VALUES ($1, 'invited', 'Convidado', $2, $3::citext) RETURNING id`,
    [tenant.organizationId, email.split('@')[0], email],
  );

  await tenant.sql(
    `INSERT INTO invitation (organization_id, membership_id, email, roles, token_hash,
                             expires_at, revoked_at)
     VALUES ($1, $2, $3::citext, $4::member_role[], $5,
             now() + make_interval(hours => $6), $7)`,
    [
      tenant.organizationId,
      membership!.id,
      email,
      roles,
      `hash_${email}_${Math.floor(performance.now())}`,
      options.expiresInHours ?? 24,
      options.revoked === true ? new Date() : null,
    ],
  );
}

/** The row for one tenant, found by id rather than by position. */
async function rowFor(tenant: ScratchTenant, search: string) {
  const page = await controller.tenants(undefined, '100', search);
  return page.items.find((item) => item.id === tenant.organizationId);
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

test('a tenant Owner without the platform flag is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_owner_${tenant.organizationId.slice(0, 8)}`;
    await clearAudit(clerkUserId);

    await asOperator(clerkUserId, async () => {
      /*
       * Owner of a real club, provisioned by the real signup path. Being the most
       * senior role there is grants nothing here, and that is the whole point of
       * the ticket: platform access is orthogonal to `member_role`, so there is
       * no role anybody can hold that arrives at this screen.
       */
      await assert.rejects(
        () => guard.canActivate(context('/platform/tenants')),
        (error: { status?: number; response?: { code?: string } }) => {
          assert.equal(error.status, 403);
          assert.equal(error.response?.code, 'not_platform_admin');
          return true;
        },
      );
    });

    /*
     * And the refusal left a trace. A guard runs before every interceptor, so a
     * 403 is the one request that would otherwise reach the platform area
     * silently — which is exactly the request worth having a record of.
     */
    const rows = await auditRows(clerkUserId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, 'platform.denied');

    await clearAudit(clerkUserId);
  });
});

test('a platform admin who belongs to no tenant is admitted', async () => {
  const clerkUserId = `user_operator_${Math.floor(performance.now())}`;
  await grantPlatformAccess(clerkUserId);

  try {
    await asOperator(clerkUserId, async () => {
      // No organization, no membership, no tenant context at all — and the guard
      // never reaches for one. `currentTenant()` would throw in here.
      assert.equal(await guard.canActivate(context('/platform/tenants')), true);

      const page = await controller.tenants();
      assert.ok(page.total >= 0);
      assert.equal(page.page, 1);
    });
  } finally {
    await removePlatformAccess(clerkUserId);
    await clearAudit(clerkUserId);
  }
});

test('revoking platform access takes effect on the next request', async () => {
  const clerkUserId = `user_revoked_${Math.floor(performance.now())}`;
  await grantPlatformAccess(clerkUserId);

  try {
    await asOperator(clerkUserId, async () => {
      assert.equal(await guard.canActivate(context('/platform/tenants')), true);

      // Archived, not deleted — history is soft-deleted here as everywhere else.
      await owner.query(
        'UPDATE platform_admin SET archived_at = now() WHERE clerk_user_id = $1',
        [clerkUserId],
      );

      // No cache, so no restart. This is the assertion that pays for the round
      // trip the guard makes on every request.
      await assert.rejects(() => guard.canActivate(context('/platform/tenants')));
    });
  } finally {
    await removePlatformAccess(clerkUserId);
    await clearAudit(clerkUserId);
  }
});

// ---------------------------------------------------------------------------
// The overview's numbers
// ---------------------------------------------------------------------------

test('seats count active management memberships plus pending invitations', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_seats_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      const name = await tenantName(tenant);

      await asOperator(clerkUserId, async () => {
        // Signup made exactly one membership: the owner.
        const before = await rowFor(tenant, name);
        assert.equal(before?.managementSeatsUsed, 1);

        await inviteMember(tenant, 'nova.treinadora@example.test', ['instructor']);

        const after = await rowFor(tenant, name);
        assert.equal(
          after?.managementSeatsUsed,
          2,
          'a pending invitation consumes a seat before it is accepted — the 24h ' +
            'window would otherwise let a tenant overshoot its quota',
        );

        /*
         * And exactly one, not two. The invitation already created its membership
         * row at status `invited`; counting those as well would make every
         * pending invite worth a seat twice over.
         */
        const [counted] = await tenant.sql<{ n: string }>(
          `SELECT count(*) AS n FROM membership WHERE organization_id = $1`,
          [tenant.organizationId],
        );
        assert.equal(Number(counted!.n), 2);
      });
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

test('an expired or revoked invitation frees its seat, and a student never took one', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_seats2_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      const name = await tenantName(tenant);

      await inviteMember(tenant, 'expirou@example.test', ['admin'], { expiresInHours: -1 });
      await inviteMember(tenant, 'revogado@example.test', ['admin'], { revoked: true });
      // A family, on a plan that bills management logins. They scale
      // independently and must never appear against the seat count.
      await inviteMember(tenant, 'encarregada@example.test', ['guardian']);

      await asOperator(clerkUserId, async () => {
        const row = await rowFor(tenant, name);
        assert.equal(row?.managementSeatsUsed, 1, 'still just the owner');
      });
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

test('the row carries the tenant plan, its sites and its last activity', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_row_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      const name = await tenantName(tenant);

      /*
       * Two tanks, one of them archived. Provisioning a club opens a site and a
       * season but no pool — only a personal tenant gets one — so the count has
       * something to be wrong about only if this fixture supplies it.
       */
      await tenant.sql(
        `INSERT INTO pool (organization_id, facility_id, name, archived_at)
         VALUES ($1, $2, 'Tanque Grande', NULL),
                ($1, $2, 'Tanque Antigo', now())`,
        [tenant.organizationId, tenant.facilityId],
      );

      await asOperator(clerkUserId, async () => {
        const row = await rowFor(tenant, name);
        assert.ok(row, 'the scratch tenant is in the list');

        assert.equal(row.kind, 'business');
        // Signup opens one site and starts a trial.
        assert.equal(row.facilityCount, 1);
        // An archived tank is not a tank the club has — counts exclude them.
        assert.equal(row.poolCount, 1);
        assert.equal(row.subscriptionStatus, 'trialing');
        assert.ok(row.trialEndsAt !== null);
        // Not modelled anywhere, and deliberately not invented here.
        assert.equal(row.planTier, null);
        // The harness sets this out of the way so multi-site fixtures are not
        // refused by the licence; unlimited would be null.
        assert.equal(row.maxFacilities, 20);
        // Nobody has set a quota, and unlimited is null rather than zero.
        assert.equal(row.maxManagementUsers, null);

        /*
         * `max(audit_log.created_at)` — last recorded write, not last login.
         * Signup itself records one, so a brand-new tenant is not blank.
         */
        assert.ok(row.lastActivityAt !== null, 'signup wrote an audit entry');
        assert.equal(row.archivedAt, null);
      });
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

test('search finds a tenant by name, accents and case aside', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_search_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        // Every scratch tenant is named "Clube de Teste <stamp>"; lower case and
        // unaccented, it still has to match.
        const page = await controller.tenants(undefined, '100', 'CLUBE DE TESTE');
        assert.ok(page.items.some((item) => item.id === tenant.organizationId));

        // A one-character term is not a search — the same floor every other list
        // in the product uses, so the operator's list behaves like a club's.
        const unfiltered = await controller.tenants(undefined, '1', 'c');
        assert.ok(unfiltered.total >= page.total);
      });
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

test('a read is audited, and so is a read that failed', async () => {
  const clerkUserId = `user_audit_${Math.floor(performance.now())}`;
  await grantPlatformAccess(clerkUserId);

  try {
    await asOperator(clerkUserId, async () => {
      const ok: CallHandler = { handle: () => of({ items: [] }) };
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(context('/platform/tenants'), ok)
          .subscribe({ complete: () => resolve() });
      });

      const bad: CallHandler = { handle: () => throwError(() => new Error('boom')) };
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(context('/platform/tenants'), bad)
          .subscribe({ error: () => resolve() });
      });
    });

    /*
     * The insert is fire-and-forget — an audit write must never turn a working
     * read into a 500 — so it settles a tick after the observable does.
     */
    await new Promise((resolve) => setTimeout(resolve, 250));

    const rows = await auditRows(clerkUserId);
    assert.equal(rows.length, 2, 'one line per request, reads included');

    const outcomes = rows.map((row) => (row.detail as { outcome?: string }).outcome);
    assert.deepEqual(outcomes, ['ok', 'error']);

    // Falls back to method-and-path when no @PlatformAction names the endpoint,
    // so a decorator somebody forgot costs legibility rather than coverage.
    assert.ok(rows.every((row) => row.action.includes('platform/tenants')));
  } finally {
    await removePlatformAccess(clerkUserId);
    await clearAudit(clerkUserId);
  }
});

/** The scratch tenant's own name, so a search can be narrowed to it. */
async function tenantName(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ name: string }>(
    'SELECT name FROM organization WHERE id = $1',
    [tenant.organizationId],
  );
  return row!.name;
}

// ---------------------------------------------------------------------------
// Health — slice 2
// ---------------------------------------------------------------------------

test('a tenant carries a health verdict, and unknown is not green', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_health_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      const name = await tenantName(tenant);

      await asOperator(clerkUserId, async () => {
        const fresh = await rowFor(tenant, name);
        /*
         * A brand-new tenant has made no requests. That is `unknown`, not
         * `green`: a club nobody used is a different fact from one that worked
         * perfectly, and often a more interesting one.
         */
        assert.equal(fresh?.health, 'unknown');
        assert.equal(fresh?.requestCount24h, 0);
        assert.equal(fresh?.lastErrorAt, null);
      });

      // A quiet hour: a hundred requests, none of them a failure.
      await tenant.sql(
        `INSERT INTO tenant_request_stats (
           organization_id, bucket, request_count, count_4xx, count_5xx,
           p95_latency_ms, last_request_at
         ) VALUES ($1, date_trunc('hour', now()), 100, 4, 0, 30, now())`,
        [tenant.organizationId],
      );

      await asOperator(clerkUserId, async () => {
        const green = await rowFor(tenant, name);
        // Four 4xx and still green — a client meeting a 403 is the API working.
        assert.equal(green?.health, 'green');
        assert.equal(green?.count4xx24h, 4);
      });

      // Now three failures in a hundred: 3%, over the 2% line, and red.
      await tenant.sql(
        `UPDATE tenant_request_stats
            SET count_5xx = 3,
                last_error_at = now() - interval '5 minutes',
                last_error_route = 'GET /classes',
                last_error_message = 'boom'
          WHERE organization_id = $1`,
        [tenant.organizationId],
      );

      await asOperator(clerkUserId, async () => {
        const red = await rowFor(tenant, name);
        assert.equal(red?.health, 'red');
        assert.equal(red?.count5xx24h, 3);
        assert.ok(red?.lastErrorAt !== null);
      });
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

test('a tenant’s week of requests reads back, with its errors deduplicated', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_reqs_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      /*
       * Three hours, and the same route failing in two of them. A route broken
       * for an hour writes itself into sixty buckets; a list of sixty identical
       * lines describes one problem while hiding every other.
       */
      await tenant.sql(
        `INSERT INTO tenant_request_stats (
           organization_id, bucket, request_count, count_4xx, count_5xx,
           p95_latency_ms, last_request_at, last_error_at, last_error_route,
           last_error_message
         ) VALUES
           ($1, date_trunc('hour', now() - interval '2 hours'), 40, 0, 2, 55,
            now() - interval '2 hours', now() - interval '2 hours', 'GET /classes', 'boom'),
           ($1, date_trunc('hour', now() - interval '1 hour'), 60, 1, 1, 80,
            now() - interval '1 hour', now() - interval '1 hour', 'GET /classes', 'boom again'),
           ($1, date_trunc('hour', now()), 20, 0, 1, 30,
            now(), now(), 'POST /students', 'nope')`,
        [tenant.organizationId],
      );

      await asOperator(clerkUserId, async () => {
        const requests = await controller.requests(tenant.organizationId);

        assert.equal(requests.buckets.length, 3);
        // Oldest first, so a chart renders them without reversing.
        assert.ok(
          new Date(requests.buckets[0]!.bucket) < new Date(requests.buckets[2]!.bucket),
        );
        assert.equal(requests.requestCount24h, 120);
        assert.equal(requests.count5xx24h, 4);

        // Two distinct routes from three failing buckets, newest first.
        assert.equal(requests.errors.length, 2);
        assert.equal(requests.errors[0]!.route, 'POST /students');
        assert.equal(requests.errors[1]!.route, 'GET /classes');
        // And the newest of the two `GET /classes` rows, not the first.
        assert.equal(requests.errors[1]!.message, 'boom again');
      });
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

test('a tenant that does not exist is a 404, not an empty week', async () => {
  const clerkUserId = `user_404_${Math.floor(performance.now())}`;
  await grantPlatformAccess(clerkUserId);

  try {
    await asOperator(clerkUserId, async () => {
      await assert.rejects(
        () => controller.requests('00000000-0000-0000-0000-000000000000'),
        (error: { status?: number }) => error.status === 404,
      );
    });
  } finally {
    await removePlatformAccess(clerkUserId);
    await clearAudit(clerkUserId);
  }
});

test('reading one tenant’s requests names that tenant in the audit trail', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_auditorg_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        await new Promise<void>((resolve) => {
          interceptor
            .intercept(
              contextFor(`/platform/tenants/${tenant.organizationId}/requests`, {
                id: tenant.organizationId,
              }),
              { handle: () => of({}) },
            )
            .subscribe({ complete: () => resolve() });
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 250));

      const { rows } = await owner.query<{ organization_id: string | null }>(
        'SELECT organization_id FROM platform_audit_log WHERE clerk_user_id = $1',
        [clerkUserId],
      );
      assert.equal(rows.length, 1);
      /*
       * The first platform route that names a tenant, and the reason slice 1 put
       * `platform_audit_log` in the harness teardown list: this foreign key is
       * what would otherwise fail teardown with an error about a table nobody
       * had touched.
       */
      assert.equal(rows[0]!.organization_id, tenant.organizationId);
    } finally {
      await removePlatformAccess(clerkUserId);
      await clearAudit(clerkUserId);
    }
  });
});

/** A context whose route carries params — for the audit interceptor's tenant id. */
function contextFor(path: string, params: Record<string, string>): ExecutionContext {
  const request = {
    method: 'GET',
    path,
    originalUrl: path,
    params,
    query: {} as Record<string, unknown>,
    route: { path: '/platform/tenants/:id/requests' },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): null => null,
    getClass: () => PlatformController,
  } as unknown as ExecutionContext;
}
