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
