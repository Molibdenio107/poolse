import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { FamilyProgressController, StudentMeasuresController } from './family-progress.controller.js';
import { RecordsController } from './records.controller.js';
import { RetentionService } from '../retention/retention.service.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * A family records its own progress (Rui, 06-11-2026): who may, how a typed time
 * counts, who reads weight and height, and that they leave with the health data.
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

const TIME = { stroke: 'freestyle', distanceM: 50, course: 'scm', time: '0:32,50', swumOn: '2026-10-01' };

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

test('a time cannot name a meet: the column refuses it', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await assert.rejects(
      tenant.sql(
        `INSERT INTO swim_meet (id, organization_id, name, starts_on, official)
         VALUES (gen_random_uuid(), $1, 'Prova', '2026-10-01', true)`,
        [tenant.organizationId],
      ).then(() =>
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
      assert.equal(read.canEnter, false);
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

test('refusals: a future date, an unreadable time, a weight out of range', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const routes = new FamilyProgressController();
    await asGuardian(tenant, family, async () => {
      await expectStatus(() => routes.addTime(family.child, { ...TIME, swumOn: '2999-01-01' }), 400);
      await expectStatus(() => routes.addTime(family.child, { ...TIME, time: 'depressa' }), 400);
      await expectStatus(() => routes.addMeasure(family.child, { kind: 'weight', value: '900', measuredOn: '2026-10-01' }), 400);
      await expectStatus(() => routes.addMeasure(family.child, { kind: 'shoe', value: '38', measuredOn: '2026-10-01' }), 400);
    });
  });
});

test('weight is the family\'s and the office\'s, never an instructor\'s', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new FamilyProgressController().addMeasure(family.child, { kind: 'weight', value: '31,5', measuredOn: '2026-10-01' }),
    );
    const office = await actingAs(tenant, { roles: ['owner'] }, () => new StudentMeasuresController().list(family.child));
    assert.deepEqual(office.measures.map((one) => [one.kind, one.value, one.unit]), [['weight', 31.5, 'kg']]);
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new StudentMeasuresController().list(family.child), 403),
    );
    await withScratchTenant(async (other) => {
      const seen = await actingAs(other, { roles: ['owner'] }, () => new StudentMeasuresController().list(family.child));
      assert.deepEqual(seen.measures, []);
    });
  });
});

test('a family removes what it entered and nothing the office did; the audit never holds a weight', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const routes = new FamilyProgressController();
    const { id } = await asGuardian(tenant, family, () =>
      routes.addMeasure(family.child, { kind: 'height', value: '140', measuredOn: '2026-10-01' }),
    );
    const [audit] = await tenant.sql<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_log WHERE action = 'student_measure.created' AND organization_id = $1`,
      [tenant.organizationId],
    );
    assert.deepEqual(audit!.data, { kind: 'height' });

    const office = await actingAs(tenant, { roles: ['owner'] }, () =>
      new RecordsController().add(family.child, { stroke: 'freestyle', distanceM: 50, seconds: 30, swumOn: '2026-10-01' }),
    );
    await asGuardian(tenant, family, async () => {
      await expectStatus(() => routes.archiveTime(family.child, office.id), 404);
      assert.deepEqual(await routes.archiveMeasure(family.child, id), { archived: true });
    });
  });
});

test('weight and height leave with the student\'s health data', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new FamilyProgressController().addMeasure(family.child, { kind: 'weight', value: '31', measuredOn: '2026-10-01' }),
    );
    await tenant.sql(`UPDATE student SET archived_at = now() - interval '2 years', created_at = now() - interval '3 years' WHERE id = $1`, [family.child]);
    const run = await new RetentionService().run(tenant.organizationId);
    assert.ok(run.healthErased >= 1, 'the sweep reached this student');
    const left = await tenant.sql(`SELECT 1 FROM student_measure WHERE student_id = $1`, [family.child]);
    assert.equal(left.length, 0);
  });
});
