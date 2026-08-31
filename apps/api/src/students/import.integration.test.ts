import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { StudentImportController } from './import.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Slice 1.10 — the import against a real database.
 *
 * The pure rules are covered in `import.test.ts`. What needs a database is the
 * half that cannot be proved by reading: that a preview writes nothing, that a
 * commit writes exactly what the preview approved, that a level is matched
 * against this tenant's own levels, and that the endpoint refuses somebody the
 * create form would also refuse.
 *
 * The most valuable one is the first. "Preview writes nothing" is the promise
 * the whole screen rests on, and it is the kind of promise that stays true right
 * up until somebody adds a convenience write to the validation path.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const RELATIONSHIP = 'Encarregado de educação';

async function countStudents(tenant: { sql: <T extends object>(t: string, v?: unknown[]) => Promise<T[]> }): Promise<number> {
  const [row] = await tenant.sql<{ count: string }>(
    'SELECT count(*)::text AS count FROM student WHERE archived_at IS NULL',
  );
  return Number(row?.count ?? '0');
}

test('a preview writes nothing at all', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [
          { fullName: 'Rita Nunes', birthDate: '12/04/1988' },
          { fullName: 'Tiago Sousa', birthDate: '01/09/1990' },
        ],
        commit: false,
        defaultRelationship: RELATIONSHIP,
      });

      assert.equal(result.summary.total, 2);
      assert.equal(result.summary.importable, 2);
      assert.equal(result.created, undefined, 'a preview reports no creation');
    });

    assert.equal(await countStudents(tenant), 0, 'and the register is untouched');
  });
});

test('a commit writes exactly the rows that were ticked', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    const rows = [
      { fullName: 'Rita Nunes', birthDate: '12/04/1988' },
      { fullName: 'Tiago Sousa', birthDate: '01/09/1990' },
      { fullName: 'Marta Lopes', birthDate: '03/03/1975' },
    ];

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows,
        commit: true,
        // The first and the third; the middle one deliberately left out.
        include: [0, 2],
        defaultRelationship: RELATIONSHIP,
      });

      assert.equal(result.created, 2);
      assert.equal(result.skipped, 1);
    });

    const names = await tenant.sql<{ first_name: string }>(
      'SELECT first_name FROM student WHERE archived_at IS NULL ORDER BY first_name',
    );
    assert.deepEqual(
      names.map((row) => row.first_name),
      ['Marta', 'Rita'],
    );
  });
});

test('a level is matched by name against this club, accents and case aside', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    const [level] = await tenant.sql<{ id: string }>(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Iniciação', 1) RETURNING id`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [
          { fullName: 'Rita Nunes', birthDate: '12/04/1988', levelName: 'iniciacao' },
          { fullName: 'Tiago Sousa', birthDate: '01/09/1990', levelName: 'Pré-competição' },
        ],
        commit: false,
        defaultRelationship: RELATIONSHIP,
      });

      assert.equal(result.rows[0]?.levelId, level?.id);
      assert.equal(result.rows[1]?.importable, false);
      assert.equal(result.rows[1]?.problems[0]?.code, 'unknownLevel');
    });
  });
});

test('somebody already in the register comes back as a duplicate, and is not written twice', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, 'Rita', 'Nunes', '1988-04-12')`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const preview = await controller.run({
        rows: [{ fullName: 'Rita Nunes', birthDate: '12/04/1988' }],
        commit: false,
        defaultRelationship: RELATIONSHIP,
      });
      assert.equal(preview.rows[0]?.duplicate?.kind, 'register');
      assert.equal(preview.rows[0]?.importable, true, 'the operator may still decide to');

      /*
       * No `include`, which is what an API caller sends and what the screen's
       * own default means: import the clean rows, leave the ones already here.
       */
      const commit = await controller.run({
        rows: [{ fullName: 'Rita Nunes', birthDate: '12/04/1988' }],
        commit: true,
        defaultRelationship: RELATIONSHIP,
      });
      assert.equal(commit.created, 0);
    });

    assert.equal(await countStudents(tenant), 1);
  });
});

test('a guardian named in the sheet becomes a person, linked to the child', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [
          {
            fullName: 'Duarte Melo',
            birthDate: '12/05/2016',
            guardianName: 'Sofia Melo',
            guardianPhone: '912345678',
            guardianEmail: 'sofia.melo@example.test',
          },
        ],
        commit: true,
        include: [0],
        defaultRelationship: RELATIONSHIP,
      });
      assert.equal(result.created, 1);
    });

    const [link] = await tenant.sql<{
      relationship: string;
      first_name: string;
      email: string;
    }>(
      `SELECT gl.relationship, m.first_name, m.email::text AS email
         FROM guardian_link gl
         JOIN membership m ON m.id = gl.guardian_membership_id
        WHERE gl.archived_at IS NULL`,
    );
    assert.equal(link?.first_name, 'Sofia');
    assert.equal(link?.relationship, RELATIONSHIP);
    assert.equal(link?.email, 'sofia.melo@example.test');
  });
});

test('a refused row is refused however hard the client ticks it', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        // A minor with nobody to telephone — the rule the create form enforces.
        rows: [{ fullName: 'Duarte Melo', birthDate: '12/05/2016' }],
        commit: true,
        include: [0],
        defaultRelationship: RELATIONSHIP,
      });

      assert.equal(result.created, 0, 'the tick is not permission');
      assert.equal(result.rows[0]?.problems[0]?.code, 'guardianRequired');
    });

    assert.equal(await countStudents(tenant), 0);
  });
});

/**
 * `guardian_needs_a_key` fires during the commit, so a row that slipped past the
 * validation would roll the whole import back with a message from PL/pgSQL. This
 * is the test that says the refusal happens early enough to be a line on screen.
 */
test('a guardian with only a telephone number never reaches the trigger', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [
          {
            fullName: 'Duarte Melo',
            birthDate: '12/05/2016',
            guardianName: 'Sofia Melo',
            guardianPhone: '912345678',
          },
          { fullName: 'Rita Nunes', birthDate: '12/04/1988' },
        ],
        commit: true,
        include: [0, 1],
        defaultRelationship: RELATIONSHIP,
      });

      assert.equal(result.rows[0]?.problems[0]?.code, 'guardianKeyRequired');
      // And the clean row beside it still lands: one bad row is refused, not
      // the whole file.
      assert.equal(result.created, 1);
    });

    assert.equal(await countStudents(tenant), 1);
  });
});

test('the import takes the same roles as creating one student by hand', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();
    const body = {
      rows: [{ fullName: 'Rita Nunes' }],
      commit: false,
      defaultRelationship: RELATIONSHIP,
    };

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);
    const student = await addMember(tenant, 'Ana', 'Aluna', ['student']);

    // An instructor teaches; they do not enrol two hundred people at once.
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      await expectStatus(() => controller.run(body), 403);
    });

    await actingAs(tenant, { membershipId: student, roles: ['student'] }, async () => {
      await expectStatus(() => controller.run(body), 403);
    });

    // And an admin is admitted, which is what proves the two above were about
    // the role rather than about the body.
    const admin = await addMember(tenant, 'Paulo', 'Admin', ['admin']);
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      const result = await controller.run(body);
      assert.equal(result.summary.total, 1);
    });
  });
});

test('a body with no rows is a 400 rather than an import of nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () => controller.run({ rows: [], commit: false, defaultRelationship: RELATIONSHIP }),
        400,
      );
      // The relationship is required: the guardian link needs a non-blank one,
      // and only the web app owns readable Portuguese for it.
      await expectStatus(
        () => controller.run({ rows: [{ fullName: 'Rita' }], commit: false }),
        400,
      );
    });
  });
});
