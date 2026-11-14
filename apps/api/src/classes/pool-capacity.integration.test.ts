import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * The tank is full, said in a way an operator can act on — round 5, ticket 4.2.
 *
 * `pool-capacity.sql` proves the rule itself, against the database, including
 * the tenant boundary. This proves the other half: that the refusal arrives as a
 * 409 carrying the three figures rather than as a 500, and that the figures are
 * the ones the database counted.
 *
 * **The numbers are the point.** "The pool is full" tells an operator to give
 * up; "the tank holds 40, this slot already has 32, so this class may take 8"
 * tells them what to type. They travel from the trigger's DETAIL through
 * `asHttp` without being recomputed, so this test is what would catch the day
 * somebody reimplements the sum in TypeScript and the two answers drift.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Tenant {
  organizationId: string;
  facilityId: string;
  seasonId: string;
  sql: <T extends object>(text: string, values?: unknown[]) => Promise<T[]>;
}

/** A tank with a ceiling, and one without, at the same site. */
async function tanks(tenant: Tenant): Promise<{ capped: string; uncapped: string }> {
  const [capped] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind, max_capacity)
     VALUES ($1, $2, 'Tanque Grande', 'indoor', 40) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [uncapped] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Sem Limite', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  return { capped: capped!.id, uncapped: uncapped!.id };
}

async function aTurma(
  tenant: Tenant,
  name: string,
  poolId: string,
  capacity: number,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, facility_id, season_id, name, pool_id, capacity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId, name, poolId, capacity],
  );
  return row!.id;
}

/** The structure `asHttp` attaches, narrowed the way the web app narrows it. */
function capacityOf(error: unknown): {
  status: number;
  code: unknown;
  max: unknown;
  taken: unknown;
  remaining: unknown;
} {
  const status = (error as { status?: number }).status ?? 0;
  const body = (error as { response?: Record<string, unknown> }).response ?? {};
  const full = (body['poolCapacity'] ?? {}) as Record<string, unknown>;
  return {
    status,
    code: body['code'],
    max: full['max'],
    taken: full['taken'],
    remaining: full['remaining'],
  };
}

test('14-11-2026 — a slot over the tank ceiling saves, and the answer names the numbers', async () => {
  await withScratchTenant(async (tenant) => {
    const { capped } = await tanks(tenant);
    const cadetes = await aTurma(tenant, 'Cadetes', capped, 20);
    const infantis = await aTurma(tenant, 'Infantis', capped, 12);
    const absolutos = await aTurma(tenant, 'Absolutos', capped, 12);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const slot = { weekday: 1, startTime: '19:15', durationMinutes: 45 };

      // 20 + 12 = 32 in a tank of 40: nothing to say.
      await classes.schedule(cadetes, slot);
      assert.deepEqual((await classes.schedule(infantis, slot)).poolOver, []);

      // The third makes 44 places: saved (Rui, 14-11-2026), and warned.
      const third = await classes.schedule(absolutos, slot);
      assert.equal(third.added, true);
      assert.deepEqual(third.poolOver, [{ weekday: 1, startTime: '19:15', max: 40, taken: 32, own: 12 }]);
    });
  });
});

test('4.2 — a tank with no ceiling refuses nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const { uncapped } = await tanks(tenant);
    const big = await aTurma(tenant, 'Livres', uncapped, 500);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const added = await classes.schedule(big, {
        weekday: 1,
        startTime: '19:15',
        durationMinutes: 45,
      });

      // Null is "not measured", and a club that has not measured it goes on
      // timetabling exactly as it did before this ticket existed.
      assert.equal(added.added, true);
    });
  });
});

test('14-11-2026 — dragging a turma into a full slot is not refused', async () => {
  await withScratchTenant(async (tenant) => {
    const { capped } = await tanks(tenant);
    const cadetes = await aTurma(tenant, 'Cadetes', capped, 32);
    const infantis = await aTurma(tenant, 'Infantis', capped, 12);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      await classes.schedule(cadetes, { weekday: 1, startTime: '19:15', durationMinutes: 45 });
      await classes.schedule(infantis, { weekday: 2, startTime: '19:15', durationMinutes: 45 });
      const [slot] = await tenant.sql<{ id: string }>(
        `SELECT id FROM class_schedule WHERE class_group_id = $1 AND archived_at IS NULL`,
        [infantis],
      );
      const moved = await classes.moveSlot(infantis, slot!.id, { weekday: 1, startTime: '19:15' });
      assert.equal(moved.moved, true);
    });
  });
});

test('14-11-2026 — enrolling past the people a tank holds is a 409 with the numbers', async () => {
  await withScratchTenant(async (tenant) => {
    const [small] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind, max_capacity)
       VALUES ($1, $2, 'Tanque Pequeno', 'indoor', 1) RETURNING id`,
      [tenant.organizationId, tenant.facilityId],
    );
    const turma = await aTurma(tenant, 'Pequenos', small!.id, 5);
    const students = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name)
       VALUES ($1, 'Ana', 'Um'), ($1, 'Bia', 'Dois') RETURNING id`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      await classes.schedule(turma, { weekday: 3, startTime: '18:00', durationMinutes: 45 });
      await classes.addStudent(turma, { studentId: students[0]!.id });

      let refusal: unknown = null;
      try {
        await classes.addStudent(turma, { studentId: students[1]!.id });
      } catch (error) {
        refusal = error;
      }
      const body = (refusal as { response?: Record<string, unknown> }).response ?? {};
      assert.equal((refusal as { status?: number }).status, 409);
      assert.equal(body['code'], 'pool_people_full');
      assert.deepEqual(body['poolPeople'], { max: 1, people: 2 });

      // The waiting list is not in the water.
      assert.equal((await classes.addStudent(turma, { studentId: students[1]!.id, waiting: true })).status, 'waiting');
    });
  });
});
