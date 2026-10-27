import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../app/app.controller.js';
import { AttendanceController } from '../classes/attendance.controller.js';
import { NoticesController } from './notices.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * *Vou / Não vou* and the instructor home — POOLSE-90 slice 2, QA 7–11, against
 * the database.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('POOLSE-90 slice 2 — a family says who is not coming, the register shows it, the instructor home counts it', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [pool] = await tenant.sql<{ id: string }>(
      `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
      [org, tenant.facilityId],
    );
    const teacher = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const standIn = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
    const elevenLogin = await addMember(tenant, 'Rui', 'Silva', ['student']);
    const twelveLogin = await addMember(tenant, 'Sara', 'Costa', ['student']);
    const adultLogin = await addMember(tenant, 'Paulo', 'Adulto', ['student']);

    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4, $5) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, pool!.id, teacher],
    );
    async function student(first: string, years: number | null, login: string | null): Promise<string> {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
         VALUES ($1, $2, 'Aluno',
                 CASE WHEN $3::int IS NULL THEN NULL ELSE (club_today() - make_interval(years => $3::int))::date END, $4)
         RETURNING id`,
        [org, first, years, login],
      );
      await tenant.sql(
        `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
         VALUES ($1, $2, $3, 'active', club_today() - 30)`,
        [org, group!.id, row!.id],
      );
      return row!.id;
    }
    const alice = await student('Alice', 9, null);
    const rui = await student('Rui', 11, elevenLogin);
    const sara = await student('Sara', 12, twelveLogin);
    const paulo = await student('Paulo', 30, adultLogin);
    for (const child of [alice, rui, sara]) {
      await tenant.sql(
        `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
         VALUES ($1, $2, $3, 'Mãe', true)`,
        [org, child, mother],
      );
    }

    async function lesson(minutesFromNow: number, extra = ''): Promise<string> {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, starts_at, duration_minutes)
         VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5::int), 45) RETURNING id`,
        [org, group!.id, pool!.id, teacher, minutesFromNow],
      );
      if (extra !== '') await tenant.sql(`UPDATE class_session SET ${extra} WHERE id = $1`, [row!.id]);
      return row!.id;
    }
    // Minutes from now, so this week holds them at almost any hour the test runs.
    const coming = await lesson(30);
    const started = await lesson(-10);
    const cancelled = await lesson(40, `status = 'cancelled'`);
    const covered = await lesson(50, `substitute_instructor_membership_id = '${standIn}'`);
    const notices = new NoticesController();

    // QA 7: Não vou, and nothing marked.
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      assert.deepEqual(await notices.answer(coming, alice, { going: false }), { going: false });
      const page = await new AppController().lesson(coming);
      const entry = page.entries.find((one) => one.studentId === alice);
      assert.deepEqual([entry?.going, entry?.mayAnswer, entry?.noticeOpen], [false, true, true]);

      // QA 8 and 10: started, cancelled — refused with their code.
      for (const [session, code] of [
        [started, 'notice_closed'],
        [cancelled, 'notice_not_offered'],
      ] as const) {
        try {
          await notices.answer(session, alice, { going: true });
          assert.fail(`${code} was accepted`);
        } catch (error) {
          const body = (error as { getResponse?: () => unknown }).getResponse?.() as Record<string, unknown>;
          assert.equal(body['code'], code);
        }
      }
      await expectStatus(() => notices.answer(coming, paulo, { going: false }), 404);
      await expectStatus(() => notices.answer(coming, alice, { going: 'no' as never }), 400);
    });
    const [marks] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM attendance WHERE class_session_id = $1`,
      [coming],
    );
    assert.equal(marks!.n, 0, 'a notice never writes attendance');

    // QA 9: eleven no, twelve yes, an adult yes.
    await actingAs(tenant, { membershipId: elevenLogin, roles: ['student'] }, async () => {
      await expectStatus(() => notices.answer(coming, rui, { going: false }), 403);
    });
    await actingAs(tenant, { membershipId: twelveLogin, roles: ['student'] }, async () => {
      assert.deepEqual(await notices.answer(coming, sara, { going: true }), { going: true });
    });
    await actingAs(tenant, { membershipId: adultLogin, roles: ['student'] }, async () => {
      assert.deepEqual(await notices.answer(coming, paulo, { going: false }), { going: false });
    });

    // QA 7: the register shows them; the instructor home counts them.
    await actingAs(tenant, { membershipId: teacher, roles: ['instructor'] }, async () => {
      const register = await new AttendanceController().register(coming);
      const byStudent = new Map(register.notices.map((one) => [one.studentId, one.going]));
      assert.deepEqual([byStudent.get(alice), byStudent.get(sara), byStudent.get(paulo)], [false, true, false]);
      assert.equal(register.notices.find((one) => one.studentId === alice)?.answeredByName, 'Marta Silva');

      const home = await new AppController().teaching();
      const today = home.lessons.find((one) => one.sessionId === coming);
      assert.deepEqual([today?.enrolled, today?.notComing], [4, 2], '4 inscritos · 2 não vêm');
      assert.ok(!home.lessons.some((one) => one.sessionId === covered), 'QA 11: not the night a stand-in covers');
    });
    await actingAs(tenant, { membershipId: standIn, roles: ['instructor'] }, async () => {
      const home = await new AppController().teaching();
      assert.ok(home.lessons.some((one) => one.sessionId === covered), "QA 11: the stand-in's home has it");
    });

    // The last answer wins, and the audit keeps the change.
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      await notices.answer(coming, alice, { going: true });
    });
    const [audit] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE organization_id = $1 AND action = 'session_notice.answered'
          AND data->>'studentId' = $2 AND data->>'before' = 'false' AND data->>'after' = 'true'`,
      [org, alice],
    );
    assert.equal(audit!.n, 1);
  });
});
