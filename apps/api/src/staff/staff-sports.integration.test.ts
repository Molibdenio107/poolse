import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import pg from 'pg';
import { authStorage } from '../auth/auth.context.js';
import { listMemberships } from '../identity/identity.repository.js';
import { PlatformController } from '../platform/platform.controller.js';
import { StaffController } from './staff.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * The sports a staff member belongs to — POOLSE-145 slice a, QA 6 and 7 and the
 * write path: everybody is swimming until told otherwise, owner and admin set
 * it, never empty and never a sport the club has off, `/me` carries it, and a
 * sport with instructors in it stays on, naming them.
 *
 * Run: pnpm api:test   (needs pnpm db:up and DATABASE_PLATFORM_URL)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
const platform = new PlatformController();

after(async () => {
  await owner.end();
  await closeHarness();
});

async function asOperator<T>(fn: () => Promise<T>): Promise<T> {
  const clerkUserId = `user_staff_sports_op_${Math.floor(performance.now())}`;
  await owner.query(
    `INSERT INTO platform_admin (clerk_user_id, note) VALUES ($1, 'staff sports test')
     ON CONFLICT (clerk_user_id) DO UPDATE SET archived_at = NULL`,
    [clerkUserId],
  );
  try {
    return await authStorage.run({ clerkUserId, sessionId: `sess_${clerkUserId}` }, fn);
  } finally {
    await owner.query('DELETE FROM platform_alert WHERE clerk_user_id = $1', [clerkUserId]);
    await owner.query('DELETE FROM platform_audit_log WHERE clerk_user_id = $1', [clerkUserId]);
    await owner.query('DELETE FROM platform_admin WHERE clerk_user_id = $1', [clerkUserId]);
  }
}

test('POOLSE-145 a — a staff member\'s sports: swimming by default, set by the office, carried on /me, holding a sport on', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ténis', ['instructor']);
    const staff = new StaffController();

    // QA 6: nobody loses anything — a new person, like every existing one, is swimming.
    const fresh = await actingAs(tenant, { roles: ['owner'] }, () => staff.one(coach));
    assert.deepEqual(fresh.sports, ['pool']);

    // A sport the club has off is refused; switched on, it can be set.
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      await expectStatus(() => staff.setSports(coach, { sports: ['tennis'] }), 400);
      await expectStatus(() => staff.setSports(coach, { sports: [] }), 400);
      await expectStatus(() => staff.setSports(coach, { sports: ['curling'] }), 400);
    });
    await asOperator(() => platform.sports(tenant.organizationId, { enabled: ['pool', 'tennis'] }));
    const moved = await actingAs(tenant, { roles: ['admin'] }, () => staff.setSports(coach, { sports: ['tennis'] }));
    assert.deepEqual(moved.sports, ['tennis']);

    // Only owner and admin decide it — not the person, not a colleague.
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      await expectStatus(() => staff.setSports(coach, { sports: ['pool', 'tennis'] }), 403);
    });

    // Audited with the before and after.
    const [entry] = await tenant.sql<{ data: { changes: { sports: { from: string[]; to: string[] } } } }>(
      `SELECT data FROM audit_log WHERE action = 'staff.sports_set' AND entity_id = $1`,
      [coach],
    );
    assert.deepEqual(entry!.data.changes.sports, { from: ['pool'], to: ['tennis'] });

    // /me carries the reader's own sports beside the club's.
    const { rows: [ownerRow] } = await owner.query<{ clerk_user_id: string }>(
      `SELECT u.clerk_user_id FROM app_user u JOIN membership m ON m.app_user_id = u.id WHERE m.id = $1`,
      [tenant.ownerMembershipId],
    );
    const mine = (await listMemberships(ownerRow!.clerk_user_id)).find((m) => m.organizationId === tenant.organizationId)!;
    assert.deepEqual(mine.sports, ['pool', 'tennis']);
    assert.deepEqual(mine.mySports, ['pool']);

    // QA 7: tennis stays on while an instructor is in it, and the refusal names them.
    await asOperator(async () => {
      await assert.rejects(
        () => platform.sports(tenant.organizationId, { enabled: ['pool'] }),
        (error: unknown) => {
          if (!(error instanceof ConflictException)) return false;
          const body = error.getResponse() as { code: string; sport: string; people: string[] };
          return body.code === 'sport_has_staff' && body.sport === 'tennis' && body.people.join() === 'Ana Ténis';
        },
      );
    });

    // Moved back to swimming, the club may switch tennis off.
    await actingAs(tenant, { roles: ['owner'] }, () => staff.setSports(coach, { sports: ['pool'] }));
    await asOperator(() => platform.sports(tenant.organizationId, { enabled: ['pool'] }));
  });
});
