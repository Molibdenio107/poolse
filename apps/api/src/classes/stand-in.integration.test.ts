import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionsCalendarController } from './sessions.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Who is teaching this one lesson.
 *
 * **This file exists because the feature shipped dead.** Every query in
 * `stand-in.repository.ts` tested `class_session.archived_at`, a column that has
 * never existed — a session is ended with `status = 'cancelled'`, and there is
 * no soft-delete column to ask about. Postgres answered `42703`, the endpoint
 * answered 500, and the browser's `.catch(() => null)` turned that into a
 * dropdown that sat greyed for ever with nothing said.
 *
 * Nothing else could have caught it. `pnpm typecheck` does not read SQL, and
 * `pnpm sql:check` only looks for backticks inside template literals. Only a
 * query run against a real schema does — which is what this is.
 *
 * So the first test is deliberately unambitious: ask the endpoint for the list,
 * expect an answer. Had it existed, the round would have ended one defect
 * shorter.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Fixture {
  sessionId: string;
  otherSessionId: string;
  poolId: string;
  otherPoolId: string;
  ana: string;
  bruno: string;
}

/** The Tuesday of next week, so nothing here lands on data today already has. */
function nextTuesday(): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
  return new Date(monday + 8 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Two tanks, two instructors, and one lesson in each at the same hour.
 *
 * Two *pools* rather than two lanes of one, because that is the axis the
 * exclusion constraint actually cares about: `class_session_instructor_free`
 * carries `pool_id WITH <>`, so one person watching two lanes of the same tank
 * is allowed and the same person in two tanks at once is not.
 */
async function twoTanks(tenant: ScratchTenant): Promise<Fixture> {
  const ana = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const bruno = await addMember(tenant, 'Bruno', 'Carvalho', ['instructor']);

  const pools: string[] = [];
  for (const name of ['Tanque grande', 'Tanque pequeno']) {
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name) VALUES ($1, $2, $3)
       RETURNING id`,
      [tenant.organizationId, tenant.facilityId, name],
    );
    pools.push(pool!.id);
  }
  const poolId = pools[0]!;
  const otherPoolId = pools[1]!;

  /** A turma in `pool`, taught by `who`, with one session next Tuesday at 18:00. */
  async function lesson(name: string, pool: string, who: string): Promise<string> {
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group
         (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, pool, who],
    );

    const [session] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session
         (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on,
          starts_at, duration_minutes)
       VALUES ($1, $2, $3, $4, $5::date,
               ($5::date + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45)
       RETURNING id`,
      [tenant.organizationId, group!.id, pool, who, nextTuesday()],
    );

    return session!.id;
  }

  return {
    sessionId: await lesson('Iniciação', poolId, ana),
    otherSessionId: await lesson('Aperfeiçoamento', otherPoolId, bruno),
    poolId,
    otherPoolId,
    ana,
    bruno,
  };
}

/** Approved leave for one person on one day — what makes somebody "away". */
async function approvedLeave(
  tenant: ScratchTenant,
  membershipId: string,
  day: string,
  kind: 'vacation' | 'medical' | 'personal',
): Promise<void> {
  /*
   * Pending first, then decided — the order the schema insists on.
   *
   * `vacation_request_check` says a request that is not pending must carry a
   * `decided_at`, so inserting one straight as approved is refused. The days go
   * in before the status moves for the same reason `seed.ts` does it that way:
   * the trigger that releases a refused request's days would otherwise archive
   * them on the way in.
   */
  const [request] = await tenant.sql<{ id: string }>(
    `INSERT INTO vacation_request (organization_id, membership_id, kind)
     VALUES ($1, $2, $3::leave_kind) RETURNING id`,
    [tenant.organizationId, membershipId, kind],
  );

  await tenant.sql(
    `INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
     VALUES ($1, $2, $3, $4::date)`,
    [tenant.organizationId, request!.id, membershipId, day],
  );

  await tenant.sql(
    `UPDATE vacation_request
        SET status = 'approved', decided_at = now(), decided_by_membership_id = $2
      WHERE id = $1`,
    [request!.id, tenant.ownerMembershipId],
  );
}

test('the candidate list answers at all', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await twoTanks(tenant);

      const answer = await new SessionsCalendarController().standInOptions(fixture.sessionId);

      // The turma's own instructor is who the box should be showing.
      assert.equal(answer.currentId, fixture.ana);
      // Both instructors are offered; nobody is hidden.
      assert.deepEqual(
        new Set(answer.candidates.map((one) => one.membershipId)),
        new Set([fixture.ana, fixture.bruno]),
      );
    });
  });
});

test('the current teacher is the session own, not the turma one', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await twoTanks(tenant);

      /*
       * A third instructor, teaching nothing.
       *
       * Putting Bruno on Ana's lesson would be refused by
       * `class_session_instructor_free` — he is in the other tank at that hour,
       * which is the constraint working. The point here is only which column the
       * current teacher is read from, so the override goes to somebody free.
       */
      const carla = await addMember(tenant, 'Cláudia', 'Pinto', ['instructor']);

      // The booking put somebody else on this one slot — the override the grid
      // renders. Reading `class_group` instead named the wrong person, which on
      // the dev database is 348 sessions of 471.
      await tenant.sql('UPDATE class_session SET instructor_membership_id = $2 WHERE id = $1', [
        fixture.sessionId,
        carla,
      ]);

      const answer = await new SessionsCalendarController().standInOptions(fixture.sessionId);
      assert.equal(answer.currentId, carla);
    });
  });
});

test('busy means what the database would refuse, and not more', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await twoTanks(tenant);

      const answer = await new SessionsCalendarController().standInOptions(fixture.sessionId);
      const bruno = answer.candidates.find((one) => one.membershipId === fixture.bruno);

      // Bruno is teaching the other tank at the same hour, and the constraint
      // carries `pool_id WITH <>` — so this is the case it would refuse.
      assert.equal(bruno?.busy, true);

      // Move his lesson into *this* tank: one person on two lanes of one tank is
      // a thing clubs do and the database allows it. Warning here would be
      // warning about something that is not refused.
      await tenant.sql('UPDATE class_session SET pool_id = $2 WHERE id = $1', [
        fixture.otherSessionId,
        fixture.poolId,
      ]);

      const again = await new SessionsCalendarController().standInOptions(fixture.sessionId);
      assert.equal(again.candidates.find((one) => one.membershipId === fixture.bruno)?.busy, false);
    });
  });
});

test('somebody on approved leave is listed, with the reason, and refused', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await twoTanks(tenant);
      await approvedLeave(tenant, fixture.bruno, nextTuesday(), 'medical');

      const answer = await new SessionsCalendarController().standInOptions(fixture.sessionId);
      const bruno = answer.candidates.find((one) => one.membershipId === fixture.bruno);

      // Listed, not hidden — "where is Bruno?" answered with a reason rather
      // than with silence.
      assert.equal(bruno?.awayReason, 'medical');

      // And refused by the endpoint, because hiding a control is never the
      // control.
      await expectStatus(
        () =>
          new SessionsCalendarController().standIn(fixture.sessionId, {
            membershipId: fixture.bruno,
          }),
        409,
      );
    });
  });
});

test('a stand-in is set and cleared, and the turma is never touched', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fixture = await twoTanks(tenant);

      // Bruno's own lesson goes, so he is free to cover Ana's.
      await tenant.sql('DELETE FROM class_session WHERE id = $1', [fixture.otherSessionId]);

      await new SessionsCalendarController().standIn(fixture.sessionId, {
        membershipId: fixture.bruno,
      });

      const set = await new SessionsCalendarController().standInOptions(fixture.sessionId);
      assert.equal(set.currentId, fixture.bruno);

      // The turma's own instructor is untouched: next week is Ana's again
      // without anybody undoing anything.
      const [group] = await tenant.sql<{ who: string }>(
        `SELECT cg.instructor_membership_id AS who
           FROM class_group cg
           JOIN class_session cs ON cs.class_group_id = cg.id
          WHERE cs.id = $1`,
        [fixture.sessionId],
      );
      assert.equal(group!.who, fixture.ana);

      // Clearing puts her back in the box.
      await new SessionsCalendarController().standIn(fixture.sessionId, { membershipId: null });
      const cleared = await new SessionsCalendarController().standInOptions(fixture.sessionId);
      assert.equal(cleared.currentId, fixture.ana);
    });
  });
});

test('a lesson that is not there is a 404, not a dropdown that never loads', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () =>
          new SessionsCalendarController().standInOptions('00000000-0000-0000-0000-000000000000'),
        404,
      );
    });
  });
});
