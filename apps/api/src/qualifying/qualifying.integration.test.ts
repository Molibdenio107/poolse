import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { QualifyingController } from './qualifying.controller.js';
import { RecordsController } from '../students/records.controller.js';
import { LevelsController } from '../students/students.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Gap to qualify — POOLSE-85, through the API: the grid, the student's gap
 * table, the coach's board, archiving and the refusals. Which time counts is
 * proved in `packages/db/test/qualifying.sql`; this proves the paths read it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function swimmer(
  tenant: ScratchTenant,
  firstName: string,
  birthDate: string | null,
  levelId: string | null = null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, gender, level_id)
     VALUES ($1, $2, 'Nadadora', $3, 'female', $4) RETURNING id`,
    [tenant.organizationId, firstName, birthDate, levelId],
  );
  return row!.id;
}

/** A Juvenis girls' band, a standard with a wide window, and two entry times. */
async function setUp(tenant: ScratchTenant): Promise<{ standardId: string; groupId: string }> {
  const q = new QualifyingController();
  return actingAs(tenant, { roles: ['instructor'] }, async () => {
    const { id: groupId } = await q.addAgeGroup({
      seasonId: tenant.seasonId,
      name: 'Juvenis',
      gender: 'female',
      bornFrom: 2011,
      bornTo: 2012,
    });
    const { id: standardId } = await q.addStandard({
      seasonId: tenant.seasonId,
      name: 'Nacionais de Juvenis',
      windowFrom: '2026-01-01',
      windowTo: '2027-12-31',
    });
    await q.setTimes(standardId, groupId, {
      times: [
        { stroke: 'freestyle', distanceM: 100, course: 'lcm', time: '1:05.00' },
        { stroke: 'butterfly', distanceM: 50, course: 'lcm', time: '31,50' },
      ],
    });
    return { standardId, groupId };
  });
}

async function officialTime(studentId: string, stroke: string, distanceM: number, seconds: number, hundredths: number) {
  await new RecordsController().add(studentId, {
    stroke,
    distanceM,
    course: 'lcm',
    swumOn: '2026-10-01',
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60),
    hundredths: String(hundredths),
    meetName: 'Regional de Outono',
    meetOfficial: true,
  });
}

test('the grid saves a column whole, refuses an unreadable cell by name, and clears an empty one', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId, groupId } = await setUp(tenant);
    const q = new QualifyingController();

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      try {
        await q.setTimes(standardId, groupId, {
          times: [
            { stroke: 'freestyle', distanceM: 100, course: 'lcm', time: '1.05.00' },
            { stroke: 'butterfly', distanceM: 50, course: 'lcm', time: '30.90' },
          ],
        });
        assert.fail('an ambiguous time was accepted');
      } catch (error) {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 422);
        const body = error.getResponse() as { fields: Record<string, string> };
        assert.deepEqual(body.fields, { 'freestyle-100-lcm': 'qualifying.badTime' });
      }
      // Nothing was written by the refused save.
      let read = await q.standard(standardId);
      assert.equal(read.times.find((t) => t.stroke === 'butterfly')?.timeMs, 31500);

      const result = await q.setTimes(standardId, groupId, {
        times: [
          { stroke: 'freestyle', distanceM: 100, course: 'lcm', time: '' },
          { stroke: 'butterfly', distanceM: 50, course: 'lcm', time: '30.90' },
        ],
      });
      assert.deepEqual(result, { added: 0, changed: 1, cleared: 1 });
      read = await q.standard(standardId);
      assert.deepEqual(
        read.times.map((t) => [t.stroke, t.timeMs]),
        [['butterfly', 30900]],
      );
    });
  });
});

test('QA 2, 6 — the student page carries the gap; no birth date says so', async () => {
  await withScratchTenant(async (tenant) => {
    await setUp(tenant);
    const ana = await swimmer(tenant, 'Ana', '2012-05-01');
    const nobody = await swimmer(tenant, 'Sem', null);
    const records = new RecordsController();

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await officialTime(ana, 'freestyle', 100, 64, 20);

      const read = await records.read(ana);
      assert.ok(read.qualifying);
      assert.deepEqual(read.qualifying.ageGroups, ['Juvenis']);
      const [standard] = read.qualifying.standards;
      assert.equal(standard?.name, 'Nacionais de Juvenis');
      const free = standard?.rows.find((row) => row.stroke === 'freestyle');
      assert.equal(free?.bestMs, 64200);
      assert.equal(free?.gapMs, -800, 'qualified by eight tenths');
      const fly = standard?.rows.find((row) => row.stroke === 'butterfly');
      assert.equal(fly?.bestMs, null, 'no valid time is not a gap');
      assert.equal(fly?.gapMs, null);

      const none = await records.read(nobody);
      assert.equal(none.qualifying?.noBand, 'birthDate');
      assert.deepEqual(none.qualifying?.standards, []);
    });
  });
});

test('the board lists qualified, close and unplaced swimmers', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId } = await setUp(tenant);
    const levels = new LevelsController();
    const team = await actingAs(tenant, { roles: ['owner'] }, () =>
      levels.create({ name: 'Competição', competitive: true }),
    );
    const ana = await swimmer(tenant, 'Ana', '2012-05-01', team.id);
    const bia = await swimmer(tenant, 'Bia', '2011-02-01', team.id);
    await swimmer(tenant, 'Carla', '2011-02-01', team.id);
    await swimmer(tenant, 'Dora', null, team.id);
    // Swim school, no time: not on the board.
    await swimmer(tenant, 'Eva', '2012-01-01');

    const q = new QualifyingController();
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await officialTime(ana, 'freestyle', 100, 64, 20);
      await officialTime(bia, 'freestyle', 100, 66, 10);

      const board = await q.board(standardId, '2000');
      const byName = new Map(board.swimmers.map((s) => [s.name.split(' ')[0], s]));
      assert.equal(byName.get('Ana')?.qualified.length, 1);
      assert.equal(byName.get('Bia')?.close[0]?.gapMs, 1100);
      assert.equal(byName.get('Carla')?.noTime, 2);
      assert.equal(byName.has('Eva'), false, 'a swim-school child with no time stays off the board');
      assert.deepEqual(
        board.unplaced.map((u) => [u.name.split(' ')[0], u.reason]),
        [['Dora', 'birthDate']],
      );

      const tight = await q.board(standardId, '500');
      assert.equal(tight.swimmers.find((s) => s.name.startsWith('Bia'))?.close.length, 0);
    });
  });
});

test('archiving a standard takes it off the student page; an instructor may not archive', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId } = await setUp(tenant);
    const ana = await swimmer(tenant, 'Ana', '2012-05-01');
    const q = new QualifyingController();

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => q.removeStandard(standardId), 403);
    });
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      await q.removeStandard(standardId);
      assert.equal((await new RecordsController().read(ana)).qualifying, null);
      await expectStatus(() => q.standard(standardId), 404);
    });
  });
});

test('a name twice in one season is a 409 on the name; another club cannot read ours', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId } = await setUp(tenant);
    const q = new QualifyingController();

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      try {
        await q.addStandard({ seasonId: tenant.seasonId, name: ' nacionais de juvenis ' });
        assert.fail('a second standard of the same name was accepted');
      } catch (error) {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 409);
        assert.deepEqual((error.getResponse() as { fields: unknown }).fields, {
          name: 'qualifying.standardTaken',
        });
      }
      await expectStatus(
        () => q.addAgeGroup({ seasonId: tenant.seasonId, name: 'X', bornFrom: 2012, bornTo: 2010 }),
        422,
      );
    });

    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        await expectStatus(() => q.standard(standardId), 404);
        await expectStatus(() => q.board(standardId), 404);
      });
    });
  });
});
