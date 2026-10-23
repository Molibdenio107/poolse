import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SeasonsController } from '../classes/seasons.controller.js';
import { ActivityController } from '../activity/activity.controller.js';
import { AdvancementController, LevelsController } from './students.controller.js';
import { AdvancementApplyService } from './advancement-apply.service.js';
import { deliverLevelChangeNotice } from './level-change-delivery.js';
import type { Email } from '../notifications/notifier.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Advancement by age at the season change — POOLSE-112, the half the SQL test
 * cannot reach: the publish hook, the queue's outlook, the club's mode, the
 * nightly apply as *sistema* with its audit and its undo, and the family's email.
 *
 * The fixture is one club with a two-step ladder — Iniciação to 8, then
 * Aperfeiçoamento to 12 — a nine-year-old still in Iniciação whose mother has
 * an address, and a draft season starting next September. Ages are judged on
 * that first day, so the test does not depend on the day it runs.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const NEXT = { name: '2027/2028', startsOn: '2027-09-01', endsOn: '2028-08-31' };

function outbox(): { sent: Email[]; send: (email: Email) => Promise<boolean> } {
  const sent: Email[] = [];
  return { sent, send: async (email) => (sent.push(email), true) };
}

interface Fixture {
  lower: string;
  upper: string;
  childId: string;
}

async function seed(tenant: ScratchTenant): Promise<Fixture> {
  const org = tenant.organizationId;
  const [lower] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order, min_age_months, max_age_months)
     VALUES ($1, 'Iniciação', 1, 72, 96) RETURNING id`,
    [org],
  );
  const [upper] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order, min_age_months, max_age_months)
     VALUES ($1, 'Aperfeiçoamento', 2, 96, 144) RETURNING id`,
    [org],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id)
     VALUES ($1, $2, $3, 'Iniciação A', 8, $4) RETURNING id`,
    [org, tenant.facilityId, tenant.seasonId, lower!.id],
  );
  // Nine on 1 September 2027.
  const [child] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
     VALUES ($1, 'Inês', 'Nove', $2, DATE '2018-05-20') RETURNING id`,
    [org, lower!.id],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [org, group!.id, child!.id],
  );
  const motherId = await addMember(tenant, 'Marta', 'Nove', ['guardian']);
  await tenant.sql(`UPDATE membership SET email = 'marta@familia.pt' WHERE id = $1`, [motherId]);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id)
     VALUES ($1, $2, $3)`,
    [org, child!.id, motherId],
  );
  return { lower: lower!.id, upper: upper!.id, childId: child!.id };
}

async function pending(tenant: ScratchTenant, studentId: string) {
  const [row] = await tenant.sql<{
    id: string;
    reason: string;
    applied_at: string | null;
    to_level_id: string;
  }>(
    `SELECT id, reason::text AS reason, applied_at, to_level_id FROM transfer_proposal
      WHERE student_id = $1 AND status = 'pending'`,
    [studentId],
  );
  return row ?? null;
}

async function levelOf(tenant: ScratchTenant, studentId: string): Promise<string | null> {
  const [row] = await tenant.sql<{ level_id: string | null }>(
    'SELECT level_id FROM student WHERE id = $1',
    [studentId],
  );
  return row?.level_id ?? null;
}

test('QA 1 + 4: the outlook names the change, and publishing proposes by age', async () => {
  await withScratchTenant(async (tenant) => {
    const fixture = await seed(tenant);
    const seasons = new SeasonsController();
    const advancement = new AdvancementController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { season } = await seasons.draft({ ...NEXT });

      // Empty queue, informative outlook: the draft is the next change, and the
      // nine-year-old is the one who will move.
      const before = (await advancement.outlook()).outlook;
      assert.equal(before.mode, 'propose');
      assert.equal(before.nextSeason?.id, season.id);
      assert.equal(before.nextSeason?.startsOn, '2027-09-01');
      assert.equal(before.willMove, 1);
      const lower = before.levels.find((level) => level.levelId === fixture.lower);
      assert.equal(lower?.movableNext, 1);
      assert.equal((await advancement.list()).proposals.total, 0);

      await seasons.publish(season.id);

      const proposal = await pending(tenant, fixture.childId);
      assert.ok(proposal, 'publishing queued the proposal');
      assert.equal(proposal.reason, 'age');
      assert.equal(proposal.to_level_id, fixture.upper);
      assert.equal(proposal.applied_at, null);

      const queued = (await advancement.list()).proposals.items[0];
      assert.equal(queued?.reason, 'age');
      assert.equal(queued?.seasonName, NEXT.name);

      // The level did not move: propose means a person confirms.
      assert.equal(await levelOf(tenant, fixture.childId), fixture.lower);
    });
  });
});

test('QA 2 + 5: automatic mode moves the level on the first day as sistema, tells the family, and is undone through the record', async () => {
  await withScratchTenant(async (tenant) => {
    const fixture = await seed(tenant);
    const seasons = new SeasonsController();
    const levels = new LevelsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await levels.advancementMode({ mode: 'apply' }), { mode: 'apply' });
      // The season is published early, as a club does; nothing moves yet.
      const { season } = await seasons.draft({ ...NEXT });
      await seasons.publish(season.id);
    });

    const pass = new AdvancementApplyService();
    assert.deepEqual(await pass.run(tenant.organizationId), { tenants: 1, applied: 0 });
    assert.equal(await levelOf(tenant, fixture.childId), fixture.lower);

    // The first day arrives.
    await tenant.sql(
      `UPDATE season SET starts_on = club_today() WHERE name = $1 AND organization_id = $2`,
      [NEXT.name, tenant.organizationId],
    );

    const run = await pass.run(tenant.organizationId);
    assert.equal(run.applied, 1);
    assert.equal(await levelOf(tenant, fixture.childId), fixture.upper);

    const proposal = await pending(tenant, fixture.childId);
    assert.ok(proposal?.applied_at, 'the proposal stays in the queue for the turma, marked applied');

    // Audited as the system: no actor on the student's own change.
    const [entry] = await tenant.sql<{ id: string; actor: string | null; data: Record<string, unknown> }>(
      `SELECT id, actor_membership_id AS actor, data FROM audit_log
        WHERE organization_id = $1 AND action = 'student.updated' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenant.organizationId, fixture.childId],
    );
    assert.ok(entry);
    assert.equal(entry.actor, null);
    assert.equal(entry.data['automatic'], true);
    assert.equal(entry.data['reason'], 'age');

    // The family is told, with the reason.
    const [notice] = await tenant.sql<{ id: string; recipients: string[] }>(
      `SELECT id, recipients::text[] AS recipients FROM level_change_notice WHERE student_id = $1`,
      [fixture.childId],
    );
    assert.ok(notice);
    assert.deepEqual(notice.recipients, ['marta@familia.pt']);
    const box = outbox();
    assert.equal(await deliverLevelChangeNotice(tenant.organizationId, notice.id, box.send), true);
    assert.equal(box.sent.length, 1);
    assert.match(box.sent[0]!.subject, /passou de nível/);
    assert.match(box.sent[0]!.text, /idade/);
    // Once: a second call finds it delivered.
    assert.equal(await deliverLevelChangeNotice(tenant.organizationId, notice.id, box.send), false);

    // Undo goes through the record's own revert — POOLSE-80.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await new ActivityController().revert(entry.id, {}), { reverted: true });
    });
    assert.equal(await levelOf(tenant, fixture.childId), fixture.lower);
  });
});

test('Propor queues against the running season; roles hold on every new route', async () => {
  await withScratchTenant(async (tenant) => {
    const fixture = await seed(tenant);
    const advancement = new AdvancementController();
    const levels = new LevelsController();

    // The child is eight today in a level to eight? Make them clearly above it
    // today: a level that stops at six.
    await tenant.sql(`UPDATE student_level SET max_age_months = 72 WHERE id = $1`, [fixture.lower]);
    await tenant.sql(`UPDATE student_level SET min_age_months = 72 WHERE id = $1`, [fixture.upper]);

    const coachId = await addMember(tenant, 'Ana', 'Coach', ['instructor']);
    const guardianId = await addMember(tenant, 'Zeca', 'Outro', ['guardian']);

    await actingAs(tenant, { membershipId: coachId, roles: ['instructor'] }, async () => {
      // A coach reads the outlook and may not open the question or set the mode.
      assert.equal((await advancement.outlook()).outlook.levels.length, 2);
      await expectStatus(() => advancement.proposeByAge({}), 403);
      await expectStatus(() => levels.advancementMode({ mode: 'apply' }), 403);
    });
    await actingAs(tenant, { membershipId: guardianId, roles: ['guardian'] }, async () => {
      await expectStatus(() => advancement.outlook(), 403);
      await expectStatus(() => advancement.proposeByAge({}), 403);
      await expectStatus(() => levels.advancementMode({ mode: 'apply' }), 403);
    });

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const outlook = (await advancement.outlook()).outlook;
      assert.equal(outlook.levels.find((l) => l.levelId === fixture.lower)?.movableNow, 1);

      assert.deepEqual(await advancement.proposeByAge({ levelId: fixture.lower }), { queued: 1 });
      assert.deepEqual(await advancement.proposeByAge({}), { queued: 0 });
      await expectStatus(() => levels.advancementMode({ mode: 'later' }), 400);
    });
  });
});

test('POOLSE-113 QA 1, 2, 4: candidates come ranked with what the picker shows; confirm enrols, a seat gone is a 409, an applied proposal moves only the enrolment', async () => {
  await withScratchTenant(async (tenant) => {
    const fixture = await seed(tenant);
    const org = tenant.organizationId;
    const coach = await addMember(tenant, 'Rui', 'Treinador', ['instructor']);

    // Inês's turma: Monday 17:00, with Rui.
    const [current] = await tenant.sql<{ id: string }>(
      `UPDATE class_group SET instructor_membership_id = $2 WHERE name = 'Iniciação A' AND organization_id = $1 RETURNING id`,
      [org, coach],
    );
    const turma = async (name: string, capacity: number, instructor: string | null, weekday: number, at: string) => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_group (organization_id, facility_id, season_id, name, capacity, level_id, instructor_membership_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [org, tenant.facilityId, tenant.seasonId, name, capacity, fixture.upper, instructor],
      );
      await tenant.sql(
        `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
         VALUES ($1, $2, $3, $4::time, 45)`,
        [org, row!.id, weekday, at],
      );
      return row!.id;
    };
    await tenant.sql(
      `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes)
       VALUES ($1, $2, 1, TIME '17:00', 45)`,
      [org, current!.id],
    );
    const sameSlot = await turma('Aperf. Segunda', 8, null, 1, '17:00');
    const sameCoach = await turma('Aperf. Rui', 8, coach, 3, '18:00');
    const available = await turma('Aperf. Sexta', 2, null, 5, '10:00');

    const [proposal] = await tenant.sql<{ id: string }>(
      `INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, fixture.childId, fixture.lower, fixture.upper],
    );

    const controller = new AdvancementController();
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const card = (await controller.list()).proposals.items.find((one) => one.id === proposal!.id)!;
      // QA 1: three reasons, in rank order, each row carrying what the picker draws.
      assert.deepEqual(
        card.candidates.map((one) => [one.classGroupId, one.rankReason]),
        [
          [sameSlot, 'same_slot'],
          [sameCoach, 'same_instructor'],
          [available, 'available'],
        ],
      );
      const first = card.candidates[0]!;
      assert.deepEqual(first.slots, [{ weekday: 1, startTime: '17:00' }]);
      assert.equal(first.capacity, 8);
      assert.equal(first.active, 0);
      assert.equal(first.freeSeats, 8);
      // Rui has no login, and is still named — never read as "no instructor".
      assert.match(card.candidates[1]!.instructorName ?? '', /^Rui/);

      // QA 2: the last-ranked turma fills between the page load and the click.
      for (const name of ['Um', 'Dois']) {
        const [other] = await tenant.sql<{ id: string }>(
          `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Outro') RETURNING id`,
          [org, name],
        );
        await tenant.sql(
          `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
          [org, available, other!.id],
        );
      }
      await expectStatus(
        () => controller.confirm(proposal!.id, { classGroupId: available, effectiveOn: '2026-10-26' }),
        409,
      );
      assert.ok(await pending(tenant, fixture.childId), 'the proposal stays pending');

      // QA 1: picking the first and confirming enrols into it.
      assert.deepEqual(
        await controller.confirm(proposal!.id, { classGroupId: sameSlot, effectiveOn: '2026-10-26' }),
        { confirmed: true },
      );
    });
    const [enrolled] = await tenant.sql<{ class_group_id: string }>(
      `SELECT class_group_id FROM enrollment WHERE student_id = $1 AND status = 'active'`,
      [fixture.childId],
    );
    assert.equal(enrolled!.class_group_id, sameSlot);
    assert.equal(await levelOf(tenant, fixture.childId), fixture.upper);

    // QA 4: an applied (age) proposal — the level already moved — confirms the turma only.
    const [second] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, level_id, birth_date)
       VALUES ($1, 'Rita', 'Aplicada', $2, DATE '2018-02-01') RETURNING id`,
      [org, fixture.upper],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
      [org, current!.id, second!.id],
    );
    const [applied] = await tenant.sql<{ id: string }>(
      `INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id, reason, applied_at, season_id)
       VALUES ($1, $2, $3, $4, 'age', now(), $5) RETURNING id`,
      [org, second!.id, fixture.lower, fixture.upper, tenant.seasonId],
    );
    const notices = async () =>
      Number(
        (await tenant.sql<{ n: string }>(`SELECT count(*) AS n FROM level_change_notice WHERE student_id = $1`, [second!.id]))[0]!
          .n,
      );
    const before = await notices();
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const card = (await controller.list()).proposals.items.find((one) => one.id === applied!.id)!;
      assert.ok(card.appliedAt !== null);
      assert.equal(card.candidates[0]!.rankReason, 'same_slot');
      await controller.confirm(applied!.id, { classGroupId: sameCoach, effectiveOn: '2026-10-26' });
    });
    const [moved] = await tenant.sql<{ class_group_id: string }>(
      `SELECT class_group_id FROM enrollment WHERE student_id = $1 AND status = 'active'`,
      [second!.id],
    );
    assert.equal(moved!.class_group_id, sameCoach);
    assert.equal(await levelOf(tenant, second!.id), fixture.upper, 'the level was already moved and stays');
    assert.equal(await notices(), before, 'the family was told when the level moved, not again for the turma');
  });
});
