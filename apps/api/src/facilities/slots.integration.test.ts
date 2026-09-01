import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SlotsController } from './slots.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * The slot grid, through its endpoints — POOLSE-44.
 *
 * `packages/db/test/time-slots.sql` proves what the schema guarantees. This
 * proves the half above it: that a generated grid arrives whole or not at all,
 * that an overlap comes back as something the screen can say out loud, and that
 * `00:00` is refused with the instruction rather than with a constraint name.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const WEEKDAY_GRID = [
  { dayGroup: 'weekday', startTime: '06:30', endTime: '07:15' },
  { dayGroup: 'weekday', startTime: '08:45', endTime: '09:30' },
  { dayGroup: 'weekday', startTime: '09:30', endTime: '10:15' },
  { dayGroup: 'weekday', startTime: '10:15', endTime: '11:00' },
  // The lunchtime hole is the absence of a row, not a row.
  { dayGroup: 'weekday', startTime: '14:45', endTime: '15:30' },
];

test('a generated grid arrives whole, abutting slots and all', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { created } = await slots.add(tenant.facilityId, { slots: WEEKDAY_GRID });
      assert.equal(created, 5);

      const grid = await slots.list(tenant.facilityId);
      assert.equal(grid.slots.length, 5);

      // Ordered by the clock, which is the only order a grid has.
      assert.deepEqual(
        grid.slots.map((slot) => slot.startTime),
        ['06:30', '08:45', '09:30', '10:15', '14:45'],
      );
    });
  });
});

test('an overlapping slot is refused and names the hours it wanted', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, { slots: WEEKDAY_GRID });

      await assert.rejects(
        slots.add(tenant.facilityId, {
          slots: [{ dayGroup: 'weekday', startTime: '10:00', endTime: '10:45' }],
        }),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          const body = error.getResponse() as { message: string; startTime: string };
          assert.equal(body.message, 'slotOverlap');
          assert.equal(body.startTime, '10:00');
          return true;
        },
      );
    });
  });
});

test('a batch containing one overlap writes none of it', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await assert.rejects(
        slots.add(tenant.facilityId, {
          slots: [
            { dayGroup: 'weekday', startTime: '09:30', endTime: '10:15' },
            { dayGroup: 'weekday', startTime: '10:15', endTime: '11:00' },
            // Collides with the first. Half a grid is worse than none, because
            // nobody can tell which half.
            { dayGroup: 'weekday', startTime: '09:45', endTime: '10:30' },
          ],
        }),
      );

      assert.equal((await slots.list(tenant.facilityId)).slots.length, 0);
    });
  });
});

test('24:00 is a real end time and 00:00 is refused with the instruction', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, {
        slots: [{ dayGroup: 'weekday', startTime: '23:00', endTime: '24:00' }],
      });
      assert.equal((await slots.list(tenant.facilityId)).slots[0]?.endTime, '24:00');

      await assert.rejects(
        slots.add(tenant.facilityId, {
          slots: [{ dayGroup: 'saturday', startTime: '21:00', endTime: '00:00' }],
        }),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          // The message has to be the instruction. "violates check constraint"
          // tells the operator nothing they can act on.
          assert.match(String(error.message), /24:00/);
          return true;
        },
      );
    });
  });
});

test('the three day groups keep their own grids', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, {
        slots: [
          { dayGroup: 'weekday', startTime: '09:30', endTime: '10:15' },
          { dayGroup: 'saturday', startTime: '09:30', endTime: '10:15' },
          { dayGroup: 'sunday', startTime: '09:30', endTime: '10:15' },
        ],
      });

      const grid = await slots.list(tenant.facilityId);
      assert.equal(grid.slots.filter((slot) => slot.startTime === '09:30').length, 3);
    });
  });
});

test('a slot can be corrected, and archived to free its hours', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, {
        slots: [{ dayGroup: 'weekday', startTime: '09:00', endTime: '09:45' }],
      });

      const [slot] = (await slots.list(tenant.facilityId)).slots;
      await slots.edit(slot!.id, {
        dayGroup: 'weekday',
        startTime: '08:45',
        endTime: '09:30',
      });
      assert.equal((await slots.list(tenant.facilityId)).slots[0]?.startTime, '08:45');

      await slots.remove(slot!.id);
      assert.equal((await slots.list(tenant.facilityId)).slots.length, 0);

      // The hours are free again — the exclusion constraint is partial.
      await slots.add(tenant.facilityId, {
        slots: [{ dayGroup: 'weekday', startTime: '08:45', endTime: '09:30' }],
      });
      assert.equal((await slots.list(tenant.facilityId)).slots.length, 1);
    });
  });
});

test('a malformed time is refused before it reaches the database', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      for (const bad of ['9:30', '25:00', '24:30', 'meia-noite', '']) {
        await assert.rejects(
          slots.add(tenant.facilityId, {
            slots: [{ dayGroup: 'weekday', startTime: bad, endTime: '10:15' }],
          }),
          `"${bad}" should not be accepted as a start time`,
        );
      }

      await assert.rejects(
        slots.add(tenant.facilityId, {
          slots: [{ dayGroup: 'terça', startTime: '09:30', endTime: '10:15' }],
        }),
      );
    });
  });
});

test('an instructor may read the grid and may not change it', async () => {
  await withScratchTenant(async (tenant) => {
    const slots = new SlotsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await slots.add(tenant.facilityId, { slots: WEEKDAY_GRID });
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      // Reading is fine: the grid is the timetable's shape and everyone needs it.
      const grid = await slots.list(tenant.facilityId);
      assert.equal(grid.slots.length, 5);
      assert.equal(grid.canManage, false);

      // Writing is not, and the endpoint is what refuses it.
      await assert.rejects(
        slots.add(tenant.facilityId, {
          slots: [{ dayGroup: 'weekday', startTime: '20:00', endTime: '20:45' }],
        }),
      );
      await assert.rejects(slots.remove((await slots.list(tenant.facilityId)).slots[0]!.id));
    });
  });
});

test("a slot cannot be read or written across the tenant boundary", async () => {
  await withScratchTenant(async (a) => {
    const slots = new SlotsController();
    let slotId = '';

    await actingAs(a, { roles: ['owner'] }, async () => {
      await slots.add(a.facilityId, { slots: WEEKDAY_GRID });
      slotId = (await slots.list(a.facilityId)).slots[0]!.id;
    });

    await withScratchTenant(async (b) => {
      await actingAs(b, { roles: ['owner'] }, async () => {
        // A's site id, asked for by B: RLS finds nothing, which is the correct
        // amount of information to give back.
        assert.deepEqual((await slots.list(a.facilityId)).slots, []);

        // And A's slot id cannot be edited or removed by B.
        await assert.rejects(
          slots.edit(slotId, { dayGroup: 'weekday', startTime: '07:00', endTime: '07:45' }),
        );
        await assert.rejects(slots.remove(slotId));
      });
    });
  });
});
