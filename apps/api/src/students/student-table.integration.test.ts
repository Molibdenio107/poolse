import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StudentsController } from './students.controller.js';
import { InsurancePoliciesController } from '../billing/insurance.controller.js';
import { FeePlansController } from '../billing/fees.controller.js';
import { ExportsController } from './export.controller.js';
import { actingAs, addMember, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The Alunos table — POOLSE-164, against the real database.
 *
 * Each row carries its turmas, its seguro today in three states and the
 * family's last visit; the list filters by one turma (or none), by the seguro's
 * state, sorts youngest first, and offers the live turmas for the filter —
 * an instructor only their own sports' turmas.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

interface Club {
  swim: string;
  other: string;
  ana: string;
  bruno: string;
  carla: string;
  duarte: string;
}

/**
 * Four students: Ana (2015, Golfinhos, insured), Bruno (2012, Golfinhos, a
 * seguro that ended), Carla (2018, Tubarões, never insured) and Duarte (no
 * birth date, no turma).
 */
async function aClub(tenant: ScratchTenant): Promise<Club> {
  const org = tenant.organizationId;
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );
  const group = async (name: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, name, pool!.id],
    );
    return row!.id;
  };
  const swim = await group('Golfinhos');
  const other = await group('Tubarões');
  const student = async (first: string, born: string | null, groups: string[]): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date) VALUES ($1, $2, 'Teste', $3) RETURNING id`,
      [org, first, born],
    );
    for (const one of groups) {
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
        [org, one, row!.id],
      );
    }
    return row!.id;
  };
  const ana = await student('Ana', '2015-03-01', [swim]);
  const bruno = await student('Bruno', '2012-03-01', [swim]);
  const carla = await student('Carla', '2018-03-01', [other]);
  const duarte = await student('Duarte', null, []);

  // Seguros: Ana's covers today, Bruno's ended last month.
  await actingAs(tenant, { roles: ['owner'] }, async () => {
    const policy = await new InsurancePoliciesController().create(tenant.facilityId, {
      insurer: 'Fidelidade',
      policyNumber: 'AP-164',
      validFrom: inDays(-400),
      validTo: inDays(300),
      costPerPersonCents: 850,
    });
    const plan = await new FeePlansController().create(tenant.facilityId, {
      kind: 'seguro',
      amountCents: 1200,
      seasonId: tenant.seasonId,
      vatExempt: true,
    });
    for (const [studentId, from, to] of [
      [ana, inDays(-30), inDays(300)],
      [bruno, inDays(-390), inDays(-30)],
    ] as const) {
      await tenant.sql(
        `INSERT INTO student_fee
           (organization_id, student_id, fee_plan_id, season_id, insurance_policy_id, covers_from, covers_to, amount_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1200)`,
        [org, studentId, plan.id, tenant.seasonId, policy.id, from, to],
      );
    }
  });
  return { swim, other, ana, bruno, carla, duarte };
}

type Query = Partial<Record<'sport' | 'classGroupId' | 'insurance' | 'order' | 'overdue' | 'sort', string>>;

function list(query: Query = {}) {
  return new StudentsController().list(
    undefined, // search
    undefined, // levelId
    undefined, // page
    '100', // limit
    query.sort,
    undefined, // invite
    query.sport,
    undefined, // multi
    undefined, // sportCounts
    query.classGroupId,
    query.insurance,
    query.order,
    query.overdue,
  );
}

const ids = (response: Awaited<ReturnType<typeof list>>): string[] => response.students.items.map((s) => s.id);

test('each row says its turmas, its seguro today and whether the family has a login', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const all = await list();
      const row = (id: string) => all.students.items.find((s) => s.id === id)!;
      assert.deepEqual(row(club.ana).turmas, [{ id: club.swim, name: 'Golfinhos' }]);
      assert.deepEqual(row(club.duarte).turmas, []);
      assert.equal(row(club.ana).insuranceState, 'insured');
      assert.equal(row(club.bruno).insuranceState, 'lapsed');
      assert.equal(row(club.carla).insuranceState, 'never');
      assert.equal(row(club.ana).familyHasLogin, false, 'no login: no guardian, no account of their own');
      assert.equal(row(club.ana).familyLastSeenAt, null);
      // The filter's options: the live turmas, by name.
      assert.deepEqual(
        all.turmas.map((one) => one.name),
        ['Golfinhos', 'Tubarões'],
      );
    });
  });
});

test('one turma, no turma, a seguro state, youngest first, and overdue=1 as sort=overdue', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.deepEqual(ids(await list({ classGroupId: club.swim })).sort(), [club.ana, club.bruno].sort());
      assert.deepEqual(ids(await list({ sport: 'none' })), [club.duarte], '*Sem turma*');
      assert.deepEqual(ids(await list({ insurance: 'insured' })), [club.ana]);
      assert.deepEqual(ids(await list({ insurance: 'lapsed' })), [club.bruno]);
      assert.deepEqual(ids(await list({ insurance: 'never' })).sort(), [club.carla, club.duarte].sort());
      // Youngest first; no birth date last.
      assert.deepEqual(ids(await list({ order: 'age' })), [club.carla, club.ana, club.bruno, club.duarte]);
      assert.deepEqual(ids(await list({ overdue: '1' })), ids(await list({ sort: 'overdue' })));
      // The export is the list it was asked from (sweep 01-11-2026), these filters included.
      const exported = async (q: Record<string, string>) =>
        (
          await new ExportsController().students(
            undefined, undefined, undefined, undefined, undefined, undefined, q['classGroupId'], q['insurance'],
          )
        ).students.map((s) => s.id);
      assert.deepEqual((await exported({ classGroupId: club.swim })).sort(), [club.ana, club.bruno].sort());
      assert.deepEqual(await exported({ insurance: 'lapsed' }), [club.bruno]);
      // A turma id that is not a uuid is ignored, never a SQL error.
      assert.equal((await list({ classGroupId: 'golfinhos' })).students.total, 4);
    });
  });
});

test("an instructor's turma filter offers only their sports' turmas", async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    await owner.connect();
    try {
      await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [tenant.organizationId]);
    } finally {
      await owner.end();
    }
    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo 1') RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    await tenant.sql(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
       VALUES ($1, $2, $3, 'Ténis', $4)`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, court!.id],
    );
    const teacher = await addMember(tenant, 'Ana', 'Professora', ['instructor']);
    const names = await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () =>
      (await list()).turmas.map((one) => one.name),
    );
    assert.deepEqual(names, ['Golfinhos', 'Tubarões'], 'swimming only: the instructor holds {pool}');
    const all = await actingAs(tenant, { roles: ['admin'] }, async () => (await list()).turmas.length);
    assert.equal(all, 3);
    void club;
  });
});
