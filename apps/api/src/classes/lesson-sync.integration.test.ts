import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * A turma's lessons follow its weekly pattern — 11 October 2026.
 *
 * Before this, lessons existed only after somebody pressed *Gerar a época*, so a
 * turma placed on the calendar later had no lesson and its card lost the plan,
 * the register and Cancelar aula. Every pattern write now tops the season up.
 * What must hold: the lessons appear at once, never in the past, and a removed
 * slot's future lessons go with it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function aTurma(
  tenant: ScratchTenant,
  name = 'Golfinhos',
  instructor: string | null = null,
  poolId: string | null = null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, facility_id, season_id, name, instructor_membership_id,
                              pool_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId, name, instructor, poolId],
  );
  return row!.id;
}

async function lessons(
  tenant: ScratchTenant,
  groupId: string,
): Promise<{ total: number; past: number; live: number; first: string | null }> {
  const [row] = await tenant.sql<{ total: number; past: number; live: number; first: string | null }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE occurs_on < club_today())::int AS past,
            count(*) FILTER (WHERE status <> 'cancelled')::int AS live,
            min(occurs_on)::text AS first
       FROM class_session WHERE class_group_id = $1`,
    [groupId],
  );
  return row!;
}

test('placing a turma creates its lessons to the end of the season, none in the past', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await aTurma(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const added = await new ClassesController().schedule(groupId, {
        weekday: '3',
        startTime: '10:00',
        durationMinutes: '45',
      });
      assert.ok(added.lessons !== null);
      assert.ok(added.lessons.created > 0, 'lessons exist without pressing Gerar');
    });

    const after = await lessons(tenant, groupId);
    assert.ok(after.total > 0);
    assert.equal(after.past, 0, 'a turma placed today owes no register for the past');
  });
});

test('removing the slot takes its future lessons with it', async () => {
  await withScratchTenant(async (tenant) => {
    const groupId = await aTurma(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new ClassesController();
      await controller.schedule(groupId, { weekday: '3', startTime: '10:00', durationMinutes: '45' });
      const [slot] = await tenant.sql<{ id: string }>(
        'SELECT id FROM class_schedule WHERE class_group_id = $1 AND archived_at IS NULL',
        [groupId],
      );
      await controller.unschedule(groupId, slot!.id);
    });

    const after = await lessons(tenant, groupId);
    assert.equal(after.live, 0, 'no lesson left standing for a slot that is gone');
  });
});

test('a clash leaves out only the turmas in it, and names them', async () => {
  await withScratchTenant(async (tenant) => {
    const teacher = await addMember(tenant, 'Prof', 'Dobrado', ['instructor']);
    // Two tanks: one instructor across lanes of one pool is allowed (POOLSE-51).
    const pools: string[] = [];
    for (const name of ['Tanque 1', 'Tanque 2']) {
      const [pool] = await tenant.sql<{ id: string }>(
        `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, name],
      );
      pools.push(pool!.id);
    }
    const first = await aTurma(tenant, 'Bebés', teacher, pools[0]!);
    const second = await aTurma(tenant, 'Aperfeiçoamento', teacher, pools[1]!);
    const other = await aTurma(tenant, 'Cadetes');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new ClassesController();
      // Same instructor, same Monday hour, two tanks: a clash.
      await controller.schedule(first, { weekday: '1', startTime: '12:45', durationMinutes: '45' });
      await controller.schedule(second, { weekday: '1', startTime: '12:45', durationMinutes: '45' });
      const added = await controller.schedule(other, {
        weekday: '3',
        startTime: '10:00',
        durationMinutes: '45',
      });
      assert.ok(added.lessons !== null);
      assert.equal(added.lessons.clashes.length, 1, 'the clash is named');
    });

    // The first was placed before any clash existed and keeps its lessons; the
    // one whose placement made the clash gets none until it is fixed.
    assert.ok((await lessons(tenant, first)).total > 0);
    assert.equal((await lessons(tenant, second)).total, 0);
    assert.ok((await lessons(tenant, other)).total > 0, 'one clash does not empty the calendar');
  });
});
