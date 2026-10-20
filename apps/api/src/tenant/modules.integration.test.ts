import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import pg from 'pg';
import {
  enabledModules,
  moduleDependencyBreaches,
  POOLSE_MODULES,
  type PoolseModule,
} from '@poolse/rules';
import { authStorage } from '../auth/auth.context.js';
import { EnergyController } from '../energy/energy.controller.js';
import { FacilitiesController } from '../facilities/facilities.controller.js';
import { PoolPublicLinkController, PublicWaterController } from '../facilities/public-link.controller.js';
import { listMemberships } from '../identity/identity.repository.js';
import { PlatformController } from '../platform/platform.controller.js';
import { StudentsController } from '../students/students.controller.js';
import { DashboardController } from '../dashboard/dashboard.controller.js';
import { QualificationsController } from '../staff/qualifications.controller.js';
import { raiseQualificationAlerts } from '../staff/qualification-alerts.js';
import {
  actingAs,
  addMember,
  closeHarness,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { ModuleGuard } from './modules.js';
import { TenantMiddleware } from './tenant.middleware.js';

/**
 * Modules per club — POOLSE-87 slice 1, against the real database.
 *
 * The guard is driven the way a request drives it: the real `TenantMiddleware`
 * resolves the membership through `resolve_memberships`, and the guard reads the
 * real controllers' metadata inside the context it installed. Only Express is
 * missing.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const middleware = new TenantMiddleware();
const guard = new ModuleGuard(new Reflector());
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
  const clerkUserId = `user_modules_op_${Math.floor(performance.now())}`;
  await owner.query(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'modules test')
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

function contextFor(controller: Type, handler: string): ExecutionContext {
  return {
    getHandler: () => (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

/**
 * What the guard answers for `controller.handler`, as this club's owner would
 * reach it: `'passed'` or the refusal's body.
 */
async function reach(
  tenant: ScratchTenant,
  controller: Type,
  handler: string,
  method = 'GET',
): Promise<unknown> {
  const clerkUserId = await ownerClerkId(tenant);
  return authStorage.run({ clerkUserId, sessionId: 'sess' }, () =>
    new Promise<unknown>((resolve, reject) => {
      const request = {
        method,
        path: '/',
        header: (name: string) => (name === 'x-poolse-organization' ? tenant.organizationId : undefined),
      } as never;
      middleware
        .use(request, {} as never, () => {
          try {
            guard.canActivate(contextFor(controller, handler));
            resolve('passed');
          } catch (error) {
            resolve((error as { response?: unknown }).response);
          }
        })
        .catch(reject);
    }),
  );
}

async function disabledOf(tenant: ScratchTenant): Promise<string[]> {
  const { rows } = await owner.query<{ disabled: string[] }>(
    'SELECT disabled_modules::text[] AS disabled FROM organization WHERE id = $1',
    [tenant.organizationId],
  );
  return rows[0]!.disabled;
}

test('the SQL enum spells exactly POOLSE_MODULES, in order', async () => {
  const { rows } = await owner.query<{ values: string[] }>(
    'SELECT enum_range(NULL::poolse_module)::text[] AS values',
  );
  assert.deepEqual(rows[0]!.values, [...POOLSE_MODULES]);
});

test('the CHECK and moduleDependencyBreaches agree over every pair', async () => {
  const sets: PoolseModule[][] = [[]];
  for (const a of POOLSE_MODULES) {
    sets.push([a]);
    for (const b of POOLSE_MODULES) if (a < b) sets.push([a, b]);
  }
  const { rows } = await owner.query<{ ok: boolean[] }>(
    'SELECT array_agg(modules_consistent(s::poolse_module[]) ORDER BY i) AS ok FROM unnest($1::text[]) WITH ORDINALITY AS t(s, i)',
    [sets.map((set) => `{${set.join(',')}}`)],
  );
  sets.forEach((set, i) => {
    assert.equal(rows[0]!.ok[i], moduleDependencyBreaches(set).length === 0, set.join(','));
  });
});

test('QA 1: a new club has nothing switched off, and the membership says so', async () => {
  await withScratchTenant(async (tenant) => {
    assert.deepEqual(await disabledOf(tenant), []);
    const memberships = await listMemberships(await ownerClerkId(tenant));
    const mine = memberships.find((m) => m.organizationId === tenant.organizationId)!;
    assert.deepEqual(mine.disabledModules, []);
    assert.deepEqual(enabledModules(mine.disabledModules), [...POOLSE_MODULES]);
  });
});

test('QA 2: energy off refuses every energy route, reads included, and nothing else', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(() => platform.modules(tenant.organizationId, { disabled: ['energy'] }));

    const refusal = { code: 'module_disabled', module: 'energy', message: 'This module is not active for this organization' };
    assert.deepEqual(await reach(tenant, EnergyController, 'list'), refusal);
    assert.deepEqual(await reach(tenant, EnergyController, 'create', 'POST'), refusal);
    assert.equal(await reach(tenant, StudentsController, 'list'), 'passed');
    // A core controller's water route belongs to water quality, which is on.
    assert.equal(await reach(tenant, FacilitiesController, 'recordAnalysis', 'POST'), 'passed');
  });
});

test('QA 2: water quality off refuses the water routes inside a core controller, and not the rest of it', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(() => platform.modules(tenant.organizationId, { disabled: ['water_quality'] }));

    const refused = await reach(tenant, FacilitiesController, 'recordAnalysis', 'POST');
    assert.equal((refused as { module?: string }).module, 'water_quality');
    assert.equal(await reach(tenant, FacilitiesController, 'list'), 'passed');
  });
});

test('QA 3: water quality off makes the public water page the same miss as an unknown token', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      'INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id',
      [tenant.organizationId, tenant.facilityId, 'Piscina'],
    );
    const token = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const link = await new PoolPublicLinkController().issue(pool!.id, { replace: false });
      return link.token!;
    });
    const page = new PublicWaterController();
    assert.ok(await page.page(token));

    await asOperator(() => platform.modules(tenant.organizationId, { disabled: ['water_quality'] }));
    const off = await page.page(token).then(() => null, (error: { status?: number }) => error.status);
    const unknown = await page.page('x'.repeat(40)).then(() => null, (error: { status?: number }) => error.status);
    assert.equal(off, 404);
    assert.equal(off, unknown);

    await asOperator(() => platform.modules(tenant.organizationId, { disabled: [] }));
    assert.ok(await page.page(token));
  });
});

test('QA 6: invoicing off while reception is on is a 409 naming both, and nothing changes', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(async () => {
      await assert.rejects(
        () => platform.modules(tenant.organizationId, { disabled: ['invoicing'] }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          assert.deepEqual(error.getResponse(), {
            code: 'module_dependency',
            module: 'reception',
            requires: 'invoicing',
          });
          return true;
        },
      );
    });
    assert.deepEqual(await disabledOf(tenant), []);

    // Both off is fine, and lands in list order whatever order it was sent in.
    await asOperator(() => platform.modules(tenant.organizationId, { disabled: ['reception', 'invoicing'] }));
    assert.deepEqual(await disabledOf(tenant), ['reception', 'invoicing']);
  });
});

test('a module name nobody knows is refused, not dropped', async () => {
  await withScratchTenant(async (tenant) => {
    await asOperator(async () => {
      await assert.rejects(
        () => platform.modules(tenant.organizationId, { disabled: ['energy', 'enegry'] }),
        (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
          error.status === 400 && error.response?.fields?.['disabled'] === 'admin.error.moduleInvalid',
      );
      await assert.rejects(() => platform.modules(tenant.organizationId, { disabled: 'energy' }));
    });
    assert.deepEqual(await disabledOf(tenant), []);
  });
});

test('QA 10: off and back on leaves every row as it was, and the trail holds both changes', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      'INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id',
      [tenant.organizationId, tenant.facilityId, 'Piscina'],
    );
    await tenant.sql(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at, notes) VALUES ($1, $2, now(), 'antes')`,
      [tenant.organizationId, pool!.id],
    );
    const snapshot = async (): Promise<string> => {
      const { rows } = await owner.query<{ rows: unknown }>(
        `SELECT json_agg(a ORDER BY a.id) AS rows FROM pool_analysis a WHERE organization_id = $1`,
        [tenant.organizationId],
      );
      return JSON.stringify(rows[0]!.rows);
    };
    const before = await snapshot();

    await asOperator(async (clerkUserId) => {
      await platform.modules(tenant.organizationId, { disabled: ['water_quality', 'energy'] });
      assert.equal(await snapshot(), before);
      const back = await platform.modules(tenant.organizationId, { disabled: [] });
      assert.deepEqual(back.changed['disabled_modules'], {
        before: ['water_quality', 'energy'],
        after: [],
      });

      const { rows } = await owner.query<{ action: string; detail: { changed: Record<string, unknown> } }>(
        `SELECT action, detail FROM platform_audit_log
          WHERE clerk_user_id = $1 AND organization_id = $2 ORDER BY created_at`,
        [clerkUserId, tenant.organizationId],
      );
      assert.deepEqual(
        rows.map((row) => [row.action, row.detail.changed['disabled_modules']]),
        [
          ['tenant.modules.set', { before: [], after: ['water_quality', 'energy'] }],
          ['tenant.modules.set', { before: ['water_quality', 'energy'], after: [] }],
        ],
      );
      // And an alert for each, like every platform write.
      const { rows: alerts } = await owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform_alert
          WHERE clerk_user_id = $1 AND action = 'tenant.modules.set'`,
        [clerkUserId],
      );
      assert.equal(alerts[0]!.n, 2);
    });
    assert.equal(await snapshot(), before);
  });
});


// ---------------------------------------------------------------------------
// Slice 2 — what the club sees
// ---------------------------------------------------------------------------

/** Set the list directly as the owner login — the platform write is tested above. */
async function switchOff(tenant: ScratchTenant, modules: PoolseModule[]): Promise<void> {
  await owner.query('UPDATE organization SET disabled_modules = $2::poolse_module[] WHERE id = $1', [
    tenant.organizationId,
    modules,
  ]);
}

test('/me lists what is on, computed on the server', async () => {
  await withScratchTenant(async (tenant) => {
    await switchOff(tenant, ['energy', 'salaries']);
    const memberships = await listMemberships(await ownerClerkId(tenant));
    const mine = memberships.find((m) => m.organizationId === tenant.organizationId)!;
    assert.deepEqual(
      mine.modules,
      POOLSE_MODULES.filter((m) => m !== 'energy' && m !== 'salaries'),
    );
  });
});

test('QA 7: salaries off leaves no staff-cost card in the raw dashboard payload', async () => {
  await withScratchTenant(async (tenant) => {
    await switchOff(tenant, ['salaries']);
    const page = await actingAs(tenant, { roles: ['owner'] }, () => new DashboardController().read());
    assert.equal(JSON.stringify(page).includes('mgmt.staffcost'), false);
  });
});

test('QA 8: maintenance off leaves a maintenance person no maintenance cards, and water stays', async () => {
  await withScratchTenant(async (tenant) => {
    const joao = await addMember(tenant, 'João', 'Módulos', ['maintenance']);
    const read = (): Promise<unknown> =>
      actingAs(tenant, { membershipId: joao, roles: ['maintenance'] }, () => new DashboardController().read());

    const on = JSON.stringify(await read());
    assert.ok(on.includes('maint.requests'), 'the control: on, the band is there');

    await switchOff(tenant, ['maintenance']);
    const off = JSON.stringify(await read());
    for (const id of ['maint.mytasks', 'maint.requests', 'maint.cleanings.overdue', 'maint.inventory']) {
      assert.equal(off.includes(id), false, id);
    }
    assert.ok(off.includes('maint.waterquality.due'), 'water quality is its own module');
  });
});

test('QA 9: qualifications off writes no alert for the club', async () => {
  await withScratchTenant(async (tenant) => {
    const [type] = await tenant.sql<{ id: string }>(
      `SELECT id FROM qualification_type WHERE archived_at IS NULL ORDER BY name LIMIT 1`,
    );
    const person = await addMember(tenant, 'Marta', 'Módulos', ['instructor']);
    const [soon] = await tenant.sql<{ d: string }>(`SELECT to_char(club_today() + 5, 'YYYY-MM-DD') AS d`);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new QualificationsController().add(person, { typeId: type!.id, issuingBody: 'IPDJ', expiresOn: soon!.d }),
    );

    await switchOff(tenant, ['qualifications']);
    assert.equal(await raiseQualificationAlerts(tenant.organizationId), null);
    const rows = await tenant.sql('SELECT 1 FROM qualification_alert');
    assert.equal(rows.length, 0);

    // The control: switched back on, the same record alerts.
    await switchOff(tenant, []);
    assert.equal((await raiseQualificationAlerts(tenant.organizationId))?.raised.length, 1);
  });
});

test('the pool page carries no water log while water quality is off', async () => {
  await withScratchTenant(async (tenant) => {
    const [pool] = await tenant.sql<{ id: string }>(
      'INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id',
      [tenant.organizationId, tenant.facilityId, 'Piscina'],
    );
    await tenant.sql(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at) VALUES ($1, $2, now())`,
      [tenant.organizationId, pool!.id],
    );
    const read = () =>
      actingAs(tenant, { roles: ['owner'] }, () => new FacilitiesController().pool(pool!.id));

    const on = await read();
    assert.equal(on.waterQuality, true);
    assert.equal(on.analyses.length, 1);

    await switchOff(tenant, ['water_quality']);
    const off = await read();
    assert.equal(off.waterQuality, false);
    assert.deepEqual(off.analyses, []);
    assert.deepEqual(off.alerts, []);
    assert.equal(off.canRecordAnalysis, false);
    assert.equal(off.name, on.name, 'the pool itself is core');
  });
});
