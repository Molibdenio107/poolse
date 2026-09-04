import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from '../classes/classes.controller.js';
import { AttendanceController } from '../classes/attendance.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * "Is this mine?" — slice 1.12.
 *
 * The slice exists because six controllers carried the same comment: an
 * instructor could mark **any** register in their club, confirm any
 * advancement, approve any reposição. None of that crosses a tenant boundary —
 * isolation is structural and lives in the schema — but a register is a record
 * of who was in the water, and a colleague editing it is a colleague
 * overwriting a fact they were not there for.
 *
 * What is asserted here is the part that would otherwise ship broken:
 *
 * **The substitute is the assigned instructor of the night they cover**, and the
 * person they are covering for is not. Read from `resolved_instructor_id`, which
 * is generated rather than copied, so it cannot drift from the two columns
 * behind it.
 *
 * **A booking override makes a turma yours.** POOLSE-46 lets one Tuesday of
 * somebody else's turma name a different instructor; reading only
 * `class_group.instructor_membership_id` would refuse that person the register
 * for the class they are about to teach.
 *
 * **Owner and admin are never refused.** A club whose office cannot fix last
 * Tuesday after the instructor has left is a club that phones support.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  sandra: string;
  nuno: string;
  sandrasTurma: string;
  nunosTurma: string;
  sandrasSession: string;
  nunosSession: string;
}

/** Two instructors, a turma each, and one dated session each. */
async function twoTurmas(tenant: ScratchTenant): Promise<Fixture> {
  const sandra = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
  const nuno = await addMember(tenant, 'Nuno', 'Teixeira', ['instructor']);

  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );

  const turma = async (name: string, instructor: string): Promise<string> => {
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group
         (organization_id, season_id, facility_id, pool_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, pool!.id, name, instructor],
    );
    return group!.id;
  };

  const sandrasTurma = await turma('Infantis', sandra);
  const nunosTurma = await turma('Juvenis', nuno);

  /*
   * Sessions written directly rather than through `generate_sessions`, because
   * the generator needs a published season inside its window and this test is
   * about who may touch a session, not about how one comes to exist.
   */
  const session = async (groupId: string, instructor: string, at: string): Promise<string> => {
    const [made] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session
         (organization_id, class_group_id, pool_id, occurs_on, starts_at,
          duration_minutes, instructor_membership_id)
       VALUES ($1, $2, $3, $4::date, $4::date + time '19:15', 45, $5) RETURNING id`,
      [tenant.organizationId, groupId, pool!.id, at, instructor],
    );
    return made!.id;
  };

  return {
    sandra,
    nuno,
    sandrasTurma,
    nunosTurma,
    sandrasSession: await session(sandrasTurma, sandra, '2026-10-06'),
    nunosSession: await session(nunosTurma, nuno, '2026-10-07'),
  };
}

test('an instructor may mark their own register and not a colleague\'s', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);
    });

    const attendance = new AttendanceController();

    await actingAs(tenant, { membershipId: fix!.sandra, roles: ['instructor'] }, async () => {
      // Hers: allowed, and the screen is told it may offer the control.
      const register = await attendance.register(fix.sandrasSession);
      assert.equal(register.canRecord, true);
      await attendance.record(fix.sandrasSession, { marks: [] });

      /*
       * His: readable, not writable. Looking at a colleague's register to see
       * how a child is getting on is ordinary; editing it is not — so the read
       * succeeds with `canRecord` false and the write is refused outright.
       */
      const other = await attendance.register(fix.nunosSession);
      assert.equal(other.canRecord, false);
      await expectStatus(() => attendance.record(fix.nunosSession, { marks: [] }), 403);
    });
  });
});

test('hiding the button is never the control', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);
    });

    // The request the screen would never send, sent by hand. This is the check —
    // `canRecord` is a courtesy to the interface and nothing more.
    await actingAs(tenant, { membershipId: fix!.nuno, roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new AttendanceController().record(fix.sandrasSession, { marks: [] }),
        403,
      );
    });
  });
});

test('the substitute may mark the night they cover, and the regular may not', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);

      // Sandra is away on the 6th; Nuno covers.
      await tenant.sql(
        `UPDATE class_session SET substitute_instructor_membership_id = $2 WHERE id = $1`,
        [fix.sandrasSession, fix.nuno],
      );
    });

    const attendance = new AttendanceController();

    await actingAs(tenant, { membershipId: fix!.nuno, roles: ['instructor'] }, async () => {
      // The person actually standing there marks the register. That is the whole
      // point of a substitute, and `resolved_instructor_id` is what says so.
      await attendance.record(fix.sandrasSession, { marks: [] });
      assert.equal((await attendance.register(fix.sandrasSession)).canRecord, true);
    });

    await actingAs(tenant, { membershipId: fix!.sandra, roles: ['instructor'] }, async () => {
      /*
       * And Sandra still may, because it is still her turma — she was not there
       * on the night but the class is hers, and a register she has to correct on
       * Monday morning is an ordinary thing. `isMySession` accepts either the
       * resolved instructor or the turma's own.
       */
      assert.equal((await attendance.register(fix.sandrasSession)).canRecord, true);
    });
  });
});

test('a booking override makes the turma yours for that class', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);

      // Nuno covers one weekly slot of Sandra's turma — POOLSE-46's override.
      const [schedule] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_schedule
           (organization_id, facility_id, subject_type, class_group_id, weekday,
            start_time, duration_minutes, instructor_membership_id)
         VALUES ($1, $2, 'turma', $3, 2, '19:15', 45, $4) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, fix.sandrasTurma, fix.nuno],
      );
      assert.ok(schedule);
    });

    await actingAs(tenant, { membershipId: fix!.nuno, roles: ['instructor'] }, async () => {
      // Sandra's turma is now in Nuno's list, because he teaches one of its
      // slots — and a turma he teaches but cannot see is a turma he cannot mark.
      const mine = await new ClassesController().list('mine');
      assert.deepEqual(
        mine.groups.map((group) => group.name).sort(),
        ['Infantis', 'Juvenis'],
      );
    });
  });
});

test('an instructor sees their own turmas; an owner who teaches sees both views', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);
    });

    const classes = new ClassesController();

    await actingAs(tenant, { membershipId: fix!.sandra, roles: ['instructor'] }, async () => {
      // The default view, without asking for one.
      const mine = await classes.list();
      assert.deepEqual(mine.groups.map((group) => group.name), ['Infantis']);
      assert.equal(mine.scope, 'mine');
      // One view, so no switch to offer.
      assert.equal(mine.canSwitchScope, false);

      /*
       * And the club's list is still reachable. The turma list is not secret —
       * POOLSE-49's grid already shows every booking in the building to
       * everybody — so what 1.12 narrows is the acting, not the looking.
       */
      const all = await classes.list('all');
      assert.equal(all.groups.length, 2);
      assert.equal(all.scope, 'all');
    });

    // The owner who also teaches: the case the slice's criterion names.
    await actingAs(
      tenant,
      { membershipId: fix!.sandra, roles: ['owner', 'instructor'] },
      async () => {
        const byDefault = await classes.list();
        assert.equal(byDefault.scope, 'all', 'an owner opens on the club, not on themselves');
        assert.equal(byDefault.groups.length, 2);
        assert.equal(byDefault.canSwitchScope, true, 'and is offered the other view');

        const mine = await classes.list('mine');
        assert.deepEqual(mine.groups.map((group) => group.name), ['Infantis']);
        assert.equal(mine.scope, 'mine');
      },
    );
  });
});

test('an owner or admin is never refused a register', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);
    });

    const attendance = new AttendanceController();

    // Neither of these turmas is theirs and both are markable. The office fixing
    // last Tuesday after the instructor has left is the reason.
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.equal((await attendance.register(fix.sandrasSession)).canRecord, true);
      await attendance.record(fix.nunosSession, { marks: [] });
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await attendance.record(fix.sandrasSession, { marks: [] });
    });
  });
});

test('a role with no business here is still refused before ownership is asked', async () => {
  await withScratchTenant(async (tenant) => {
    let fix: Fixture;
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fix = await twoTurmas(tenant);
    });

    /*
     * Maintenance holds no teaching role at all, so it fails `requireRole`
     * before `requireMySession` is ever consulted. Asserted because the two
     * checks are separate and the order matters: an ownership check that ran
     * first would answer "not yours" to somebody whose actual problem is that
     * they are not staff.
     */
    await actingAs(tenant, { roles: ['maintenance'] }, async () => {
      await expectStatus(
        () => new AttendanceController().record(fix.sandrasSession, { marks: [] }),
        403,
      );
      await expectStatus(() => new AttendanceController().register(fix.sandrasSession), 403);
    });
  });
});
