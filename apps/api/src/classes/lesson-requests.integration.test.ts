import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionForReader } from '../attention/attention.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';
import { AttendanceController } from './attendance.controller.js';
import { CoverRequestsController, LessonRequestsController } from './lesson-requests.controller.js';
import { SessionsCalendarController } from './sessions.controller.js';

/**
 * A teacher asks for a substitute, and the office assigns one — POOLSE-198.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

async function lesson(
  tenant: ScratchTenant,
): Promise<{ sessionId: string; ana: string; bruno: string }> {
  const ana = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const bruno = await addMember(tenant, 'Bruno', 'Carvalho', ['instructor']);
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
     VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id, ana],
  );
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, ends_at, duration_minutes)
     VALUES ($1, $2, $3, $4, (now() + interval '1 day')::date, now() + interval '1 day',
             now() + interval '1 day 45 minutes', 45) RETURNING id`,
    [tenant.organizationId, group!.id, pool!.id, ana],
  );
  return { sessionId: row!.id, ana, bruno };
}

test('a teacher asks, the circle shows, the office assigns, and it closes', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, bruno } = await lesson(tenant);
    const cover = new CoverRequestsController();
    const office = new LessonRequestsController();

    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await cover.request(sessionId, { note: 'Consulta médica' });
      await expectStatus(() => cover.request(sessionId, {}), 409);
      const register = await new AttendanceController().register(sessionId);
      assert.equal(register.coverRequest?.note, 'Consulta médica');
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { requests } = await office.open();
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.kind, 'substitute');
      assert.equal((await attentionForReader()).menu['calendar'], 1);

      await new SessionsCalendarController().standIn(sessionId, { membershipId: bruno });
      assert.equal((await office.open()).requests.length, 0);
      assert.equal((await attentionForReader()).menu['calendar'], undefined);
    });
  });
});

test('a teacher withdraws their own request, and only their own lesson', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, bruno } = await lesson(tenant);
    const cover = new CoverRequestsController();
    await actingAs(tenant, { membershipId: bruno, roles: ['instructor'] }, () =>
      expectStatus(() => cover.request(sessionId, {}), 403),
    );
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await cover.request(sessionId, {});
      await cover.withdraw(sessionId);
      await expectStatus(() => cover.withdraw(sessionId), 404);
    });
  });
});

test('a teacher no longer picks a stand-in; the office does', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, bruno } = await lesson(tenant);
    const sessions = new SessionsCalendarController();
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await expectStatus(() => sessions.standIn(sessionId, { membershipId: bruno }), 403);
      await expectStatus(() => sessions.standInOptions(sessionId), 403);
    });
  });
});

test('a teacher cancels only with a reason, and the office is told until it has seen', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana } = await lesson(tenant);
    const sessions = new SessionsCalendarController();
    const office = new LessonRequestsController();
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await new CoverRequestsController().request(sessionId, {});
      await expectStatus(() => sessions.cancel(sessionId, {}), 400);
      await sessions.cancel(sessionId, { reason: 'Ninguém pode cobrir' });
    });
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { requests } = await office.open();
      assert.deepEqual(
        requests.map((one) => [one.kind, one.note]),
        [['cancelled', 'Ninguém pode cobrir']],
        'the open cover request closed with it',
      );
      await office.seen(requests[0]!.id);
      assert.equal((await office.open()).requests.length, 0);
    });
  });
});

test('the office’s list is the office’s', async () => {
  await withScratchTenant(async (tenant) => {
    for (const roles of [['instructor'], ['guardian'], ['maintenance'], ['student']] as const) {
      await actingAs(tenant, { roles: [...roles] }, () => expectStatus(() => new LessonRequestsController().open(), 403));
    }
    await withScratchTenant(async (club) => {
      const { sessionId } = await lesson(tenant);
      const teacher = await addMember(club, 'Rita', 'Costa', ['instructor']);
      await actingAs(club, { membershipId: teacher, roles: ['instructor'] }, () =>
        expectStatus(() => new CoverRequestsController().request(sessionId, {}), 403),
      );
    });
  });
});
