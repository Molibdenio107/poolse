import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { findScheduleClashes } from './sessions.repository.js';
import {
  actingAs,
  addMember,
  closeHarness,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * When one instructor is booked twice — F-07.
 *
 * The reported bug was in the *sentence*: the API returned the two turmas' start
 * times and the screen joined them with an en dash, so two classes both
 * beginning at 12:45 read "Segunda 12:45–12:45" — a window of no length, and
 * nothing an operator could act on.
 *
 * `findScheduleClashes` had no test at all, which is the thing this codebase
 * names outright: a repository function with no integration test is untested
 * SQL. The generation behaviour is untouched — all-or-nothing stays as it was.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/**
 * Two turmas on one instructor, on Monday, at the times given.
 *
 * Both need the same instructor: the query is about one person being in two
 * places, so a fixture with two instructors would find nothing and pass for the
 * wrong reason.
 */
async function twoClasses(
  tenant: ScratchTenant,
  first: { name: string; startTime: string; durationMinutes: number },
  second: { name: string; startTime: string; durationMinutes: number },
): Promise<void> {
  const instructor = await addMember(tenant, 'Nuno', 'Pereira', ['instructor']);

  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order)
     VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );

  for (const one of [first, second]) {
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, level_id,
                                instructor_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        tenant.organizationId,
        tenant.seasonId,
        tenant.facilityId,
        one.name,
        level!.id,
        instructor,
      ],
    );

    await tenant.sql(
      `INSERT INTO class_schedule (organization_id, facility_id, class_group_id, weekday,
                                   start_time, duration_minutes)
       VALUES ($1, $2, $3, 1, $4::time, $5)`,
      [tenant.organizationId, tenant.facilityId, group!.id, one.startTime, one.durationMinutes],
    );
  }
}

test('F-07 — two classes starting at the same time report a real overlap, not 12:45–12:45', async () => {
  await withScratchTenant(async (tenant) => {
    // The exact shape from the report: both at 12:45, different lengths.
    await twoClasses(
      tenant,
      { name: 'Hidro ginástica bebés', startTime: '12:45', durationMinutes: 45 },
      { name: 'Aperfeiçoamento', startTime: '12:45', durationMinutes: 30 },
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const clashes = await findScheduleClashes(tenant.organizationId);
      assert.equal(clashes.length, 1);
      const clash = clashes[0]!;

      assert.equal(clash.weekday, 1);

      // Each turma's own hours: what tells the operator which one to move.
      const hydro = clash.firstClass === 'Hidro ginástica bebés';
      assert.equal(hydro ? clash.firstTo : clash.secondTo, '13:30');
      assert.equal(hydro ? clash.secondTo : clash.firstTo, '13:15');

      /*
       * And the overlap, which is the part that makes it a clash. The later
       * start to the earlier end — here the whole of the shorter class.
       */
      assert.equal(clash.overlapFrom, '12:45');
      assert.equal(clash.overlapTo, '13:15');
      assert.notEqual(clash.overlapFrom, clash.overlapTo, 'never a zero-length window');
    });
  });
});

test('F-07 — a partial overlap reports only the part that overlaps', async () => {
  await withScratchTenant(async (tenant) => {
    await twoClasses(
      tenant,
      { name: 'Cadetes', startTime: '18:00', durationMinutes: 60 },
      { name: 'Infantis', startTime: '18:30', durationMinutes: 60 },
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const [clash] = await findScheduleClashes(tenant.organizationId);

      // 18:00–19:00 and 18:30–19:30 share half an hour, and that half hour is
      // what the operator has to remove. Order-independent, deliberately.
      assert.equal(clash?.overlapFrom, '18:30');
      assert.equal(clash?.overlapTo, '19:00');

      /*
       * "First" and "second" are whichever turma has the lower uuid — the pair
       * is de-duplicated with `b.group_id > a.group_id` — so asserting them
       * positionally is a coin toss that passes in isolation and fails in a full
       * run. Read each turma by name instead.
       */
      const cadetes = clash!.firstClass === 'Cadetes';
      assert.equal(cadetes ? clash!.firstFrom : clash!.secondFrom, '18:00');
      assert.equal(cadetes ? clash!.firstTo : clash!.secondTo, '19:00');
      assert.equal(cadetes ? clash!.secondFrom : clash!.firstFrom, '18:30');
      assert.equal(cadetes ? clash!.secondTo : clash!.firstTo, '19:30');
    });
  });
});

test('F-07 — back-to-back classes are not a clash', async () => {
  await withScratchTenant(async (tenant) => {
    await twoClasses(
      tenant,
      { name: 'Cadetes', startTime: '18:00', durationMinutes: 45 },
      { name: 'Infantis', startTime: '18:45', durationMinutes: 45 },
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      /*
       * Half-open, agreeing with the exclusion constraint the calendar rests on.
       * An instructor finishing at 18:45 and starting at 18:45 is an ordinary
       * afternoon, and reporting it would make the clash list unusable — which
       * is the failure mode a well-meaning `<=` introduces.
       */
      assert.deepEqual(await findScheduleClashes(tenant.organizationId), []);
    });
  });
});
