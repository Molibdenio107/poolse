import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { RecordsController } from './records.controller.js';
import { LevelsController, StudentsController } from './students.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The competition pathway — POOLSE-81, slice 1: pool length on every time,
 * bests per course with the official one beside them, meets named by hand, the
 * FPN licence and the competitive level.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function student(tenant: ScratchTenant, firstName: string, levelId: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, level_id)
     VALUES ($1, $2, 'Nadadora', '2012-03-04', $3) RETURNING id`,
    [tenant.organizationId, firstName, levelId],
  );
  return row!.id;
}

const time = (minutes: number, seconds: number, hundredths: number) => ({
  minutes: String(minutes),
  seconds: String(seconds),
  hundredths: String(hundredths),
});

test('QA 8–9 — a 25 m and a 50 m best are two bests; a time with no pool counts as neither', async () => {
  await withScratchTenant(async (tenant) => {
    const swimmer = await student(tenant, 'Inês');
    const records = new RecordsController();

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const base = { stroke: 'freestyle', distanceM: 100, swumOn: '2026-09-10' };
      await records.add(swimmer, { ...base, course: 'scm', ...time(1, 0, 0) });
      await records.add(swimmer, { ...base, course: 'lcm', ...time(1, 2, 0) });
      await records.add(swimmer, { ...base, course: '', ...time(0, 58, 0) });

      const read = await records.read(swimmer);
      const bests = read.bests.map((best) => [best.course, best.timeMs]);
      assert.deepEqual(bests, [['scm', 60000], ['lcm', 62000], [null, 58000]]);
      assert.equal(
        read.records.filter((record) => record.isPersonalBest).length,
        3,
        'one best per pool, never 58.00 standing for all three',
      );
    });
  });
});

test("Rui's call — a typed time names a meet, and an official meet's best shows beside the overall", async () => {
  await withScratchTenant(async (tenant) => {
    const swimmer = await student(tenant, 'Rita');
    const records = new RecordsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const base = { stroke: 'butterfly', distanceM: 50, course: 'lcm' };
      // A training time, faster than anything at a meet.
      await records.add(swimmer, { ...base, swumOn: '2026-09-01', ...time(0, 31, 50) });
      // A meet named here and marked official.
      await records.add(swimmer, {
        ...base,
        swumOn: '2026-09-20',
        meetName: 'Torneio de Outono',
        meetOfficial: true,
        ...time(0, 32, 10),
      });
      // The same meet named again on the same day is the same meet.
      await records.add(swimmer, {
        ...base,
        stroke: 'freestyle',
        swumOn: '2026-09-20',
        meetName: 'torneio de outono ',
        meetOfficial: false,
        ...time(0, 29, 0),
      });

      const read = await records.read(swimmer);
      assert.equal(read.meets.length, 1, 'one meet, reused by name and day');
      assert.equal(read.meets[0]!.official, true, 'the first naming decided it');

      const fly = read.bests.find((best) => best.stroke === 'butterfly')!;
      assert.equal(fly.timeMs, 31500, 'the overall best is the training time');
      assert.equal(fly.official, false);
      assert.deepEqual(fly.officialBest, {
        timeMs: 32100,
        swumOn: '2026-09-20',
        meetName: 'Torneio de Outono',
      });

      // An existing meet by id; one from another club is refused.
      await records.add(swimmer, { ...base, swumOn: '2026-09-20', meetId: read.meets[0]!.id, ...time(0, 33, 0) });
      try {
        await records.add(swimmer, {
          ...base,
          swumOn: '2026-09-20',
          meetId: '00000000-0000-4000-8000-000000000000',
          ...time(0, 33, 0),
        });
        assert.fail('a meet that is not this club’s was accepted');
      } catch (error) {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 422);
      }
    });
  });
});

test('QA 11 — the FPN licence is unique per club, and its absence in a competitive level warns', async () => {
  await withScratchTenant(async (tenant) => {
    const levels = new LevelsController();
    const students = new StudentsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id: team } = await levels.create({ name: 'Competição', competitive: true });
      const { id: school } = await levels.create({ name: 'Iniciação' });
      const listed = await tenant.sql<{ name: string; competitive: boolean }>(
        `SELECT name, competitive FROM student_level WHERE organization_id = $1 ORDER BY name`,
        [tenant.organizationId],
      );
      assert.deepEqual(
        listed.map((level) => [level.name, level.competitive]),
        [['Competição', true], ['Iniciação', false]],
      );

      const inTeam = await student(tenant, 'Joana', team);
      const inSchool = await student(tenant, 'Marta', school);
      assert.equal((await students.one(inTeam)).licenceMissing, true, 'competitive, no licence: warned');
      assert.equal((await students.one(inSchool)).licenceMissing, false);

      const body = (firstName: string, licence: string) => ({
        firstName,
        lastName: 'Nadadora',
        birthDate: '1990-01-01',
        levelId: team,
        federationLicence: licence,
      });
      await students.update(inTeam, body('Joana', '204117'));
      assert.equal((await students.one(inTeam)).licenceMissing, false);
      assert.equal((await students.one(inTeam)).federationLicence, '204117');

      // The same licence on a second student of this club: a 409 naming the field.
      try {
        await students.update(inSchool, body('Marta', '204117'));
        assert.fail('two students shared one licence');
      } catch (error) {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 409);
        assert.deepEqual((error.getResponse() as { fields?: unknown }).fields, {
          federationLicence: 'students.licenceTaken',
        });
      }
    });

    // The change is logged by name, never by value.
    const [entry] = await tenant.sql<{ data: { withheld?: string[]; after?: Record<string, unknown> } }>(
      `SELECT data FROM audit_log WHERE organization_id = $1 AND action = 'student.updated'
        ORDER BY created_at DESC LIMIT 1`,
      [tenant.organizationId],
    );
    assert.ok(entry!.data.withheld?.includes('federationLicence'));
    assert.equal(JSON.stringify(entry!.data).includes('204117'), false);
  });
});

test('QA 13 — a family reads its child’s times; it cannot record one', async () => {
  await withScratchTenant(async (tenant) => {
    const swimmer = await student(tenant, 'Lia');
    await actingAs(tenant, { roles: ['guardian', 'student'] }, async () => {
      await expectStatus(
        () => new RecordsController().add(swimmer, { stroke: 'freestyle', distanceM: 50, swumOn: '2026-09-01', ...time(0, 40, 0) }),
        403,
      );
    });
  });
});
