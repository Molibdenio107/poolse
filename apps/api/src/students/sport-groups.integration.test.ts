import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { LeadsController } from '../leads/leads.controller.js';
import { AdvancementController, LevelsController, StudentsController } from './students.controller.js';
import { readAttention } from '../attention/attention.repository.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Alunos and its children per sport — POOLSE-143.
 *
 * A lead's sport is derived once (`LEAD_SPORT`): the turma asked for, else the
 * level, else none — read by the list, the chips and the menu circle alike. A
 * sport's Níveis is its own ladder, and its Avanços the proposals onto it.
 * `?sport=` names a sport the club has on, or `none`; anything else is a 400.
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

async function lead(
  tenant: ScratchTenant,
  first: string,
  fields: { levelId?: string; classGroupId?: string } = {},
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO lead (organization_id, facility_id, swimmer_first_name, swimmer_last_name,
                       swimmer_birth_date, email, consent_text_version, consented_at,
                       level_id, requested_class_group_id, requested_by_membership_id)
     VALUES ($1, $2, $3, 'Teste', '2016-05-01', 'familia@example.test', 'v1', now(), $4, $5, $6)
     RETURNING id`,
    [
      tenant.organizationId,
      tenant.facilityId,
      first,
      fields.levelId ?? null,
      fields.classGroupId ?? null,
      fields.classGroupId === undefined ? null : tenant.ownerMembershipId,
    ],
  );
  return row!.id;
}

test('a lead’s sport is its turma’s, else its level’s, else none — and the list, the chips and the circle agree (QA 5, 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    await enableTennis(org);
    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo 1') RETURNING id`,
      [org, tenant.facilityId],
    );
    const [tennisTurma] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
       VALUES ($1, $2, $3, 'Ténis Iniciação', $4) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, court!.id],
    );
    const [poolLevel] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Golfinhos', 0) RETURNING id`,
      [org],
    );
    const tennisLead = await lead(tenant, 'Teresa', { classGroupId: tennisTurma!.id });
    const poolLead = await lead(tenant, 'Paulo', { levelId: poolLevel!.id });
    const noSport = await lead(tenant, 'Nuno');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const leads = new LeadsController();
      const ids = async (sport?: string): Promise<string[]> =>
        (await leads.list(undefined, sport)).leads.map((one) => one.id);
      assert.deepEqual(await ids('tennis'), [tennisLead]);
      assert.deepEqual(await ids('pool'), [poolLead]);
      assert.deepEqual(await ids('none'), [noSport]);
      assert.equal((await ids()).length, 3);
      await expectStatus(() => leads.list(undefined, 'padel'), 400);

      const counted = await leads.list(undefined, undefined, '1');
      assert.deepEqual(counted.sportCounts, {
        total: 3,
        bySport: [
          { sport: 'pool', count: 1 },
          { sport: 'tennis', count: 1 },
        ],
        none: 1,
      });
      assert.equal(counted.leads.find((one) => one.id === tennisLead)?.sport, 'tennis');
    });

    // The circle: each sport's Pedidos its own, the shared entry the rest (rule 7).
    const attention = await readAttention(org, {
      leads: true,
      water: false,
      maintenance: false,
      families: null,
      membershipId: tenant.ownerMembershipId,
    });
    assert.deepEqual(attention.menu, { leads: 1, 'leads:pool': 1, 'leads:tennis': 1 });
  });
});

test('a pool-only club keeps one circle counting every lead (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    await lead(tenant, 'Uma');
    await lead(tenant, 'Outra');
    const attention = await readAttention(tenant.organizationId, {
      leads: true,
      water: false,
      maintenance: false,
      families: null,
      membershipId: tenant.ownerMembershipId,
    });
    assert.deepEqual(attention.menu, { leads: 2 });
  });
});

test('a sport’s Níveis is its own ladder, and its Avanços the proposals onto it', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    await enableTennis(org);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const levels = new LevelsController();
      await levels.create({ name: 'Natação 1' });
      const { id: tennisOne } = await levels.create({ name: 'Ténis 1', sportId: 'tennis' });
      const { id: tennisTwo } = await levels.create({ name: 'Ténis 2', sportId: 'tennis' });
      await expectStatus(() => levels.create({ name: 'Padel 1', sportId: 'padel' }), 400);

      const ladder = (sport?: string) =>
        new StudentsController()
          .list(undefined, undefined, undefined, undefined, undefined, undefined, sport)
          .then((r) => r.levels.map((level) => [level.name, level.sportId, level.sortOrder]));
      // Each ladder is ordered on its own: tennis starts at 0, beside swimming's 0.
      assert.deepEqual(await ladder('tennis'), [
        ['Ténis 1', 'tennis', 0],
        ['Ténis 2', 'tennis', 1],
      ]);
      assert.deepEqual(await ladder('pool'), [['Natação 1', 'pool', 0]]);

      // Her tennis level sits on its own row — POOLSE-148; the record's own
      // field is the swimming level.
      const [student] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Rita', 'Teste') RETURNING id`,
        [org],
      );
      await tenant.sql(
        `INSERT INTO student_sport_level (organization_id, student_id, sport_id, level_id) VALUES ($1, $2, 'tennis', $3)`,
        [org, student!.id, tennisOne],
      );
      await tenant.sql(
        `INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id) VALUES ($1, $2, $3, $4)`,
        [org, student!.id, tennisOne, tennisTwo],
      );
      const queue = (sport?: string) =>
        new AdvancementController().list(undefined, undefined, sport).then((r) => r.proposals.items.length);
      assert.equal(await queue('tennis'), 1);
      assert.equal(await queue('pool'), 0);
      assert.equal(await queue(), 1);
      await expectStatus(() => new AdvancementController().list(undefined, undefined, 'none'), 400);
    });
  });
});

/*
 * QA 7 was "a convenience, not a boundary" until POOLSE-145 made it one: an
 * instructor reads only the sports they belong to. Everybody belongs to
 * swimming until told otherwise, so tennis is now a 403 for them — and the
 * owner, who reads every sport, still filters any.
 */
test('the filter is an instructor’s boundary since POOLSE-145; the owner filters any sport (QA 7)', async () => {
  await withScratchTenant(async (tenant) => {
    await enableTennis(tenant.organizationId);
    const tennis = () =>
      new StudentsController().list(undefined, undefined, undefined, undefined, undefined, undefined, 'tennis');
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(tennis, 403);
    });
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual((await tennis()).students.items, []);
    });
  });
});
