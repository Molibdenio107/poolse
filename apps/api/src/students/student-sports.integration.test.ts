import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { StudentsController } from './students.controller.js';
import { StudentFeesController } from '../billing/fees.controller.js';
import { ExportsController } from './export.controller.js';
import pg from 'pg';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Multi-sport Slice 3 — the register's *Modalidades*: each student's sports
 * from their active turmas' recintos, the sport and multi-sport filters, and
 * the chips' counts, asked for only by a multi-sport club.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** Switching a sport on is the platform's to do (POOLSE-124); the test does it as the owner. */
async function enableTennis(organizationId: string): Promise<void> {
  const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await owner.connect();
  try {
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [organizationId]);
  } finally {
    await owner.end();
  }
}

test('the register says each student’s sports, filters by them and counts them', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    await enableTennis(org);
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo 1') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [swim] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id],
    );
    const [tennis] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
       VALUES ($1, $2, $3, 'Ténis Iniciação', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, court!.id],
    );
    const student = async (first: string, groups: string[]): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Teste') RETURNING id`,
        [org, first],
      );
      for (const group of groups) {
        await tenant.sql(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
          [org, group, row!.id],
        );
      }
      return row!.id;
    };
    const ana = await student('Ana', [swim!.id]);
    const bruno = await student('Bruno', [tennis!.id]);
    const carla = await student('Carla', [swim!.id, tennis!.id]);
    await student('Duarte', []);

    const list = (query: Record<string, string>) =>
      actingAs(tenant, { roles: ['admin'] }, () =>
        new StudentsController().list(
          undefined, undefined, undefined, '100', undefined, undefined,
          query['sport'], query['multi'], query['sportCounts'],
        ),
      );

    const all = await list({});
    const sportsOf = (id: string) => all.students.items.find((s) => s.id === id)?.sports;
    assert.deepEqual(sportsOf(ana), ['pool']);
    assert.deepEqual(sportsOf(bruno), ['tennis']);
    assert.deepEqual(sportsOf(carla), ['pool', 'tennis']);
    assert.equal(all.sportCounts, undefined, 'counts only when asked');

    const ids = (r: Awaited<ReturnType<typeof list>>) => r.students.items.map((s) => s.id).sort();
    assert.deepEqual(ids(await list({ sport: 'tennis' })), [bruno, carla].sort());
    assert.deepEqual(ids(await list({ multi: '1' })), [carla]);
    // POOLSE-143: a sport the club has not switched on is a 400, never an empty list;
    // `none` is *Sem modalidade* — Duarte, in no live turma.
    await expectStatus(() => list({ sport: 'padel' }), 400);
    const duarte = all.students.items.find((s) => s.firstName === 'Duarte')!.id;
    assert.deepEqual(ids(await list({ sport: 'none' })), [duarte]);

    const counted = await list({ sportCounts: '1' });
    assert.deepEqual(counted.sportCounts, {
      total: 4,
      bySport: [
        { sport: 'pool', count: 2 },
        { sport: 'tennis', count: 2 },
      ],
      multi: 1,
      none: 1,
    });

    // The export is the list it was asked from (sweep 01-11-2026): a sport, or
    // the multi-sport students, never everybody.
    const exported = (sport?: string, multi?: string) =>
      actingAs(tenant, { roles: ['admin'] }, () =>
        new ExportsController().students(undefined, undefined, undefined, undefined, sport, multi),
      ).then((r) => r.students.map((one) => one.id).sort());
    assert.deepEqual(await exported('tennis'), [bruno, carla].sort());
    assert.deepEqual(await exported(undefined, '1'), [carla]);
    assert.equal((await exported()).length, 4);

    // The mensalidade's split: each plan carries its turmas' sport.
    const fees = await actingAs(tenant, { roles: ['admin'] }, () => new StudentFeesController().list(carla));
    assert.deepEqual([...new Set(fees.currentPlans.map((plan) => plan.sport))].sort(), ['pool', 'tennis']);
  });
});
