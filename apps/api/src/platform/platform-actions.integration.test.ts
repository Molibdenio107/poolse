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
            max_facilities, max_management_users, suspended_at, suspension_reason,
            read_only_at, pending_delete_at, name,
            billing_mode::text AS billing_mode,
            paid_through::text AS paid_through
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
/**
 * Drive the real middleware, as a real request.
 *
 * `method` and `path` default to a plain read, which is what every caller before
 * POOLSE-61 was asking about. Read-only is decided on exactly those two, so the
 * tests that care pass them and nothing else changes.
 */
async function resolveTenant(
  clerkUserId: string,
  organizationId: string,
  method = 'GET',
  path = '/students',
): Promise<string> {
  return authStorage.run({ clerkUserId, sessionId: 'sess' }, async () => {
    const request = {
      method,
      path,
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

/**
 * `comped` is no longer a status — POOLSE-63.
 *
 * It moved to `billing_mode`, because two homes for one fact is how they drift:
 * a club could be `manual` and `comped` at once, reading as "pays in cash" and
 * "is not billed" in the same breath. The free pilot now carries the word on its
 * billing mode, with an ordinary `active` status — the more honest pair.
 */
test('63 — comped is refused as a status and carried by the billing mode', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_sub_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        for (const status of ['comped', 'free_forever']) {
          await assert.rejects(
            () => controller.subscription(tenant.organizationId, { status }),
            (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
              error.status === 400 &&
              error.response?.fields?.['status'] === 'admin.error.statusInvalid',
            `${status} should be refused as a subscription status`,
          );
        }

        await controller.billingMode(tenant.organizationId, { billingMode: 'comped' });
        await controller.subscription(tenant.organizationId, { status: 'active' });
      });

      // The free pilot: live, and deliberately not billed.
      const org = await organization(tenant);
      assert.equal(org['billing_mode'], 'comped');
      assert.equal(org['subscription_status'], 'active');
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
     * rather than through the API: `poolse_platform` holds UPDATE on *named*
     * columns, so a statement touching one it does not name is refused by
     * Postgres. There is no code path that renames a club and there is no way to
     * write one.
     *
     * `archived_at` was on this list until 14 September 2026 and is now granted,
     * deliberately, so the trial clock can close the ladder — see
     * `docs/decisions.md`. What replaced it here is `DELETE`, which is the half
     * of the old guarantee that survived: archiving is reversible and destroying
     * a tenant is not something the operator area can do at all.
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
          platform.query('DELETE FROM organization WHERE id = $1', [tenant.organizationId]),
        (error: { code?: string }) => error.code === '42501',
      );

      // And the one that was traded away, asserted as *allowed* rather than left
      // untested — a capability nothing checks is a capability that rots.
      await platform.query('UPDATE organization SET archived_at = now() WHERE id = $1', [
        tenant.organizationId,
      ]);
      await platform.query('UPDATE organization SET archived_at = NULL WHERE id = $1', [
        tenant.organizationId,
      ]);
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

// ---------------------------------------------------------------------------
// Read-only — POOLSE-61 slice B1
// ---------------------------------------------------------------------------

/** What a read-only refusal has to carry for the banner to be buildable. */
interface ReadOnlyRefusal {
  status?: number;
  response?: { code?: string; trialEndedAt?: string | null; dataKeptUntil?: string | null };
}

test('61.3 — a read-only tenant reads, and every unsafe method is refused with the dates', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_ro_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.readOnly(tenant.organizationId, {
          readOnly: true,
          dataKeptUntil: '2026-12-31',
        });
      });

      // Reads pass. So does every export in the product, because every export is
      // a GET — which is what makes AC5 true without listing a single route.
      assert.equal(await resolveTenant(club, tenant.organizationId, 'GET', '/students'), 'passed');
      assert.equal(
        await resolveTenant(club, tenant.organizationId, 'GET', '/students/export'),
        'passed',
        'a club that cannot get its own data out is the failure this state exists to avoid',
      );
      assert.equal(await resolveTenant(club, tenant.organizationId, 'HEAD', '/students'), 'passed');

      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        await assert.rejects(
          () => resolveTenant(club, tenant.organizationId, method, '/students'),
          (error: ReadOnlyRefusal) => {
            assert.equal(error.status, 403);
            assert.equal(error.response?.code, 'tenant_read_only');
            // The banner is built from the refusal rather than from a second
            // request asking why the first one failed.
            assert.ok(error.response?.trialEndedAt, 'the refusal says when writing stopped');
            assert.equal(error.response?.dataKeptUntil?.slice(0, 10), '2026-12-31');
            return true;
          },
          `${method} should have been refused`,
        );
      }
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('61.5 — a read-only tenant can still reach the checkout and the portal', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_ropay_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.readOnly(tenant.organizationId, { readOnly: true });
      });

      /*
       * The whole design in one assertion: a read-only tenant that cannot pay is
       * a read-only tenant for ever. These two are the only writes it may make.
       */
      for (const path of ['/subscription/checkout', '/subscription/portal']) {
        assert.equal(
          await resolveTenant(club, tenant.organizationId, 'POST', path),
          'passed',
          `${path} is the way back and must stay open`,
        );
      }

      // And the allowlist is a prefix match, not a substring one: a route that
      // merely mentions the word is not on it.
      await assert.rejects(
        () => resolveTenant(club, tenant.organizationId, 'POST', '/students/subscription/checkout'),
        (error: ReadOnlyRefusal) => error.response?.code === 'tenant_read_only',
      );
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('61.6 — lifting read-only restores writing and cancels the deletion', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_rolift_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.readOnly(tenant.organizationId, {
          readOnly: true,
          dataKeptUntil: '2026-12-31',
        });
      });
      await assert.rejects(() =>
        resolveTenant(club, tenant.organizationId, 'POST', '/students'),
      );

      await asOperator(clerkUserId, async () => {
        await controller.readOnly(tenant.organizationId, { readOnly: false });
      });

      assert.equal(
        await resolveTenant(club, tenant.organizationId, 'POST', '/students'),
        'passed',
        'one status change and the club writes again — nothing was ever moved',
      );

      const org = await organization(tenant);
      assert.equal(org['read_only_at'], null);
      assert.equal(
        org['pending_delete_at'],
        null,
        'the deletion goes with it — a club writing normally with one scheduled is the worst state',
      );
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('61.7 — suspension beats read-only, and the refusal says which', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_roboth_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);
    const club = await ownerClerkId(tenant);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.readOnly(tenant.organizationId, { readOnly: true });
        await controller.suspension(tenant.organizationId, {
          suspended: true,
          reason: 'Fatura por regularizar.',
        });
      });

      /*
       * A club that is both is a club we have closed. Telling it "your trial ran
       * out, pay here" would be the wrong sentence and the wrong call to action —
       * so the precedence is a rule, not an accident of ordering, and it holds
       * for a *read* as well, which read-only would have let through.
       */
      await assert.rejects(
        () => resolveTenant(club, tenant.organizationId, 'GET', '/students'),
        (error: ReadOnlyRefusal) => {
          assert.equal(error.response?.code, 'tenant_suspended');
          return true;
        },
      );
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('61.1 — a trial is fifteen days, from one definition', async () => {
  const { rows } = await owner.query<{ days: number; matches: boolean }>(
    `SELECT extract(day FROM trial_period())::int AS days,
            (trial_period() = interval '15 days') AS matches`,
  );
  assert.equal(rows[0]?.days, 15);
  assert.ok(rows[0]?.matches);

  // And provisioning asks rather than knowing: the literal is gone from it.
  const { rows: source } = await owner.query<{ body: string }>(
    `SELECT prosrc AS body FROM pg_proc WHERE proname = 'provision_organization'`,
  );
  for (const fn of source) {
    assert.ok(
      !fn.body.includes("interval '14 days'"),
      'a provisioning function still holds its own trial length',
    );
    assert.ok(fn.body.includes('trial_period()'), 'provisioning should call the definition');
  }
});

test('61.2 — the operator moves both columns, and the change is on the trail', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_roaudit_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        const result = await controller.readOnly(tenant.organizationId, {
          readOnly: true,
          dataKeptUntil: '2026-12-31',
        });
        // Only what actually moved, before and after — the platform contract.
        assert.ok('read_only_at' in result.changed);
        assert.ok('pending_delete_at' in result.changed);
      });

      /*
       * Through `changeTenant`, so it is audited by construction. A non-GET
       * platform endpoint that bypassed that helper would not be audited at all,
       * which is the standing rule this endpoint had to be written against.
       */
      const { rows } = await owner.query<{ action: string }>(
        `SELECT action FROM platform_audit_log
          WHERE organization_id = $1 AND action = 'tenant.read_only'`,
        [tenant.organizationId],
      );
      assert.equal(rows.length, 1);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('61 — a date that is not a date is refused rather than read as "no deletion"', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_robad_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        // The difference between a club with thirty days and a club with none.
        for (const bad of ['31-12-2026', '2026-13-45', 'soon']) {
          await assert.rejects(
            () => controller.readOnly(tenant.organizationId, { readOnly: true, dataKeptUntil: bad }),
            (error: { status?: number }) => error.status === 400,
            `${bad} should be refused`,
          );
        }
      });
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

// ---------------------------------------------------------------------------
// Paid outside Stripe — POOLSE-63
// ---------------------------------------------------------------------------

/** A `YYYY-MM-DD` day, n days from today. Days are days — never instants. */
function day(offset: number): string {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return at.toISOString().slice(0, 10);
}

async function payments(tenant: ScratchTenant): Promise<Record<string, unknown>[]> {
  const { rows } = await owner.query<Record<string, unknown>>(
    `SELECT amount_cents, currency, provenance::text AS provenance,
            method::text AS method, received_on::text AS received_on,
            covers_from::text AS covers_from, covers_to::text AS covers_to,
            note, recorded_by_clerk_user_id
       FROM manual_payment WHERE organization_id = $1 ORDER BY created_at`,
    [tenant.organizationId],
  );
  return rows;
}

/**
 * Recording a payment is the one thing that moves `paid_through`.
 *
 * And it moves everything the money means with it, in one transaction: the mode
 * becomes `manual`, the status `active`, the read-only lifts. A club that pays
 * Rui in cash on a Friday is writing again on the Friday.
 */
test('63 — a recorded payment moves the cover, the mode and the door together', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_pay_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      // A club the clock has already restricted: cover ran out, grace ran out.
      await owner.query(
        `UPDATE organization
            SET billing_mode = 'manual', subscription_status = 'past_due',
                paid_through = $2::date, read_only_at = now()
          WHERE id = $1`,
        [tenant.organizationId, day(-40)],
      );

      await asOperator(clerkUserId, async () => {
        const result = await controller.recordPayment(tenant.organizationId, {
          amountCents: 12_000,
          receivedOn: day(0),
          method: 'bank_transfer',
          coversFrom: day(0),
          coversTo: day(30),
          note: 'Transferência — trimestre',
        });

        assert.equal(result.changed['subscription_status']!.after, 'active');
        assert.equal(result.changed['paid_through']!.after, day(30));
        assert.equal(result.changed['read_only_at']!.after, null);
      });

      const org = await organization(tenant);
      assert.equal(org['billing_mode'], 'manual');
      assert.equal(org['subscription_status'], 'active');
      assert.equal(org['paid_through'], day(30));
      assert.equal(org['read_only_at'], null);
      assert.equal(org['pending_delete_at'], null);

      const [recorded] = await payments(tenant);
      assert.equal(recorded!['amount_cents'], 12_000);
      assert.equal(recorded!['currency'], 'EUR');
      // Money that arrived is `actual` by definition — docs/financials.md §2.
      assert.equal(recorded!['provenance'], 'actual');
      assert.equal(recorded!['method'], 'bank_transfer');
      assert.equal(recorded!['covers_to'], day(30));
      assert.equal(recorded!['recorded_by_clerk_user_id'], clerkUserId);

      /*
       * Audited by construction, through the same helper every other platform
       * write goes through — and the figure is in the trail rather than in a
       * path, a query string or a log line.
       */
      const entries = await trail(clerkUserId);
      const entry = entries.find((row) => row.action === 'tenant.payment.recorded');
      assert.ok(entry, 'the payment should be in platform_audit_log');
      assert.equal((entry.detail as { amountCents?: number }).amountCents, 12_000);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

/**
 * A payment recorded out of order extends cover and never shortens it.
 *
 * The realistic way in: the treasurer pays for the year in January, then hands
 * over a receipt in March for a month that is already covered. Taking the later
 * figure would quietly move a club's cover backwards by nine months.
 */
test('63 — an out-of-order payment cannot shorten what is already paid for', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_order_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.recordPayment(tenant.organizationId, {
          amountCents: 100_000,
          receivedOn: day(-60),
          method: 'bank_transfer',
          coversTo: day(300),
        });

        await controller.recordPayment(tenant.organizationId, {
          amountCents: 12_000,
          receivedOn: day(0),
          method: 'cash',
          coversTo: day(30),
        });
      });

      assert.equal((await organization(tenant))['paid_through'], day(300));
      assert.equal((await payments(tenant)).length, 2);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

/**
 * The constraint said as a sentence.
 *
 * The CHECK is what makes an open-ended manual subscription impossible; this is
 * what makes it a message beside the field instead of a constraint name in a 500.
 */
test('63 — a club cannot be marked manual and active with nothing paid', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_mode_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await owner.query(
        `UPDATE organization SET subscription_status = 'active' WHERE id = $1`,
        [tenant.organizationId],
      );

      await asOperator(clerkUserId, async () => {
        await assert.rejects(
          () => controller.billingMode(tenant.organizationId, { billingMode: 'manual' }),
          (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
            error.status === 400 &&
            error.response?.fields?.['billingMode'] === 'admin.error.manualNeedsPayment',
        );

        // And the refusal rolled the whole thing back: still on Stripe.
        await assert.rejects(
          () => controller.billingMode(tenant.organizationId, { billingMode: 'monthly' }),
          (error: { status?: number }) => error.status === 400,
        );
      });

      assert.equal((await organization(tenant))['billing_mode'], 'stripe');
      assert.equal((await payments(tenant)).length, 0);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

/** Every refusal names its field, so the message lands beside the box. */
test('63 — a payment that is not one is refused, field by field', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_bad_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    const base = {
      amountCents: 5_000,
      receivedOn: day(0),
      method: 'cash',
      coversTo: day(30),
    };

    try {
      await asOperator(clerkUserId, async () => {
        const cases: [Record<string, unknown>, string][] = [
          [{ amountCents: 0 }, 'amountCents'],
          [{ amountCents: -1 }, 'amountCents'],
          [{ amountCents: 12.5 }, 'amountCents'],
          [{ method: 'bitcoin' }, 'method'],
          // dd-MM-yyyy is what Poolse *shows*; what it accepts is a day.
          [{ receivedOn: '31-12-2026' }, 'receivedOn'],
          [{ coversTo: 'soon' }, 'coversTo'],
          [{ coversFrom: day(60) }, 'coversFrom'],
          [{ receivedOn: day(800) }, 'receivedOn'],
        ];

        for (const [override, field] of cases) {
          await assert.rejects(
            () => controller.recordPayment(tenant.organizationId, { ...base, ...override }),
            (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
              error.status === 400 && error.response?.fields?.[field] !== undefined,
            `${JSON.stringify(override)} should be refused, naming ${field}`,
          );
        }
      });

      // Nothing was written by any of them.
      assert.equal((await payments(tenant)).length, 0);
      assert.equal((await organization(tenant))['paid_through'], null);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

/**
 * The renewals list, which is the screen that stops a manual club being
 * forgotten — and the billing figures beside it, which are counts and one real
 * sum rather than a number this product guessed.
 */
test('63 — renewals due inside the window, and never a Stripe figure', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_renew_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        await controller.recordPayment(tenant.organizationId, {
          amountCents: 7_500,
          receivedOn: day(0),
          method: 'cash',
          coversTo: day(20),
        });

        const near = await controller.billing();
        assert.ok(near.tenantsByMode.manual >= 1);
        assert.ok(near.manualCentsAllTime >= 7_500);
        assert.equal(near.renewalsWindowDays, 30);

        const due = near.renewals.find((row) => row.organizationId === tenant.organizationId);
        assert.ok(due, 'a club whose cover ends in 20 days is due');
        assert.equal(due.paidThrough, day(20));
        assert.equal(due.daysLeft, 20);

        // Forty days out is not this month's problem.
        await controller.recordPayment(tenant.organizationId, {
          amountCents: 7_500,
          receivedOn: day(0),
          method: 'cash',
          coversTo: day(40),
        });

        const far = await controller.billing();
        assert.equal(
          far.renewals.find((row) => row.organizationId === tenant.organizationId),
          undefined,
        );
      });
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

/** What a club actually paid, on its own page. */
test('63 — a club that has never paid in cash has an empty history, not a 404', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_hist_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        const empty = await controller.payments(tenant.organizationId);
        assert.equal(empty.items.length, 0);

        await controller.recordPayment(tenant.organizationId, {
          amountCents: 4_250,
          receivedOn: day(-1),
          method: 'other',
          coversTo: day(29),
          note: 'Acerto de contas',
        });

        const listed = await controller.payments(tenant.organizationId);
        assert.equal(listed.items.length, 1);
        assert.equal(listed.items[0]!.amountCents, 4_250);
        assert.equal(listed.items[0]!.receivedOn, day(-1));
        assert.equal(listed.items[0]!.note, 'Acerto de contas');
      });
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

/**
 * *Conceder novo período* — POOLSE-62, and the reason the block is allowed to be
 * hard.
 *
 * One trial per address has no appeal inside the product: a club that genuinely
 * left and came back is refused by exactly the same index as somebody on their
 * fourth free fortnight, and only a person can tell those apart. So the override
 * has to cost one click, and it has to be on the action that already exists —
 * two controls would let an operator free the address and leave the club on a
 * trial that ran out in March.
 */
test('62.7 — granting a fresh trial frees the address, and says so on the trail', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_fresh_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      // The harness provisions through `provision_organization`, so this tenant
      // has a real claim — the same one a signup writes.
      const before = await owner.query<{ n: string }>(
        `SELECT count(*) AS n FROM trial_claim
          WHERE organization_id = $1 AND released_at IS NULL`,
        [tenant.organizationId],
      );
      assert.equal(Number(before.rows[0]!.n), 1, 'the scratch tenant claimed its address');

      const endsAt = new Date(Date.now() + 15 * 86_400_000).toISOString();

      await asOperator(clerkUserId, async () => {
        // A plain date change leaves the ledger alone: freeing an address is
        // never what "correct this date" means.
        await controller.trial(tenant.organizationId, { endsAt });
      });

      const untouched = await owner.query<{ n: string }>(
        `SELECT count(*) AS n FROM trial_claim
          WHERE organization_id = $1 AND released_at IS NULL`,
        [tenant.organizationId],
      );
      assert.equal(Number(untouched.rows[0]!.n), 1, 'a date change is not a release');

      await asOperator(clerkUserId, async () => {
        await controller.trial(tenant.organizationId, { endsAt, releaseClaim: true });
      });

      const after = await owner.query<{
        released_by_clerk_user_id: string | null;
        released_at: Date | null;
      }>(
        `SELECT released_by_clerk_user_id, released_at FROM trial_claim
          WHERE organization_id = $1`,
        [tenant.organizationId],
      );
      assert.ok(after.rows[0]?.released_at, 'the claim was released');
      // A release is a row and never a deletion: who did it survives.
      assert.equal(after.rows[0]?.released_by_clerk_user_id, clerkUserId);

      /*
       * And the address is genuinely free — the unique index is partial on
       * `released_at`, which is the whole mechanism. Proved by claiming it
       * again rather than by reading the index definition.
       */
      const { rows: claimed } = await owner.query<{ normalized_email: string }>(
        `SELECT normalized_email FROM trial_claim WHERE organization_id = $1`,
        [tenant.organizationId],
      );
      await owner.query(
        `INSERT INTO trial_claim (organization_id, normalized_email, email_domain)
         VALUES ($1, $2, 'example.test')`,
        [tenant.organizationId, claimed[0]!.normalized_email],
      );

      // Both halves on one entry, because they were one decision.
      const entries = await trail(clerkUserId);
      const granted = entries.filter((row) => row.action === 'tenant.trial.set');
      assert.equal(granted.length, 2);
      const detail = granted[1]!.detail as { claimsReleased?: number };
      assert.equal(detail.claimsReleased, 1);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});
