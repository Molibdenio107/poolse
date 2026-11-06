import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AppController } from '../app/app.controller.js';
import { AppAvisosController } from '../messages/avisos.controller.js';
import { StudentMessagesController } from '../messages/student-messages.controller.js';
import { StudentDocumentsController } from './documents.controller.js';
import { MedicalExamScheduleController } from './medical-exam-schedule.controller.js';
import { MedicalExamsController } from './medical-exams.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-192 — the office schedules a medical exam and reminds the student.
 *
 * Run: pnpm api:test   (needs pnpm db:up and storage, as every upload test does)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
after(async () => {
  await owner.end();
  await closeHarness();
});

const tab = new MedicalExamScheduleController();
const reminder = { subject: 'Exame médico', body: 'Tem exame médico marcado.' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

interface Family {
  student: string;
  guardian: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Alice', 'Silva', club_today() - interval '10 years') RETURNING id`,
    [tenant.organizationId],
  );
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [tenant.organizationId, row!.id, guardian],
  );
  await owner.query(`UPDATE membership SET email = 'marta@x.pt', phone = '912345678' WHERE id = $1`, [guardian]);
  return { student: row!.id, guardian };
}

const asOwner = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);
const days = async (tenant: ScratchTenant, offset: number): Promise<string> => {
  const [row] = await tenant.sql<{ day: string }>(`SELECT (club_today() + $1::int)::text AS day`, [offset]);
  return row!.day;
};
const avisosOf = (tenant: ScratchTenant, family: Family) =>
  actingAs(tenant, { membershipId: family.guardian, roles: ['guardian'] }, async () => (await new AppAvisosController().mine()).avisos);

test('QA 1–4: either kind saves, a past date and a second open one are refused', async () => {
  await withScratchTenant(async (tenant) => {
    const { student } = await seed(tenant);
    const dueOn = await days(tenant, 10);
    await asOwner(tenant, async () => {
      await expectStatus(() => tab.create(student, { kind: 'nonsense', dueOn }), 400);
      await tab.create(student, { kind: 'appointment', dueOn, dueTime: '10:30', place: 'Clínica Norte', note: 'Levar BI' });
      const { schedule } = await tab.read(student);
      assert.equal(schedule!.kind, 'appointment');
      assert.equal(schedule!.dueTime, '10:30');
      assert.equal(schedule!.place, 'Clínica Norte');
      assert.equal(schedule!.overdue, false);
      await expectStatus(() => tab.create(student, { kind: 'deadline', dueOn }), 409);
      await tab.cancel(student, schedule!.id);

      await tab.create(student, { kind: 'deadline', dueOn, dueTime: '10:30' });
      assert.equal((await tab.read(student)).schedule!.dueTime, null, 'a deadline has no hour');
    });
    const past = await days(tenant, -1);
    await asOwner(tenant, async () => {
      const { schedule } = await tab.read(student);
      await tab.cancel(student, schedule!.id);
      await expectStatus(() => tab.create(student, { kind: 'deadline', dueOn: past }), 400);
    });
  });
});

test('QA 5–6: the first reminder raises one aviso through the day after; a resend raises none', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const dueOn = await days(tenant, 5);
    const lastDay = await days(tenant, 6);
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'appointment', dueOn }));
    await asOwner(tenant, async () => {
      await tab.remind(family.student, id, { channel: 'email', ...reminder });
      await tab.remind(family.student, id, { channel: 'email', ...reminder });
    });
    const avisos = await avisosOf(tenant, family);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]!.shownUntil, lastDay);
    const rows = await tenant.sql<{ channel: string; health: boolean }>(
      `SELECT channel::text AS channel, health FROM message WHERE student_id = $1`,
      [family.student],
    );
    assert.equal(rows.filter((one) => one.channel === 'email').length, 2);
    assert.ok(rows.every((one) => one.health));
    assert.equal((await asOwner(tenant, () => tab.read(family.student))).schedule!.avisoUntil, lastDay);
  });
});

test('QA 7: the office records the exam, and the schedule and the aviso close', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }));
    await asOwner(tenant, () => tab.remind(family.student, id, { channel: 'email', ...reminder }));
    await asOwner(tenant, () =>
      new MedicalExamsController().record(family.student, { examinedOn: '2026-01-01', result: 'fit' }),
    );
    assert.equal((await asOwner(tenant, () => tab.read(family.student))).schedule, null);
    assert.equal((await avisosOf(tenant, family)).length, 0);
    const [row] = await tenant.sql<{ recorded: boolean }>(
      `SELECT recorded_exam_id IS NOT NULL AS recorded FROM medical_exam_schedule WHERE id = $1`,
      [id],
    );
    assert.equal(row!.recorded, true);
  });
});

test('QA 8: a family’s exam accepted closes it the same way', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name) VALUES ($1, $2, $3, 'Golfinhos') RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 10)`,
      [tenant.organizationId, group!.id, family.student],
    );
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }));
    await asOwner(tenant, () => tab.remind(family.student, id, { channel: 'email', ...reminder }));
    const examinedOn = await days(tenant, -1);
    await actingAs(tenant, { membershipId: family.guardian, roles: ['guardian'] }, () =>
      new AppController().sendDocument('medical_exam', family.student, 'e.pdf', examinedOn, PDF),
    );
    await asOwner(tenant, async () => {
      const documents = new StudentDocumentsController();
      const { submissions } = await documents.submissions(family.student);
      await documents.accept(family.student, submissions[0]!.id, { result: 'fit' });
      assert.equal((await tab.read(family.student)).schedule, null);
    });
    assert.equal((await avisosOf(tenant, family)).length, 0);
  });
});

test('QA 9: the date gone by says Por registar, and a reminder then raises no aviso', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const dueOn = await days(tenant, -5);
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
       VALUES ($1, $2, 'deadline', $3::date) RETURNING id`,
      [tenant.organizationId, family.student, dueOn],
    );
    await asOwner(tenant, async () => {
      assert.equal((await tab.read(family.student)).schedule!.overdue, true);
      await tab.remind(family.student, row!.id, { channel: 'email', ...reminder });
    });
    assert.equal((await avisosOf(tenant, family)).length, 0);
  });
});

test('QA 10: cancelling ends the aviso and opens the way for a new one', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }));
    await asOwner(tenant, () => tab.remind(family.student, id, { channel: 'email', ...reminder }));
    await asOwner(tenant, () => tab.cancel(family.student, id));
    assert.equal((await avisosOf(tenant, family)).length, 0);
    await asOwner(tenant, () => expectStatus(() => tab.cancel(family.student, id), 404));
    await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-02' }));
  });
});

test('QA 11–12: an instructor and a family reach none of it, and an instructor never sees a reminder', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
    const [group] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
       VALUES ($1, $2, $3, 'Golfinhos', $4) RETURNING id`,
      [tenant.organizationId, tenant.seasonId, tenant.facilityId, coach],
    );
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 10)`,
      [tenant.organizationId, group!.id, family.student],
    );
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }));
    await asOwner(tenant, () => tab.remind(family.student, id, { channel: 'email', ...reminder }));

    for (const [role, membershipId] of [['instructor', coach], ['guardian', family.guardian], ['maintenance', undefined]] as const) {
      await actingAs(tenant, { roles: [role], ...(membershipId === undefined ? {} : { membershipId }) }, async () => {
        await expectStatus(() => tab.read(family.student), 403);
        await expectStatus(() => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }), 403);
        await expectStatus(() => tab.remind(family.student, id, { channel: 'email', ...reminder }), 403);
        await expectStatus(() => tab.cancel(family.student, id), 403);
      });
    }
    // Even one written in the coach's name: the health flag leaves it out of their list.
    await owner.query(`UPDATE message SET sent_by_membership_id = $2 WHERE student_id = $1`, [family.student, coach]);
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      assert.equal((await new StudentMessagesController().list(family.student)).messages.length, 0);
    });
    await asOwner(tenant, async () => {
      assert.ok((await new StudentMessagesController().list(family.student)).messages.length >= 2, 'the office sees them');
    });
  });
});

test('QA 13: another club is a 404, and the database refuses the reference', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }));
    await withScratchTenant(async (other) => {
      await asOwner(other, async () => {
        await expectStatus(() => tab.read(family.student), 404);
        await expectStatus(() => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01' }), 404);
        await expectStatus(() => tab.cancel(family.student, id), 404);
        await expectStatus(() => tab.remind(family.student, id, { channel: 'email', ...reminder }), 404);
      });
      await assert.rejects(
        other.sql(
          `INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on)
           VALUES ($1, $2, 'deadline', '2099-01-01')`,
          [other.organizationId, family.student],
        ),
      );
    });
  });
});

test('QA 14: when the health data goes, the schedule and the reminder’s words go, and a plain message stays', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const { id } = await asOwner(tenant, () => tab.create(family.student, { kind: 'deadline', dueOn: '2099-01-01', place: 'Clínica' }));
    await asOwner(tenant, () => tab.remind(family.student, id, { channel: 'email', ...reminder }));
    await asOwner(tenant, () =>
      new StudentMessagesController().send(family.student, { channel: 'email', subject: 'Treino', body: 'Sábado' }),
    );
    await tenant.sql(`UPDATE student SET archived_at = now() - interval '2 years' WHERE id = $1`, [family.student]);
    await tenant.sql(`SELECT * FROM apply_retention()`);

    assert.equal((await tenant.sql('SELECT 1 FROM medical_exam_schedule WHERE id = $1', [id])).length, 0);
    const rows = await tenant.sql<{ subject: string; health: boolean }>(
      `SELECT subject, health FROM message WHERE student_id = $1`,
      [family.student],
    );
    assert.ok(rows.filter((one) => one.health).every((one) => one.subject === 'Mensagem anonimizada'));
    assert.ok(rows.some((one) => one.subject === 'Treino'), 'a plain message waits for the identity');
  });
});
