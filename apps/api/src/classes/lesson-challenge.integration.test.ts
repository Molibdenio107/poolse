import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../app/app.controller.js';
import { SessionsCalendarController } from './sessions.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-195 — the instructor sets a Desafio, the student answers it in the
 * feedback, and a classmate sees the answer under POOLSE-194's rules.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

const lessons = new SessionsCalendarController();

async function seed(tenant: ScratchTenant) {
  const org = tenant.organizationId;
  const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
  const other = await addMember(tenant, 'Rui', 'Lima', ['instructor']);
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const [child] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Alice', 'Silva', club_today() - interval '10 years') RETURNING id`,
    [org],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child!.id, guardian],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
     VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
    [org, tenant.seasonId, tenant.facilityId, coach],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 30)`,
    [org, group!.id, child!.id],
  );
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );
  // Yesterday's lesson, ended and marked present, so its feedback is open.
  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
     VALUES ($1, $2, $3, $4, club_today() - 1, now() - interval '1 day', 45) RETURNING id`,
    [org, group!.id, pool!.id, coach],
  );
  await tenant.sql(
    `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
     VALUES ($1, $2, $3, 'present', $4)`,
    [org, session!.id, child!.id, coach],
  );
  return { coach, other, guardian, child: child!.id, session: session!.id };
}

const asCoach = <T>(tenant: ScratchTenant, coach: string, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, fn);

test('QA 1–3: the turma’s instructor sets it, it is short, and a family reads it with no plan', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    await asCoach(tenant, f.coach, async () => {
      await expectStatus(() => lessons.saveChallenge(f.session, { body: 'x'.repeat(201) }), 400);
      await lessons.saveChallenge(f.session, { body: '4 piscinas sem parar' });
    });
    await actingAs(tenant, { membershipId: f.guardian, roles: ['guardian'] }, async () => {
      const plan = await lessons.plan(f.session);
      assert.equal(plan.challenge, '4 piscinas sem parar');
      assert.equal(plan.body, '');
    });
  });
});

test('QA 4: another instructor, a family and another club are refused', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    await asCoach(tenant, f.other, () => expectStatus(() => lessons.saveChallenge(f.session, { body: 'a' }), 403));
    await actingAs(tenant, { membershipId: f.guardian, roles: ['guardian'] }, () =>
      expectStatus(() => lessons.saveChallenge(f.session, { body: 'a' }), 403),
    );
    await withScratchTenant(async (club) => {
      await actingAs(club, { roles: ['admin'], membershipId: await addMember(club, 'Ana', 'Dono', ['admin']) }, () =>
        expectStatus(() => lessons.saveChallenge(f.session, { body: 'a' }), 404),
      );
    });
  });
});

test('QA 5–6, 10: the answer sits in the feedback, is optional, and outlives the Desafio', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    const app = new AppController();
    await asCoach(tenant, f.coach, () => lessons.saveChallenge(f.session, { body: '4 piscinas' }));

    await actingAs(tenant, { membershipId: f.guardian, roles: ['guardian'] }, async () => {
      const lesson = await app.lesson(f.session);
      assert.equal(lesson.feedback[0]!.challenge, '4 piscinas');
      const saved = await app.feedback(f.session, { studentId: f.child, mood: 4 });
      assert.equal(saved.challengeDone, null, 'optional');
      const answered = await app.feedback(f.session, { studentId: f.child, mood: 4, challengeDone: true });
      assert.equal(answered.challengeDone, true);
      assert.equal(answered.challengeText, '4 piscinas');
    });

    await asCoach(tenant, f.coach, () => lessons.saveChallenge(f.session, { body: '' }));
    const [row] = await tenant.sql<{ challenge_text: string }>(
      `SELECT challenge_text FROM lesson_feedback WHERE class_session_id = $1`,
      [f.session],
    );
    assert.equal(row!.challenge_text, '4 piscinas', 'the answer keeps its words');
  });
});

test('with no Desafio on the lesson, an answer is not stored', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    await actingAs(tenant, { membershipId: f.guardian, roles: ['guardian'] }, async () => {
      const saved = await new AppController().feedback(f.session, { studentId: f.child, mood: 3, challengeDone: true });
      assert.equal(saved.challengeDone, null);
    });
  });
});

test('QA 8: a minor’s result reaches another family only as a count', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    await asCoach(tenant, f.coach, () => lessons.saveChallenge(f.session, { body: '4 piscinas' }));
    await actingAs(tenant, { membershipId: f.guardian, roles: ['guardian'] }, () =>
      new AppController().feedback(f.session, { studentId: f.child, mood: 4, challengeDone: true }),
    );
    const [groupRow] = await tenant.sql<{ class_group_id: string }>(
      `SELECT class_group_id FROM class_session WHERE id = $1`,
      [f.session],
    );
    const [peer] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, 'Bruna', 'Costa', club_today() - interval '11 years') RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 30)`,
      [tenant.organizationId, groupRow!.class_group_id, peer!.id],
    );
    const parent = await addMember(tenant, 'Rita', 'Costa', ['guardian']);
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [tenant.organizationId, peer!.id, parent],
    );
    const seen = await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, () =>
      new AppController().classmates(f.session),
    );
    const hidden = seen.people.find((one) => one.name === null)!;
    assert.equal(hidden.challengeDone, true);
    assert.equal(JSON.stringify(seen).includes('Alice'), false);
  });
});
