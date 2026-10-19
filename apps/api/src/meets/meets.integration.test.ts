import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetsController } from './meets.controller.js';
import { RecordsController } from '../students/records.controller.js';
import { ArchiveController } from '../archive/archive.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Importing a meet's results — POOLSE-81, slice 2.
 *
 * The body here is what the web's LENEX parser hands the API (`lib/lenex.ts`,
 * tested there against real file shapes); this proves what the API does with
 * it: which club, who is matched, what is written, skipped, updated, and what
 * the bin brings back.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function student(
  tenant: ScratchTenant,
  firstName: string,
  lastName: string,
  birthDate: string,
  licence: string | null = null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, federation_licence)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, firstName, lastName, birthDate, licence],
  );
  return row!.id;
}

const result = (over: Record<string, unknown> = {}) => ({
  eventNumber: 3,
  round: 'TIM',
  stroke: 'freestyle',
  distanceM: 100,
  relayCount: 1,
  course: 'lcm',
  rawCourse: 'LCM',
  swumOn: '2026-12-12',
  timeMs: 62340,
  status: '',
  ...over,
});

function file(athletes: unknown[], over: Record<string, unknown> = {}) {
  return {
    fileName: 'inverno.lxf',
    clubCode: 'CST',
    official: true,
    meet: { name: 'Torneio de Inverno', city: 'Santo Tirso', course: 'lcm', startsOn: '2026-12-12', endsOn: '2026-12-13' },
    athletes,
    confirmed: {},
    writeLicence: {},
    ...over,
  };
}

test('QA 1–6 — one club, licence and confirmed matches, results written, the rest skipped and counted', async () => {
  await withScratchTenant(async (tenant) => {
    const ines = await student(tenant, 'Inês', 'Sousa', '2012-04-03', '204117');
    const marta = await student(tenant, 'Marta', 'Costa', '2011-06-01');
    await student(tenant, 'Rui', 'Silva', '2011-01-01');
    const meets = new MeetsController();

    const athletes = [
      {
        key: 'CST:1',
        clubCode: 'CST',
        firstName: 'Inês',
        lastName: 'Sousa',
        birthDate: '2012-04-03',
        licence: '204117',
        results: [
          result({ round: 'PRE', timeMs: 62340 }),
          result({ round: 'FIN', timeMs: 61900 }),
          result({ eventNumber: 5, relayCount: 4 }),
          result({ eventNumber: 6, status: 'DSQ', timeMs: 70000 }),
          result({ eventNumber: 7, status: 'DNS', timeMs: null }),
          result({ eventNumber: 8, timeMs: null }),
        ],
      },
      {
        key: 'CST:2',
        clubCode: 'CST',
        firstName: 'Marta',
        lastName: 'Costa',
        birthDate: '2011-06-01',
        licence: '300001',
        results: [result({ eventNumber: 9, stroke: 'backstroke', distanceM: 200, course: 'scm', rawCourse: 'SCM', swumOn: '2026-12-13', timeMs: 150000 })],
      },
      {
        // Same name as a student, different birth date: nobody.
        key: 'CST:3',
        clubCode: 'CST',
        firstName: 'Rui',
        lastName: 'Silva',
        birthDate: '2011-02-02',
        licence: null,
        results: [result({ eventNumber: 10 })],
      },
    ];

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const preview = await meets.import(file(athletes));
      const byKey = Object.fromEntries(preview.athletes.map((a) => [a.key, a]));
      assert.equal(byKey['CST:1']!.match, 'licence');
      assert.equal(byKey['CST:2']!.match, 'proposed');
      assert.equal(byKey['CST:2']!.canWriteLicence, true);
      assert.equal(byKey['CST:3']!.match, 'none');
      assert.deepEqual(
        { relay: preview.skipped.relay, dsq: preview.skipped.dsq, dns: preview.skipped.dns, noTime: preview.skipped.noTime },
        { relay: 1, dsq: 1, dns: 1, noTime: 1 },
      );
      // QA 10: the faster of the heat and final is a new best for a swimmer with none.
      assert.deepEqual(
        byKey['CST:1']!.results.map((r) => [r.round, r.newBest]),
        [['PRE', false], ['FIN', true]],
      );

      const committed = await meets.import({
        ...file(athletes),
        commit: true,
        confirmed: { 'CST:2': marta },
      });
      assert.ok(committed.meetId);
    });

    // QA 4 and 6: Inês has two records (heat and final), each as the file said.
    const records = await tenant.sql<{ student_id: string; time_ms: number; course: string; round: string; swum_on: string }>(
      `SELECT student_id, time_ms, course::text, lenex_round AS round, to_char(swum_on, 'YYYY-MM-DD') AS swum_on
         FROM student_record WHERE organization_id = $1 ORDER BY student_id, time_ms`,
      [tenant.organizationId],
    );
    assert.deepEqual(
      records.filter((r) => r.student_id === ines).map((r) => [r.time_ms, r.course, r.round, r.swum_on]),
      [[61900, 'lcm', 'FIN', '2026-12-12'], [62340, 'lcm', 'PRE', '2026-12-12']],
    );
    assert.equal(records.filter((r) => r.student_id === marta).length, 1, 'the confirmed proposal was written');
    assert.equal(records.length, 3, 'nothing for the unmatched swimmer, nothing skipped');

    const [club] = await tenant.sql<{ code: string; licence: string }>(
      `SELECT o.federation_club_code AS code,
              (SELECT federation_licence FROM student WHERE id = $2) AS licence
         FROM organization o WHERE o.id = $1`,
      [tenant.organizationId, marta],
    );
    assert.deepEqual(club, { code: 'CST', licence: '300001' }, 'the club is remembered; Marta gains her licence');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const list = await new MeetsController().list();
      assert.equal(list.rememberedClubCode, 'CST');
      const detail = await new MeetsController().one(list.items[0]!.id);
      assert.deepEqual(detail.unmatched, [{ name: 'Rui Silva', results: 1 }]);
      assert.equal(detail.official, true);

      // QA 7: the same file again previews nothing new and writes nothing.
      const again = await meets.import({ ...file(athletes), confirmed: { 'CST:2': marta } });
      assert.equal(again.totals.new, 0);
      assert.equal(again.totals.update, 0);

      // A corrected time is one update, through the record's path, audited.
      athletes[0]!.results[1] = result({ round: 'FIN', timeMs: 61800 });
      const corrected = await meets.import({ ...file(athletes), commit: true, confirmed: { 'CST:2': marta } });
      assert.equal(corrected.totals.update, 1);
      assert.equal(corrected.totals.new, 0);
    });

    const [audit] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE organization_id = $1 AND action = 'student_record.updated'
          AND data->'before'->>'timeMs' = '61900' AND data->'after'->>'timeMs' = '61800'`,
      [tenant.organizationId],
    );
    assert.equal(audit!.n, 1);
  });
});

test('QA 13–14 — families are refused; archiving a meet takes its results out of the bests and the bin brings them back', async () => {
  await withScratchTenant(async (tenant) => {
    const ines = await student(tenant, 'Inês', 'Sousa', '2012-04-03', '204117');
    const meets = new MeetsController();

    for (const role of ['guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        await expectStatus(() => meets.list(), 403);
        await expectStatus(() => meets.one('00000000-0000-4000-8000-000000000000'), 403);
        await expectStatus(() => meets.import(file([])), 403);
        await expectStatus(() => meets.archive('00000000-0000-4000-8000-000000000000'), 403);
      });
    }

    let meetId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const done = await meets.import({
        ...file([
          { key: 'CST:1', clubCode: 'CST', firstName: 'Inês', lastName: 'Sousa', birthDate: '2012-04-03', licence: '204117', results: [result()] },
        ]),
        commit: true,
      });
      meetId = done.meetId!;
      assert.equal((await new RecordsController().read(ines)).bests.length, 1);

      // An instructor may import but not archive.
      await actingAs(tenant, { roles: ['instructor'] }, async () => {
        await expectStatus(() => meets.archive(meetId), 403);
      });

      const { archiveEntryId } = await meets.archive(meetId);
      assert.equal((await new RecordsController().read(ines)).bests.length, 0, 'out of the bests');

      const restored = await new ArchiveController().restore(archiveEntryId);
      assert.deepEqual(restored.children, { student_record: 1 });
      assert.equal((await new RecordsController().read(ines)).bests.length, 1, 'back, exactly those');
    });

    // Another club cannot see this one's meet.
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        await expectStatus(() => new MeetsController().one(meetId), 404);
      });
    });
  });
});
