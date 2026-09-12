import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { authStorage } from '../auth/auth.context.js';
import { listMemberships } from '../identity/identity.repository.js';
import { TenantMiddleware } from '../tenant/tenant.middleware.js';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';

/**
 * The four things an operator can change, and the one that can lock a club out.
 *
 * Suspension gets most of this file, and deliberately. Everything else here is
 * wrong by a number on a screen; this one is wrong by a swimming school of
 * thirty children finding the register closed at eight in the morning. So it is
 * asserted from four directions: that it refuses, that it refuses with a reason
 * a person can read, that `/me` and the platform area keep working so the club
 * can be told and the operator can undo it, and that restoring is an exact
 * inverse.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const guard = new PlatformAdminGuard();
const controller = new PlatformController();
const middleware = new TenantMiddleware();

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });

after(async () => {
  await owner.end();
  await closeHarness();
});

function asOperator<T>(clerkUserId: string, fn: () => Promise<T>): Promise<T> {
  return authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, fn);
}

async function grantPlatformAccess(clerkUserId: string): Promise<void> {
  await owner.query(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'action test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
}

async function cleanup(clerkUserId: string): Promise<void> {
  await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
}

async function trail(clerkUserId: string): Promise<{ action: string; detail: unknown }[]> {
  const { rows } = await owner.query<{ action: string; detail: unknown }>(
    `SELECT action, detail FROM platform_audit_log
      WHERE clerk_user_id = $1 ORDER BY created_at`,
    [clerkUserId],
  );
  return rows;
}

async function organization(tenant: ScratchTenant): Promise<Record<string, unknown>> {
  const { rows } = await owner.query<Record<string, unknown>>(
    `SELECT subscription_status::text AS subscription_status, trial_ends_at,
            max_facilities, max_management_users, suspended_at, suspension_reason, name
       FROM organization WHERE id = $1`,
    [tenant.organizationId],
  );
  return rows[0]!;
}

/**
 * The real TenantMiddleware, against the real membership lookup.
 *
 * Not a stub: the whole question is whether a suspended tenant gets past the one
 * piece of code that decides, and a fake of it would prove nothing. Resolves to
 * `'passed'` when `next()` is reached.
 */
async function resolveTenant(clerkUserId: string, organizationId: string): Promise<string> {
  return authStorage.run({ clerkUserId, sessionId: 'sess' }, async () => {
    const request = {
      header: (name: string) =>
        name === 'x-poolse-organization' ? organizationId : undefined,
    } as never;

    return new Promise<string>((resolve, reject) => {
      middleware
        .use(request, {} as never, () => resolve('passed'))
        .catch((error: unknown) => reject(error));
    });
  });
}

/** The Clerk id the harness gives the scratch tenant's owner. */
async function ownerClerkId(tenant: ScratchTenant): Promise<string> {
  const { rows } = await owner.query<{ clerk_user_id: string }>(
    `SELECT u.clerk_user_id
       FROM app_user u
       JOIN membership m ON m.app_user_id = u.id
      WHERE m.id = $1`,
    [tenant.ownerMembershipId],
  );
  return rows[0]!.clerk_user_id;
}

// ---------------------------------------------------------------------------
// Who may act
// ---------------------------------------------------------------------------

test('the actions are refused to everybody but a platform administrator', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_notop_${Math.floor(performance.now())}`;

    await asOperator(clerkUserId, async () => {
      /*
       * The guard, not the handler. `PlatformAdminGuard` is bound to the module
       * and to the controller, so in production nothing reaches these methods
       * without it — which is why the assertion is that the guard refuses rather
       * than that the handler does.
       */
      await assert.rejects(
        () =>
          guard.canActivate({
            switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/platform/x' }) }),
            getHandler: () => (): null => null,
          } as never),
        (error: { status?: number; response?: { code?: string } }) =>
          error.status === 403 && error.response?.code === 'not_platform_admin',
      );
    });

    // And nothing moved.
    const org = await organization(tenant);
    assert.equal(org['suspended_at'], null);
    await cleanup(clerkUserId);
  });
});

// ---------------------------------------------------------------------------
// Trial, subscription, plan
// ---------------------------------------------------------------------------

test('a trial date is set, and recorded with what it was before', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_trial_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      const was = (await organization(tenant))['trial_ends_at'] as Date;
      const endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

      await asOperator(clerkUserId, async () => {
        const result = await controller.trial(tenant.organizationId, { endsAt });
        assert.ok(result.changed['trial_ends_at'], 'the change is reported');
        assert.equal(result.changed['trial_ends_at']!.after, endsAt);
        assert.equal(result.changed['trial_ends_at']!.before, was.toISOString());
      });

      const now = (await organization(tenant))['trial_ends_at'] as Date;
      assert.equal(now.toISOString(), endsAt);

      /*
       * One row, written by the action itself rather than by the interceptor —
       * and carrying the pair. A trail that says "a trial was changed" without
       * saying from what is a trail nobody can reconstruct an argument from.
       */
      const rows = await trail(clerkUserId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.action, 'tenant.trial.set');
      const detail = rows[0]!.detail as { changed?: Record<string, unknown> };
      assert.ok(detail.changed?.['trial_ends_at']);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('a trial date two years out is refused, and one in the past is not', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_typo_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        /*
         * `2027` typed for `2026` is one keystroke and silently gives somebody
         * two years free. Every legitimate extension is weeks.
         */
        const far = new Date();
        far.setFullYear(far.getFullYear() + 3);
        await assert.rejects(
          () => controller.trial(tenant.organizationId, { endsAt: far.toISOString() }),
          (error: { status?: number; response?: { fields?: Record<string, string> } }) => {
            assert.equal(error.status, 400);
            assert.equal(error.response?.fields?.['endsAt'], 'admin.error.dateTooFar');
            return true;
          },
        );

        await assert.rejects(
          () => controller.trial(tenant.organizationId, { endsAt: 'not a date' }),
          (error: { status?: number }) => error.status === 400,
        );

        /*
         * The past is allowed. Ending a trial today is something an operator
         * means to do, and making them find another screen for it is the sort of
         * gap somebody works around with a database client.
         */
        const yesterday = new Date(Date.now() - 86_400_000).toISOString();
        const result = await controller.trial(tenant.organizationId, { endsAt: yesterday });
        assert.equal(result.changed['trial_ends_at']!.after, yesterday);
      });
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('comped is settable, and an invented status is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_sub_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.subscription(tenant.organizationId, { status: 'comped' });

        await assert.rejects(
          () => controller.subscription(tenant.organizationId, { status: 'free_forever' }),
          (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
            error.status === 400 &&
            error.response?.fields?.['status'] === 'admin.error.statusInvalid',
        );
      });

      // The free pilot: live, and deliberately not billed.
      assert.equal((await organization(tenant))['subscription_status'], 'comped');
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('plan limits move together, and zero is refused while empty means unlimited', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_plan_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.plan(tenant.organizationId, {
          maxFacilities: 3,
          maxManagementUsers: 25,
        });

        // A quota of nought is a tenant nobody can log into. Not a state
        // anybody means to create, so it is refused rather than read as
        // unlimited.
        await assert.rejects(
          () =>
            controller.plan(tenant.organizationId, {
              maxFacilities: 3,
              maxManagementUsers: 0,
            }),
          (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
            error.status === 400 &&
            error.response?.fields?.['maxManagementUsers'] === 'admin.error.atLeastOneOrEmpty',
        );

        await assert.rejects(
          () =>
            controller.plan(tenant.organizationId, {
              maxFacilities: 0,
              maxManagementUsers: null,
            }),
          (error: { status?: number }) => error.status === 400,
        );
      });

      let org = await organization(tenant);
      assert.equal(org['max_facilities'], 3);
      assert.equal(org['max_management_users'], 25);

      // Emptying the box is how a ceiling is removed — null is unlimited, and
      // the reading every ceiling in this schema has.
      await asOperator(clerkUserId, async () => {
        await controller.plan(tenant.organizationId, {
          maxFacilities: 1,
          maxManagementUsers: '',
        });
      });

      org = await organization(tenant);
      assert.equal(org['max_management_users'], null);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('an action against a tenant that does not exist is a 404', async () => {
  const clerkUserId = `user_missing_${Math.floor(performance.now())}`;
  await grantPlatformAccess(clerkUserId);

  try {
    await asOperator(clerkUserId, async () => {
      await assert.rejects(
        () =>
          controller.subscription('00000000-0000-0000-0000-000000000000', {
            status: 'active',
          }),
        (error: { status?: number }) => error.status === 404,
      );
    });

    // And nothing was recorded: there was nothing to record a change to.
    assert.equal((await trail(clerkUserId)).length, 0);
  } finally {
    await cleanup(clerkUserId);
  }
});

test('the operator cannot reach a column the grant does not name', async () => {
  await withScratchTenant(async (tenant) => {
    const before = (await organization(tenant))['name'];

    /*
     * The guarantee the whole slice rests on, asserted through the connection
     * rather than through the API: `poolse_platform` holds UPDATE on six named
     * columns, so a statement touching a seventh is refused by Postgres. There is
     * no code path that renames a club and there is no way to write one.
     */
    const platform = new pg.Pool({
      connectionString: process.env['DATABASE_PLATFORM_URL'],
      max: 1,
    });
    try {
      await assert.rejects(
        () => platform.query('UPDATE organization SET name = $1 WHERE id = $2', [
          'Apropriado',
          tenant.organizationId,
        ]),
        (error: { code?: string }) => error.code === '42501',
      );
      await assert.rejects(
        () =>
          platform.query('UPDATE organization SET archived_at = now() WHERE id = $1', [
            tenant.organizationId,
          ]),
        (error: { code?: string }) => error.code === '42501',
      );
    } finally {
      await platform.end();
    }

    assert.equal((await organization(tenant))['name'], before);
  });
});

// ---------------------------------------------------------------------------
// Suspension — the dangerous one
// ---------------------------------------------------------------------------

test('a suspended tenant is refused, with the operator’s own reason', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_susp_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      // Before: the real middleware lets the club's owner through.
      assert.equal(await resolveTenant(club, tenant.organizationId), 'passed');

      await asOperator(clerkUserId, async () => {
        await controller.suspension(tenant.organizationId, {
          suspended: true,
          reason: 'Fatura de setembro por regularizar.',
        });
      });

      await assert.rejects(
        () => resolveTenant(club, tenant.organizationId),
        (error: { status?: number; response?: { code?: string; reason?: string } }) => {
          assert.equal(error.status, 403);
          /*
           * Its own code. `no_organization` sends somebody to create one and
           * `forbidden_role` sends them to an admin; this one sends them to us,
           * and a client that cannot tell the three apart shows the wrong screen
           * to a club whose door we closed.
           */
          assert.equal(error.response?.code, 'tenant_suspended');
          // The sentence the operator typed, carried through verbatim.
          assert.equal(error.response?.reason, 'Fatura de setembro por regularizar.');
          return true;
        },
      );
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('a suspended tenant can still be told why: /me keeps answering', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_me_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.suspension(tenant.organizationId, {
          suspended: true,
          reason: 'Suspensa a pedido do cliente.',
        });
      });

      /*
       * `listMemberships` is what `/me` reads, and it is an identity-only route
       * that TenantMiddleware never runs for. If suspension had been enforced
       * inside `resolve_memberships` instead, this would come back empty and the
       * club would be indistinguishable from somebody who belongs to no
       * organization — sent to create a second one rather than told why the
       * first is shut.
       */
      const memberships = await listMemberships(club);
      const membership = memberships.find((m) => m.organizationId === tenant.organizationId);

      assert.ok(membership, 'the membership still resolves');
      assert.ok(membership.suspendedAt !== null);
      assert.equal(membership.suspensionReason, 'Suspensa a pedido do cliente.');
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('restoring is an exact inverse, and both columns move together', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_restore_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.suspension(tenant.organizationId, {
          suspended: true,
          reason: 'Temporária.',
        });
        await controller.suspension(tenant.organizationId, { suspended: false });
      });

      const org = await organization(tenant);
      // Neither half left behind. The CHECK would refuse one without the other,
      // which is what makes "an exact inverse" a property rather than a habit.
      assert.equal(org['suspended_at'], null);
      assert.equal(org['suspension_reason'], null);

      assert.equal(await resolveTenant(club, tenant.organizationId), 'passed');

      const rows = await trail(clerkUserId);
      assert.deepEqual(
        rows.map((row) => row.action),
        ['tenant.suspended', 'tenant.restored'],
      );
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('suspending without a reason is refused before it reaches the column', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_noreason_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        for (const reason of [undefined, '', '   ']) {
          await assert.rejects(
            () => controller.suspension(tenant.organizationId, { suspended: true, reason }),
            (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
              error.status === 400 &&
              error.response?.fields?.['reason'] === 'admin.error.reasonRequired',
          );
        }
      });

      // A 400 beside the field, not a constraint violation as a 500 — the club
      // stayed open throughout.
      assert.equal((await organization(tenant))['suspended_at'], null);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('suspending one tenant leaves every other one open', async () => {
  await withScratchTenant(async (suspended) => {
    await withScratchTenant(async (untouched) => {
      const clerkUserId = `user_blast_${Math.floor(performance.now())}`;
      await grantPlatformAccess(clerkUserId);
      const other = await ownerClerkId(untouched);

      try {
        await asOperator(clerkUserId, async () => {
          await controller.suspension(suspended.organizationId, {
            suspended: true,
            reason: 'Uma só.',
          });
        });

        /*
         * The blast radius. `poolse_platform` reads and now writes across every
         * tenant, so an action whose WHERE clause slipped would close every club
         * in the database at once — the one mistake in this slice that cannot be
         * apologised for.
         */
        assert.equal(await resolveTenant(other, untouched.organizationId), 'passed');
        assert.equal((await organization(untouched))['suspended_at'], null);
      } finally {
        await cleanup(clerkUserId);
      }
    });
  });
});

test('an operator whose own tenant is suspended can still reach the platform area', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await ownerClerkId(tenant);
    await grantPlatformAccess(club);

    try {
      await asOperator(club, async () => {
        await controller.suspension(tenant.organizationId, {
          suspended: true,
          reason: 'Erro meu.',
        });

        /*
         * The way back. `/platform` is in IDENTITY_ONLY_ROUTES, so
         * TenantMiddleware never runs for it — which means suspending the tenant
         * you happen to belong to does not lock you out of the screen that
         * undoes it.
         */
        assert.equal(
          await guard.canActivate({
            switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/platform/tenants' }) }),
            getHandler: () => (): null => null,
          } as never),
          true,
        );

        await controller.suspension(tenant.organizationId, { suspended: false });
      });

      assert.equal(await resolveTenant(club, tenant.organizationId), 'passed');
    } finally {
      await cleanup(club);
    }
  });
});

test('a change that changes nothing is recorded as changing nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_noop_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.subscription(tenant.organizationId, { status: 'active' });
        const again = await controller.subscription(tenant.organizationId, { status: 'active' });

        /*
         * Empty, not absent. `normalise` exists for this: without it a timestamp
         * would compare by object identity and every re-save would be recorded
         * as a change, and "this moved" would stop meaning anything.
         */
        assert.deepEqual(again.changed, {});
      });

      const rows = await trail(clerkUserId);
      // Still two entries: the request happened and is worth the line. What the
      // second one says is that nothing moved.
      assert.equal(rows.length, 2);
      assert.deepEqual((rows[1]!.detail as { changed: unknown }).changed, {});
    } finally {
      await cleanup(clerkUserId);
    }
  });
});
