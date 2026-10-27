import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AppController } from '../app/app.controller.js';
import { AttendanceController } from '../classes/attendance.controller.js';
import { ArchiveController } from '../archive/archive.controller.js';
import { FeedbackController } from './feedback.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A student's feedback after a lesson — POOLSE-116, QA 1–10, against the
 * database.
 *
 * One turma, two regular instructors' worth of lessons, a stand-in, a mother
 * of a nine-year-old who also has her own login, and a fourteen-year-old who
 * answers for himself. The lessons are chosen for what they prove: one taught
 * yesterday, one the stand-in covered, one the child missed, one nobody
 * marked, one still running, and one ten days ago (outside the window).
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login — to plant one answer the trigger would refuse, as time passing would. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

test('POOLSE-116 — a family answers for a lesson its child attended, and staff read it by who taught it', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const teacher = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const standIn = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
    const aliceLogin = await addMember(tenant, 'Alice', 'Silva', ['student']);
    const tiagoLogin = await addMember(tenant, 'Tiago', 'Costa', ['student']);

    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id, teacher],
    );
    const [alice] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Alice', 'Silva', club_today() - interval '9 years', $2) RETURNING id`,
      [org, aliceLogin],
    );
    const [tiago] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Tiago', 'Costa', club_today() - interval '14 years', $2) RETURNING id`,
      [org, tiagoLogin],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [org, alice!.id, mother],
    );
    for (const child of [alice!.id, tiago!.id]) {
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
         VALUES ($1, $2, $3, 'active', club_today() - 30)`,
        [org, group!.id, child],
      );
    }

    /** A lesson `days` from the club's today at `hour`, Lisbon. */
    async function lesson(days: number, hour: string): Promise<string> {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
         SELECT $1, $2, $3, $4, d, (d + $5::time) AT TIME ZONE 'Europe/Lisbon', 45
           FROM (SELECT club_today() + $6::int AS d) day
         RETURNING id`,
        [org, group!.id, pool!.id, teacher, hour, days],
      );
      return row!.id;
    }
    async function mark(session: string, student: string, status: string): Promise<void> {
      await tenant.sql(
        `INSERT INTO attendance (organization_id, class_session_id, student_id, status, recorded_by_membership_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [org, session, student, status, teacher],
      );
    }

    const yesterday = await lesson(-1, '18:00');
    const covered = await lesson(-2, '18:00');
    await tenant.sql(`UPDATE class_session SET substitute_instructor_membership_id = $2 WHERE id = $1`, [covered, standIn]);
    const missed = await lesson(-3, '18:00');
    const unmarked = await lesson(-4, '18:00');
    const [running] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
       VALUES ($1, $2, $3, $4, club_today(), now() - interval '10 minutes', 45) RETURNING id`,
      [org, group!.id, pool!.id, teacher],
    );
    const old = await lesson(-10, '18:00');

    await mark(yesterday, alice!.id, 'present');
    await mark(yesterday, tiago!.id, 'present');
    await mark(covered, alice!.id, 'present');
    await mark(missed, alice!.id, 'absent');
    await mark(running!.id, alice!.id, 'present');
    await mark(old, alice!.id, 'present');

    // Ten days ago somebody answered; the window has since closed on it.
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `INSERT INTO lesson_feedback (organization_id, class_session_id, student_id, mood, comment, author_membership_id)
         VALUES ($1, $2, $3, 3, 'Normal.', $4)`,
        [org, old, alice!.id, mother],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const app = new AppController();

    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      // QA 1: the lesson she opens from Últimas aulas takes the form.
      const page = await app.lesson(yesterday);
      assert.equal(page.feedback[0]?.state, 'open');
      assert.equal(page.feedback[0]?.mayAnswer, true);
      const saved = await app.feedback(yesterday, { studentId: alice!.id, mood: 4, comment: '  Gostou muito. ' });
      assert.deepEqual([saved.mood, saved.comment, saved.authoredBy], [4, 'Gostou muito.', 'guardian']);
      await app.feedback(covered, { studentId: alice!.id, mood: 5 });

      const agenda = await app.agenda();
      const recent = new Map(agenda.recent.map((one) => [one.sessionId, one]));
      assert.equal(recent.get(yesterday)?.mood, 4, 'the agenda shows the face');
      assert.ok(!recent.has(missed), 'a lesson she missed is not among the last lessons');
      assert.ok(!recent.has(old), 'nor one outside the window');

      // QA 3, 4, 5: no form, in words, and the write refused with its code.
      assert.equal((await app.lesson(missed)).feedback[0]?.state, 'absent');
      await expectStatus(() => app.feedback(missed, { studentId: alice!.id, mood: 3 }), 409);
      assert.equal((await app.lesson(unmarked)).feedback[0]?.state, 'notMarked');
      await expectStatus(() => app.feedback(unmarked, { studentId: alice!.id, mood: 3 }), 409);
      assert.equal((await app.lesson(running!.id)).feedback[0]?.state, 'notEnded');
      await expectStatus(() => app.feedback(running!.id, { studentId: alice!.id, mood: 3 }), 409);

      // QA 6: past the window the page is a 404 again (rule 9), and a write
      // that arrives late is refused carrying the date it closed.
      await expectStatus(() => app.lesson(old), 404);
      try {
        await app.feedback(old, { studentId: alice!.id, mood: 1 });
        assert.fail('a closed window was written');
      } catch (error) {
        const body = (error as { getResponse?: () => unknown }).getResponse?.() as Record<string, unknown>;
        assert.equal(body['code'], 'feedback_window_closed');
        assert.match(String(body['closesOn']), /^\d{4}-\d{2}-\d{2}$/);
      }

      // QA 10: 501 characters is a field error, nothing saved.
      await expectStatus(() => app.feedback(yesterday, { studentId: alice!.id, mood: 2, comment: 'a'.repeat(501) }), 400);
      assert.equal((await app.lesson(yesterday)).feedback[0]?.feedback?.mood, 4);
      // A child that is not hers: the same 404 as a stranger's lesson.
      await expectStatus(() => app.feedback(yesterday, { studentId: tiago!.id, mood: 2 }), 404);
    });

    // Rule 2: nine is too young to answer alone; fourteen is not.
    await actingAs(tenant, { membershipId: aliceLogin, roles: ['student'] }, async () => {
      await expectStatus(() => app.feedback(yesterday, { studentId: alice!.id, mood: 1 }), 403);
    });
    await actingAs(tenant, { membershipId: tiagoLogin, roles: ['student'] }, async () => {
      const own = await app.feedback(yesterday, { studentId: tiago!.id, mood: 3 });
      assert.equal(own.authoredBy, 'student', 'QA 2: pelo aluno');
    });

    // QA 1, 7: the register shows it to whoever taught that night, and only them.
    const attendance = new AttendanceController();
    await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
      const register = await attendance.register(yesterday);
      assert.deepEqual(register.feedback.map((one) => [one.studentName, one.authoredBy]).sort(), [
        ['Alice Silva', 'guardian'],
        ['Tiago Costa', 'student'],
      ]);
      assert.equal(register.feedback.find((one) => one.authoredBy === 'guardian')?.authorName, 'Marta Silva');
      assert.deepEqual((await attendance.register(covered)).feedback, [], 'the regular instructor did not teach it');
      const list = await new FeedbackController().forStudent(alice!.id);
      assert.deepEqual(list.items.map((one) => one.sessionId), [yesterday, old], 'only the lessons she taught');
    });
    await actingAs(tenant, { membershipId: standIn, roles: ['instructor'] }, async () => {
      assert.equal((await attendance.register(covered)).feedback.length, 1, 'the stand-in reads the night they covered');
    });

    // QA 8: the office archives it; the family's box reopens; the bin brings it back.
    let entryId = '';
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const all = await new FeedbackController().forStudent(alice!.id);
      assert.equal(all.items.length, 3, 'an admin reads every lesson');
      const target = all.items.find((one) => one.sessionId === yesterday)!;
      entryId = (await new FeedbackController().archive(target.id)).archiveEntryId;
      assert.equal((await attendance.register(yesterday)).feedback.length, 1, 'gone from the strip');
    });
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      const reopened = await app.lesson(yesterday);
      assert.equal(reopened.feedback[0]?.state, 'open');
      assert.equal(reopened.feedback[0]?.feedback, null, 'the box reopens as if nothing had been written');
    });
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await new ArchiveController().restore(entryId);
      assert.equal((await attendance.register(yesterday)).feedback.length, 2, 'restored from Arquivados');
    });

    // Sweep 27-10: the window counts from the day it was taught. A lesson whose
    // pattern day was ten days ago, moved to yesterday for that week only, is
    // inside it, and it is on Últimas aulas.
    const [moved] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes, moved_at)
       SELECT $1, $2, $3, $4, club_today() - 10, ((club_today() - 1) + TIME '19:00') AT TIME ZONE 'Europe/Lisbon', 45, now()
       RETURNING id`,
      [org, group!.id, pool!.id, teacher],
    );
    await mark(moved!.id, alice!.id, 'present');
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      assert.equal((await app.lesson(moved!.id)).feedback[0]?.state, 'open', 'moved: open from the day it happened');
      assert.equal((await app.feedback(moved!.id, { studentId: alice!.id, mood: 4 })).mood, 4);
      assert.ok((await app.agenda()).recent.some((one) => one.sessionId === moved!.id));
    });

    // QA 9: another club reads none of it.
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, async () => {
        await expectStatus(() => new FeedbackController().forStudent(alice!.id), 404);
        await expectStatus(() => new FeedbackController().archive(entryId), 404);
      });
    });
  });
});
