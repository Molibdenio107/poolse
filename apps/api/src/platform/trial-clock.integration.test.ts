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
 * **It archives on day 75, and only a tenant it closed itself.** That needed the
 * platform login's grant widened — a decision taken on 14 September 2026 knowing
 * what it costs — so the test that matters is not "can it" but "whose club": a
 * tenant an operator suspended for a reason of their own is never filed away by
 * the machine.
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
            pending_delete_at, suspended_at, suspension_reason, archived_at,
            billing_mode::text AS billing_mode, paid_through::text AS paid_through
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

/**
 * The free pilot, which since POOLSE-63 is a *mode* rather than a status.
 *
 * A comped club is `billing_mode = 'comped'` and an ordinary `active` — so it
 * matches neither the trial steps, which filter on `trialing`, nor the manual
 * pair, which filter on `manual`. Structurally out of the clock's way rather
 * than excluded by a line somebody has to remember to write.
 */
test('61.15 — a comped tenant is never moved, whatever its dates say', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      billing_mode: 'comped',
      subscription_status: 'active',
      // A year ago, and paid through nothing. The free pilot does not run out.
      trial_ends_at: new Date(Date.now() - 365 * 86_400_000).toISOString(),
    });

    await clock.run(tenant.organizationId);

    const org = await read(tenant);
    assert.equal(org['subscription_status'], 'active');
    assert.equal(org['billing_mode'], 'comped');
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

test('61 — the ladder ends in an archive, thirty days after the door shut', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      subscription_status: 'expired',
      read_only_at: new Date(Date.now() - 61 * 86_400_000).toISOString(),
      pending_delete_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      suspended_at: null,
      suspension_reason: null,
    });

    // The pass that closes the door writes the `access_closed` event the archive
    // step requires as its proof.
    await clock.run(tenant.organizationId);
    await state(tenant, {
      suspended_at: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });
    await clock.run(tenant.organizationId);

    assert.ok((await read(tenant))['archived_at'], 'filed away');
    assert.deepEqual(await events(tenant), ['access_closed', 'archived']);

    /*
     * Archiving is a soft delete and the club's rows all survive it. What changed
     * on 14-09-2026 is that the operator login may do this at all — the purge,
     * which actually destroys something, is still a separate ticket.
     */
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM membership WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    assert.ok(Number(rows[0]!.n) > 0, 'nothing was destroyed');
  });
});

test('61 — a club an operator shut is never filed away by the machine', async () => {
  await withScratchTenant(async (tenant) => {
    /*
     * Suspended long enough ago to qualify on dates alone, and by a person. The
     * clock requires its own `access_closed` event as proof, so this club's
     * closure — which the ladder knows nothing about — is left entirely alone.
     */
    await state(tenant, {
      subscription_status: 'expired',
      read_only_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      pending_delete_at: new Date(Date.now() - 170 * 86_400_000).toISOString(),
      suspended_at: new Date(Date.now() - 170 * 86_400_000).toISOString(),
      suspension_reason: 'Fatura de setembro por regularizar.',
    });

    await clock.run(tenant.organizationId);

    assert.equal((await read(tenant))['archived_at'], null);
    assert.deepEqual(await events(tenant), []);
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

    const { rows: who } = await owner.query<{ email: string }>(
      `SELECT u.cached_email AS email FROM app_user u
         JOIN membership m ON m.app_user_id = u.id
        WHERE m.id = $1`,
      [tenant.ownerMembershipId],
    );
    const ownerEmail = who[0]!.email;

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
     * The club's owner, resolved by role and written onto the row. Reading the
     * address means reading `app_user` — the eighth table the platform login can
     * reach, and a decision taken on 14-09-2026 rather than a grant that was
     * always there.
     */
    assert.deepEqual(
      rows[0]?.recipients,
      [ownerEmail],
      'owed to the owner, because nobody else can pay',
    );

    // Hourly, and owed once: the (tenant, kind, day) key is what makes that true.
    await clock.run(tenant.organizationId);
    const { rows: again } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM trial_notice WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    assert.equal(again[0]!.n, '1');
  });
});

// ---------------------------------------------------------------------------
// A subscription paid by hand — POOLSE-63
//
// The other ladder, and the point is where it stops. A trial walks all the way
// down to an archive because nobody ever paid for it. A customer who is late is
// a customer: past due, then read-only, and never a closed door.
// ---------------------------------------------------------------------------

/** A `YYYY-MM-DD` day, n days from today. A day has no timezone. */
function day(offset: number): string {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  return at.toISOString().slice(0, 10);
}

test('63.1 — cover that ran out is past due, and the door stays open', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      billing_mode: 'manual',
      subscription_status: 'active',
      paid_through: day(-1),
      read_only_at: null,
    });

    const result = await clock.run(tenant.organizationId);
    assert.equal(result.lapsed, 1);

    const org = await read(tenant);
    assert.equal(org['subscription_status'], 'past_due');
    /*
     * The distinction the platform slice settled, holding here too: billing
     * state moved and access state did not. A club mid-lesson with thirty
     * children in the water does not lose its register because a transfer is
     * late.
     */
    assert.equal(org['read_only_at'], null);
    assert.equal(org['suspended_at'], null);
    assert.deepEqual(await events(tenant), ['payment_lapsed']);
  });
});

test('63.2 — the grace is fifteen days, and then writing stops', async () => {
  await withScratchTenant(async (tenant) => {
    // Cover ended a fortnight ago: inside the grace, still writing.
    await state(tenant, {
      billing_mode: 'manual',
      subscription_status: 'past_due',
      paid_through: day(-14),
      read_only_at: null,
    });

    assert.equal((await clock.run(tenant.organizationId)).restricted, 0);
    assert.equal((await read(tenant))['read_only_at'], null);

    await state(tenant, { paid_through: day(-16) });

    assert.equal((await clock.run(tenant.organizationId)).restricted, 1);

    const org = await read(tenant);
    assert.ok(org['read_only_at'], 'writing stopped');
    /*
     * **And the ladder stops here.** No deletion date, no closed door, no
     * archive — a club that has paid before is not a trial that never did.
     */
    assert.equal(org['pending_delete_at'], null);
    assert.equal(org['suspended_at'], null);
    assert.equal(org['archived_at'], null);
    assert.deepEqual(await events(tenant), ['payment_read_only']);
  });
});

test('63.3 — a late club is never closed or archived, however long it stays late', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      billing_mode: 'manual',
      subscription_status: 'past_due',
      // Two years overdue. The trial ladder would have archived this club twice.
      paid_through: day(-730),
      read_only_at: new Date(Date.now() - 700 * 86_400_000).toISOString(),
    });

    await clock.run(tenant.organizationId);

    const org = await read(tenant);
    assert.equal(org['suspended_at'], null, 'the machine never shuts a customer out');
    assert.equal(org['archived_at'], null, 'and never files one away');
    assert.equal(org['pending_delete_at'], null);
  });
});

test('63.4 — a second pass changes nothing, and each rung is written once', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      billing_mode: 'manual',
      subscription_status: 'active',
      paid_through: day(-20),
      read_only_at: null,
    });

    // Both rungs in one pass: cover ran out and the grace has passed too.
    const first = await clock.run(tenant.organizationId);
    assert.equal(first.lapsed, 1);
    assert.equal(first.restricted, 1);

    const second = await clock.run(tenant.organizationId);
    assert.equal(second.lapsed, 0);
    assert.equal(second.restricted, 0);

    /*
     * Idempotent by the state it reads rather than by a constraint: a club
     * already `past_due` does not match the query that lapses one.
     */
    assert.deepEqual(await events(tenant), ['payment_lapsed', 'payment_read_only']);
  });
});

test('63.5 — a club whose cover is still good is not touched', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      billing_mode: 'manual',
      subscription_status: 'active',
      // Today is the last day covered, and the last day is included.
      paid_through: day(0),
      read_only_at: null,
    });

    const result = await clock.run(tenant.organizationId);
    assert.equal(result.lapsed, 0);

    assert.equal((await read(tenant))['subscription_status'], 'active');
    assert.deepEqual(await events(tenant), []);
  });
});

test('63.6 — a lapsed club is owed a notice, recorded and not sent', async () => {
  await withScratchTenant(async (tenant) => {
    await state(tenant, {
      billing_mode: 'manual',
      subscription_status: 'active',
      paid_through: day(-1),
      read_only_at: null,
    });

    await clock.run(tenant.organizationId);

    const { rows } = await owner.query<{ kind: string; delivered_at: Date | null }>(
      `SELECT kind::text AS kind, delivered_at FROM trial_notice
        WHERE organization_id = $1`,
      [tenant.organizationId],
    );

    const overdue = rows.find((row) => row.kind === 'payment_overdue');
    assert.ok(overdue, 'the club is owed a word about the money');
    // Null means recorded and nothing left the building. There is no provider.
    assert.equal(overdue.delivered_at, null);
  });
});
