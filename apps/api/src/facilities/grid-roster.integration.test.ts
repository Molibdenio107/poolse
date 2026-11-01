import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { GridController } from './grid.controller.js';
import { PartnersController } from './partners.controller.js';
import { actingAs, closeHarness, countStatements, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * The calendar card's students — POOLSE-147.
 *
 * Since round 6 the calendar built every card with `people: []`, so a full
 * turma said nobody was enrolled. The names now come with `readGrid`: active
 * enrolments only, filed by surname, in one grouped statement however many
 * bookings the week has — and nothing at all for a parceria, which carries a
 * headcount and no people.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function turma(tenant: ScratchTenant, name: string, capacity: number | null, startTime = '18:00'): Promise<string> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, capacity)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, capacity],
  );
  await tenant.sql(
    `INSERT INTO class_schedule
       (organization_id, facility_id, subject_type, class_group_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, 'turma', $3, 1, $4::time, 45)`,
    [tenant.organizationId, tenant.facilityId, group!.id, startTime],
  );
  return group!.id;
}

async function enrol(tenant: ScratchTenant, groupId: string, first: string, last: string, status = 'active'): Promise<void> {
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, first, last],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, waiting_position)
     VALUES ($1, $2, $3, $4::enrollment_status, $5)`,
    [tenant.organizationId, groupId, student!.id, status, status === 'waiting' ? 1 : null],
  );
}

test('a turma card lists its active students by surname; an empty one lists none; a parceria has no list', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const full = await turma(tenant, 'Deficientes', 8);
      await enrol(tenant, full, 'Rita', 'Sousa');
      await enrol(tenant, full, 'Ana', 'Almeida');
      await enrol(tenant, full, 'Bruno', 'Matos');
      await enrol(tenant, full, 'Carla', 'Esperança', 'waiting');
      const empty = await turma(tenant, 'Vazia', null, '19:00');

      const partners = new PartnersController();
      const partner = await partners.create(tenant.facilityId, { name: 'Escola', type: 'escola', color: '#b3d49d' });
      const group = await partners.createGroup(partner.id, { name: '6A', participantCount: 24 });
      await tenant.sql(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, partner_group_id, season_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, 'parceria', $3, $4, 2, '09:00', 45)`,
        [tenant.organizationId, tenant.facilityId, group.id, tenant.seasonId],
      );

      const grid = await new GridController().read(tenant.facilityId);
      const byGroup = (id: string) => grid.bookings.find((b) => b.classGroupId === id)!;

      // QA 1: three names, filed by surname; the waiting one is not in the class.
      assert.deepEqual(byGroup(full).people!.map((p) => p.name), ['Ana Almeida', 'Bruno Matos', 'Rita Sousa']);
      assert.equal(byGroup(full).capacity, 8);
      // QA 2: an empty turma is an empty list, not null — the card says so in words.
      assert.deepEqual(byGroup(empty).people, []);
      assert.equal(byGroup(empty).capacity, null);
      // QA 3: a parceria has no student section at all.
      const parceria = grid.bookings.find((b) => b.subjectType === 'parceria')!;
      assert.equal(parceria.people, null);
    });
  });
});

test('sixty bookings read their names in one statement (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Thirty turmas, each twice a week: sixty bookings.
      const groups = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, season_id, facility_id, name)
         SELECT $1, $2, $3, 'Turma ' || n FROM generate_series(1, 30) AS n RETURNING id`,
        [tenant.organizationId, tenant.seasonId, tenant.facilityId],
      );
      await tenant.sql(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id, weekday, start_time, duration_minutes)
         SELECT $1, $2, 'turma', g.id, d, '08:00'::time + make_interval(mins => 30 * (row_number() OVER ())::int), 30
           FROM unnest($3::uuid[]) AS g(id) CROSS JOIN (VALUES (1), (3)) AS days(d)`,
        [tenant.organizationId, tenant.facilityId, groups.map((g) => g.id)],
      );
      for (const group of groups.slice(0, 5)) await enrol(tenant, group.id, 'Aluno', group.id.slice(0, 6));

      const { result, statements } = await countStatements(() => new GridController().read(tenant.facilityId));
      assert.equal(result.bookings.length, 60);
      const rosterStatements = statements.filter((sql) => /\benrollment\b/.test(sql));
      assert.equal(rosterStatements.length, 1, 'the names are one grouped statement, never one per booking');
      assert.equal(result.bookings.filter((b) => (b.people ?? []).length === 1).length, 10);
    });
  });
});

test('another club’s turma at the same hour lends no names (QA 6)', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      await actingAs(theirs, { roles: ['owner'] }, async () => {
        const group = await turma(theirs, 'Deles', 8);
        await enrol(theirs, group, 'Estranho', 'Alheio');
      });
      await actingAs(mine, { roles: ['owner'] }, async () => {
        const own = await turma(mine, 'Nossa', 8);
        const grid = await new GridController().read(mine.facilityId);
        assert.equal(grid.bookings.length, 1);
        assert.deepEqual(grid.bookings.find((b) => b.classGroupId === own)!.people, []);
      });
    });
  });
});
