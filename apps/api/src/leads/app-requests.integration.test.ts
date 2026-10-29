import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { AppController } from '../app/app.controller.js';
import { LeadsController } from './leads.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Asking to join a class from the app — POOLSE-121, the enrolment half.
 *
 * A guardian asks for a place for their child, and for a new child; both land in
 * the office's queue naming the turma; Inscrever attaches the turma to the child
 * the club already has (no twin) and makes the new one a student with the
 * guardian linked. Refusals: a full turma, a turma asked for twice, a child
 * already in it, and somebody else's child.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function setUp(tenant: ScratchTenant) {
  const org = tenant.organizationId;
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind) VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [org],
  );
  const turma = async (name: string, capacity: number | null): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO class_group (organization_id, season_id, facility_id, name, pool_id, level_id, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [org, tenant.seasonId, tenant.facilityId, name, pool!.id, level!.id, capacity],
    );
    await tenant.sql(
      `INSERT INTO class_schedule (organization_id, class_group_id, weekday, start_time, duration_minutes, facility_id, season_id)
       VALUES ($1, $2, 2, '18:00', 45, $3, $4)`,
      [org, row!.id, tenant.facilityId, tenant.seasonId],
    ).catch(() => undefined);
    return row!.id;
  };
  const open = await turma('Golfinhos', 8);
  const full = await turma('Tubarões', 1);

  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const [child] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, level_id) VALUES ($1, 'Alice', 'Silva', $2) RETURNING id`,
    [org, level!.id],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child!.id, guardian],
  );
  const [other] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date) VALUES ($1, 'Bruno', 'Costa', '2016-03-01') RETURNING id`,
    [org],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today())`,
    [org, full, other!.id],
  );
  return { open, full, guardian, childId: child!.id, otherId: other!.id };
}

function refusedWith(code: string) {
  return (error: unknown): boolean =>
    error instanceof ConflictException && (error.getResponse() as { code: string }).code === code;
}

test('a guardian asks for a place for their child and a new one; the office enrols both', async () => {
  await withScratchTenant(async (tenant) => {
    const s = await setUp(tenant);

    const ids = await actingAs(tenant, { membershipId: s.guardian, roles: ['guardian'] }, async () => {
      const app = new AppController();
      const options = await app.enrolmentOptions();
      assert.deepEqual(options.people.map((one) => one.id), [s.childId]);
      assert.deepEqual(options.classes.map((one) => one.id), [s.open], 'only the turma with a free place');

      const forAlice = await app.requestEnrolment({
        studentId: s.childId,
        classGroupId: s.open,
        note: 'Pode ser às terças?',
        consent: true,
      });
      await assert.rejects(
        () => app.requestEnrolment({ studentId: s.childId, classGroupId: s.open, consent: true }),
        refusedWith('already_requested'),
      );
      await assert.rejects(
        () => app.requestEnrolment({ studentId: s.childId, classGroupId: s.full, consent: true }),
        refusedWith('class_unavailable'),
      );
      await expectStatus(
        () => app.requestEnrolment({ studentId: s.otherId, classGroupId: s.open, consent: true }),
        404,
      );
      await expectStatus(
        () => app.requestEnrolment({ studentId: 'new', classGroupId: s.open, firstName: 'Rui', consent: true }),
        400,
      );
      const forNew = await app.requestEnrolment({
        studentId: 'new',
        classGroupId: s.open,
        firstName: 'Rita',
        lastName: 'Silva',
        birthDate: '2019-05-04',
        relationship: 'Filha',
        consent: true,
      });

      const sent = (await app.enrolmentOptions()).sent;
      assert.equal(sent.length, 2);
      return { alice: forAlice.id, rita: forNew.id };
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const leads = new LeadsController();
      const alice = await leads.one(ids.alice);
      assert.equal(alice.requestedClassGroupId, s.open);
      assert.equal(alice.requestedClassName, 'Golfinhos');
      assert.equal(alice.requestedByName, 'Marta Silva');
      assert.equal(alice.existingStudent, true);
      assert.equal(alice.note, 'Pode ser às terças?');

      const placed = await leads.convert(ids.alice, { classGroupId: s.open });
      assert.equal(placed.studentId, s.childId, 'the child the club has, never a twin');
      const [count] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM student WHERE first_name = 'Alice'`,
      );
      assert.equal(count!.n, 1);

      const rita = await leads.one(ids.rita);
      assert.equal(rita.existingStudent, false);
      assert.equal(rita.guardianName, 'Marta Silva');
      const made = await leads.convert(ids.rita, { classGroupId: s.open });
      const [link] = await tenant.sql<{ guardian_membership_id: string }>(
        `SELECT guardian_membership_id FROM guardian_link WHERE student_id = $1 AND archived_at IS NULL`,
        [made.studentId],
      );
      assert.equal(link?.guardian_membership_id, s.guardian, 'the new child is linked to the guardian who asked');
    });

    // Now in it: asking again is refused as already enrolled.
    await actingAs(tenant, { membershipId: s.guardian, roles: ['guardian'] }, async () => {
      await assert.rejects(
        () => new AppController().requestEnrolment({ studentId: s.childId, classGroupId: s.open, consent: true }),
        refusedWith('already_enrolled'),
      );
    });
  });
});
