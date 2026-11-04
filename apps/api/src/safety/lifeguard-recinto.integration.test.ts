import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { LifeguardRosterController } from './roster.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Lifeguards per sport — POOLSE-156, against the real database.
 *
 * A duty sits on a recinto: a pool duty names its pool and the trigger fills the
 * recinto; a court duty names the recinto alone. The week asks the sport, a
 * court shows its duties and no gaps, the same person cannot overlap themselves
 * on a court, and an instructor outside a sport is refused it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login, for the switches the app may not write: the club's and a person's sports. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

/** A Monday four weeks out, so the week is in the future and the dates are fixed. */
function aMonday(): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + 28 + ((8 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
}

async function setUp(tenant: ScratchTenant): Promise<{ poolId: string; courtId: string }> {
  await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [tenant.organizationId]);
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, 'Tanque 25m') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [court] = await tenant.sql<{ id: string }>(
    `INSERT INTO playing_area (organization_id, facility_id, sport_id, name)
     VALUES ($1, $2, 'tennis', 'Campo 1') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return { poolId: pool!.id, courtId: court!.id };
}

test("a pool duty arrives with its pool and the trigger gives it the pool's recinto", async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId } = await setUp(tenant);
    const person = await addMember(tenant, 'Rita', 'Nadadora', ['instructor']);
    const monday = aMonday();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { id } = await new LifeguardRosterController().add(tenant.facilityId, {
        poolId,
        membershipId: person,
        day: monday,
        from: '09:00',
        to: '11:00',
      });
      const [row] = await tenant.sql<{ match: boolean }>(
        `SELECT d.playing_area_id = p.playing_area_id AS match
           FROM lifeguard_duty d JOIN pool p ON p.id = d.pool_id WHERE d.id = $1`,
        [id],
      );
      assert.equal(row?.match, true);
    });
  });
});

test('a court duty has no pool, shows under the court with no gaps, and cannot overlap itself', async () => {
  await withScratchTenant(async (tenant) => {
    const { courtId, poolId } = await setUp(tenant);
    const person = await addMember(tenant, 'Tiago', 'Campo', ['instructor']);
    const monday = aMonday();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const roster = new LifeguardRosterController();
      const { id } = await roster.add(tenant.facilityId, {
        playingAreaId: courtId,
        membershipId: person,
        day: monday,
        from: '10:00',
        to: '12:00',
      });
      const [row] = await tenant.sql<{ pool_id: string | null; playing_area_id: string }>(
        'SELECT pool_id, playing_area_id FROM lifeguard_duty WHERE id = $1',
        [id],
      );
      assert.equal(row?.pool_id, null, 'no pool');
      assert.equal(row?.playing_area_id, courtId);

      // Overlapping the same person on the same court is refused.
      await expectStatus(
        () =>
          roster.add(tenant.facilityId, {
            playingAreaId: courtId,
            membershipId: person,
            day: monday,
            from: '11:00',
            to: '13:00',
          }),
        409,
      );

      const tennis = await roster.read(tenant.facilityId, monday, '7', 'tennis');
      assert.equal(tennis.placeKind, 'area');
      assert.deepEqual(tennis.places.map((place) => place.id), [courtId]);
      assert.deepEqual(tennis.duties.map((duty) => duty.placeId), [courtId]);
      assert.deepEqual(tennis.gaps, [], 'a court has no required cover');

      const swimming = await roster.read(tenant.facilityId, monday, '7');
      assert.equal(swimming.placeKind, 'pool', 'no sport is swimming, as before');
      assert.deepEqual(swimming.places.map((place) => place.id), [poolId]);
      assert.equal(swimming.duties.length, 0, "the court's duty is not the pool's");

      await expectStatus(() => roster.read(tenant.facilityId, monday, '7', 'golf'), 400);
    });
  });
});

test("an instructor of tennis alone is refused the pool's week (403 sport_not_yours)", async () => {
  await withScratchTenant(async (tenant) => {
    await setUp(tenant);
    const coach = await addMember(tenant, 'Coach', 'Tenis', ['instructor']);
    await owner.query("UPDATE membership SET sports = '{tennis}' WHERE id = $1", [coach]);
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      const roster = new LifeguardRosterController();
      await expectStatus(() => roster.read(tenant.facilityId, aMonday(), '7', 'pool'), 403);
      const own = await roster.read(tenant.facilityId, aMonday(), '7', 'tennis');
      assert.equal(own.placeKind, 'area', 'their own sport answers');
    });
  });
});

test("another club's court is refused, and nothing is written", async () => {
  await withScratchTenant(async (other) => {
    const { courtId: theirs } = await setUp(other);
    await withScratchTenant(async (tenant) => {
      await setUp(tenant);
      const person = await addMember(tenant, 'Ana', 'Intrusa', ['instructor']);
      await actingAs(tenant, { roles: ['owner'] }, async () => {
        await expectStatus(
          () =>
            new LifeguardRosterController().add(tenant.facilityId, {
              playingAreaId: theirs,
              membershipId: person,
              day: aMonday(),
              from: '09:00',
              to: '10:00',
            }),
          400,
        );
      });
      const [row] = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM lifeguard_duty');
      assert.equal(row!.n, 0);
    });
  });
});
