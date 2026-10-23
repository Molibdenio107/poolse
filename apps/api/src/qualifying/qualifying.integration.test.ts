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
    const team = await actingAs(tenant, { roles: ['owner'] }, () =>
      new LevelsController().create({ name: 'Competição', competitive: true }),
    );
    const nobody = await swimmer(tenant, 'Sem', null, team.id);
    const learner = await swimmer(tenant, 'Bebé', '2012-03-01');
    const noGender = await swimmer(tenant, 'Gé', '2012-03-01', team.id);
    await tenant.sql('UPDATE student SET gender = NULL WHERE id = $1', [noGender]);
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

      // Sweep 19-10b: a learn-to-swim child with nothing to compare sees no tab at all.
      assert.equal((await records.read(learner)).qualifying, null);
      // And a missing gender is said as such, not as "no band fits".
      assert.equal((await records.read(noGender)).qualifying?.noBand, 'gender');
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

test('sweep 19-10b — an impossible date on a standard is a 422, not a 500', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId } = await setUp(tenant);
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new QualifyingController().editStandard(standardId, { name: 'X', windowFrom: '2026-02-30' }),
        422,
      );
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
      // POOLSE-111: a birth year within the last hundred years, and not in the future.
      const thisYear = new Date().getUTCFullYear();
      await expectStatus(
        () => q.addAgeGroup({ seasonId: tenant.seasonId, name: 'Y', bornFrom: thisYear - 101 }),
        422,
      );
      await expectStatus(
        () => q.addAgeGroup({ seasonId: tenant.seasonId, name: 'Z', bornTo: thisYear + 1 }),
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

test('slice 2 QA 3–4 — an import previews per cell, commits whole, and an empty cell leaves a time alone', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId, groupId } = await setUp(tenant);
    const q = new QualifyingController();
    // setUp typed 100 free lcm 1:05.00 and 50 fly lcm 31.50.
    const cells = [
      { row: 0, ageGroupId: groupId, eventLabel: '100 Livres', stroke: 'freestyle', distanceM: 100, time: '1:04,50' },
      { row: 1, ageGroupId: groupId, eventLabel: '200 Livres', stroke: 'freestyle', distanceM: 200, time: '2:20.00' },
      { row: 2, ageGroupId: groupId, eventLabel: '4x100 Livres', stroke: null, distanceM: null, time: '4:10.00' },
      { row: 3, ageGroupId: groupId, eventLabel: '100 Costas', stroke: 'backstroke', distanceM: 100, time: '1.12.00' },
      { row: 4, ageGroupId: groupId, eventLabel: '100 Livres', stroke: 'freestyle', distanceM: 100, time: '1:03.00' },
    ];

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const preview = await q.importTimes(standardId, { course: 'lcm', cells });
      assert.deepEqual(
        preview.cells.map((c) => [c.status, c.reason]),
        [
          ['changed', null],
          ['new', null],
          ['refused', 'event'],
          ['refused', 'time'],
          ['refused', 'duplicate'],
        ],
      );
      assert.equal(preview.cells[0]?.previousMs, 65000);
      assert.equal((await q.standard(standardId)).times.length, 2, 'a preview writes nothing');

      const done = await q.importTimes(standardId, { course: 'lcm', cells, commit: true });
      assert.equal(done.committed, true);
      const times = (await q.standard(standardId)).times;
      const of = (stroke: string, distanceM: number) =>
        times.find((t) => t.stroke === stroke && t.distanceM === distanceM)?.timeMs;
      assert.equal(of('freestyle', 100), 64500);
      assert.equal(of('freestyle', 200), 140000);
      assert.equal(of('butterfly', 50), 31500, 'a cell the file did not mention is left alone');
      assert.equal(of('backstroke', 100), undefined);

      // The same file again: nothing new.
      const again = await q.importTimes(standardId, { course: 'lcm', cells: cells.slice(0, 2) });
      assert.deepEqual(again.summary, { new: 0, changed: 0, unchanged: 2, refused: 0 });

      // Another pool length is another set of cells.
      const short = await q.importTimes(standardId, { course: 'scm', cells: cells.slice(0, 1) });
      assert.equal(short.cells[0]?.status, 'new');
    });
  });
});

test('slice 2 — a group from another season is refused, and a missing standard is a 404', async () => {
  await withScratchTenant(async (tenant) => {
    const { standardId } = await setUp(tenant);
    const q = new QualifyingController();
    const [old] = await tenant.sql<{ id: string }>(
      `INSERT INTO season (organization_id, name, starts_on, ends_on, status)
       VALUES ($1, 'Antiga', '2020-09-01', '2021-07-31', 'archived') RETURNING id`,
      [tenant.organizationId],
    );
    const [band] = await tenant.sql<{ id: string }>(
      `INSERT INTO federation_age_group (organization_id, season_id, name, gender)
       VALUES ($1, $2, 'Juvenis', 'female') RETURNING id`,
      [tenant.organizationId, old!.id],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await q.importTimes(standardId, {
        course: 'lcm',
        commit: true,
        cells: [{ ageGroupId: band!.id, eventLabel: '50 Livres', stroke: 'freestyle', distanceM: 50, time: '30.00' }],
      });
      assert.equal(result.cells[0]?.reason, 'ageGroup');
      await expectStatus(() => q.importTimes(standardId, { course: 'yards', cells: [] }), 400);
      await expectStatus(
        () => q.importTimes('00000000-0000-4000-8000-000000000000', { course: 'lcm', cells: [] }),
        404,
      );
    });
  });
});

test('POOLSE-111 — one click creates the FPN groups for the season; a second click adds nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const q = new QualifyingController();
    const [season] = await tenant.sql<{ end_year: number }>(
      `SELECT extract(year FROM ends_on)::int AS end_year FROM season WHERE id = $1`,
      [tenant.seasonId],
    );
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // A club that already typed one keeps it.
      await q.addAgeGroup({ seasonId: tenant.seasonId, name: 'juniores', bornFrom: 2000, bornTo: 2001 });
      const first = await q.addFpnAgeGroups({ seasonId: tenant.seasonId });
      assert.equal(first.created, 8, 'the nine, less the one the club had');
      assert.equal(first.ids.length, 9);
      const again = await q.addFpnAgeGroups({ seasonId: tenant.seasonId });
      assert.equal(again.created, 0);
      assert.deepEqual(again.ids, first.ids, 'the same groups, in the same order');

      const { ageGroups } = await q.read(tenant.seasonId);
      const byName = Object.fromEntries(ageGroups.map((g) => [g.name, g]));
      const year = season!.end_year;
      assert.equal(byName['Cadetes A']?.bornFrom, year - 12);
      assert.equal(byName['Cadetes A']?.bornTo, year - 12);
      assert.equal(byName['Seniores']?.bornFrom, null);
      assert.equal(byName['Seniores']?.bornTo, year - 19);
      assert.equal(byName['Cadetes A']?.gender, null, 'the FPN bands are the same for both');
      assert.equal(byName['juniores']?.bornFrom, 2000, "the club's own group is left as it was");
    });
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => q.addFpnAgeGroups({ seasonId: '00000000-0000-4000-8000-000000000000' }), 404),
    );
  });
});
