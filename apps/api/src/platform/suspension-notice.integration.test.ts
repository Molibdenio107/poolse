import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { ExecutionContext } from '@nestjs/common';
import { authStorage } from '../auth/auth.context.js';
import { DeliveryRetryService } from '../notifications/delivery-retry.service.js';
import type { Email } from '../notifications/notifier.js';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { deliverSuspensionNotice, supportAddress } from './owner-notices.js';
import { PlatformController } from './platform.controller.js';
import { PlatformAdminGuard } from './platform.guard.js';
import { TrialClockService } from './trial-clock.service.js';

/**
 * A club's Owners are told when an operator suspends or restores it — POOLSE-225.
 *
 * The suspension goes through the real controller as a real operator. Email is
 * console in tests, so the first send after the commit leaves nothing; the notice
 * is then sent again through a stand-in outbox, as the hourly retry would.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const controller = new PlatformController();
const retry = new DeliveryRetryService();
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });

after(async () => {
  await owner.end();
  await closeHarness();
});

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
  return (await owner.query<T>(text, values)).rows;
}

function outbox(ok = true): { sent: Email[]; send: (email: Email) => Promise<boolean> } {
  const sent: Email[] = [];
  return { sent, send: async (email) => (sent.push(email), ok) };
}

interface NoticeRow {
  id: string;
  kind: string;
  reason: string | null;
  recipients: string[];
  delivered_at: Date | null;
}

async function notices(tenant: ScratchTenant): Promise<NoticeRow[]> {
  return sql<NoticeRow>(
    `SELECT id, kind::text AS kind, reason, recipients, delivered_at
       FROM suspension_notice WHERE organization_id = $1 ORDER BY created_at, kind`,
    [tenant.organizationId],
  );
}

async function ownerEmail(tenant: ScratchTenant): Promise<string> {
  const [row] = await sql<{ email: string }>(
    `SELECT u.cached_email::text AS email FROM app_user u JOIN membership m ON m.app_user_id = u.id WHERE m.id = $1`,
    [tenant.ownerMembershipId],
  );
  return row!.email;
}

/** Run `fn` as a platform operator who exists only for this test. */
async function asOperator<T>(fn: () => Promise<T>): Promise<T> {
  const clerkUserId = `user_s225_${Math.floor(performance.now() * 1000)}`;
  await sql(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'POOLSE-225 test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
  try {
    return await authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, fn);
  } finally {
    await sql('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
    await sql('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
    await sql('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
  }
}

const REASON = 'Falta de pagamento <b>desde março</b>';

function suspend(tenant: ScratchTenant, reason = REASON): Promise<unknown> {
  return asOperator(() =>
    controller.suspension(tenant.organizationId, { suspended: true, reason, confirmName: tenant.name }),
  );
}

function restore(tenant: ScratchTenant): Promise<unknown> {
  return asOperator(() => controller.suspension(tenant.organizationId, { suspended: false }));
}

test('225 QA 1 — a suspension records one notice with the reason verbatim, and its email says so', async () => {
  await withScratchTenant(async (tenant) => {
    await suspend(tenant);

    const [org] = await sql<{ suspended_at: Date | null }>('SELECT suspended_at FROM organization WHERE id = $1', [
      tenant.organizationId,
    ]);
    assert.ok(org!.suspended_at, 'the suspension committed although no email could leave');

    const rows = await notices(tenant);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, 'suspended');
    assert.equal(rows[0]!.reason, REASON, 'byte for byte');
    assert.deepEqual(rows[0]!.recipients, [await ownerEmail(tenant)]);
    assert.equal(rows[0]!.delivered_at, null, 'email is console in tests: recorded, not sent');

    const box = outbox();
    assert.equal(await deliverSuspensionNotice(rows[0]!.id, box.send), true);
    const [email] = box.sent;
    assert.equal(email!.to, await ownerEmail(tenant));
    assert.match(email!.subject, new RegExp(tenant.name));
    assert.ok(email!.text.includes(REASON), 'the text part carries the reason untouched');
    assert.ok(email!.html.includes('Falta de pagamento &lt;b&gt;desde março&lt;/b&gt;'), 'the HTML part escapes it');
    assert.ok(!email!.html.includes('<b>desde'), 'no tag of the operator’s reaches the HTML');
    assert.match(email!.text, /\d{2}-\d{2}-\d{4} \d{2}:\d{2}/, 'from when, dd-MM-yyyy HH:mm');
    assert.match(email!.text, /Nada foi apagado/);
    assert.ok(email!.text.includes(supportAddress()), 'the support contact');
    assert.ok(email!.html.includes(`mailto:${supportAddress()}`));
    assert.match(email!.text, /\/dashboard/);

    const [stamped] = await notices(tenant);
    assert.notEqual(stamped!.delivered_at, null);
    assert.equal(await deliverSuspensionNotice(rows[0]!.id, box.send), false, 'sent once');
  });
});

test('225 QA 2 — a restore records a notice with no reason, that says access is back', async () => {
  await withScratchTenant(async (tenant) => {
    await suspend(tenant);
    await restore(tenant);

    const rows = await notices(tenant);
    assert.deepEqual(
      rows.map((row) => row.kind),
      ['suspended', 'restored'],
    );
    const restored = rows[1]!;
    assert.equal(restored.reason, null);

    const box = outbox();
    assert.equal(await deliverSuspensionNotice(restored.id, box.send), true);
    assert.match(box.sent[0]!.text, /foi reposto/);
    assert.match(box.sent[0]!.text, /Nada foi apagado/);
    assert.ok(!box.sent[0]!.text.includes('Motivo'), 'a restore quotes no reason');
  });
});

test('225 QA 3 — no transition, no notice', async () => {
  await withScratchTenant(async (tenant) => {
    await restore(tenant);
    assert.equal((await notices(tenant)).length, 0, 'restoring an open club told nobody anything');

    await suspend(tenant);
    await suspend(tenant, 'Outra frase');
    assert.equal((await notices(tenant)).length, 1, 'suspending a suspended club is not a second event');
  });
});

test('225 QA 4 — a provider refusal leaves the notice for the hourly retry, which sends it once', async () => {
  await withScratchTenant(async (tenant) => {
    await suspend(tenant);
    const [notice] = await notices(tenant);
    assert.equal(await deliverSuspensionNotice(notice!.id, outbox(false).send), false);

    await sql(`UPDATE suspension_notice SET created_at = now() - interval '1 hour' WHERE id = $1`, [notice!.id]);
    const box = outbox();
    const first = await retry.run({ organizationId: tenant.organizationId, send: box.send });
    assert.equal(first.delivered, 1);
    assert.equal(box.sent.length, 1);
    assert.ok(box.sent[0]!.text.includes(REASON), 'the retry renders from the row');

    const again = await retry.run({ organizationId: tenant.organizationId, send: box.send });
    assert.equal(again.attempted, 0);
  });
});

test('225 QA 5 — the trial clock’s closing records nothing; an operator’s restore of it does', async () => {
  await withScratchTenant(async (tenant) => {
    await sql(
      `UPDATE organization
          SET subscription_status = 'expired',
              read_only_at = now() - interval '31 days',
              pending_delete_at = now() - interval '1 day',
              suspended_at = NULL, suspension_reason = NULL
        WHERE id = $1`,
      [tenant.organizationId],
    );
    await new TrialClockService().run(tenant.organizationId);
    const [org] = await sql<{ suspended_at: Date | null }>('SELECT suspended_at FROM organization WHERE id = $1', [
      tenant.organizationId,
    ]);
    assert.ok(org!.suspended_at, 'the clock closed it');
    assert.equal((await notices(tenant)).length, 0, 'access_closed is its notice; one event, one email');

    await restore(tenant);
    assert.deepEqual(
      (await notices(tenant)).map((row) => row.kind),
      ['restored'],
    );
  });
});

test('225 QA 6 — an Owner with no address: recorded with nobody, sent to nobody, never retried', async () => {
  await withScratchTenant(async (tenant) => {
    const [link] = await sql<{ app_user_id: string; cached_email: string | null; email: string | null }>(
      `SELECT m.app_user_id, u.cached_email::text AS cached_email, m.email::text AS email
         FROM membership m JOIN app_user u ON u.id = m.app_user_id WHERE m.id = $1`,
      [tenant.ownerMembershipId],
    );
    await sql('UPDATE app_user SET cached_email = NULL WHERE id = $1', [link!.app_user_id]);
    await sql('UPDATE membership SET email = NULL WHERE id = $1', [tenant.ownerMembershipId]);
    try {
      await suspend(tenant);
      const [notice] = await notices(tenant);
      assert.deepEqual(notice!.recipients, []);

      const box = outbox();
      assert.equal(await deliverSuspensionNotice(notice!.id, box.send), false);
      await sql(`UPDATE suspension_notice SET created_at = now() - interval '1 hour' WHERE id = $1`, [notice!.id]);
      await retry.run({ organizationId: tenant.organizationId, send: box.send });
      assert.equal(box.sent.length, 0);
    } finally {
      await sql('UPDATE app_user SET cached_email = $2 WHERE id = $1', [link!.app_user_id, link!.cached_email]);
      await sql('UPDATE membership SET email = $2 WHERE id = $1', [tenant.ownerMembershipId, link!.email]);
    }
  });
});

test('225 QA 9 — an English club gets the English email', async () => {
  await withScratchTenant(async (tenant) => {
    await sql(`UPDATE organization SET locale = 'en' WHERE id = $1`, [tenant.organizationId]);
    await suspend(tenant, 'Unpaid since March');
    const [notice] = await notices(tenant);
    const box = outbox();
    await deliverSuspensionNotice(notice!.id, box.send);
    assert.match(box.sent[0]!.subject, /Access to the club suspended/);
    assert.match(box.sent[0]!.text, /Nothing was deleted/);
    assert.match(box.sent[0]!.text, /Reason given:\nUnpaid since March/);
    assert.ok(!/Nada|suspenso a/.test(box.sent[0]!.text), 'no Portuguese left in it');
  });
});

test('225 QA 8 — a club Owner without the platform flag is refused, and nothing is recorded', async () => {
  await withScratchTenant(async (tenant) => {
    const clerkUserId = `user_own225_${tenant.organizationId.slice(0, 8)}`;
    const path = `/platform/tenants/${tenant.organizationId}/suspension`;
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path,
          originalUrl: path,
          params: { id: tenant.organizationId },
          query: {},
          route: { path: '/platform/tenants/:id/suspension' },
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
      assert.equal((await notices(tenant)).length, 0);
    } finally {
      await sql('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
      await sql('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
    }
  });
});

test('225 — a malformed tenant id is a 400, never a 500 (security review 17-11-2026)', async () => {
  await asOperator(async () => {
    await assert.rejects(
      () => controller.suspension('not-a-uuid', { suspended: false }),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 400,
    );
  });
});
