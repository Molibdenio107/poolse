import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionForReader } from '../attention/attention.controller.js';
import { currentTenant, tenantStorage } from '../tenant/tenant.context.js';
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

test('a colleague reads the roll, never the faces, what families said or the cover note', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, bruno } = await lesson(tenant);
    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date) VALUES ($1, 'Alice', 'Silva', '2016-01-01')`,
      [tenant.organizationId],
    );
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, () =>
      new CoverRequestsController().request(sessionId, { note: 'Consulta médica' }),
    );
    await actingAs(tenant, { membershipId: bruno, roles: ['instructor'] }, async () => {
      const register = await new AttendanceController().register(sessionId);
      assert.equal(register.canRecord, false);
      assert.equal(register.coverRequest, null);
      assert.deepEqual(register.notices, []);
      assert.equal(register.canRequestCover, false);
    });
  });
});

test('under a view the register carries no exam, insurance, note or cover note (POOLSE-188 rule 8)', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana } = await lesson(tenant);
    const [group] = await tenant.sql<{ id: string }>(
      `SELECT class_group_id AS id FROM class_session WHERE id = $1`,
      [sessionId],
    );
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, 'Alice', 'Silva', '2016-01-01') RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 10)`,
      [tenant.organizationId, group!.id, student!.id],
    );
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await new CoverRequestsController().request(sessionId, { note: 'Consulta médica' });
      const plain = await new AttendanceController().register(sessionId);
      assert.equal(plain.coverRequest?.note, 'Consulta médica');
      const viewed = await tenantStorage.run({ ...currentTenant(), viewing: { id: 'v', hat: 'teaching' } }, () =>
        new AttendanceController().register(sessionId),
      );
      assert.equal(viewed.coverRequest?.note, null);
      assert.equal(viewed.entries[0]!.examState, 'none');
      assert.equal(viewed.entries[0]!.note, null);
    });
  });
});

test('after a stand-in is named, only they may ask; cover for a lesson that is gone stops waiting', async () => {
  await withScratchTenant(async (tenant) => {
    const { sessionId, ana, bruno } = await lesson(tenant);
    const cover = new CoverRequestsController();
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, () => cover.request(sessionId, {}));
    await tenant.sql(`UPDATE class_session SET starts_at = now() - interval '2 hours' WHERE id = $1`, [sessionId]);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await new LessonRequestsController().open()).requests.length, 0);
      assert.equal((await attentionForReader()).menu['calendar'], undefined);
    });
    await tenant.sql(`UPDATE class_session SET starts_at = now() + interval '1 day' WHERE id = $1`, [sessionId]);
    await actingAs(tenant, { roles: ['owner'] }, () => new SessionsCalendarController().standIn(sessionId, { membershipId: bruno }));
    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, () =>
      expectStatus(() => cover.request(sessionId, {}), 403),
    );
  });
});
