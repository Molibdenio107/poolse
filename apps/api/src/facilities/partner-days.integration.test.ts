import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * A partnership group on several days — POOLSE-117.
 *
 * **One action, several days, all or nothing.** A clash on any day writes
 * nothing and names every refused day, by day, lane and holder.
 *
 * **Removing a day ends that booking only**, and the group's other days stay.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function fixture(tenant: ScratchTenant): Promise<{ lanes: string[]; sixA: string; sixB: string }> {
  await tenant.sql(`UPDATE season SET status = 'published' WHERE id = $1`, [tenant.seasonId]);
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  await tenant.sql(`UPDATE lane SET name = 'Pista 1' WHERE pool_id = $1 AND position = 1`, [pool!.id]);
  await tenant.sql(
    `INSERT INTO lane (organization_id, pool_id, name, position)
     SELECT $1, $2, 'Pista ' || n, n FROM generate_series(2, 4) AS n`,
    [tenant.organizationId, pool!.id],
  );
  const lanes = (await tenant.sql<{ id: string }>(`SELECT id FROM lane WHERE pool_id = $1 ORDER BY position`, [pool!.id])).map(
    (lane) => lane.id,
  );
  const partners = new PartnersController();
  const school = await partners.create(tenant.facilityId, { name: 'ES D. Dinis', type: 'escola' });
  const sixA = (await partners.createGroup(school.id, { name: '6A', participantCount: 24 })).id;
  const sixB = (await partners.createGroup(school.id, { name: '6B', participantCount: 22 })).id;
  return { lanes, sixA, sixB };
}

async function days(tenant: ScratchTenant, groupId: string): Promise<{ weekday: number; start: string; lanes: number }[]> {
  return tenant.sql(
    `SELECT cs.weekday, to_char(cs.start_time, 'HH24:MI') AS start,
            (SELECT count(*)::int FROM booking_lane bl WHERE bl.schedule_id = cs.id) AS lanes
       FROM class_schedule cs
      WHERE cs.partner_group_id = $1 AND cs.archived_at IS NULL
      ORDER BY cs.weekday`,
    [groupId],
  );
}

test('QA 1–3: a group is booked on two days at once, refused whole on a clash, and a day comes off', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { lanes, sixA, sixB } = await fixture(tenant);
      const partners = new PartnersController();

      // QA 1: Monday and Wednesday, 10:00, Pista 2.
      const placed = await partners.bookDays(sixA, {
        weekdays: [1, 3],
        startTime: '10:00',
        durationMinutes: 45,
        laneIds: [lanes[1]],
      });
      assert.equal(placed.ids.length, 2);
      assert.deepEqual(await days(tenant, sixA), [
        { weekday: 1, start: '10:00', lanes: 1 },
        { weekday: 3, start: '10:00', lanes: 1 },
      ]);

      // QA 2: 6B on Tuesday and Wednesday in the same lane — Wednesday is 6A's,
      // so nothing is booked, not even Tuesday, and the refusal names Wednesday.
      let refusal: unknown;
      try {
        await partners.bookDays(sixB, { weekdays: [2, 3], startTime: '10:15', durationMinutes: 45, laneIds: [lanes[1]] });
      } catch (error) {
        refusal = error;
      }
      assert.ok(refusal instanceof ConflictException);
      const body = (refusal as ConflictException).getResponse() as {
        code: string;
        clashes: { weekday: number; reason: string; lane?: string; holder?: string }[];
      };
      assert.equal(body.code, 'partner_days_clash');
      assert.deepEqual(body.clashes, [{ weekday: 3, reason: 'lane_taken', lane: 'Pista 2', holder: '6A' }]);
      assert.deepEqual(await days(tenant, sixB), []);

      // The same day and hour twice is a refusal too, never a second row.
      await expectStatus(
        () => partners.bookDays(sixA, { weekdays: [1], startTime: '10:00', durationMinutes: 45, laneIds: [] }),
        409,
      );

      // QA 3: Thursday 14:00 in Sem pista, then Monday comes off; Wednesday and Thursday stay.
      await partners.bookDays(sixA, { weekdays: [4], startTime: '14:00', durationMinutes: 60, laneIds: [] });
      const [monday] = await tenant.sql<{ id: string }>(
        `SELECT id FROM class_schedule WHERE partner_group_id = $1 AND weekday = 1 AND archived_at IS NULL`,
        [sixA],
      );
      await partners.removeDay(monday!.id);
      assert.deepEqual(await days(tenant, sixA), [
        { weekday: 3, start: '10:00', lanes: 1 },
        { weekday: 4, start: '14:00', lanes: 0 },
      ]);
      await expectStatus(() => partners.removeDay(monday!.id), 404);
    });
  });
});

test('QA 8: an instructor may not book or remove a partnership day', async () => {
  await withScratchTenant(async (tenant) => {
    let sixA = '';
    let scheduleId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      ({ sixA } = await fixture(tenant));
      scheduleId = (await new PartnersController().bookDays(sixA, {
        weekdays: [2],
        startTime: '11:00',
        durationMinutes: 45,
        laneIds: [],
      })).ids[0]!;
    });
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const partners = new PartnersController();
      await expectStatus(
        () => partners.bookDays(sixA, { weekdays: [4], startTime: '11:00', durationMinutes: 45, laneIds: [] }),
        403,
      );
      await expectStatus(() => partners.removeDay(scheduleId), 403);
    });
  });
});

test('with no published season, days are refused in words', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { sixA } = await fixture(tenant);
      await tenant.sql(`UPDATE season SET status = 'draft' WHERE id = $1`, [tenant.seasonId]);
      await expectStatus(
        () => new PartnersController().bookDays(sixA, { weekdays: [1], startTime: '10:00', durationMinutes: 45, laneIds: [] }),
        409,
      );
    });
  });
});

async function slots(tenant: ScratchTenant): Promise<void> {
  await tenant.sql(
    `INSERT INTO facility_time_slot (organization_id, facility_id, season_id, day_group, start_time, end_time)
     VALUES ($1, $2, $3, 'weekday', '10:00', '10:45'), ($1, $2, $3, 'weekday', '14:00', '15:00')`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId],
  );
}

test('QA 4–7: the sheet books days in Sem pista, adds days on a second row, refuses an unknown length, and a round trip changes nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await fixture(tenant);
      await slots(tenant);
      const partners = new PartnersController();
      const row = (group: string, weekdays: string, startTime: string, extra: Record<string, string> = {}) => ({
        partnerName: 'Colégio Novo',
        groupName: group,
        participantCount: '20',
        weekdays,
        startTime,
        ...extra,
      });

      // QA 6: 10:20 has no slot and no Duração — that row is refused with its reason.
      const preview = await partners.import(tenant.facilityId, {
        rows: [row('3A', 'Seg, Qua', '10:00'), row('3A', 'Qui', '14:00'), row('3B', 'Ter', '10:20'), row('3C', 'Seg a Qua', '10:00')],
        commit: false,
      });
      assert.deepEqual(preview.rows[0]!.newDays, [1, 3]);
      assert.equal(preview.rows[0]!.durationMinutes, 45, "the slot's length");
      assert.equal(preview.rows[1]!.moreDaysOf, 2, 'QA 5: more days, not a duplicate');
      assert.equal(preview.rows[1]!.importable, true);
      assert.equal(preview.rows[2]!.problems[0]?.code, 'durationRequired');
      assert.equal(preview.rows[3]!.problems[0]?.code, 'dayRange');
      assert.equal(preview.summary.daysToBook, 3);

      // The same day and hour twice is still the duplicate it always was.
      const twice = await partners.import(tenant.facilityId, {
        rows: [row('3A', 'Seg', '10:00'), row('3A', 'Seg', '10:00')],
        commit: false,
      });
      assert.equal(twice.rows[1]!.repeatOfLine, 2);

      // QA 4: commit the good rows — two days and one more, all in Sem pista.
      const committed = await partners.import(tenant.facilityId, {
        rows: [row('3A', 'Seg, Qua', '10:00'), row('3A', 'Qui', '14:00', { durationMinutes: '60' })],
        commit: true,
      });
      assert.equal(committed.bookedDays, 3);
      const [group] = await tenant.sql<{ id: string }>(`SELECT id FROM partner_group WHERE name = '3A'`);
      assert.deepEqual(await days(tenant, group!.id), [
        { weekday: 1, start: '10:00', lanes: 0 },
        { weekday: 3, start: '10:00', lanes: 0 },
        { weekday: 4, start: '14:00', lanes: 0 },
      ]);

      // QA 7: what the export writes, the import reads back as igual — and writes nothing.
      const exported = await partners.exportAll(tenant.facilityId);
      const back = exported.rows
        .filter((line) => line.groupName === '3A')
        .map((line) => ({
          partnerName: line.partnerName,
          groupName: line.groupName,
          participantCount: String(line.participantCount),
          weekdays: line.weekdays.map((day) => ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day]).join(', '),
          startTime: line.startTime ?? '',
          durationMinutes: String(line.durationMinutes ?? ''),
        }));
      assert.equal(back.length, 2, 'one line per hour');
      const again = await partners.import(tenant.facilityId, { rows: back, commit: false });
      assert.equal(again.summary.daysToBook, 0);
      assert.ok(again.rows.every((one) => one.newDays.length === 0 && one.sameDays.length > 0));
      const recommit = await partners.import(tenant.facilityId, { rows: back, commit: true });
      assert.equal(recommit.bookedDays, 0);
      assert.equal(recommit.createdGroups, 0);
      assert.equal((await days(tenant, group!.id)).length, 3);
    });
  });
});
