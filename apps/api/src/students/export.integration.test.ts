import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ExportsController } from './export.controller.js';
import { StudentImportController } from './import.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Slice 1.11 — the export against a real database.
 *
 * Three things need a database rather than a reading. That the file is the
 * *filtered* set and not the whole register, because an export button under a
 * filtered list that quietly returns everything is a button that lies. That an
 * archived student stays archived — history is soft-deleted, and a soft delete
 * that reappears in a spreadsheet is not a delete. And that every export leaves
 * an audit entry, because this is a register of children with their families'
 * telephone numbers leaving the product in a form nothing can take back.
 *
 * The last test is the pair to slice 1.10: import a file, export it, and the
 * same people come back out. That is the round trip the two slices exist to make
 * true, asserted end to end rather than argued for.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const RELATIONSHIP = 'Encarregado de educação';

interface Tenant {
  organizationId: string;
  sql: <T extends object>(text: string, values?: unknown[]) => Promise<T[]>;
}

async function addStudent(
  tenant: Tenant,
  firstName: string,
  lastName: string,
  levelId: string | null = null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, level_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.organizationId, firstName, lastName, levelId],
  );
  return row!.id;
}

test('the export is the whole register, filed by surname', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new ExportsController();

    await addStudent(tenant, 'Tiago', 'Sousa');
    await addStudent(tenant, 'Rita', 'Nunes');
    // An accented surname, which is the case that files wrongly without the
    // Portuguese collation the ORDER BY asks for.
    await addStudent(tenant, 'Ana', 'Álvares');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { students, total, capped } = await controller.students();

      assert.equal(total, 3);
      assert.equal(capped, false);
      assert.deepEqual(
        students.map((student) => student.lastName),
        ['Álvares', 'Nunes', 'Sousa'],
      );
    });
  });
});

test('the export is what is filtered, not what exists', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new ExportsController();

    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );

    await addStudent(tenant, 'Rita', 'Nunes', level!.id);
    await addStudent(tenant, 'Tiago', 'Sousa', null);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const byLevel = await controller.students(undefined, level!.id);
      assert.deepEqual(
        byLevel.students.map((student) => student.firstName),
        ['Rita'],
      );

      const bySearch = await controller.students('sousa');
      assert.deepEqual(
        bySearch.students.map((student) => student.firstName),
        ['Tiago'],
      );

      /*
       * One character is not a search — POOLSE-30, and the same floor the list
       * uses. A file narrowed by a rule the screen does not apply would not
       * match what the operator was looking at when they pressed the button.
       */
      const tooShort = await controller.students('s');
      assert.equal(tooShort.total, 2);
    });
  });
});

test('an archived student is not in the file', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new ExportsController();

    await addStudent(tenant, 'Rita', 'Nunes');
    const gone = await addStudent(tenant, 'Tiago', 'Sousa');
    await tenant.sql('UPDATE student SET archived_at = now() WHERE id = $1', [gone]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { students } = await controller.students();
      assert.deepEqual(
        students.map((student) => student.firstName),
        ['Rita'],
      );
    });
  });
});

test('every export leaves a trail saying who, when and how much', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new ExportsController();
    await addStudent(tenant, 'Rita', 'Nunes');

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await controller.students('nunes');
    });

    const [entry] = await tenant.sql<{
      action: string;
      actor_membership_id: string | null;
      data: { rows: number; search: string | null; capped: boolean };
    }>(
      `SELECT action, actor_membership_id, data
         FROM audit_log
        WHERE action = 'students.exported'`,
    );

    assert.ok(entry !== undefined, 'an export with no audit entry is an export nobody can account for');
    assert.equal(entry.data.rows, 1);
    assert.equal(entry.data.search, 'nunes', 'and it records what the file was narrowed to');
    assert.equal(entry.data.capped, false);
    assert.notEqual(entry.actor_membership_id, null, 'and who asked for it');
  });
});

test('exporting the register takes the same roles as importing it', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new ExportsController();

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);
    const student = await addMember(tenant, 'Ana', 'Aluna', ['student']);
    const guardian = await addMember(tenant, 'Maria', 'Mae', ['guardian']);

    /*
     * One file with every child's name, birth date and a family telephone
     * number. An instructor's own turmas are a narrower question and 1.12 is
     * where it is answered — until then this is owner and admin, exactly as
     * creating a student is.
     */
    for (const [membershipId, role] of [
      [instructor, 'instructor'],
      [student, 'student'],
      [guardian, 'guardian'],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [role] }, async () => {
        await expectStatus(() => controller.students(), 403);
      });
    }

    // And an admin is admitted, which is what proves the three above were
    // refused for their role rather than for anything else.
    const admin = await addMember(tenant, 'Paulo', 'Admin', ['admin']);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      assert.equal((await controller.students()).total, 0);
    });
  });
});

test('what the importer put in, the exporter gives back', async () => {
  await withScratchTenant(async (tenant) => {
    const importer = new StudentImportController();
    const exporter = new ExportsController();

    await tenant.sql(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1)`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await importer.run({
        rows: [
          {
            fullName: 'Duarte Melo',
            birthDate: '12/05/2016',
            levelName: 'iniciacao',
            contactPhone: '212345678',
            guardianName: 'Sofia Melo',
            guardianEmail: 'sofia.melo@example.test',
            guardianPhone: '912345678',
            guardianTaxNumber: '123456789',
          },
        ],
        commit: true,
        include: [0],
        defaultRelationship: RELATIONSHIP,
      });

      const { students } = await exporter.students();
      const [duarte] = students;

      assert.equal(duarte?.firstName, 'Duarte');
      assert.equal(duarte?.lastName, 'Melo');
      // Day-first on the way in, ISO on the way out, and the same day.
      assert.equal(duarte?.birthDate, '2016-05-12');
      assert.equal(duarte?.levelName, 'Iniciação');
      assert.equal(duarte?.contactPhone, '212345678');

      const guardian = duarte?.guardians[0];
      assert.equal(guardian?.name, 'Sofia Melo');
      assert.equal(guardian?.relationship, RELATIONSHIP);
      assert.equal(guardian?.email, 'sofia.melo@example.test');
      assert.equal(guardian?.phone, '912345678');
      assert.equal(guardian?.taxNumber, '123456789');
    });
  });
});
