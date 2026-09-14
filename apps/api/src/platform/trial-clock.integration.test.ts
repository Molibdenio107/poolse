import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';
import { TrialClockService } from './trial-clock.service.js';

/**
 * The trial clock — POOLSE-61 slice B2, against a real database.
 *
 * The job is two UPDATEs and a set of notices, and every one of them is driven by
 * state rather than by a cursor. So the tests set a tenant's dates to where the
 * clock would have found them and run one pass.
 *
 * **Every pass here is scoped to its own scratch tenant**, and that is not
 * tidiness. The job is global by design — it sweeps the whole estate — and this
 * suite runs its files concurrently against one database, so an unscoped pass
 * reaches into another test's tenant, expires it, and leaves it a transition that
 * test never asked for. Which is exactly how this was found: the whole suite went
 * red on a teardown foreign key while every file passed on its own.
 *
 * Four claims carry the rest:
 *
 * **It is idempotent.** A second pass in the same hour changes nothing, because a
 * tenant already moved no longer matches the query that moves one. Asserted by
 * running it twice rather than by reading the SQL.
 *
 * **Two instances are one.** The advisory lock is what makes a second Railway
 * container a no-op instead of a double transition. Asserted by holding the lock
 * from another connection and watching a pass decline to do anything.
 *
 * **A `comped` tenant never moves**, whatever its dates say. The free pilot is
 * live and unbilled, and the whole guarantee is one WHERE clause.
 *
 * **`platform_audit_log` is untouched.** A cron has no person behind it, and that
 * table's actor column is named for one.
 *
 * **And it cannot archive anybody**, which corrects the ticket's third step: the
 * platform login has no grant on `archived_at`, because removing a tenant is not
 * an operator action. Asserted, so that a future widening of the grant does not
 * quietly hand an hourly job the ability to delete clubs.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const clock = new TrialClockService();

/** The owner login, because the job's own role cannot set up a fixture. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(() => owner.end());

/** Put a tenant exactly where the clock would find it. */
async function state(
  tenant: ScratchTenant,
  set: Record<string, string | null>,
): Promise<void> {
  const columns = Object.keys(set);
  const assignments = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await owner.query(`UPDATE organization SET ${assignments} WHERE id = $1`, [
    tenant.organizationId,
    ...columns.map((c) => set[c]),
  ]);
}

async function read(tenant: ScratchTenant): Promise<Record<string, unknown>> {
  const { rows } = await owner.query<Record<string, unknown>>(
    `SELECT subscription_status::text AS subscription_status, read_only_at,
            pending_delete_at, suspended_at, suspension_reason, archived_at
       FROM organization WHERE id = $1`,
    [tenant.organizationId],
  );
  return rows[0]!;
}

async function events(tenant: ScratchTenant): Promise<string[]> {
  const { rows } = await owner.query<{ transition: string }>(
    `SELECT transition::text AS transition FROM trial_event
      WHERE organization_id = $1 ORDER BY occurred_at`,
    [tenant.organizationId],
  );
  return rows.map((row) => row.transition);
}

test('61.1 — a trial that ran out becomes read-only, with a date thirty days out', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() - 3_600_000).toISOString(),
      read_only_at: null,
      pending_delete_at: null,
    });

    await clock.run(tenant.organizationId);

    const org = await read(tenant);
    assert.equal(org['subscription_status'], 'expired');
    assert.ok(org['read_only_at'], 'writing stopped');

    const keptUntil = org['pending_delete_at'] as Date;
    const days = Math.round((keptUntil.getTime() - Date.now()) / 86_400_000);
    assert.equal(days, 30, 'the ladder is thirty days, and it comes from SQL');

    assert.deepEqual(await events(tenant), ['expired']);
  });
});

test('61.2 — a second pass in the same hour changes nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const first = await clock.run(tenant.organizationId);
    const after = await read(tenant);
    const second = await clock.run(tenant.organizationId);

    assert.equal(first.expired, 1);
    assert.equal(second.expired, 0, 'a tenant already expired does not match');
    assert.deepEqual(
      await events(tenant),
      ['expired'],
      'one transition, one entry — the book is not written twice',
    );
    // And the dates did not move under it on the second pass.
    assert.deepEqual(await read(tenant), after);
  });
});

test('61.2 — a second instance is a no-op, not a double transition', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() - 3_600_000).toISOString(),
    });

    /*
     * The lock held from another connection, which is what a second Railway
     * container looks like from here. Session-level, so it outlives the
     * statement; the job's is transaction-level and is released by its commit.
     */
    const holder = await owner.connect();
    try {
      const key = 6_1_2026_09_14;
      const { rows } = await holder.query<{ taken: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS taken',
        [key],
      );
      assert.equal(rows[0]?.taken, true, 'the fixture must actually hold the lock');

      const result = await clock.run(tenant.organizationId);
      assert.equal(result.locked, false, 'the pass declined rather than duplicating work');
      assert.equal(result.expired, 0);
      assert.equal((await read(tenant))['subscription_status'], 'trialing');

      await holder.query('SELECT pg_advisory_unlock($1)', [key]);
    } finally {
      holder.release();
    }

    // Released: the next hour does the work the blocked one did not.
    assert.equal((await clock.run(tenant.organizationId)).expired, 1);
  });
});

test('61.15 — a comped tenant is never moved, whatever its dates say', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'comped',
      // A year ago. The free pilot is live and unbilled and does not run out.
      trial_ends_at: new Date(Date.now() - 365 * 86_400_000).toISOString(),
    });

    await clock.run(tenant.organizationId);

    const org = await read(tenant);
    assert.equal(org['subscription_status'], 'comped');
    assert.equal(org['read_only_at'], null);
    assert.deepEqual(await events(tenant), []);
  });
});

test('61.8 — sign-in closes with the machine’s reason, and no Clerk account is touched', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'expired',
      read_only_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      pending_delete_at: new Date(Date.now() - 86_400_000).toISOString(),
      suspended_at: null,
      suspension_reason: null,
    });

    await clock.run(tenant.organizationId);

    const org = await read(tenant);
    assert.ok(org['suspended_at'], 'the door is shut through the mechanism that exists');
    assert.equal(org['suspension_reason'], TrialClockService.CLOSED_REASON);
    assert.ok((await events(tenant)).includes('access_closed'));

    /*
     * Nothing in this service touches Clerk, and the point is worth asserting
     * rather than asserting about: the middleware already refuses the request, so
     * somebody who cannot get past the door never counts as a monthly active
     * user — and deactivating their account would lock them out of a second club
     * they still pay for. The app_user row is untouched.
     */
    const { rows } = await owner.query<{ deleted_at: Date | null }>(
      `SELECT u.deleted_at FROM app_user u
         JOIN membership m ON m.app_user_id = u.id
        WHERE m.id = $1`,
      [tenant.ownerMembershipId],
    );
    assert.equal(rows[0]?.deleted_at, null);
  });
});

test('61 — a tenant a person suspended keeps that person’s reason', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'expired',
      read_only_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      pending_delete_at: new Date(Date.now() - 86_400_000).toISOString(),
      suspended_at: new Date(Date.now() - 86_400_000).toISOString(),
      suspension_reason: 'Fatura de setembro por regularizar.',
    });

    await clock.run(tenant.organizationId);

    // Their sentence is the one that should be on screen; overwriting it would
    // lose why the door was really shut.
    assert.equal(
      (await read(tenant))['suspension_reason'],
      'Fatura de setembro por regularizar.',
    );
    assert.deepEqual(await events(tenant), []);
  });
});

test('61.13 — the clock stops at the closed door and cannot remove a tenant', async () => {
  await withScratchTenant(async (tenant) => {
    // Long past every rung the ticket named, including the one that said archive.
    await state(tenant, {
      subscription_status: 'expired',
      read_only_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      pending_delete_at: new Date(Date.now() - 170 * 86_400_000).toISOString(),
      suspended_at: new Date(Date.now() - 170 * 86_400_000).toISOString(),
      suspension_reason: TrialClockService.CLOSED_REASON,
    });

    await clock.run(tenant.organizationId);

    /*
     * Nothing removed. `archived_at` is not on the platform login's column grant,
     * because deleting a tenant is not an operator action and a cron has a weaker
     * claim to it than a person — so the ladder stops at the closed door and day
     * 75 belongs to the purge ticket.
     *
     * Asserted rather than left implicit: if somebody later widens that grant,
     * this is what says an hourly job must still not be the thing that uses it.
     */
    assert.equal((await read(tenant))['archived_at'], null);

    const { rows } = await owner.query<{ n: string }>(
      // UPDATE specifically. The platform login may *read* whether a tenant is
      // archived — that is how /admin draws the list — and may not archive one.
      `SELECT count(*)::text AS n
         FROM information_schema.column_privileges
        WHERE grantee = 'poolse_platform' AND table_name = 'organization'
          AND column_name = 'archived_at' AND privilege_type = 'UPDATE'`,
      [],
    );
    assert.equal(rows[0]!.n, '0', 'the platform login may not archive a tenant');
  });
});

test('61.9 — the cron writes its own book and never the operators’ one', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'trialing',
      trial_ends_at: new Date(Date.now() - 3_600_000).toISOString(),
    });

    await clock.run(tenant.organizationId);

    assert.deepEqual(await events(tenant), ['expired']);

    /*
     * `platform_audit_log.clerk_user_id` is NOT NULL and names a person. A cron
     * has nobody behind it, so an entry there would be a lie in the one place
     * that exists to be believed.
     */
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM platform_audit_log WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    assert.equal(rows[0]!.n, '0');
  });
});

test('61.10 — a notice is recorded, owed to the owner, and marked undelivered', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'trialing',
      // Inside the five-day window before the end, so the first notice is due.
      trial_ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });

    await clock.run(tenant.organizationId);

    const { rows } = await owner.query<{
      kind: string;
      recipients: string[];
      delivered_at: Date | null;
    }>(
      `SELECT kind::text AS kind, recipients, delivered_at FROM trial_notice
        WHERE organization_id = $1`,
      [tenant.organizationId],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, 'trial_ending_soon');
    assert.equal(
      rows[0]?.delivered_at,
      null,
      'recorded and not sent — there is no email provider, and the screens say so',
    );

    /*
     * Empty, and deliberately: an owner's address is in `app_user.cached_email`
     * and the platform login holds no privilege on that table. Granting an eighth
     * table so a job that sends nothing could write an address down would widen
     * the narrowest login in the system for no delivery. The provider slice
     * resolves recipients at send time, which is when "who was told" is a fact.
     *
     * Asserted rather than left unsaid, so that filling this in later is a
     * decision somebody takes on purpose.
     */
    assert.deepEqual(rows[0]?.recipients, []);

    // Hourly, and owed once: the (tenant, kind, day) key is what makes that true.
    await clock.run(tenant.organizationId);
    const { rows: again } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM trial_notice WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    assert.equal(again[0]!.n, '1');
  });
});
