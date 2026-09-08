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

/*
 * ---------------------------------------------------------------------------
 * Partnerships the club runs the lessons for
 * ---------------------------------------------------------------------------
 *
 * POOLSE-46 settled that a parceria takes no register and has no plan, and that
 * is still what a partnership is by default. `partner.managed_lessons` is the
 * exception a club sets on the partnership itself: a school that buys an hour
 * and has us teach it gets a plan and Cancelar aula, and still no register --
 * a partner group holds a `participant_count` and no students, so there is
 * nobody to mark.
 *
 * The switch is what these pin. A partnership with it off must answer exactly as
 * it did before, or every existing parceria quietly changes behaviour.
 */

/** A partnership, one group, and one session of it next week. */
async function partnership(
  tenant: ScratchTenant,
  managed: boolean,
): Promise<{ sessionId: string; groupId: string; instructorId: string }> {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque da Escola', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  const instructorId = await addMember(tenant, 'Nuno', 'Teixeira', ['instructor']);

  const [partner] = await tenant.sql<{ id: string }>(
    `INSERT INTO partner (organization_id, facility_id, name, type, managed_lessons)
     VALUES ($1, $2, 'Escola do Juncal', 'escola', $3) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, managed],
  );

  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO partner_group (organization_id, partner_id, name, participant_count)
     VALUES ($1, $2, '3.o ano', 22) RETURNING id`,
    [tenant.organizationId, partner!.id],
  );

  /*
   * `season_id` is required here and forbidden on a turma booking --
   * `class_schedule_season_source`, POOLSE-47's rule: a turma takes its season
   * from its turma, everything else carries its own.
   */
  const [schedule] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_schedule
       (organization_id, facility_id, subject_type, partner_group_id, season_id, weekday,
        start_time, duration_minutes, instructor_membership_id)
     VALUES ($1, $2, 'parceria', $3, $4, 2, TIME '10:00', 45, $5) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, group!.id, tenant.seasonId, instructorId],
  );

  // No `class_group_id`: that is the whole point of a parceria session.
  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, schedule_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, $3, now() + interval '7 days', 45, (now() + interval '7 days')::date)
     RETURNING id`,
    [tenant.organizationId, schedule!.id, pool!.id],
  );

  return { sessionId: session!.id, groupId: group!.id, instructorId };
}

test('a partnership the club runs gets a plan, stored against its group', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const parceria = await partnership(tenant, true);
      const calendar = new SessionsCalendarController();

      const empty = await calendar.plan(parceria.sessionId);
      assert.equal(empty.body, '');
      // It belongs to the partner group and to no turma, which is the CHECK the
      // migration added holding at the other end.
      assert.equal(empty.classGroupId, null);
      assert.equal(empty.partnerGroupId, parceria.groupId);
      assert.equal(empty.canEdit, true);

      await calendar.savePlan(parceria.sessionId, { body: '8 x 25 costas' });

      const saved = await calendar.plan(parceria.sessionId);
      assert.equal(saved.body, '8 x 25 costas');

      // And it landed on the partner column, not the turma one.
      const [row] = await tenant.sql<{ n: string }>(
        `SELECT count(*) AS n FROM lesson_plan
          WHERE partner_group_id = $1 AND class_group_id IS NULL AND archived_at IS NULL`,
        [parceria.groupId],
      );
      assert.equal(row!.n, '1');
    });
  });
});

test('a partnership the club does not run has no plan at all', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const parceria = await partnership(tenant, false);

      // The same 404 as a session in another club: a caller probing ids learns
      // nothing from the difference, and there is genuinely nothing to plan.
      await expectStatus(() => new SessionsCalendarController().plan(parceria.sessionId), 404);
      await expectStatus(
        () => new SessionsCalendarController().savePlan(parceria.sessionId, { body: 'x' }),
        404,
      );
    });
  });
});

test('the instructor on a partnership booking may write its plan', async () => {
  await withScratchTenant(async (tenant) => {
    let sessionId = '';
    let instructorId = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const parceria = await partnership(tenant, true);
      sessionId = parceria.sessionId;
      instructorId = parceria.instructorId;
    });

    // A parceria has no turma to take an instructor from, so the booking's own
    // is the person who will be standing on the deck -- and the one who needs
    // to write the plan.
    await actingAs(tenant, { membershipId: instructorId, roles: ['instructor'] }, async () => {
      const plan = await new SessionsCalendarController().plan(sessionId);
      assert.equal(plan.canEdit, true);
      await new SessionsCalendarController().savePlan(sessionId, { body: 'Aquecimento 200 m' });
    });

    // Somebody else's instructor reads it and is refused by the API.
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      const plan = await new SessionsCalendarController().plan(sessionId);
      assert.equal(plan.body, 'Aquecimento 200 m');
      assert.equal(plan.canEdit, false);
      await expectStatus(
        () => new SessionsCalendarController().savePlan(sessionId, { body: 'nao' }),
        403,
      );
    });
  });
});

/**
 * A moved lesson is dated by the day it is taught, not by the day it is filed.
 *
 * A plan is keyed on `occurs_on` so it survives a regeneration — a plan hanging
 * off a rebuilt session row is a plan that vanishes when somebody changes the
 * pool. But a one-week move deliberately leaves `occurs_on` alone, so the key is
 * the pattern's day and the class is somewhere else: a Wednesday class moved to
 * Saturday kept a Wednesday key, and the panel said "quarta-feira" above a
 * lesson nobody would attend that day.
 *
 * Both halves are asserted here, because fixing one by breaking the other is the
 * obvious wrong repair: the screen must say Saturday **and** the row must still
 * be filed under Wednesday.
 */
test('a lesson moved for one week is dated where it is taught, and still filed where it was', async () => {
  await withScratchTenant(async (tenant) => {
    const { first, groupId } = await twoLessons(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const sessions = new SessionsCalendarController();
      const before = await sessions.plan(first);

      // Three days later, that week only — the gesture that produces the drift.
      const moved = new Date(`${before.onDate}T12:00:00Z`);
      moved.setUTCDate(moved.getUTCDate() + 3);
      const movedTo = moved.toISOString().slice(0, 10);

      await sessions.move(first, { date: movedTo, startTime: '10:00' });
      await sessions.savePlan(first, { body: 'Viragens' });

      const after = await sessions.plan(first);
      assert.equal(after.onDate, movedTo, 'the panel says the day the class runs');
      assert.equal(after.body, 'Viragens');

      // And the row is still filed under the day the pattern implied, which is
      // what stops the next regeneration losing it.
      const [row] = await tenant.sql<{ on_date: string }>(
        `SELECT on_date::text AS on_date FROM lesson_plan
          WHERE class_group_id = $1 AND archived_at IS NULL`,
        [groupId],
      );
      assert.equal(row?.on_date, before.onDate);
    });
  });
});
