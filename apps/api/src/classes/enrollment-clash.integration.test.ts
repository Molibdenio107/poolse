import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from './classes.controller.js';
import { GridController } from '../facilities/grid.controller.js';
import { LeadsController } from '../leads/leads.controller.js';
import { AdvancementController } from '../students/students.controller.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';
import type { ScratchTenant } from '../test/harness.js';

/**
 * A student in two turmas at the same hour — POOLSE-144, through the API.
 *
 * The rule itself is proved in `packages/db/test/enrollment-clash.sql`. What is
 * proved here is that every way a club enrols somebody answers the same 409
 * `enrollment_clash`, naming the other turma, its weekday and hour (QA 1, 8 and
 * the advancement queue); that a series move is written and warned on the
 * calendar instead (QA 7); and that the Turmas list is owner/admin's (QA 6).
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function turma(
  tenant: ScratchTenant,
  name: string,
  weekday: number,
  startTime: string,
  levelId: string | null = null,
): Promise<string> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, level_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name, levelId],
  );
  await tenant.sql(
    `INSERT INTO class_schedule
       (organization_id, facility_id, subject_type, class_group_id, weekday, start_time, duration_minutes)
     VALUES ($1, $2, 'turma', $3, $4, $5::time, 45)`,
    [tenant.organizationId, tenant.facilityId, group!.id, weekday, startTime],
  );
  return group!.id;
}

async function student(tenant: ScratchTenant, first: string, levelId: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, level_id) VALUES ($1, $2, 'Teste', $3) RETURNING id`,
    [tenant.organizationId, first, levelId],
  );
  return row!.id;
}

async function enrolDirect(tenant: ScratchTenant, groupId: string, studentId: string): Promise<void> {
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
    [tenant.organizationId, groupId, studentId],
  );
}

/** The 409's body, for asserting what the screen will be told. */
async function refusal(fn: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await fn();
  } catch (error) {
    const status = (error as { status?: number }).status;
    assert.equal(status, 409, `expected 409, got ${status ?? String(error)}`);
    return (error as { getResponse: () => Record<string, unknown> }).getResponse();
  }
  throw new Error('expected a refusal, but the call succeeded');
}

test('the turma form refuses a clash with 409 enrollment_clash naming the other turma (QA 1, 2, 3)', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const a = await turma(tenant, 'Golfinhos A', 1, '18:00');
      const b = await turma(tenant, 'Golfinhos B', 1, '18:30');
      const c = await turma(tenant, 'Terça', 2, '18:00');
      const d = await turma(tenant, 'Logo a seguir', 1, '18:45');
      const ana = await student(tenant, 'Ana');
      const classes = new ClassesController();
      await classes.addStudent(a, { studentId: ana });

      const body = await refusal(() => classes.addStudent(b, { studentId: ana }));
      assert.equal(body['code'], 'enrollment_clash');
      assert.deepEqual(body['fields'], { studentId: 'enrollment.clash' });
      assert.deepEqual(body['enrollmentClash'], {
        classGroupId: a,
        turma: 'Golfinhos A',
        weekday: 1,
        startTime: '18:00',
      });

      assert.deepEqual(await classes.addStudent(c, { studentId: ana }), { status: 'enrolled' });
      assert.deepEqual(await classes.addStudent(d, { studentId: ana }), { status: 'enrolled' });
      // Waiting never clashes.
      assert.deepEqual(await classes.addStudent(b, { studentId: ana, waiting: true }), { status: 'waiting' });
    });
  });
});

test('Colocar refuses the same way, for a request from the app too (QA 8)', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await turma(tenant, 'Manhã', 6, '10:00');
    const b = await turma(tenant, 'Manhã 2', 6, '10:15');
    const rita = await student(tenant, 'Rita');
    await enrolDirect(tenant, a, rita);
    const [lead] = await tenant.sql<{ id: string }>(
      `INSERT INTO lead (organization_id, facility_id, swimmer_first_name, swimmer_last_name,
                         swimmer_birth_date, email, consent_text_version, consented_at, student_id,
                         requested_class_group_id, requested_by_membership_id)
       VALUES ($1, $2, 'Rita', 'Teste', '2017-03-01', 'familia@example.test', 'v1', now(), $3, $4, $5)
       RETURNING id`,
      // A request from the app for a child the club has (POOLSE-121): the
      // family asked for B, which meets while Rita is in A.
      [tenant.organizationId, tenant.facilityId, rita, b, tenant.ownerMembershipId],
    );

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const body = await refusal(() => new LeadsController().convert(lead!.id, { classGroupId: b }));
      assert.equal(body['code'], 'enrollment_clash');
      assert.deepEqual(body['fields'], { classGroupId: 'enrollment.clash' });
      assert.equal((body['enrollmentClash'] as { turma: string }).turma, 'Manhã');
    });
    const [still] = await tenant.sql<{ status: string }>('SELECT status::text FROM lead WHERE id = $1', [lead!.id]);
    assert.notEqual(still!.status, 'converted', 'nothing was written');
  });
});

test('the advancement queue refuses a turma that clashes, and the old enrolment stays', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [low] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Baixo', 1) RETURNING id`,
      [org],
    );
    const [high] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Alto', 2) RETURNING id`,
      [org],
    );
    const current = await turma(tenant, 'Baixo Seg', 1, '17:00', low!.id);
    const other = await turma(tenant, 'Competição Qua', 3, '18:00');
    const target = await turma(tenant, 'Alto Qua', 3, '18:00', high!.id);
    const bruno = await student(tenant, 'Bruno', low!.id);
    await enrolDirect(tenant, current, bruno);
    await enrolDirect(tenant, other, bruno);
    const [proposal] = await tenant.sql<{ id: string }>(
      `INSERT INTO transfer_proposal (organization_id, student_id, from_level_id, to_level_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, bruno, low!.id, high!.id],
    );

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const body = await refusal(() =>
        new AdvancementController().confirm(proposal!.id, { classGroupId: target, effectiveOn: clubToday() }),
      );
      assert.equal(body['code'], 'enrollment_clash');
      assert.equal((body['enrollmentClash'] as { turma: string }).turma, 'Competição Qua');
    });
    const [kept] = await tenant.sql<{ status: string }>(
      'SELECT status::text FROM enrollment WHERE class_group_id = $1 AND student_id = $2',
      [current, bruno],
    );
    assert.equal(kept!.status, 'active', 'the transfer rolled back whole');
  });
});

test('a series move onto a student’s other hour is written, and the calendar names the student (QA 7); the list is owner/admin (QA 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await turma(tenant, 'Segunda', 1, '18:00');
    const b = await turma(tenant, 'Quarta', 3, '18:00');
    const carla = await student(tenant, 'Carla');
    await enrolDirect(tenant, a, carla);
    await enrolDirect(tenant, b, carla);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual((await new ClassesController().clashes()).students, []);

      // B's pattern moves to Monday 18:00 — the operator's call, never blocked.
      await tenant.sql(
        `UPDATE class_schedule SET weekday = 1 WHERE class_group_id = $1 AND archived_at IS NULL`,
        [b],
      );

      const grid = await new GridController().read(tenant.facilityId);
      for (const id of [a, b]) {
        assert.deepEqual(grid.bookings.find((x) => x.classGroupId === id)!.clashStudents, ['Carla Teste']);
      }

      const listed = (await new ClassesController().clashes()).students;
      assert.equal(listed.length, 1);
      assert.equal(listed[0]!.name, 'Carla Teste');
      assert.deepEqual(
        listed[0]!.slots.map((slot) => [slot.turma, slot.weekday, slot.startTime]),
        [
          ['Quarta', 1, '18:00'],
          ['Segunda', 1, '18:00'],
        ],
      );
    });

    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new ClassesController().clashes(), 403);
    });
  });
});
