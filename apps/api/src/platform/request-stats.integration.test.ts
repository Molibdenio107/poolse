import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { authStorage } from '../auth/auth.context.js';
import { tenantStorage } from '../tenant/tenant.context.js';
import { actingAs, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { percentile, RequestStatsInterceptor } from './request-stats.interceptor.js';

/**
 * What the interceptor records, and — more importantly — what it does not.
 *
 * The three assertions the ticket names are here: a request with a tenant
 * increments the right bucket, a request without one records nothing at all, and
 * a 5xx increments `count_5xx` and stamps the error fields.
 *
 * The second is the one worth the most. `RequestStatsInterceptor` is registered
 * globally, so it sees the Clerk webhook, `/me`, `/organizations`, `/join`, the
 * health check and the whole platform area — none of which belongs to a tenant.
 * Recording those would attribute Poolse's own plumbing to whichever club
 * happened to be in scope, and the way that goes wrong is silent.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A fresh interceptor per test: the buffer is per-instance and must not leak. */
function interceptor(): RequestStatsInterceptor {
  return new RequestStatsInterceptor();
}

function context(method: string, route: string, status: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, path: route, route: { path: route } }),
      getResponse: () => ({ statusCode: status }),
    }),
  } as unknown as ExecutionContext;
}

/** Push one request through and wait for the observable to settle. */
async function request(
  stats: RequestStatsInterceptor,
  options: { method?: string; route?: string; status?: number; error?: unknown } = {},
): Promise<void> {
  const { method = 'GET', route = '/students', status = 200, error } = options;

  const handler: CallHandler = {
    handle: () => (error === undefined ? of({ ok: true }) : throwError(() => error)),
  };

  await new Promise<void>((resolve) => {
    stats.intercept(context(method, route, status), handler).subscribe({
      complete: () => resolve(),
      error: () => resolve(),
    });
  });
}

interface StatRow {
  bucket: Date;
  request_count: number;
  count_4xx: number;
  count_5xx: number;
  p95_latency_ms: number;
  last_request_at: Date | null;
  last_error_at: Date | null;
  last_error_route: string | null;
  last_error_message: string | null;
}

async function rows(tenant: ScratchTenant): Promise<StatRow[]> {
  return tenant.sql<StatRow>(
    `SELECT bucket, request_count, count_4xx, count_5xx, p95_latency_ms,
            last_request_at, last_error_at, last_error_route, last_error_message
       FROM tenant_request_stats
      WHERE organization_id = $1
      ORDER BY bucket`,
    [tenant.organizationId],
  );
}

test('a request with a tenant context increments that tenant’s bucket', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await request(stats);
      await request(stats);
      await request(stats, { status: 201, method: 'POST' });
    });

    // Nothing is written until the flush. The whole design is that a request
    // costs a Map lookup and the database is touched by a timer.
    assert.equal((await rows(tenant)).length, 0, 'nothing written in the request path');

    await stats.flush();

    const [row] = await rows(tenant);
    assert.ok(row, 'one row for the hour');
    assert.equal(row.request_count, 3);
    assert.equal(row.count_4xx, 0);
    assert.equal(row.count_5xx, 0);
    assert.equal(row.last_error_at, null);
    assert.ok(row.last_request_at !== null);

    // One row per tenant per hour, never one per request.
    assert.equal((await rows(tenant)).length, 1);

    // Truncated to the hour, and the CHECK on the column agrees.
    assert.equal(row.bucket.getUTCMinutes(), 0);
    assert.equal(row.bucket.getUTCSeconds(), 0);
  });
});

test('a request with no tenant context records nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    /*
     * Authenticated, and deliberately outside `tenantStorage` — the exact shape
     * of `/me`, `/organizations`, `/join` and every `/platform` route. The
     * webhook and the health check have neither storage and are the same case.
     */
    await authStorage.run({ clerkUserId: 'user_no_tenant', sessionId: 'sess' }, async () => {
      await request(stats, { route: '/me' });
      await request(stats, { route: '/platform/tenants' });
    });

    await stats.flush();
    assert.equal((await rows(tenant)).length, 0);

    // And nothing landed against any other tenant either — the interceptor had
    // no organization to attribute it to and did not invent one.
    const [any] = await tenant.sql<{ n: string }>(
      'SELECT count(*) AS n FROM tenant_request_stats',
    );
    assert.equal(Number(any!.n), 0);
  });
});

test('a 5xx increments count_5xx and stamps the error, a 4xx only counts', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await request(stats);
      await request(stats, { status: 403, route: '/students/:id' });
      await request(stats, {
        route: '/classes/:id',
        method: 'PATCH',
        error: Object.assign(new Error('relation "class_sesion" does not exist'), {
          status: 500,
        }),
      });
    });

    await stats.flush();

    const [row] = await rows(tenant);
    assert.ok(row);
    assert.equal(row.request_count, 3);
    assert.equal(row.count_4xx, 1);
    assert.equal(row.count_5xx, 1);

    assert.ok(row.last_error_at !== null);
    // The route *pattern*, never the URL: `/students/8f3c…` would put a tenant's
    // identifiers into a table explicitly meant to hold none.
    assert.equal(row.last_error_route, 'PATCH /classes/:id');
    assert.equal(row.last_error_message, 'relation "class_sesion" does not exist');

    /*
     * The newest request was the failure, which is one of the three ways a
     * tenant goes red — and the comparison the verdict makes is exactly this.
     */
    assert.ok(row.last_error_at >= row.last_request_at!);
  });
});

test('a 4xx never stamps an error message', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await request(stats, {
        route: '/students',
        error: Object.assign(new Error('Requires one of: owner, admin'), { status: 403 }),
      });
    });

    await stats.flush();

    const [row] = await rows(tenant);
    assert.equal(row?.count_4xx, 1);
    assert.equal(row?.count_5xx, 0);
    /*
     * A refused request is the API working. Recording its message would fill
     * the error list with permission checks doing their job, and would be the
     * likeliest route by which a name reached this table.
     */
    assert.equal(row?.last_error_at, null);
    assert.equal(row?.last_error_message, null);
  });
});

test('a later flush adds to the hour rather than replacing it, and keeps the error', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await request(stats, {
        error: Object.assign(new Error('boom'), { status: 500 }),
      });
    });
    await stats.flush();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await request(stats);
      await request(stats);
    });
    await stats.flush();

    const all = await rows(tenant);
    assert.equal(all.length, 1, 'still one row for the hour');

    const row = all[0]!;
    assert.equal(row.request_count, 3, 'counts add across flushes');
    assert.equal(row.count_5xx, 1);

    /*
     * The batch that followed carried no failure, and must not blank the one
     * recorded a moment earlier — the `coalesce` in the upsert. Nor may it leave
     * last batch's route beside a fresh timestamp, which is why the three error
     * columns move together.
     */
    assert.equal(row.last_error_message, 'boom');
    assert.ok(row.last_error_route !== null);

    // But the newest request is now a success, so the tenant is no longer red on
    // the "last request failed" rule.
    assert.ok(row.last_request_at! > row.last_error_at!);
  });
});

test('flushing an empty buffer writes nothing and does not throw', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();
    await stats.flush();
    assert.equal((await rows(tenant)).length, 0);
  });
});

test('the buffer is emptied by a flush, so a second one does not double-count', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await request(stats);
    });

    await stats.flush();
    await stats.flush();

    const [row] = await rows(tenant);
    assert.equal(row?.request_count, 1);
  });
});

test('an unhandled non-HTTP error counts as a 5xx', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // No `status` on it at all — a TypeError from a repository, which is the
      // realistic shape of the failures this table exists to surface. Reading
      // `response.statusCode` here would say 200, because the response has not
      // been written yet.
      await request(stats, { error: new TypeError('cannot read properties of null') });
    });

    await stats.flush();

    const [row] = await rows(tenant);
    assert.equal(row?.count_5xx, 1);
    assert.equal(row?.count_4xx, 0);
  });
});

test('the tenant context is read per request, not captured once', async () => {
  await withScratchTenant(async (first) => {
    await withScratchTenant(async (second) => {
      const stats = interceptor();

      await actingAs(first, { roles: ['owner'] }, async () => {
        await request(stats);
      });
      await actingAs(second, { roles: ['owner'] }, async () => {
        await request(stats);
        await request(stats);
      });

      await stats.flush();

      const [a] = await rows(first);
      const [b] = await rows(second);
      assert.equal(a?.request_count, 1);
      assert.equal(b?.request_count, 2);
    });
  });
});

// ---------------------------------------------------------------------------
// p95
// ---------------------------------------------------------------------------

test('p95 is nearest-rank, so it always returns a latency that happened', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([7], 95), 7);

  // 100 samples, 1…100. The 95th by nearest rank is the 95th value.
  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(hundred, 95), 95);

  // Unsorted input must give the same answer.
  assert.equal(percentile([...hundred].reverse(), 95), 95);

  // Two samples: rank ceil(1.9) = 2, the larger. Reading high is the safe
  // direction for a health signal.
  assert.equal(percentile([10, 200], 95), 200);
});

test('a request with a tenant but no auth still records', async () => {
  await withScratchTenant(async (tenant) => {
    const stats = interceptor();

    /*
     * `tenantStorage` alone, without `authStorage`. Not a shape production
     * produces today, and asserted anyway because the interceptor must depend on
     * exactly one of the two storages — reaching for `currentAuth()` here would
     * throw inside a `tap`, which is an unhandled rejection rather than a visible
     * failure.
     */
    await tenantStorage.run(
      {
        organizationId: tenant.organizationId,
        membershipId: tenant.ownerMembershipId,
        appUserId: '',
        roles: ['owner'],
      },
      async () => {
        await request(stats);
      },
    );

    await stats.flush();
    assert.equal((await rows(tenant))[0]?.request_count, 1);
  });
});
