import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StudentsController } from './students.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * An instructor reads only their sports' students — POOLSE-145 slice b, QA 1–3,
 * 5, 6 and 8: another sport is a 403 and never an empty list, no sport asked for
 * is their own sports, a student in two sports opens with the other sport's
 * cards absent, the owner reads everything, and an instructor whose sports are
 * all the club's reads exactly as before.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

interface Club {
  ana: string; // swimming only
  bruno: string; // tennis only
  carla: string; // both
  duarte: string; // no turma
  tennisCoach: string;
  poolCoach: string;
}

async function aClub(tenant: ScratchTenant): Promise<Club> {
  const org = tenant.organizationId;
  await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [org]);
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
  const [swimLevel] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Golfinho', 99) RETURNING id`,
    [org],
  );
  const student = async (first: string, groups: string[]): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, level_id, federation_licence)
       VALUES ($1, $2, 'Teste', $3, $4) RETURNING id`,
      [org, first, swimLevel!.id, first === 'Carla' ? '123456' : null],
    );
    for (const group of groups) {
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
        [org, group, row!.id],
      );
    }
    return row!.id;
  };
  const tennisCoach = await addMember(tenant, 'Teresa', 'Ténis', ['instructor']);
  const poolCoach = await addMember(tenant, 'Pedro', 'Piscina', ['instructor']);
  await owner.query("UPDATE membership SET sports = '{tennis}' WHERE id = $1", [tennisCoach]);
  await owner.query("UPDATE membership SET sports = '{pool,tennis}' WHERE id = $1", [poolCoach]);
  return {
    ana: await student('Ana', [swim!.id]),
    bruno: await student('Bruno', [tennis!.id]),
    carla: await student('Carla', [swim!.id, tennis!.id]),
    duarte: await student('Duarte', []),
    tennisCoach,
    poolCoach,
  };
}

const list = (sport?: string, sportCounts?: string) =>
  new StudentsController().list(undefined, undefined, undefined, '100', undefined, undefined, sport, undefined, sportCounts);

const ids = (response: Awaited<ReturnType<typeof list>>): string[] => response.students.items.map((s) => s.id).sort();

test('POOLSE-145 b — a tennis-only instructor reads tennis students, and nothing of swimming', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);

    await actingAs(tenant, { membershipId: club.tennisCoach, roles: ['instructor'] }, async () => {
      // QA 1: another sport is a 403, never an empty list — and so is "no sport".
      await expectStatus(() => list('pool'), 403);
      await expectStatus(() => list('none'), 403);
      // QA 2: no sport asked for is their own sports.
      assert.deepEqual(ids(await list()), [club.bruno, club.carla].sort());
      assert.deepEqual(ids(await list('tennis')), [club.bruno, club.carla].sort());
      // The chips count their sport only.
      const counted = await list(undefined, '1');
      assert.deepEqual(counted.sportCounts?.bySport, [{ sport: 'tennis', count: 2 }]);
      assert.equal(counted.sportCounts?.total, 2);

      // QA 3: Carla opens, her swimming cards absent — not blank.
      const carla = await new StudentsController().one(club.carla);
      assert.equal('levelId' in carla, false);
      assert.equal('levelName' in carla, false);
      assert.equal('federationLicence' in carla, false);
      assert.equal(carla.firstName, 'Carla');
      // Ana is swimming only: not theirs to open.
      await expectStatus(() => new StudentsController().one(club.ana), 403);
      await expectStatus(() => new StudentsController().one(club.duarte), 403);
    });

    // QA 6: an instructor who belongs to every sport the club has reads as before.
    await actingAs(tenant, { membershipId: club.poolCoach, roles: ['instructor'] }, async () => {
      assert.deepEqual(ids(await list()), [club.ana, club.bruno, club.carla, club.duarte].sort());
      const carla = await new StudentsController().one(club.carla);
      assert.equal(carla.federationLicence, '123456');
    });

    // QA 5: the owner reads everything, both sports.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(ids(await list()), [club.ana, club.bruno, club.carla, club.duarte].sort());
      assert.deepEqual(ids(await list('pool')), [club.ana, club.carla].sort());
      assert.equal((await new StudentsController().one(club.carla)).levelName, 'Golfinho');
    });
  });
});

test('POOLSE-145 b — in a pool-only club an instructor reads every student, as before (rule 7)', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Rui', 'Treinador', ['instructor']);
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Sem', 'Turma') RETURNING id`,
      [tenant.organizationId],
    );
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      assert.ok(ids(await list()).includes(student!.id));
      assert.ok(ids(await list('none')).includes(student!.id));
      await new StudentsController().one(student!.id);
    });
  });
});
