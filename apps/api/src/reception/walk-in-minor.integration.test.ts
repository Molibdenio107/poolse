import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { ReceptionController } from './passes.controller.js';
import { AttentionController } from '../attention/attention.controller.js';
import { StudentsController } from '../students/students.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * A minor is never registered without an encarregado (Rui, 11-11-2026).
 *
 * **At the desk.** Nova pessoa takes a birth date; under the club's maioridade
 * it asks the student form's rule — a name, a relationship, a NIF or an email —
 * and the child becomes a student linked to the person the desk sells to.
 *
 * **On the register.** A minor who got in without one (an import, a birth date
 * added later) is flagged on the list and counted in *Por rever*, until an
 * encarregado is linked.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A date of birth `years` years ago, give or take a month, so the age is not on a birthday. */
function bornYearsAgo(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}

function fieldsOf(error: unknown): unknown {
  assert.ok(error instanceof HttpException, `expected an HTTP refusal, got ${String(error)}`);
  return (error.getResponse() as { fields?: unknown }).fields;
}

test('the desk refuses a child with no encarregado, and says which field', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      const child = { firstName: 'Rita', lastName: 'Sousa', birthDate: bornYearsAgo(9) };

      await assert.rejects(reception.walkIn(child), (error) => {
        assert.deepEqual(fieldsOf(error), { guardianName: 'students.guardianNameRequired' });
        return true;
      });
      // A name alone is not somebody who can be found again: a NIF or an email.
      await assert.rejects(
        reception.walkIn({ ...child, guardianName: 'Marta Sousa', guardianRelationship: 'Mãe', guardianPhone: '912345678' }),
        (error) => {
          assert.deepEqual(fieldsOf(error), { guardianTaxNumber: 'students.guardianKeyRequired' });
          return true;
        },
      );

      // Nothing was left behind by the refusals.
      const people = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM membership WHERE organization_id = $1 AND first_name = 'Rita'`,
        [tenant.organizationId],
      );
      assert.equal(people[0]!.n, 0);
    });
  });
});

test('a child with an encarregado becomes a student linked to the person the desk sells to', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      const { membershipId } = await reception.walkIn({
        firstName: 'Rita',
        lastName: 'Sousa',
        birthDate: bornYearsAgo(9),
        guardianName: 'Marta Sousa',
        guardianRelationship: 'Mãe',
        guardianEmail: 'marta.sousa@example.test',
      });

      const [student] = await tenant.sql<{ id: string; birth_date: string }>(
        `SELECT id, birth_date::text AS birth_date FROM student WHERE membership_id = $1 AND archived_at IS NULL`,
        [membershipId],
      );
      assert.ok(student, 'the child is a student');
      const links = await tenant.sql<{ name: string; relationship: string }>(
        `SELECT m.first_name || ' ' || m.last_name AS name, g.relationship
           FROM guardian_link g JOIN membership m ON m.id = g.guardian_membership_id
          WHERE g.student_id = $1 AND g.archived_at IS NULL`,
        [student.id],
      );
      assert.deepEqual(links, [{ name: 'Marta Sousa', relationship: 'Mãe' }]);
    });
  });
});

test('an adult at the desk stays a person, with the date kept; no date asks nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reception = new ReceptionController();
      const adult = await reception.walkIn({ firstName: 'Paulo', lastName: 'Lima', birthDate: bornYearsAgo(40) });
      const unknown = await reception.walkIn({ firstName: 'Vera', lastName: 'Lima' });

      const rows = await tenant.sql<{ id: string; birth_date: string | null; students: number }>(
        `SELECT m.id, m.birth_date::text AS birth_date,
                (SELECT count(*)::int FROM student s WHERE s.membership_id = m.id) AS students
           FROM membership m WHERE m.id = ANY($1::uuid[]) ORDER BY m.first_name`,
        [[adult.membershipId, unknown.membershipId]],
      );
      assert.deepEqual(
        rows.map((row) => [row.id, row.birth_date, row.students]),
        [
          [adult.membershipId, bornYearsAgo(40), 0],
          [unknown.membershipId, null, 0],
        ],
      );
    });
  });
});

test('a minor who got in with no encarregado is flagged on the register and counted in Por rever, until one is linked', async () => {
  await withScratchTenant(async (tenant) => {
    // The importer's way in: a row the save rule never saw.
    const [orphan] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, 'Tomás', 'Nunes', $2::date) RETURNING id`,
      [tenant.organizationId, bornYearsAgo(10)],
    );
    const [adult] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, 'Joana', 'Nunes', $2::date) RETURNING id`,
      [tenant.organizationId, bornYearsAgo(30)],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const list = await new StudentsController().list();
      const flag = (id: string): boolean | undefined =>
        list.students.items.find((student) => student.id === id)?.minorWithoutGuardian;
      assert.equal(flag(orphan!.id), true);
      assert.equal(flag(adult!.id), false);

      const seen = await new AttentionController().read();
      assert.equal(seen.students[orphan!.id], 1);
      assert.equal(seen.students[adult!.id], undefined);
    });

    // An encarregado linked: the flag and the circle go.
    const [parent] = await tenant.sql<{ id: string }>(
      `INSERT INTO membership (organization_id, status, first_name, last_name, email)
       VALUES ($1, 'active', 'Carla', 'Nunes', 'carla.nunes@example.test') RETURNING id`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [tenant.organizationId, orphan!.id, parent!.id],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const list = await new StudentsController().list();
      assert.equal(list.students.items.find((student) => student.id === orphan!.id)?.minorWithoutGuardian, false);
      assert.equal((await new AttentionController().read()).students[orphan!.id], undefined);
    });
  });
});
