import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityController } from './activity.controller.js';
import { AttendanceController } from '../classes/attendance.controller.js';
import { ClassesController } from '../classes/classes.controller.js';
import { updateStudent, type StudentInput } from '../students/students.repository.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * *Atividade* and *Reverter* — POOLSE-80, QA 1–7.
 *
 * **The ticket's first step was an audit, and the audit failed.** None of the
 * three entities recorded what a field was before an edit, so these tests
 * start where the slice did: an edit has to write `{ before, after }`, and a
 * person's contact details have to stay out of it (Rui, 16-10-2026).
 *
 * **QA 5 lands on the reposição credit, not on an invoice.** A register mark
 * never reaches an invoice — the monthly run bills fee lines, not attendance —
 * but a *falta justificada* mints a make-up credit, and the register already
 * refuses to clear one. A revert meets that refusal in the register's words.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const activity = new ActivityController();

async function level(tenant: ScratchTenant, name: string, order: number): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, name, order],
  );
  return row!.id;
}

async function student(tenant: ScratchTenant, levelId: string | null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, level_id, contact_phone)
     VALUES ($1, 'Rita', 'Sousa', $2, '912345678') RETURNING id`,
    [tenant.organizationId, levelId],
  );
  return row!.id;
}

function form(levelId: string | null, phone = '912345678'): StudentInput {
  return {
    firstName: 'Rita',
    lastName: 'Sousa',
    birthDate: null,
    levelId,
    contactEmail: null,
    contactPhone: phone,
    taxNumber: null,
    notes: null,
    gender: null,
    guardians: [],
  };
}

async function latest(tenant: ScratchTenant, action: string) {
  const [row] = await tenant.sql<{ id: string; data: Record<string, unknown> }>(
    `SELECT id, data FROM audit_log
      WHERE organization_id = $1 AND action = $2
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [tenant.organizationId, action],
  );
  return row!;
}

async function levelOf(tenant: ScratchTenant, id: string): Promise<string | null> {
  const [row] = await tenant.sql<{ level_id: string | null }>(
    'SELECT level_id FROM student WHERE id = $1',
    [id],
  );
  return row!.level_id;
}

/** The status and the body Nest would send, from a thrown HttpException. */
async function refusal(fn: () => Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await fn();
  } catch (error) {
    return {
      status: (error as { status?: number }).status ?? 0,
      body: ((error as { response?: Record<string, unknown> }).response ?? {}) as Record<string, unknown>,
    };
  }
  throw new Error('expected a refusal');
}

test('QA 1 — an edit records the level before and after, and the Owner puts it back', async () => {
  await withScratchTenant(async (tenant) => {
    const golfinhos = await level(tenant, 'Golfinhos', 1);
    const tubaroes = await level(tenant, 'Tubarões', 2);
    const id = await student(tenant, golfinhos);
    const admin = await addMember(tenant, 'Ana', 'Admin', ['admin']);

    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, () =>
      updateStudent(tenant.organizationId, id, form(tubaroes, '934000111')),
    );

    const edit = await latest(tenant, 'student.updated');
    assert.deepEqual(edit.data['before'], { levelId: golfinhos });
    assert.deepEqual(edit.data['after'], { levelId: tubaroes });
    assert.deepEqual(edit.data['withheld'], ['contactPhone'], 'the phone is named');
    const json = JSON.stringify(edit.data);
    assert.ok(!json.includes('934000111') && !json.includes('912345678'), 'and never valued');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await activity.revert(edit.id, {}), { reverted: true });
      assert.equal(await levelOf(tenant, id), golfinhos);

      const page = await activity.student(id);
      assert.equal(page.items.length, 2, 'the edit and its revert, both kept');
      const [revert, original] = page.items;
      assert.equal(revert!.revertOf, edit.id);
      assert.equal(original!.id, edit.id);
      assert.equal(original!.fields[0]!.before.label, 'Golfinhos', 'a name, never a uuid');
      assert.equal(original!.fields[0]!.after.label, 'Tubarões');
      assert.deepEqual(original!.withheld, ['contactPhone']);
      assert.equal(original!.actor?.membershipId, admin);
    });
  });
});

test('QA 2 — a field changed again since is a 409 with three values, resolved by a choice', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await level(tenant, 'A', 1);
    const b = await level(tenant, 'B', 2);
    const c = await level(tenant, 'C', 3);
    const id = await student(tenant, a);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await updateStudent(tenant.organizationId, id, form(b));
      const first = await latest(tenant, 'student.updated');
      await updateStudent(tenant.organizationId, id, form(c));

      const blind = await refusal(() => activity.revert(first.id, {}));
      assert.equal(blind.status, 409);
      assert.equal(blind.body['code'], 'revert_conflict');
      const [conflict] = blind.body['conflicts'] as {
        field: string;
        before: { label: string };
        after: { label: string };
        current: { label: string };
      }[];
      assert.equal(conflict!.field, 'levelId');
      assert.deepEqual(
        [conflict!.before.label, conflict!.after.label, conflict!.current.label],
        ['A', 'B', 'C'],
      );
      assert.equal(await levelOf(tenant, id), c, 'a refusal changes nothing');

      // Keeping what is there now writes nothing, so it is refused as such.
      const kept = await refusal(() => activity.revert(first.id, { resolve: { levelId: 'current' } }));
      assert.equal(kept.body['code'], 'revert_nothing');

      await activity.revert(first.id, { resolve: { levelId: 'before' } });
      assert.equal(await levelOf(tenant, id), a);
    });
  });
});

test('QA 3 — a revert is itself revertible', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await level(tenant, 'A', 1);
    const b = await level(tenant, 'B', 2);
    const id = await student(tenant, a);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await updateStudent(tenant.organizationId, id, form(b));
      await activity.revert((await latest(tenant, 'student.updated')).id, {});
      assert.equal(await levelOf(tenant, id), a);

      const revert = await latest(tenant, 'student.updated');
      assert.ok(typeof revert.data['revertOf'] === 'string');
      await activity.revert(revert.id, {});
      assert.equal(await levelOf(tenant, id), b, 'back to the value before the first revert');
    });
  });
});

test('a revert to a level since archived is a 409 naming it', async () => {
  await withScratchTenant(async (tenant) => {
    const a = await level(tenant, 'Antigo', 1);
    const b = await level(tenant, 'Novo', 2);
    const id = await student(tenant, a);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await updateStudent(tenant.organizationId, id, form(b));
      await tenant.sql('UPDATE student_level SET archived_at = now() WHERE id = $1', [a]);

      const seen = await refusal(async () =>
        activity.revert((await latest(tenant, 'student.updated')).id, {}),
      );
      assert.equal(seen.status, 409);
      assert.equal(seen.body['code'], 'revert_target_gone');
      assert.equal(seen.body['label'], 'Antigo');
      assert.equal(await levelOf(tenant, id), b);
    });
  });
});

async function turma(tenant: ScratchTenant, capacity: number) {
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind, max_capacity)
     VALUES ($1, $2, 'Tanque', 'indoor', 10) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  // On lane 1, as the turma form requires since round 5 (8.2).
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, facility_id, season_id, name, pool_id, capacity, lane_id)
     VALUES ($1, $2, $3, 'Cadetes', $4, $5,
             (SELECT id FROM lane WHERE pool_id = $4 AND position = 1))
     RETURNING id`,
    [tenant.organizationId, tenant.facilityId, tenant.seasonId, pool!.id, capacity],
  );
  return { poolId: pool!.id, groupId: group!.id };
}

test('a turma edit records every field before and after, and reverts through its own path', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, groupId } = await turma(tenant, 8);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      await classes.update(groupId, { name: 'Cadetes A', poolId, capacity: 6, lane: 1 });

      const edit = await latest(tenant, 'class_group.updated');
      assert.deepEqual(edit.data['before'], { name: 'Cadetes', capacity: 8 });
      assert.deepEqual(edit.data['after'], { name: 'Cadetes A', capacity: 6 });

      await activity.revert(edit.id, {});
      const back = await classes.one(groupId);
      assert.equal(back.name, 'Cadetes');
      assert.equal(back.capacity, 8);

      const page = await activity.classGroup(groupId);
      assert.equal(page.items[0]!.revertOf, edit.id);
    });
  });
});

test('QA 4 — a capacity revert that overfills the tank meets the tank refusal, with its numbers', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, groupId } = await turma(tenant, 8);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const classes = new ClassesController();
      const slot = { weekday: 1, startTime: '19:15', durationMinutes: 45 };
      await classes.schedule(groupId, slot);
      await classes.update(groupId, { name: 'Cadetes', poolId, capacity: 5, lane: 1 });
      const shrink = await latest(tenant, 'class_group.updated');

      // A second turma takes the room the first one gave up: 5 + 5 in a tank of 10.
      const { id: other } = await classes.create({ name: 'Infantis', poolId, lane: 1, capacity: 5 });
      await classes.schedule(other, slot);

      const full = await refusal(() => activity.revert(shrink.id, {}));
      assert.equal(full.status, 409);
      assert.equal(full.body['code'], 'pool_full');
      const numbers = full.body['poolCapacity'] as Record<string, unknown>;
      assert.equal(numbers['max'], 10);
      assert.equal((await classes.one(groupId)).capacity, 5, 'nothing was written');
    });
  });
});

async function session(tenant: ScratchTenant, groupId: string, poolId: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session
       (organization_id, class_group_id, pool_id, starts_at, duration_minutes, occurs_on)
     VALUES ($1, $2, $3, now() - interval '1 day', 45, (now() - interval '1 day')::date)
     RETURNING id`,
    [tenant.organizationId, groupId, poolId],
  );
  return row!.id;
}

test('a register mark records one entry per child whose mark moved, and reverts', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, groupId } = await turma(tenant, 8);
    const sessionId = await session(tenant, groupId, poolId);
    const rita = await student(tenant, null);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const register = new AttendanceController();
      await register.record(sessionId, { marks: [{ studentId: rita, status: 'present', note: null }] });
      await register.record(sessionId, {
        marks: [{ studentId: rita, status: 'absent', note: 'doente' }],
      });

      const mark = await latest(tenant, 'attendance.changed');
      assert.deepEqual(mark.data['before'], { status: 'present' });
      assert.deepEqual(mark.data['after'], { status: 'absent' });
      assert.deepEqual(mark.data['withheld'], ['note']);
      assert.ok(!JSON.stringify(mark.data).includes('doente'), 'the note is never copied');

      // Saving the same register again changes nothing and records no change.
      const [{ n: before }] = (await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'attendance.changed' AND organization_id = $1`,
        [tenant.organizationId],
      )) as [{ n: number }];
      await register.record(sessionId, {
        marks: [{ studentId: rita, status: 'absent', note: 'doente' }],
      });
      const [{ n: after }] = (await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'attendance.changed' AND organization_id = $1`,
        [tenant.organizationId],
      )) as [{ n: number }];
      assert.equal(after, before);

      await activity.revert(mark.id, {});
      const [row] = await tenant.sql<{ status: string; note: string | null }>(
        'SELECT status::text AS status, note FROM attendance WHERE class_session_id = $1',
        [sessionId],
      );
      assert.equal(row!.status, 'present');
      assert.equal(row!.note, 'doente', 'a revert puts back the status and leaves the words');

      const forStudent = await activity.student(rita);
      assert.equal(forStudent.items[0]!.session?.id, sessionId);
      const forTurma = await activity.classGroup(groupId);
      assert.equal(forTurma.items[0]!.student?.id, rita);

      // No cancelled-class case: a class with marks cannot be cancelled at all
      // (`refuse_cancelling_marked_session`), so no mark sits on one to revert.
    });
  });
});

test('QA 5 — a justified absence that earned a make-up credit cannot be reverted away', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, groupId } = await turma(tenant, 8);
    const sessionId = await session(tenant, groupId, poolId);
    const rita = await student(tenant, null);
    await tenant.sql('UPDATE class_group SET reposicao_enabled = true WHERE id = $1', [groupId]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new AttendanceController().record(sessionId, {
        marks: [{ studentId: rita, status: 'excused', note: null }],
      });
      const [credit] = await tenant.sql<{ n: number }>(
        'SELECT count(*)::int AS n FROM reposicao_credit WHERE student_id = $1',
        [rita],
      );
      assert.equal(credit!.n, 1, 'the excused mark minted a credit');

      const refused = await refusal(async () =>
        activity.revert((await latest(tenant, 'attendance.changed')).id, {}),
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.body['code'], 'register_credited');
    });
  });
});

test('QA 6 — an instructor has no activity and no revert (403)', async () => {
  await withScratchTenant(async (tenant) => {
    const id = await student(tenant, null);
    const instructor = await addMember(tenant, 'Ivo', 'Prof', ['instructor']);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      await expectStatus(() => activity.student(id), 403);
      await expectStatus(() => activity.classGroup(id), 403);
      await expectStatus(() => activity.revert('00000000-0000-0000-0000-000000000000', {}), 403);
    });
  });
});

test('a revert that would leave a turma with no lane is refused, as the form refuses it', async () => {
  await withScratchTenant(async (tenant) => {
    const { poolId, groupId } = await turma(tenant, 8);
    await tenant.sql('UPDATE class_group SET lane_id = NULL WHERE id = $1', [groupId]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new ClassesController().update(groupId, { name: 'Cadetes', poolId, capacity: 8, lane: 1 });
      const refused = await refusal(async () =>
        activity.revert((await latest(tenant, 'class_group.updated')).id, {}),
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.body['code'], 'revert_required');
      assert.equal(refused.body['field'], 'lane');
    });
  });
});

test('QA 7 — an entry with no before is listed without a revert, and the API refuses one', async () => {
  await withScratchTenant(async (tenant) => {
    const id = await student(tenant, null);
    const [old] = await tenant.sql<{ id: string }>(
      `INSERT INTO audit_log (organization_id, actor_membership_id, action, entity_type, entity_id, data)
       VALUES ($1, $2, 'student.updated', 'student', $3, '{"name":"Rita Sousa"}') RETURNING id`,
      [tenant.organizationId, tenant.ownerMembershipId, id],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const page = await activity.student(id);
      assert.equal(page.items[0]!.revertible, false);
      const refused = await refusal(() => activity.revert(old!.id, {}));
      assert.equal(refused.status, 409);
      assert.equal(refused.body['code'], 'revert_not_revertible');
    });
  });
});

test('another club’s change is a 404, and so is another club’s record', async () => {
  await withScratchTenant(async (first) => {
    const a = await level(first, 'A', 1);
    const b = await level(first, 'B', 2);
    const id = await student(first, a);
    await actingAs(first, { roles: ['owner'] }, () =>
      updateStudent(first.organizationId, id, form(b)),
    );
    const theirs = await latest(first, 'student.updated');

    await withScratchTenant(async (second) => {
      await actingAs(second, { roles: ['owner'] }, async () => {
        await expectStatus(() => activity.revert(theirs.id, {}), 404);
        await expectStatus(() => activity.student(id), 404);
      });
    });
    assert.equal(await levelOf(first, id), b);
  });
});
