import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import pg from 'pg';
import { POOLSE_SPORTS } from '@poolse/rules';
import { authStorage } from '../auth/auth.context.js';
import { SubscriptionController } from '../billing/subscription.controller.js';
import { listMemberships } from '../identity/identity.repository.js';
import { PlatformController } from '../platform/platform.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { FacilitiesController } from './facilities.controller.js';

/**
 * Sports as paid modules — POOLSE-124, against the real database.
 *
 * A club is a pool club until Rui switches another sport on from /admin. The
 * schema half (who may write the switch, the pool always on, the refusals) is
 * `packages/db/test/sport-modules.sql`; this is the API: the 403 a court gets
 * for a sport that is off, the 409 that names the courts in the way, the audit,
 * `/me.sports` and the add-on lines on the subscription read.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const platform = new PlatformController();

after(async () => {
  await owner.end();
  await closeHarness();
});

async function ownerClerkId(tenant: ScratchTenant): Promise<string> {
  const { rows } = await owner.query<{ clerk_user_id: string }>(
    `SELECT u.clerk_user_id FROM app_user u JOIN membership m ON m.app_user_id = u.id
      WHERE m.id = $1`,
    [tenant.ownerMembershipId],
  );
  return rows[0]!.clerk_user_id;
}

/** An operator, for the length of `fn`, removed afterwards with their trail. */
async function asOperator<T>(fn: (clerkUserId: string) => Promise<T>): Promise<T> {
  const clerkUserId = `user_sports_op_${Math.floor(performance.now())}`;
  await owner.query(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'sports test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
  try {
    return await authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, () => fn(clerkUserId));
  } finally {
    await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
    await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
    await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
  }
}

test('the sport table spells exactly POOLSE_SPORTS, in order', async () => {
  const { rows } = await owner.query<{ id: string }>('SELECT id FROM sport ORDER BY position, id');
  assert.deepEqual(rows.map((row) => row.id), [...POOLSE_SPORTS]);
});

test('a pool club: /me says {pool}, a court is a 403, and the subscription has no add-on', async () => {
  await withScratchTenant(async (tenant) => {
    const [membership] = await listMemberships(await ownerClerkId(tenant));
    assert.deepEqual(membership!.sports, ['pool']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await assert.rejects(
        () => new FacilitiesController().addPlayingArea(tenant.facilityId, { sportId: 'tennis', name: 'Campo 1' }),
        (error: unknown) =>
          error instanceof ForbiddenException &&
          (error.getResponse() as { code: string; sport: string }).code === 'sport_not_enabled' &&
          (error.getResponse() as { sport: string }).sport === 'tennis',
      );
      // A pool is added as a pool, never through this door.
      await expectStatus(
        () => new FacilitiesController().addPlayingArea(tenant.facilityId, { sportId: 'pool', name: 'P' }),
        400,
      );
      const view = await new SubscriptionController().read();
      assert.deepEqual(view.addons, []);
    });
  });
});

test('switched on from /admin: the court is made, /me and the add-on line follow, and the trail has both lists', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(async (clerkUserId) => {
      const result = await platform.sports(tenant.organizationId, { enabled: ['tennis', 'pool'] });
      assert.deepEqual(result.changed['enabled_sports'], { before: ['pool'], after: ['pool', 'tennis'] });

      const { rows } = await owner.query<{ action: string; detail: { changed: Record<string, unknown> } }>(
        `SELECT action, detail FROM platform_audit_log
          WHERE clerk_user_id = $1 AND organization_id = $2`,
        [clerkUserId, tenant.organizationId],
      );
      assert.deepEqual(
        rows.map((row) => [row.action, row.detail.changed['enabled_sports']]),
        [['tenant.sports.set', { before: ['pool'], after: ['pool', 'tennis'] }]],
      );
      const { rows: alerts } = await owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform_alert WHERE clerk_user_id = $1 AND action = 'tenant.sports.set'`,
        [clerkUserId],
      );
      assert.equal(alerts[0]!.n, 1);
    });

    const [membership] = await listMemberships(await ownerClerkId(tenant));
    assert.deepEqual(membership!.sports, ['pool', 'tennis']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new FacilitiesController().addPlayingArea(tenant.facilityId, {
        sportId: 'tennis',
        name: 'Campo Central',
      });
      const site = await new FacilitiesController().one(tenant.facilityId);
      const court = site.playingAreas.find((area) => area.id === id);
      assert.equal(court?.sportId, 'tennis');
      assert.equal(court?.poolId, null);

      const view = await new SubscriptionController().read();
      assert.deepEqual(view.addons, [{ sport: 'tennis', monthlyCents: null, currency: 'EUR' }]);
    });

    // The /admin block counts it.
    await asOperator(async () => {
      const row = await platform.tenant(tenant.organizationId);
      const tennis = row.sports.find((sport) => sport.sport === 'tennis');
      assert.deepEqual(tennis, { sport: 'tennis', enabled: true, recintos: 1, addonMonthlyCents: null });
      assert.equal(row.sports.find((sport) => sport.sport === 'padel')?.enabled, false);
    });
  });
});

test('a sport with a live court stays on, and the refusal names the court', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(() => platform.sports(tenant.organizationId, { enabled: ['pool', 'padel'] }));
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new FacilitiesController().addPlayingArea(tenant.facilityId, { sportId: 'padel', name: 'Padel 1' }),
    );

    await asOperator(async () => {
      await assert.rejects(
        () => platform.sports(tenant.organizationId, { enabled: ['pool'] }),
        (error: unknown) => {
          if (!(error instanceof ConflictException)) return false;
          const body = error.getResponse() as { code: string; sport: string; recintos: string[] };
          return body.code === 'sport_in_use' && body.sport === 'padel' && body.recintos.join() === 'Padel 1';
        },
      );
      // The pool cannot leave, and an unknown sport is not a sport.
      await expectStatus(() => platform.sports(tenant.organizationId, { enabled: ['padel'] }), 400);
      await expectStatus(() => platform.sports(tenant.organizationId, { enabled: ['pool', 'curling'] }), 400);
    });
  });
});

test('only the owner and admin add a court, and never on another club\'s site', async () => {
  await withScratchTenant(async (other) => {
    await withScratchTenant(async (tenant) => {
      await asOperator(() => platform.sports(tenant.organizationId, { enabled: ['pool', 'gym'] }));
      await actingAs(tenant, { roles: ['instructor'] }, async () => {
        await expectStatus(
          () => new FacilitiesController().addPlayingArea(tenant.facilityId, { sportId: 'gym', name: 'Ginásio' }),
          403,
        );
      });
      await actingAs(tenant, { roles: ['admin'] }, async () => {
        await expectStatus(
          () => new FacilitiesController().addPlayingArea(other.facilityId, { sportId: 'gym', name: 'Ginásio' }),
          404,
        );
      });
    });
  });
});

test('a court can be archived, and then — or with its site archived — its sport can be switched off', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(() => platform.sports(tenant.organizationId, { enabled: ['pool', 'tennis', 'padel'] }));
    const ids = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const facilities = new FacilitiesController();
      const tennis = await facilities.addPlayingArea(tenant.facilityId, { sportId: 'tennis', name: 'Ténis 1' });
      const padel = await facilities.addPlayingArea(tenant.facilityId, { sportId: 'padel', name: 'Padel 1' });
      // A pool is archived as a pool, never here.
      const site = await facilities.one(tenant.facilityId);
      const poolArea = site.playingAreas.find((area) => area.sportId === 'pool');
      if (poolArea) await expectStatus(() => facilities.archivePlayingArea(poolArea.id), 404);
      await facilities.archivePlayingArea(tennis.id);
      return { padel: padel.id };
    });
    await asOperator(async () => {
      await platform.sports(tenant.organizationId, { enabled: ['pool', 'padel'] });
    });

    // Padel's court is live, but its site is archived: not in use.
    await tenant.sql('UPDATE facility SET archived_at = now() WHERE id = $1', [tenant.facilityId]);
    await asOperator(async () => {
      const row = await platform.tenant(tenant.organizationId);
      assert.equal(row.sports.find((s) => s.sport === 'padel')?.recintos, 0);
      await platform.sports(tenant.organizationId, { enabled: ['pool'] });
    });
    assert.ok(ids.padel);
  });
});

test('another club cannot archive a court', async () => {
  await withScratchTenant(async (other) => {
    await asOperator(() => platform.sports(other.organizationId, { enabled: ['pool', 'gym'] }));
    const { id } = await actingAs(other, { roles: ['owner'] }, () =>
      new FacilitiesController().addPlayingArea(other.facilityId, { sportId: 'gym', name: 'Ginásio' }),
    );
    await withScratchTenant(async (tenant) => {
      await actingAs(tenant, { roles: ['admin'] }, async () => {
        await expectStatus(() => new FacilitiesController().archivePlayingArea(id), 404);
      });
    });
  });
});
