import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { SeasonsController } from './seasons.controller.js';
import { SlotsController } from '../facilities/slots.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Planning next year, through the endpoints — POOLSE-45.
 *
 * `packages/db/test/draft-seasons.sql` proves the schema's half: one published
 * season, the ordered publish, and a generator that refuses a draft. This proves
 * what an operator can actually do — open a draft, copy the grid into it, edit
 * that grid without touching the live one, publish it, and throw one away.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const NEXT = { name: '2027/2028', startsOn: '2027-09-01', endsOn: '2028-08-31' };

test('a draft opens beside the season that is running', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { season } = await seasons.draft({ ...NEXT });
      assert.equal(season.status, 'draft');
      assert.equal(season.active, false);

      const listed = (await seasons.list()).seasons;
      assert.equal(listed.filter((s) => s.status === 'published').length, 1);
      assert.equal(listed.filter((s) => s.status === 'draft').length, 1);
    });
  });
});

test('duplicating a season copies its grid and nothing else', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, {
        slots: [
          { dayGroup: 'weekday', startTime: '09:30', endTime: '10:15' },
          { dayGroup: 'weekday', startTime: '10:15', endTime: '11:00' },
          { dayGroup: 'saturday', startTime: '09:30', endTime: '10:15' },
        ],
      });

      // A turma in the season that is running. It must not come across: it
      // belongs to the year that is happening, and a copy of a club's register
      // with no way to tell which was real is worse than no copy.
      await tenant.sql(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name)
         VALUES ($1, $2, $3, 'Infantis A')`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId],
      );

      const { season } = await seasons.draft({ ...NEXT, copyFrom: tenant.seasonId });

      const copied = await slots.list(tenant.facilityId, season.id);
      assert.equal(copied.slots.length, 3);
      assert.equal(copied.seasonId, season.id);
      assert.equal(season.classGroups, 0);
    });
  });
});

test('editing a draft grid leaves the published one alone', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, {
        slots: [{ dayGroup: 'weekday', startTime: '09:30', endTime: '10:15' }],
      });

      const { season } = await seasons.draft({ ...NEXT, copyFrom: tenant.seasonId });

      // Next year the club moves the morning class and adds an evening one.
      const draftSlots = await slots.list(tenant.facilityId, season.id);
      await slots.edit(draftSlots.slots[0]!.id, {
        dayGroup: 'weekday',
        startTime: '08:45',
        endTime: '09:30',
      });
      await slots.add(tenant.facilityId, {
        seasonId: season.id,
        slots: [{ dayGroup: 'weekday', startTime: '19:00', endTime: '19:45' }],
      });

      const live = await slots.list(tenant.facilityId);
      assert.equal(live.slots.length, 1);
      assert.equal(live.slots[0]?.startTime, '09:30');

      const planned = await slots.list(tenant.facilityId, season.id);
      assert.equal(planned.slots.length, 2);
    });
  });
});

test('publishing retires the incumbent, and there is never more than one', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { season } = await seasons.draft({ ...NEXT });

      await seasons.publish(season.id);

      const listed = (await seasons.list()).seasons;
      const published = listed.filter((s) => s.status === 'published');
      assert.equal(published.length, 1);
      assert.equal(published[0]?.id, season.id);

      const old = listed.find((s) => s.id === tenant.seasonId);
      assert.equal(old?.status, 'archived');
    });
  });
});

test('an archived season cannot be published again', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { season } = await seasons.draft({ ...NEXT });
      await seasons.publish(season.id);

      // Un-retiring a year is a different operation, and is not this one.
      await assert.rejects(seasons.publish(tenant.seasonId), (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error.getResponse() as { message: string }).message, 'seasonArchived');
        return true;
      });
    });
  });
});

test('a draft can be thrown away, and one holding turmas cannot', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, {
        slots: [{ dayGroup: 'weekday', startTime: '09:30', endTime: '10:15' }],
      });

      const { season: scrap } = await seasons.draft({ ...NEXT, copyFrom: tenant.seasonId });
      await seasons.discard(scrap.id);
      assert.equal(
        (await seasons.list()).seasons.find((s) => s.id === scrap.id),
        undefined,
      );

      // Its grid went with it rather than being orphaned.
      const [{ count } = { count: '0' }] = await tenant.sql<{ count: string }>(
        `SELECT count(*)::text AS count FROM facility_time_slot WHERE season_id = $1`,
        [scrap.id],
      );
      assert.equal(count, '0');

      // A draft somebody has parked turmas in is not a scrap of paper any more.
      const { season: real } = await seasons.draft({
        name: '2028/2029',
        startsOn: '2028-09-01',
        endsOn: '2029-08-31',
      });
      await tenant.sql(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name)
         VALUES ($1, $2, $3, 'Turma Planeada')`,
        [tenant.organizationId, real.id, tenant.facilityId],
      );

      await assert.rejects(seasons.discard(real.id), (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (error.getResponse() as { message: string }).message,
          'draftNotDiscardable',
        );
        return true;
      });
    });
  });
});

test('a reset retires the running season and leaves drafts alone', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { season: draft } = await seasons.draft({ ...NEXT });

      await seasons.reset({
        confirm: 'RESET',
        name: '2030/2031',
        startsOn: '2030-09-01',
        endsOn: '2031-08-31',
      });

      const listed = (await seasons.list()).seasons;
      // The reset used to archive every unarchived season, which after this
      // ticket would have swept away somebody's June planning.
      assert.equal(listed.find((s) => s.id === draft.id)?.status, 'draft');
      assert.equal(listed.filter((s) => s.status === 'published').length, 1);
      assert.equal(listed.find((s) => s.id === tenant.seasonId)?.status, 'archived');
    });
  });
});

test('drafts are owner and admin only, and refused for everyone else', async () => {
  await withScratchTenant(async (tenant) => {
    const seasons = new SeasonsController();
    let draftId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      draftId = (await seasons.draft({ ...NEXT })).season.id;
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Reading which season is running is not privileged; changing it is.
      assert.ok((await seasons.list()).seasons.length >= 2);

      await assert.rejects(seasons.draft({ ...NEXT, name: '2029/2030' }));
      await assert.rejects(seasons.publish(draftId));
      await assert.rejects(seasons.discard(draftId));
    });
  });
});

test('a draft cannot be reached across the tenant boundary', async () => {
  await withScratchTenant(async (a) => {
    const seasons = new SeasonsController();
    let draftId = '';

    await actingAs(a, { roles: ['owner'] }, async () => {
      draftId = (await seasons.draft({ ...NEXT })).season.id;
    });

    await withScratchTenant(async (b) => {
      await actingAs(b, { roles: ['owner'] }, async () => {
        assert.equal(
          (await seasons.list()).seasons.find((s) => s.id === draftId),
          undefined,
        );
        await assert.rejects(seasons.publish(draftId));
        await assert.rejects(seasons.discard(draftId));

        // And A's season cannot be used as the thing B copies from.
        await assert.rejects(seasons.draft({ ...NEXT, copyFrom: a.seasonId }));
      });
    });
  });
});
