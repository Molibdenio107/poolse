import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { deliverSupportNotice, deliverTrialNotice } from '../platform/owner-notices.js';
import { DeliveryRetryService } from './delivery-retry.service.js';
import type { Email } from './notifier.js';

/**
 * POOLSE-86, slice 3.0a — the recorded notices go out, and a failed send is
 * retried. A stand-in sender records what would have gone, so nothing here
 * reaches Resend.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** The owner login, because these fixtures write what no app role may. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(() => owner.end());

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
  return (await owner.query<T>(text, values)).rows;
}

const retry = new DeliveryRetryService();

function outbox(ok = true): { sent: Email[]; send: (email: Email) => Promise<boolean> } {
  const sent: Email[] = [];
  return { sent, send: async (email) => (sent.push(email), ok) };
}

/**
 * A trial ending in `days`, and the notice the clock would have written for it.
 * Written directly rather than by running the clock: the clock takes a global
 * lock, and running it here races `trial-clock.integration.test.ts`.
 */
async function trialEndingIn(tenant: ScratchTenant, days: number): Promise<string> {
  await sql(
    `UPDATE organization SET subscription_status = 'trialing', trial_ends_at = now() + make_interval(days => $2)
      WHERE id = $1`,
    [tenant.organizationId, days],
  );
  const [row] = await sql<{ id: string }>(
    `INSERT INTO trial_notice (organization_id, kind, due_on, recipients)
     VALUES ($1, 'trial_ending_soon', club_today(), ARRAY[$2]::text[]) RETURNING id`,
    [tenant.organizationId, await ownerEmail(tenant)],
  );
  return row!.id;
}

async function ownerEmail(tenant: ScratchTenant): Promise<string> {
  const [row] = await sql<{ email: string }>(
    `SELECT u.cached_email AS email FROM app_user u JOIN membership m ON m.app_user_id = u.id WHERE m.id = $1`,
    [tenant.ownerMembershipId],
  );
  return row!.email;
}

test('a trial notice is emailed to the owner, names the club and the date, and is stamped once', async () => {
  await withScratchTenant(async (tenant) => {
    const noticeId = await trialEndingIn(tenant, 3);
    const box = outbox();

    assert.equal(await deliverTrialNotice(noticeId, box.send), true);
    assert.equal(box.sent.length, 1);
    assert.equal(box.sent[0]!.to, await ownerEmail(tenant));
    assert.match(box.sent[0]!.subject, new RegExp(tenant.name));
    assert.match(box.sent[0]!.text, /\d{2}-\d{2}-\d{4}/, 'the date it ends, dd-MM-yyyy');
    assert.match(box.sent[0]!.text, /\/dashboard\/profile\/subscription/);

    const [row] = await sql<{ delivered_at: Date | null }>(
      'SELECT delivered_at FROM trial_notice WHERE id = $1',
      [noticeId],
    );
    assert.notEqual(row!.delivered_at, null);

    // Delivered once: a second call sends nothing.
    assert.equal(await deliverTrialNotice(noticeId, box.send), false);
    assert.equal(box.sent.length, 1);
  });
});

test('a provider refusal leaves the notice unsent, and the retry sends it once', async () => {
  await withScratchTenant(async (tenant) => {
    const noticeId = await trialEndingIn(tenant, 3);

    assert.equal(await deliverTrialNotice(noticeId, outbox(false).send), false);
    // The first attempt was a while ago — the retry leaves anything younger than ten minutes alone.
    await sql(`UPDATE trial_notice SET created_at = now() - interval '1 hour' WHERE id = $1`, [noticeId]);

    const box = outbox();
    const first = await retry.run({ organizationId: tenant.organizationId, send: box.send });
    assert.equal(first.attempted, 1);
    assert.equal(first.delivered, 1);
    const [row] = await sql<{ delivered_at: Date | null; delivery_attempts: number }>(
      'SELECT delivered_at, delivery_attempts FROM trial_notice WHERE id = $1',
      [noticeId],
    );
    assert.notEqual(row!.delivered_at, null);
    assert.equal(row!.delivery_attempts, 1);

    const again = await retry.run({ organizationId: tenant.organizationId, send: box.send });
    assert.equal(again.attempted, 0, 'a delivered notice is not retried');
    assert.equal(box.sent.length, 1);
  });
});

test('the retry leaves alone what is too old, too fresh, tried too often or tried this hour', async () => {
  await withScratchTenant(async (tenant) => {
    const noticeId = await trialEndingIn(tenant, 3);
    const box = outbox(false);
    const attempted = async (): Promise<number> =>
      (await retry.run({ organizationId: tenant.organizationId, send: box.send })).attempted;

    assert.equal(await attempted(), 0, 'younger than ten minutes: the first send may still be running');

    await sql(`UPDATE trial_notice SET created_at = now() - interval '3 days' WHERE id = $1`, [noticeId]);
    assert.equal(await attempted(), 0, 'older than 48 hours is no longer news');

    await sql(
      `UPDATE trial_notice SET created_at = now() - interval '2 hours', delivery_attempts = 5 WHERE id = $1`,
      [noticeId],
    );
    assert.equal(await attempted(), 0, 'five retries is the end');

    await sql(
      `UPDATE trial_notice SET delivery_attempts = 1, last_attempt_at = now() - interval '5 minutes' WHERE id = $1`,
      [noticeId],
    );
    assert.equal(await attempted(), 0, 'once an hour');

    await sql(`UPDATE trial_notice SET last_attempt_at = now() - interval '2 hours' WHERE id = $1`, [noticeId]);
    assert.equal(await attempted(), 1);
  });
});

test('with email on console and no stand-in, the retry attempts nothing', async () => {
  const saved = process.env['EMAIL_PROVIDER'];
  process.env['EMAIL_PROVIDER'] = 'console';
  try {
    const result = await retry.run({ organizationId: '00000000-0000-4000-8000-000000000000' });
    assert.deepEqual(result, { locked: false, configured: false, attempted: 0, delivered: 0 });
  } finally {
    if (saved === undefined) delete process.env['EMAIL_PROVIDER'];
    else process.env['EMAIL_PROVIDER'] = saved;
  }
});

test("the support override's notice reaches the Owners with the reason verbatim, stamped by the platform login", async () => {
  const clerkUserId = `user_delivery_${process.pid}_${Date.now()}`;
  await withScratchTenant(async (tenant) => {
    const address = await ownerEmail(tenant);
    const [admin] = await sql<{ id: string }>(
      `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'delivery test') RETURNING id`,
      [clerkUserId],
    );
    const [grant] = await sql<{ id: string }>(
      `INSERT INTO support_grant (organization_id, source, reason, requested_by_platform_admin_id,
                                  starts_at, expires_at, notice_recipients)
       VALUES ($1, 'override', 'A faturação não abre — «erro 500»', $2, now(), now() + interval '4 hours', $3::text[])
       RETURNING id`,
      [tenant.organizationId, admin!.id, [address]],
    );
    const box = outbox();

    assert.equal(await deliverSupportNotice(grant!.id, box.send), true);
    assert.equal(box.sent[0]!.to, address);
    assert.match(box.sent[0]!.text, /A faturação não abre — «erro 500»/);
    assert.match(box.sent[0]!.text, /dashboard\/profile\?tab=support/);

    const [row] = await sql<{ notice_delivered_at: Date | null; ended_at: Date | null }>(
      'SELECT notice_delivered_at, ended_at FROM support_grant WHERE id = $1',
      [grant!.id],
    );
    assert.notEqual(row!.notice_delivered_at, null, 'the platform login may stamp an override notice');
    assert.equal(row!.ended_at, null, 'and nothing else about the grant moved');
    assert.equal(await deliverSupportNotice(grant!.id, box.send), false, 'sent once');
    // The grant names the operator, so it goes before the operator does.
    await sql('DELETE FROM support_grant WHERE id = $1', [grant!.id]);
    await sql('DELETE FROM platform_admin WHERE id = $1', [admin!.id]);
  });
});
