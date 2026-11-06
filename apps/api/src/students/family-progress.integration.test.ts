import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FamilyProgressController } from './family-progress.controller.js';
import { RecordsController } from './records.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * A family records its own times (Rui, 06-11-2026): who may, how a typed time
 * counts, and how the distance adds up.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  guardian: string;
  ownLogin: string;
  child: string;
  stranger: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const ownLogin = await addMember(tenant, 'Alice', 'Silva', ['student']);
  const student = async (first: string, membership: string | null): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, $2, 'Silva', club_today() - interval '9 years', $3) RETURNING id`,
      [org, first, membership],
    );
    return row!.id;
  };
  const child = await student('Alice', ownLogin);
  const stranger = await student('Bruna', null);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child, guardian],
  );
  return { guardian, ownLogin, child, stranger };
}

const asGuardian = <T>(tenant: ScratchTenant, family: Family, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: family.guardian, roles: ['guardian'] }, fn);

const TIME = { stroke: 'freestyle', distanceM: 50, seconds: '32', hundredths: '50', swumOn: '2026-10-01' };

test('a time a guardian types is marked, may be a best, and is never official', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () => new FamilyProgressController().addTime(family.child, TIME));
    const progress = await asGuardian(tenant, family, () => new RecordsController().read(family.child));
    assert.equal(progress.records[0]!.selfReported, true);
    assert.equal(progress.records[0]!.official, false);
    assert.equal(progress.records[0]!.meetId, null);
    assert.equal(progress.bests[0]!.selfReported, true);
    assert.equal(progress.bests[0]!.officialBest, null);
  });
});

test('a typed time cannot name a meet: the column refuses it', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await assert.rejects(
      tenant
        .sql(
          `INSERT INTO swim_meet (id, organization_id, name, starts_on, official)
           VALUES (gen_random_uuid(), $1, 'Prova', '2026-10-01', true)`,
          [tenant.organizationId],
        )
        .then(() =>
          tenant.sql(
            `INSERT INTO student_record (organization_id, student_id, stroke, distance_m, time_ms, swum_on, self_reported, meet_id)
             SELECT $1, $2, 'freestyle', 50, 30000, '2026-10-01', true, id FROM swim_meet WHERE organization_id = $1`,
            [tenant.organizationId, family.child],
          ),
        ),
    );
  });
});

test('who may add: the guardian, never a nine-year-old alone, a stranger or staff', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await actingAs(tenant, { membershipId: family.ownLogin, roles: ['student'] }, async () => {
      const read = await new FamilyProgressController().read(family.child);
      assert.equal(read.canEnterTimes, false);
      await expectStatus(() => new FamilyProgressController().addTime(family.child, TIME), 403);
    });
    await asGuardian(tenant, family, () =>
      expectStatus(() => new FamilyProgressController().addTime(family.stranger, TIME), 404),
    );
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new FamilyProgressController().addTime(family.child, TIME), 403),
    );
  });
});

test('refusals: a future date, an impossible time, no time, a pool that is not the club’s', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const routes = new FamilyProgressController();
    await asGuardian(tenant, family, async () => {
      await expectStatus(() => routes.addTime(family.child, { ...TIME, swumOn: '2999-01-01' }), 400);
      await expectStatus(() => routes.addTime(family.child, { ...TIME, seconds: '75' }), 400);
      await expectStatus(() => routes.addTime(family.child, { ...TIME, seconds: '', hundredths: '' }), 400);
      await expectStatus(
        () => routes.addTime(family.child, { ...TIME, poolId: '00000000-0000-4000-8000-000000000000' }),
        400,
      );
    });
  });
});

test('hours, a pool and the running total: the length gives the course, and the distance adds up', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind, length_m)
       VALUES ($1, $2, 'Grande', 'indoor', 50) RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const routes = new FamilyProgressController();
    await asGuardian(tenant, family, async () => {
      await routes.addTime(family.child, { ...TIME, distanceM: 1500, hours: '1', minutes: '2', poolId: pool!.id });
      await routes.addTime(family.child, TIME);
      const read = await routes.read(family.child);
      assert.ok(read.pools.some((one) => one.id === pool!.id && one.lengthM === 50));
    });
    const progress = await asGuardian(tenant, family, () => new RecordsController().read(family.child));
    assert.equal(progress.totalDistanceM, 1550);
    const long = progress.records.find((record) => record.distanceM === 1500)!;
    assert.equal(long.course, 'lcm');
    assert.equal(long.timeMs, 3_600_000 + 120_000 + 32_500);
  });
});

test('a family removes what it entered and nothing the office did', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const routes = new FamilyProgressController();
    const { id } = await asGuardian(tenant, family, () => routes.addTime(family.child, TIME));
    const office = await actingAs(tenant, { roles: ['owner'] }, () =>
      new RecordsController().add(family.child, { stroke: 'freestyle', distanceM: 50, seconds: 30, swumOn: '2026-10-01' }),
    );
    await asGuardian(tenant, family, async () => {
      await expectStatus(() => routes.archiveTime(family.child, office.id), 404);
      assert.deepEqual(await routes.archiveTime(family.child, id), { archived: true });
    });
  });
});
