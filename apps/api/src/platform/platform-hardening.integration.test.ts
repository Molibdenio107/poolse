import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { ExecutionContext } from '@nestjs/common';
import { authStorage } from '../auth/auth.context.js';
import { DEFAULT_LIMIT, PLATFORM_LIMIT } from '../common/throttle.js';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';

/**
 * Hardening `/admin` — POOLSE-64, slice E1.
 *
 * The ticket's own framing is the reason this file is separate from
 * `platform-actions.integration.test.ts`: that one asks whether an action does
 * what it says, and this one asks what stands between a stranger and the
 * actions. The realistic risk here was never somebody breaking the guard — it
 * is somebody **becoming Rui** — so what is asserted is the friction and the
 * noise: that an irreversible act asks for the club's name, that every write and
 * every refusal leaves a message behind it, and that the area carries a tighter
 * ceiling than the rest of the API.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const guard = new PlatformAdminGuard();
const controller = new PlatformController();

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
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'hardening test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
}

async function cleanup(clerkUserId: string): Promise<void> {
  await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
  await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
}

interface AlertRow {
  kind: string;
  action: string;
  organization_id: string | null;
  detail: Record<string, unknown>;
  recipients: string[];
  delivered_at: Date | null;
}

async function alerts(clerkUserId: string): Promise<AlertRow[]> {
  const { rows } = await owner.query<AlertRow>(
    `SELECT kind::text AS kind, action, organization_id, detail, recipients, delivered_at
       FROM platform_alert WHERE clerk_user_id = $1 ORDER BY raised_at, created_at`,
    [clerkUserId],
  );
  return rows;
}

async function suspension(tenant: ScratchTenant): Promise<{ at: Date | null; why: string | null }> {
  const { rows } = await owner.query<{ suspended_at: Date | null; suspension_reason: string | null }>(
    'SELECT suspended_at, suspension_reason FROM organization WHERE id = $1',
    [tenant.organizationId],
  );
  return { at: rows[0]!.suspended_at, why: rows[0]!.suspension_reason };
}

/** Just enough ExecutionContext for the guard. */
function context(path: string): ExecutionContext {
  const request = { method: 'GET', path, originalUrl: path, params: {}, query: {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): null => null,
    getClass: () => PlatformController,
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// AC 3 — the club's name, typed
// ---------------------------------------------------------------------------

test('64.3 — suspending without the club’s name is refused, and nothing moves', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_typed_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        /*
         * Three ways to get it wrong, and they are deliberately one refusal:
         * nothing typed, something else typed, and *nearly* it. Somebody who
         * typed nothing and somebody who typed the wrong club are in the same
         * position — about to close a door they have not identified — and the
         * sentence they need is the same.
         */
        for (const confirmName of [undefined, '', 'Outro Clube', `${tenant.name} x`]) {
          await assert.rejects(
            () =>
              controller.suspension(tenant.organizationId, {
                suspended: true,
                reason: 'Fatura por regularizar.',
                confirmName,
              }),
            (error: { status?: number; response?: { fields?: Record<string, string> } }) => {
              assert.equal(error.status, 400);
              assert.equal(error.response?.fields?.['confirmName'], 'admin.error.nameMismatch');
              return true;
            },
            `"${String(confirmName)}" should not close a club`,
          );
        }
      });

      /*
       * And the refusal took the whole transaction with it. The check runs
       * inside `changeTenant`, after the change is known and before the UPDATE,
       * so a refused attempt cannot leave a half-suspended club — or an audit
       * entry claiming one.
       */
      const after = await suspension(tenant);
      assert.equal(after.at, null, 'the club is still open');
      assert.equal(after.why, null);

      const { rows } = await owner.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM platform_audit_log
          WHERE organization_id = $1 AND action = 'tenant.suspended'`,
        [tenant.organizationId],
      );
      assert.equal(rows[0]!.n, '0', 'a refusal writes no trail entry about a change');
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('64.3 — the name is read for what it says, not for its capitals and accents', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_fold_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        /*
         * The friction worth having is reading the name and typing it — being
         * sure which club is about to lose its morning. Refusing over a capital
         * or a circumflex would only teach somebody to paste it, which removes
         * the reading, and would refuse a keyboard with no `á` on it.
         */
        const typed = ` ${tenant.name.toUpperCase().replace('CLUBE', 'CLUBÉ')}  `;
        const result = await controller.suspension(tenant.organizationId, {
          suspended: true,
          reason: 'Confirmada.',
          confirmName: typed.replace(/\s+/g, '  '),
        });
        assert.ok(result.changed['suspended_at']);
      });

      assert.notEqual((await suspension(tenant)).at, null);

      /*
       * And the way back is one click. Nothing is made safer by slowing down the
       * direction that undoes harm: `changeTenant` decides from the columns a
       * change *sets*, and a restore sets both of them to null.
       */
      await asOperator(clerkUserId, async () => {
        await controller.suspension(tenant.organizationId, { suspended: false });
      });
      assert.equal((await suspension(tenant)).at, null, 'restoring asks for nothing');
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

test('64.3 — read-only is one click; a deletion date is not', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_kept_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    try {
      await asOperator(clerkUserId, async () => {
        // Read-only on its own is what happens by itself the day a trial ends,
        // and an operator doing it by hand is usually correcting something.
        const plain = await controller.readOnly(tenant.organizationId, { readOnly: true });
        assert.ok(plain.changed['read_only_at']);

        // Scheduling the end of a club's data is the other kind of act, and it
        // is the *column* that decides so — neither endpoint says which.
        await assert.rejects(
          () =>
            controller.readOnly(tenant.organizationId, {
              readOnly: true,
              dataKeptUntil: '2026-12-31',
            }),
          (error: { status?: number; response?: { fields?: Record<string, string> } }) =>
            error.status === 400 &&
            error.response?.fields?.['confirmName'] === 'admin.error.nameMismatch',
        );

        const scheduled = await controller.readOnly(tenant.organizationId, {
          readOnly: true,
          dataKeptUntil: '2026-12-31',
          confirmName: tenant.name,
        });
        assert.ok(scheduled.changed['pending_delete_at']);
      });

      const { rows } = await owner.query<{ pending_delete_at: Date | null }>(
        'SELECT pending_delete_at FROM organization WHERE id = $1',
        [tenant.organizationId],
      );
      assert.notEqual(rows[0]!.pending_delete_at, null);
    } finally {
      await cleanup(clerkUserId);
    }
  });
});

// ---------------------------------------------------------------------------
// AC 5 — a trail nobody reads is not a control
// ---------------------------------------------------------------------------

test('64.5 — every platform write raises an alert, recorded and marked undelivered', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_alert_${Math.floor(performance.now())}`;
    await grantPlatformAccess(clerkUserId);

    const was = process.env['PLATFORM_ALERT_EMAIL'];
    process.env['PLATFORM_ALERT_EMAIL'] = 'ops@example.test, second@example.test';

    try {
      await asOperator(clerkUserId, async () => {
        await controller.trial(tenant.organizationId, {
          endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        });
      });

      const raised = await alerts(clerkUserId);
      assert.equal(raised.length, 1, 'one alert per write');
      assert.equal(raised[0]!.kind, 'write');
      assert.equal(raised[0]!.action, 'tenant.trial.set');
      assert.equal(raised[0]!.organization_id, tenant.organizationId);

      /*
       * The columns that moved travel with it, so the message can say what
       * happened without a second read of the tenant — and so `changed` cannot
       * disagree with the audit entry written in the same transaction.
       */
      const changed = raised[0]!.detail['changed'] as Record<string, unknown>;
      assert.ok(changed['trial_ends_at'], 'the alert carries what moved');

      /*
       * **Recorded, and not sent.** The console provider returns false — it logs
       * the message instead of sending it — so `delivered_at` stays null on a
       * laptop and in CI. The addresses are written anyway: "we tried to write
       * to these two" is worth more than an empty column, and it is what lets a
       * reader tell a missing provider from a missing recipient list.
       */
      assert.deepEqual(raised[0]!.recipients, ['ops@example.test', 'second@example.test']);
      assert.equal(raised[0]!.delivered_at, null, 'nothing left the building, and it says so');
    } finally {
      if (was === undefined) delete process.env['PLATFORM_ALERT_EMAIL'];
      else process.env['PLATFORM_ALERT_EMAIL'] = was;
      await cleanup(clerkUserId);
    }
  });
});

test('64.5 — a refusal at the door raises one too, and a repeat is suppressed', async () => {
  const clerkUserId = `user_stranger_${Math.floor(performance.now())}`;

  try {
    await asOperator(clerkUserId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await assert.rejects(
          () => guard.canActivate(context('/platform/tenants')),
          (error: { status?: number; response?: { code?: string } }) =>
            error.status === 403 && error.response?.code === 'not_platform_admin',
        );
      }
    });

    const raised = await alerts(clerkUserId);

    /*
     * **Every refusal is recorded.** The row is the control; suppression is
     * about the inbox, not about the trail — a stranger must not be able to make
     * the record of their own attempts thinner by making more of them.
     */
    assert.equal(raised.length, 3, 'three attempts, three rows');
    assert.ok(raised.every((one) => one.kind === 'denied'));
    assert.ok(raised.every((one) => one.action === 'platform.denied'));
    assert.ok(
      raised.every((one) => one.organization_id === null),
      'a refusal at the door names no tenant',
    );
    assert.equal(raised[0]!.detail['path'], '/platform/tenants');

    /*
     * And only the first would have been sent. Fifteen minutes, in memory: a
     * stranger scanning for the area would otherwise fill an inbox with
     * identical warnings, which is how a channel stops being read before it ever
     * carries something urgent.
     */
    assert.equal(raised[0]!.detail['delivery'], undefined, 'the first goes out');
    assert.equal(raised[1]!.detail['delivery'], 'suppressed_repeat');
    assert.equal(raised[2]!.detail['delivery'], 'suppressed_repeat');
  } finally {
    await cleanup(clerkUserId);
  }
});

// ---------------------------------------------------------------------------
// AC 6 — its own ceiling
// ---------------------------------------------------------------------------

test('64.6 — /platform carries its own, tighter ceiling', () => {
  /*
   * Asserted on the metadata rather than by firing sixty requests: these tests
   * call controllers directly and never cross Nest's guard chain, so a loop here
   * would prove that a loop runs. What can be proved is the wiring — that the
   * class carries a `default` override, that it is genuinely tighter than the
   * API-wide limit, and that it is therefore the number a `/platform` caller
   * meets first.
   *
   * The ordering it depends on is Nest's: a global `APP_GUARD` runs before a
   * controller-scoped one, so `UserThrottlerGuard` sees the request — and this
   * override — before `PlatformAdminGuard` decides anything. That is also what
   * bounds how many refusals a stranger can produce.
   */
  const limit = Reflect.getMetadata('THROTTLER:LIMIT' + 'default', PlatformController) as unknown;
  const ttl = Reflect.getMetadata('THROTTLER:TTL' + 'default', PlatformController) as unknown;

  assert.equal(limit, PLATFORM_LIMIT, 'the platform controller overrides the default throttler');
  assert.equal(ttl, 60_000, 'per minute, like the ceiling it narrows');
  assert.ok(PLATFORM_LIMIT < DEFAULT_LIMIT, 'and it is tighter than the ordinary one');
});
