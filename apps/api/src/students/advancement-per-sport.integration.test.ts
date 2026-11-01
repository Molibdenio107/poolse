import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AdvancementController } from './students.controller.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * Advancement per sport — POOLSE-148, slice C.
 *
 * A child in swimming and tennis advances on each ladder on its own: the age
 * proposal for tennis is made from their tennis level into the next tennis
 * level — never into a swimming one, which `next_level` / `age_fit_level` used
 * to allow by ordering every ladder together — and confirming it moves the
 * tennis level and the tennis enrolment only.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function enableTennis(organizationId: string): Promise<void> {
  const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await owner.connect();
  try {
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [organizationId]);
  } finally {
    await owner.end();
  }
}

async function level(
  tenant: ScratchTenant,
  name: string,
  sport: string,
  order: number,
  ages: { min?: number; max?: number } = {},
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order, sport_id, min_age_months, max_age_months)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenant.organizationId, name, order, sport, ages.min ?? null, ages.max ?? null],
  );
  return row!.id;
}

async function turma(tenant: ScratchTenant, name: string, levelId: string, playingAreaId: string | null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, level_id, playing_area_id, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, 10) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, levelId, playingAreaId],
  );
  return row!.id;
}

test('a tennis age proposal stays on the tennis ladder, and confirming it moves tennis only', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    await enableTennis(org);
    // Swimming: one level with no band. Tennis: a junior band, then an open one.
    // The tennis levels sort *between* swimming's by number, which is how the old
    // cross-ladder ordering would have mixed them up.
    const golfinhos = await level(tenant, 'Golfinhos', 'pool', 0);
    const orcas = await level(tenant, 'Orcas', 'pool', 5, { min: 0 });
    const tennisJunior = await level(tenant, 'Mini-ténis', 'tennis', 1, { max: 72 });
    const tennisOpen = await level(tenant, 'Ténis', 'tennis', 2, { min: 72 });

    const [court] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, 'tennis', 'Campo') RETURNING id`,
      [org, tenant.facilityId],
    );
    const swimTurma = await turma(tenant, 'Natação', golfinhos, null);
    const juniorTurma = await turma(tenant, 'Mini-ténis Seg', tennisJunior, court!.id);
    const openTurma = await turma(tenant, 'Ténis Qua', tennisOpen, court!.id);

    // Ten years old: above the tennis junior band, within swimming (no band).
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, level_id)
       VALUES ($1, 'Rita', 'Dupla', (current_date - interval '10 years')::date, $2) RETURNING id`,
      [org, golfinhos],
    );
    await tenant.sql(
      `INSERT INTO student_sport_level (organization_id, student_id, sport_id, level_id) VALUES ($1, $2, 'tennis', $3)`,
      [org, child!.id, tennisJunior],
    );
    for (const group of [swimTurma, juniorTurma]) {
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
         VALUES ($1, $2, $3, 'active', club_today() - 30)`,
        [org, group, child!.id],
      );
    }

    // The ladders stay apart: nothing after Golfinhos but Orcas, nothing after
    // Mini-ténis but Ténis.
    const [next] = await tenant.sql<{ swim: string | null; tennis: string | null }>(
      `SELECT next_level($1, $2) AS swim, next_level($1, $3) AS tennis`,
      [org, golfinhos, tennisJunior],
    );
    assert.equal(next!.swim, orcas);
    assert.equal(next!.tennis, tennisOpen);

    const [queued] = await tenant.sql<{ n: number }>(`SELECT propose_age_advancements($1, $2) AS n`, [
      org,
      tenant.seasonId,
    ]);
    assert.equal(queued!.n, 1, 'one proposal, for tennis');
    const [proposal] = await tenant.sql<{ id: string; from_level_id: string; to_level_id: string }>(
      `SELECT id, from_level_id, to_level_id FROM transfer_proposal WHERE student_id = $1 AND status = 'pending'`,
      [child!.id],
    );
    assert.deepEqual([proposal!.from_level_id, proposal!.to_level_id], [tennisJunior, tennisOpen]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(
        await new AdvancementController().confirm(proposal!.id, { classGroupId: openTurma, effectiveOn: clubToday() }),
        { confirmed: true },
      );
    });

    const [after] = await tenant.sql<{ swim: string | null; tennis: string | null }>(
      `SELECT s.level_id AS swim, student_level_in(s.id, 'tennis') AS tennis FROM student s WHERE s.id = $1`,
      [child!.id],
    );
    assert.equal(after!.swim, golfinhos, 'the swimming level stayed');
    assert.equal(after!.tennis, tennisOpen, 'the tennis level moved');

    const enrolments = await tenant.sql<{ class_group_id: string; status: string }>(
      `SELECT class_group_id, status::text AS status FROM enrollment WHERE student_id = $1 ORDER BY status, class_group_id`,
      [child!.id],
    );
    const statusOf = (group: string) => enrolments.find((one) => one.class_group_id === group)?.status;
    assert.equal(statusOf(swimTurma), 'active', 'swimming untouched');
    assert.equal(statusOf(openTurma), 'active');
    assert.equal(statusOf(juniorTurma), 'ended');
  });
});
