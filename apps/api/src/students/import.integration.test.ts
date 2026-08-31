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
      });

      assert.equal(result.rows[0]?.levelId, level?.id, 'the one they already have');
      assert.equal(result.rows[1]?.importable, true, 'and a new one does not fail its row');
      assert.deepEqual(result.summary.levelsToCreate, ['Pré-competição']);
    });

    // A preview creates nothing, levels included.
    const levels = await tenant.sql<{ name: string }>('SELECT name FROM student_level');
    assert.equal(levels.length, 1);
  });
});

/**
 * A club's programme is whatever their spreadsheet says it is.
 *
 * Refusing rows whose level does not exist yet meant asking somebody to copy a
 * list out of the file they were in the middle of importing. The levels are
 * created inside the same transaction as the students, so an import brings the
 * programme and its people together or brings neither.
 */
test('levels named in the file are created, once each, on the end of the ladder', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await tenant.sql(
      `INSERT INTO student_level (organization_id, name, sort_order)
       VALUES ($1, 'Adaptação', 1)`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [
          { fullName: 'Rita Nunes', levelName: 'Pré-competição' },
          { fullName: 'Tiago Sousa', levelName: 'pre competicao' },
          { fullName: 'Marta Lopes', levelName: 'adaptacao' },
          { fullName: 'Ana Melo', levelName: 'Hidroginástica' },
        ],
        commit: true,
        include: [0, 1, 2, 3],
      });

      assert.equal(result.created, 4);
      assert.deepEqual(result.levelsCreated, ['Pré-competição', 'Hidroginástica']);
    });

    const levels = await tenant.sql<{ name: string; sort_order: number }>(
      'SELECT name, sort_order FROM student_level ORDER BY sort_order',
    );
    assert.deepEqual(
      levels.map((level) => level.name),
      ['Adaptação', 'Pré-competição', 'Hidroginástica'],
      'the existing one keeps its place and the new ones go on the end',
    );

    // Both spellings of one name landed in one level, and it kept the accents.
    const [preCompetition] = await tenant.sql<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM student s JOIN student_level l ON l.id = s.level_id
        WHERE l.name = 'Pré-competição'`,
    );
    assert.equal(preCompetition?.count, '2');
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
    assert.equal(link?.relationship, null, 'the sheet had no relationship column, so none is invented');
    assert.equal(link?.email, 'sofia.melo@example.test');
  });
});

test('a refused row is refused however hard the client ticks it', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        // A date that is not a date — one of the two things that genuinely
        // cannot be written.
        rows: [{ fullName: 'Duarte Melo', birthDate: '31/02/2016' }],
        commit: true,
        include: [0],
      });

      assert.equal(result.created, 0, 'the tick is not permission');
      assert.equal(result.rows[0]?.problems[0]?.code, 'badDate');
    });

    assert.equal(await countStudents(tenant), 0);
  });
});

test('a minor with no guardian imports, and is counted', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [{ fullName: 'Duarte Melo', birthDate: '12/05/2016' }],
        commit: true,
        include: [0],
      });

      assert.equal(result.created, 1);
      assert.equal(result.summary.minorsWithoutGuardian, 1);
    });

    assert.equal(await countStudents(tenant), 1);
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
        ],
        commit: true,
        include: [0],
      });

      // The student lands; the guardian does not, because the database requires
      // a guardian be dedupable and a phone number is not a key.
      assert.equal(result.created, 1);
      assert.equal(result.rows[0]?.warnings[0]?.code, 'guardianNotRecorded');
    });

    assert.equal(await countStudents(tenant), 1);

    const links = await tenant.sql('SELECT 1 FROM guardian_link WHERE archived_at IS NULL');
    assert.equal(links.length, 0, 'and no half-identified person was invented for them');
  });
});

test('the import takes the same roles as creating one student by hand', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();
    const body = { rows: [{ fullName: 'Rita Nunes' }], commit: false };

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
      await expectStatus(() => controller.run({ rows: [], commit: false }), 400);
      await expectStatus(() => controller.run({ commit: false }), 400);
    });
  });
});


/**
 * A second import of the same people — the case that decides whether this is
 * usable more than once.
 *
 * A NIF match is an identity: it makes the row an update of the person it
 * belongs to, even when the sheet spells their name differently. Everything else
 * matches on name and birth date. Either way a commit only ever *fills blanks* —
 * `fillStudentBlanks` coalesces every column, so a value already in Poolse
 * cannot be overwritten by a spreadsheet.
 */
test('a matching row fills the blanks instead of creating a second student', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, tax_number, contact_email)
       VALUES ($1, 'Marta', 'Vaz', '123456789', 'antiga@example.test')`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const result = await controller.run({
        rows: [
          {
            // A different name entirely: the NIF is what says this is Marta.
            fullName: 'Marta Vaz Correia',
            taxNumber: '123 456 789',
            birthDate: '15/03/1979',
            contactEmail: 'nova@example.test',
            contactPhone: '912345678',
          },
          { fullName: 'Rita Nunes', birthDate: '12/04/1988' },
        ],
        commit: true,
        include: [0, 1],
      });

      assert.equal(result.created, 1, 'only the genuinely new one');
      assert.equal(result.updated, 1);
      assert.equal(result.rows[0]?.duplicate?.matchedOn, 'taxNumber');
    });

    assert.equal(await countStudents(tenant), 2, 'and no second Marta');

    const [marta] = await tenant.sql<{
      first_name: string;
      birth_date: string | null;
      contact_email: string;
      contact_phone: string | null;
    }>(
      `SELECT first_name, to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
              contact_email::text AS contact_email, contact_phone
         FROM student WHERE tax_number = '123456789'`,
    );

    assert.equal(marta?.birth_date, '1979-03-15', 'the blank was filled');
    assert.equal(marta?.contact_phone, '912345678', 'and so was this one');
    assert.equal(marta?.contact_email, 'antiga@example.test', 'what was there is untouched');
    assert.equal(marta?.first_name, 'Marta', 'and the name is never rewritten by a file');
  });
});

test('importing the same file twice changes nothing the second time', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();
    const rows = [
      { fullName: 'Rita Nunes', birthDate: '12/04/1988', contactPhone: '912345678' },
    ];

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const first = await controller.run({ rows, commit: true, include: [0] });
      assert.equal(first.created, 1);

      const second = await controller.run({ rows, commit: true, include: [0] });
      assert.equal(second.created, 0, 'nobody is created twice');
      assert.equal(second.updated, 0, 'and there was nothing left to fill');
    });

    assert.equal(await countStudents(tenant), 1);
  });
});

test('the same child listed twice in one file becomes one student', async () => {
  await withScratchTenant(async (tenant) => {
    const controller = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // A sheet with one line per class attended. Ticking every row is what an
      // operator does; creating four children is what must not happen.
      const result = await controller.run({
        rows: [
          { fullName: 'Duarte Melo', birthDate: '12/05/2016' },
          { fullName: 'Duarte Melo', birthDate: '12/05/2016' },
          { fullName: 'Duarte Melo', birthDate: '12/05/2016' },
        ],
        commit: true,
        include: [0, 1, 2],
      });

      assert.equal(result.created, 1);
    });

    assert.equal(await countStudents(tenant), 1);
  });
});

test('a student NIF survives the round trip through the export', async () => {
  await withScratchTenant(async (tenant) => {
    const importer = new StudentImportController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await importer.run({
        rows: [{ fullName: 'Marta Vaz Correia', birthDate: '15/03/1979', taxNumber: '123456789' }],
        commit: true,
        include: [0],
      });
    });

    const [row] = await tenant.sql<{ tax_number: string }>(
      'SELECT tax_number FROM student WHERE archived_at IS NULL',
    );
    assert.equal(row?.tax_number, '123456789');
  });
});
