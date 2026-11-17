import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { ExecutionContext } from '@nestjs/common';
import { authStorage } from '../auth/auth.context.js';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';

/**
 * The tenants list says each club's access state, and filters by it — POOLSE-226.
 *
 * One scratch club moved through the states by the owner connection, and the
 * list read through the real controller, narrowed to that club by its name: the
 * list is every tenant, and another test's club must neither help nor hurt.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const controller = new PlatformController();
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });

after(async () => {
  await owner.end();
  await closeHarness();
});

async function nameOf(tenant: ScratchTenant): Promise<string> {
  const { rows } = await owner.query<{ name: string }>('SELECT name FROM organization WHERE id = $1', [
    tenant.organizationId,
  ]);
  return rows[0]!.name;
}

/** Set the door columns outright; anything not named is cleared. */
async function setDoor(
  tenant: ScratchTenant,
  door: { suspended?: boolean; readOnly?: boolean; archived?: boolean; pendingDelete?: boolean; trialing?: boolean },
): Promise<void> {
  await owner.query(
    `UPDATE organization
        SET suspended_at       = CASE WHEN $2 THEN now() - interval '3 days' END,
            suspension_reason  = CASE WHEN $2 THEN 'Falta de pagamento desde março' END,
            read_only_at       = CASE WHEN $3 THEN now() - interval '5 days' END,
            archived_at        = CASE WHEN $4 THEN now() END,
            pending_delete_at  = CASE WHEN $5 THEN now() + interval '20 days' END,
            subscription_status = CASE WHEN $6 THEN 'trialing' ELSE 'active' END::subscription_status
      WHERE id = $1`,
    [
      tenant.organizationId,
      door.suspended === true,
      door.readOnly === true,
      door.archived === true,
      door.pendingDelete === true,
      door.trialing === true,
    ],
  );
}

/** Is the club on the list with these parameters, and in which state. */
async function listed(
  tenant: ScratchTenant,
  name: string,
  params: { filter?: string; access?: string } = {},
): Promise<string | null> {
  const page = await controller.tenants(undefined, '100', name, params.filter, params.access);
  return page.items.find((item) => item.id === tenant.organizationId)?.accessState ?? null;
}

test('226 — every row carries its access state, archived over suspended over read-only over open', async () => {
  await withScratchTenant(async (tenant) => {
    const name = await nameOf(tenant);
    try {
      await setDoor(tenant, {});
      assert.equal(await listed(tenant, name), 'active');

      await setDoor(tenant, { readOnly: true });
      assert.equal(await listed(tenant, name), 'read_only');

      await setDoor(tenant, { suspended: true });
      assert.equal(await listed(tenant, name), 'suspended');

      await setDoor(tenant, { suspended: true, readOnly: true });
      assert.equal(await listed(tenant, name), 'suspended', 'suspension beats read-only (14-09-2026)');

      await setDoor(tenant, { suspended: true, archived: true });
      assert.equal(await listed(tenant, name), 'archived', 'an archive beats a suspension');

      // The dates the cell quotes travel with it.
      await setDoor(tenant, { suspended: true });
      const page = await controller.tenants(undefined, '100', name);
      const row = page.items.find((item) => item.id === tenant.organizationId)!;
      assert.ok(row.suspendedAt);
      assert.equal(row.suspensionReason, 'Falta de pagamento desde março');
    } finally {
      await setDoor(tenant, {});
    }
  });
});

test('226 — the access filter keeps only the state asked for', async () => {
  await withScratchTenant(async (tenant) => {
    const name = await nameOf(tenant);
    try {
      await setDoor(tenant, { suspended: true });
      assert.equal(await listed(tenant, name, { access: 'suspended' }), 'suspended');
      assert.equal(await listed(tenant, name, { access: 'read_only' }), null);
      assert.equal(await listed(tenant, name, { access: 'active' }), null);

      await setDoor(tenant, {});
      assert.equal(await listed(tenant, name, { access: 'active' }), 'active');
      assert.equal(await listed(tenant, name, { access: 'suspended' }), null);

      await setDoor(tenant, { archived: true });
      assert.equal(await listed(tenant, name, { access: 'archived' }), 'archived');
    } finally {
      await setDoor(tenant, {});
    }
  });
});

test('226 — Dados a apagar matches a deletion date in any state, and the old link still works', async () => {
  await withScratchTenant(async (tenant) => {
    const name = await nameOf(tenant);
    try {
      await setDoor(tenant, { readOnly: true, pendingDelete: true });
      assert.equal(await listed(tenant, name, { access: 'pending_delete' }), 'read_only');
      assert.equal(await listed(tenant, name, { access: 'read_only' }), 'read_only');
      assert.equal(await listed(tenant, name, { filter: 'pending_delete' }), 'read_only', 'a saved link keeps working');

      await setDoor(tenant, { readOnly: true });
      assert.equal(await listed(tenant, name, { access: 'pending_delete' }), null);
      assert.equal(await listed(tenant, name, { filter: 'pending_delete' }), null);
    } finally {
      await setDoor(tenant, {});
    }
  });
});

test('226 — an unknown access value filters nothing, and the two filters combine', async () => {
  await withScratchTenant(async (tenant) => {
    const name = await nameOf(tenant);
    try {
      await setDoor(tenant, { suspended: true, trialing: true });
      assert.equal(await listed(tenant, name, { access: 'nonsense' }), 'suspended');
      assert.equal(await listed(tenant, name, { access: "suspended' OR '1'='1" }), 'suspended', 'never reaches SQL');

      assert.equal(await listed(tenant, name, { filter: 'trialing', access: 'suspended' }), 'suspended');
      assert.equal(await listed(tenant, name, { filter: 'expired', access: 'suspended' }), null);
      assert.equal(await listed(tenant, name, { filter: 'trialing', access: 'active' }), null);
    } finally {
      await setDoor(tenant, {});
    }
  });
});

test('226 — a club Owner without the platform flag is refused the filtered list', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_owner226_${tenant.organizationId.slice(0, 8)}`;
    const path = '/platform/tenants?access=suspended';
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          path,
          originalUrl: path,
          params: {},
          query: { access: 'suspended' },
          route: { path: '/platform/tenants' },
        }),
      }),
      getHandler: () => (): null => null,
      getClass: () => PlatformController,
    } as unknown as ExecutionContext;

    try {
      await authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, async () => {
        await assert.rejects(
          () => new PlatformAdminGuard().canActivate(context),
          (error: { status?: number; response?: { code?: string } }) =>
            error.status === 403 && error.response?.code === 'not_platform_admin',
        );
      });
    } finally {
      await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
      await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
    }
  });
});
