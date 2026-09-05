import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { SessionsCalendarController } from './sessions.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
} from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * The plan for one lesson — round 6, ticket 4.3.
 *
 * **The permission tests are the ones that earn their place.** "The instructor
 * responsible for that class group" is not a role, so `requireRole` cannot say
 * it — the check is about a row, and a check about a row is the kind that is
 * easy to write as a UI condition and forget on the server. Tests 3 and 4 are
 * that check, from both sides.
 *
 * The rest pin what a plan *is*: one per lesson, replaced rather than appended
 * to, removed when the box is emptied, and copyable from the lesson before.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  /** Two Tuesdays of one turma, a week apart. */
  first: string;
  second: string;
  groupId: string;
  /** The instructor the turma is assigned to. */
  instructorId: string;
}

async function twoLessons(tenant: ScratchTenant, options?: { staffed?: boolean }): Promise<Fixture> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque Grande', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  const instructorId = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);

  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name) VALUES ($1, 'Iniciados') RETURNING id`,
    [tenant.organizationId],
  );

  // In their own order, which is the order a club teaches them in — and the
  // order the suggestions strip has to offer them in.
  await tenant.sql(
    `INSERT INTO skill (organization_id, level_id, name, sort_order) VALUES
       ($1, $2, 'Viragem de crol', 2),
       ($1, $2, 'Respiração lateral', 1),
       ($1, $2, 'Partida de blocos', 3)`,
    [tenant.organizationId, level!.id],
  );

  const { id: groupId } = await actingAs(tenant, { roles: ['owner'] }, async () =>
    new ClassesController().create({
      name: 'Iniciados A',
      poolId: pool!.id,
      lane: 1,
      levelId: level!.id,
      ...(options?.staffed === false ? {} : { instructorMembershipId: instructorId }),
    }),
  );

  const sessions = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES
       ($1, $2, $3, now() + interval '7 days', 45, (now() + interval '7 days')::date),
       ($1, $2, $3, now() + interval '14 days', 45, (now() + interval '14 days')::date)
     RETURNING id`,
    [tenant.organizationId, groupId, pool!.id],
  );

  return {
    first: sessions[0]!.id,
    second: sessions[1]!.id,
    groupId,
    instructorId,
  };
}

test('a lesson starts with no plan, and the level offers its skills in order', async () => {
  await withScratchTenant(async (tenant) => {
    const { first } = await twoLessons(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const plan = await new SessionsCalendarController().plan(first);

      assert.equal(plan.body, '', 'nothing written yet');
      assert.equal(plan.updatedBy, null);
      assert.equal(plan.previous, null, 'and nothing before it');
      assert.equal(plan.canEdit, true);

      // `sort_order`, not alphabetical: this is the sequence a club teaches in.
      assert.deepEqual(plan.skills, [
        'Respiração lateral',
        'Viragem de crol',
        'Partida de blocos',
      ]);
    });
  });
});

test('a plan is written, replaced, and says who last touched it', async () => {
  await withScratchTenant(async (tenant) => {
    const { first } = await twoLessons(tenant);
    const sessions = new SessionsCalendarController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sessions.savePlan(first, { body: '400 m aquecimento' });
      await sessions.savePlan(first, { body: '400 m aquecimento\n8 × 25 costas' });

      const plan = await sessions.plan(first);
      assert.equal(plan.body, '400 m aquecimento\n8 × 25 costas', 'replaced, not appended');
      assert.notEqual(plan.updatedBy, null, 'and it names whoever wrote it');
    });

    // One row, not two — the partial unique index doing what the upsert assumes.
    const [count] = await tenant.sql<{ n: string }>(
      `SELECT count(*) AS n FROM lesson_plan WHERE archived_at IS NULL`,
    );
    assert.equal(count!.n, '1');
  });
});

test('the previous lesson is the one before, and copying it is the caller reading it', async () => {
  await withScratchTenant(async (tenant) => {
    const { first, second } = await twoLessons(tenant);
    const sessions = new SessionsCalendarController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sessions.savePlan(first, { body: 'Viragens' });

      const later = await sessions.plan(second);
      assert.equal(later.previous?.body, 'Viragens');

      /*
       * And a lesson that already has a plan is not offered its own back.
       * `on_date < $2` is strictly earlier for exactly this reason: "copy from
       * the previous lesson" that copied the current one would be a button that
       * appears to do nothing.
       */
      await sessions.savePlan(second, { body: 'Partidas' });
      const again = await sessions.plan(second);
      assert.equal(again.previous?.body, 'Viragens', 'still the earlier one');
    });
  });
});

test('emptying the box removes the plan rather than storing a blank one', async () => {
  await withScratchTenant(async (tenant) => {
    const { first } = await twoLessons(tenant);
    const sessions = new SessionsCalendarController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sessions.savePlan(first, { body: 'Viragens' });
      const cleared = await sessions.savePlan(first, { body: '   ' });

      assert.equal(cleared.saved, false, 'it reports that nothing is stored');
      assert.equal((await sessions.plan(first)).body, '');
    });

    const [count] = await tenant.sql<{ n: string }>(
      `SELECT count(*) AS n FROM lesson_plan WHERE archived_at IS NULL`,
    );
    assert.equal(count!.n, '0', 'the row is gone, not blank');
  });
});

test("the turma's own instructor may plan it", async () => {
  await withScratchTenant(async (tenant) => {
    const { first, instructorId } = await twoLessons(tenant);

    await actingAs(tenant, { membershipId: instructorId, roles: ['instructor'] }, async () => {
      const sessions = new SessionsCalendarController();

      assert.equal((await sessions.plan(first)).canEdit, true, 'the screen is told so');
      await sessions.savePlan(first, { body: 'Pernada com prancha' });
      assert.equal((await sessions.plan(first)).body, 'Pernada com prancha');
    });
  });
});

test('another instructor may read the plan and is refused by the API, not by the screen', async () => {
  await withScratchTenant(async (tenant) => {
    const { first } = await twoLessons(tenant);
    const stranger = await addMember(tenant, 'Bruno', 'Costa', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () =>
      new SessionsCalendarController().savePlan(first, { body: 'Viragens' }),
    );

    await actingAs(tenant, { membershipId: stranger, roles: ['instructor'] }, async () => {
      const sessions = new SessionsCalendarController();

      /*
       * Reading is open on purpose: somebody covering for a colleague needs to
       * know what the group was doing. It is writing that belongs to one person.
       */
      const plan = await sessions.plan(first);
      assert.equal(plan.body, 'Viragens');
      assert.equal(plan.canEdit, false);

      // 403, from the server. Hiding the box would not have been the rule.
      await expectStatus(() => sessions.savePlan(first, { body: 'O meu plano' }), 403);
    });

    // And nothing was written.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await new SessionsCalendarController().plan(first)).body, 'Viragens');
    });
  });
});

test('a turma with nobody on it is owner and admin only', async () => {
  await withScratchTenant(async (tenant) => {
    // The ticket's own rule: with no instructor assigned, there is nobody else
    // to name, so the club's managers are the only ones who can plan it.
    const { first } = await twoLessons(tenant, { staffed: false });
    const somebody = await addMember(tenant, 'Carla', 'Dias', ['instructor']);

    await actingAs(tenant, { membershipId: somebody, roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new SessionsCalendarController().savePlan(first, { body: 'Tento a sorte' }),
        403,
      );
    });

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      await new SessionsCalendarController().savePlan(first, { body: 'Plano do clube' });
      assert.equal((await new SessionsCalendarController().plan(first)).body, 'Plano do clube');
    });
  });
});

test('a cancelled lesson keeps its plan, and says it is cancelled', async () => {
  await withScratchTenant(async (tenant) => {
    const { first } = await twoLessons(tenant);
    const sessions = new SessionsCalendarController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await sessions.savePlan(first, { body: 'Viragens' });
      await sessions.cancel(first, {});

      // Hidden with the class on screen; not destroyed underneath, so a class
      // brought back by Undo comes back with its plan.
      const plan = await sessions.plan(first);
      assert.equal(plan.cancelled, true);
      assert.equal(plan.body, 'Viragens');
    });
  });
});

test('a plan is refused for a class that does not exist', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () =>
          new SessionsCalendarController().plan('00000000-0000-4000-8000-000000000000'),
        404,
      );
    });
  });
});
