import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Adding a day to a turma, when the pool is shut — round 5.
 *
 * This was reported as "500 when I try to add a day". It was not a crash: the
 * facility-hours trigger was refusing a class on a day the pool does not open,
 * exactly as designed, and nothing between the trigger and the screen read the
 * refusal. A rule that reports itself as a server error is a rule nobody can
 * obey, and it teaches an operator that the product is broken.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Tenant {
  organizationId: string;
  facilityId: string;
  seasonId: string;
  sql: <T extends object>(text: string, values?: unknown[]) => Promise<T[]>;
}

/** Open on Mondays, 09:00 to 12:00, and shut for the rest of the week. */
async function mondaysOnly(tenant: Tenant): Promise<void> {
  await tenant.sql(
    `INSERT INTO facility_hours (organization_id, facility_id, weekday, available,
                                 opens_at, closes_at)
     SELECT $1, $2, d, d = 1, TIME '09:00', TIME '12:00'
       FROM generate_series(1, 7) AS d
     ON CONFLICT ON CONSTRAINT facility_hours_pkey DO UPDATE
        SET available = excluded.available,
            opens_at = excluded.opens_at,
            closes_at = excluded.closes_at`,
    [tenant.organizationId, tenant.facilityId],
  );
}

async function aTurma(tenant: Tenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, facility_id, season_id, name)
     VALUES ($1, $2, $3, 'Turma A') RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId],
  );
  return row!.id;
}

/** What the API said, or nothing if it did not refuse. */
async function refusalOf(
  run: () => Promise<unknown>,
): Promise<{ status: number | undefined; fields: Record<string, string> }> {
  try {
    await run();
  } catch (error) {
    return {
      status: (error as { status?: number }).status,
      fields:
        (error as { response?: { fields?: Record<string, string> } }).response?.fields ?? {},
    };
  }
  return { status: undefined, fields: {} };
}

test('a day the pool does not open is refused by name, not by a 500', async () => {
  await withScratchTenant(async (tenant) => {
    await mondaysOnly(tenant);
    const groupId = await aTurma(tenant);
    const classes = new ClassesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const refusal = await refusalOf(() =>
        classes.schedule(groupId, {
          weekday: '2',
          startTime: '10:00',
          durationMinutes: '45',
        }),
      );

      assert.equal(refusal.status, 409, 'a rule, not a crash');
      assert.equal(refusal.fields['weekday'], 'classes.slotClosedDay');
    });
  });
});

test('a time before the pool opens is refused against the time, and one inside it is not', async () => {
  await withScratchTenant(async (tenant) => {
    await mondaysOnly(tenant);
    const groupId = await aTurma(tenant);
    const classes = new ClassesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const early = await refusalOf(() =>
        classes.schedule(groupId, {
          weekday: '1',
          startTime: '07:00',
          durationMinutes: '45',
        }),
      );
      assert.equal(early.status, 409);
      assert.equal(early.fields['startTime'], 'classes.slotOutsideHours');

      // A class that starts inside the hours but runs past closing is a third
      // refusal, and it is about the length rather than the time.
      const long = await refusalOf(() =>
        classes.schedule(groupId, {
          weekday: '1',
          startTime: '11:30',
          durationMinutes: '90',
        }),
      );
      assert.equal(long.status, 409);
      assert.equal(long.fields['durationMinutes'], 'classes.slotEndsAfterClosing');

      // And the ordinary case still works.
      const added = await classes.schedule(groupId, {
        weekday: '1',
        startTime: '10:00',
        durationMinutes: '45',
      });
      assert.deepEqual(added, { added: true });
    });
  });
});

test('dragging a slot onto a closed day is refused the same way', async () => {
  await withScratchTenant(async (tenant) => {
    await mondaysOnly(tenant);
    const groupId = await aTurma(tenant);
    const classes = new ClassesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await classes.schedule(groupId, {
        weekday: '1',
        startTime: '10:00',
        durationMinutes: '45',
      });

      const [slot] = await tenant.sql<{ id: string }>(
        'SELECT id FROM class_schedule WHERE class_group_id = $1 AND archived_at IS NULL',
        [groupId],
      );

      const refusal = await refusalOf(() =>
        classes.moveSlot(groupId, slot!.id, { weekday: '4', startTime: '10:00' }),
      );

      assert.equal(refusal.status, 409, 'dragging cannot get round a rule typing could not');
      assert.equal(refusal.fields['weekday'], 'classes.slotClosedDay');
    });
  });
});
