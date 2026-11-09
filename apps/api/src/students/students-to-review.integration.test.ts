import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AppController } from '../app/app.controller.js';
import { AttentionController } from '../attention/attention.controller.js';
import { StudentDocumentsController } from './documents.controller.js';
import { StudentsController } from './students.controller.js';
import { completeFpnForm } from '../test/fpn-fixture.js';
import { actingAs, addMember, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-190 — what a family or a student sent raises a circle for the office,
 * and the label names who really sent it.
 *
 * Run: pnpm api:test   (needs pnpm db:up and storage, as every upload test does)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
after(async () => {
  await owner.end();
  await closeHarness();
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function addStudent(tenant: ScratchTenant, first: string, birthDate: string, membership: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
     VALUES ($1, $2, 'Silva', $3::date, $4) RETURNING id`,
    [tenant.organizationId, first, birthDate, membership],
  );
  return row!.id;
}

async function addGuardian(tenant: ScratchTenant, student: string): Promise<string> {
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [tenant.organizationId, student, guardian],
  );
  return guardian;
}

async function enrol(tenant: ScratchTenant, student: string, sport: string | null): Promise<void> {
  const org = tenant.organizationId;
  let area: string | null = null;
  if (sport !== null) {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO playing_area (organization_id, facility_id, sport_id, name) VALUES ($1, $2, $3, 'Campo') RETURNING id`,
      [org, tenant.facilityId, sport],
    );
    area = row!.id;
  }
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, playing_area_id)
     VALUES ($1, $2, $3, 'Turma ' || gen_random_uuid(), $4) RETURNING id`,
    [org, tenant.seasonId, tenant.facilityId, area],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 10)`,
    [org, group!.id, student],
  );
}

const asOffice = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);
const read = (tenant: ScratchTenant) => asOffice(tenant, () => new AttentionController().read());
/** An FPN declaration is asked of a student in a pool turma, so they join one first. */
const sendFpn = async (tenant: ScratchTenant, membershipId: string, role: 'guardian' | 'student', student: string) => {
  await enrol(tenant, student, null);
  await completeFpnForm(tenant, student);
  return actingAs(tenant, { membershipId, roles: [role] }, () =>
    new AppController().sendDocument('fpn_declaration', student, 'f.pdf', undefined, PDF),
  );
};
const pendingOf = (tenant: ScratchTenant, student: string) =>
  asOffice(tenant, async () => (await new StudentDocumentsController().submissions(student)).submissions);

test('QA 1–4: something sent raises the circle per student, and a decision clears it', async () => {
  await withScratchTenant(async (tenant) => {
    const child = await addStudent(tenant, 'Alice', '2016-03-01');
    const guardian = await addGuardian(tenant, child);
    assert.deepEqual((await read(tenant)).students, {});

    await sendFpn(tenant, guardian, 'guardian', child);
    // A second kind on the same child: the row counts two, the menu one student.
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, () =>
      new AppController().sendDocument('id_document', child, 'cc.pdf', undefined, PDF),
    );
    const seen = await read(tenant);
    assert.equal(seen.students[child], 2);
    assert.equal(seen.menu['students'], 1, 'the menu counts students, not documents');

    const [first, second] = await pendingOf(tenant, child);
    await asOffice(tenant, () => new StudentDocumentsController().reject(child, first!.id));
    assert.equal((await read(tenant)).students[child], 1);
    await asOffice(tenant, () => new StudentDocumentsController().accept(child, second!.id, { birthDate: '2016-03-01' }));
    const cleared = await read(tenant);
    assert.equal(cleared.students[child], undefined);
    assert.equal(cleared.menu['students'], undefined);
  });
});

test('QA 5: a declared date raises it, and confirming clears it', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', '1990-09-05');
    await tenant.sql(`UPDATE student SET birth_date_declared_at = now() WHERE id = $1`, [adult]);
    assert.equal((await read(tenant)).students[adult], 1);
    await asOffice(tenant, () => new StudentsController().confirmBirthDate(adult, {}));
    assert.equal((await read(tenant)).menu['students'], undefined);
  });
});

test('QA 7: each sport counts its own, the shared entry everybody; an archived student counts nowhere', async () => {
  await withScratchTenant(async (tenant) => {
    const swimmer = await addStudent(tenant, 'Ana', '1990-01-01');
    const player = await addStudent(tenant, 'Bia', '1990-01-02');
    const nobody = await addStudent(tenant, 'Carla', '1990-01-03');
    const gone = await addStudent(tenant, 'Dina', '1990-01-04');
    await owner.query("UPDATE organization SET enabled_sports = '{pool,tennis}' WHERE id = $1", [tenant.organizationId]);
    await enrol(tenant, swimmer, null);
    await enrol(tenant, player, 'tennis');
    await tenant.sql(`UPDATE student SET birth_date_declared_at = now() WHERE id = ANY($1)`, [[swimmer, player, nobody, gone]]);
    await tenant.sql(`UPDATE student SET archived_at = now() WHERE id = $1`, [gone]);

    const { menu, students } = await read(tenant);
    assert.equal(menu['students'], 3);
    assert.equal(menu['students:pool'], 1);
    assert.equal(menu['students:tennis'], 1);
    assert.equal(students[gone], undefined);
  });
});

test('QA 8–9: only the office is told, and never about another club', async () => {
  await withScratchTenant(async (tenant) => {
    const child = await addStudent(tenant, 'Alice', '2016-03-01');
    const guardian = await addGuardian(tenant, child);
    await sendFpn(tenant, guardian, 'guardian', child);

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.equal((await new AttentionController().read()).students[child], 1);
    });
    for (const role of ['instructor', 'maintenance'] as const) {
      await actingAs(tenant, { roles: [role] }, async () => {
        const seen = await new AttentionController().read();
        assert.deepEqual(seen.students, {}, role);
        assert.equal(seen.menu['students'], undefined, role);
      });
    }
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      assert.deepEqual((await new AttentionController().read()).students, {});
    });

    await withScratchTenant(async (other) => {
      assert.deepEqual((await read(other)).students, {});
    });
  });
});

test('QA 10–11: the label comes from who sent it, whatever the age', async () => {
  await withScratchTenant(async (tenant) => {
    const login = await addMember(tenant, 'Rui', 'Silva', ['student']);
    const adult = await addStudent(tenant, 'Rui', '1990-09-05', login);
    await sendFpn(tenant, login, 'student', adult);
    assert.equal((await pendingOf(tenant, adult))[0]!.submittedByRole, 'student');

    // Nineteen, and an acompanhante still linked: it truly is the guardian's upload.
    // A parent's link would grant nothing at nineteen (POOLSE-206).
    const [row] = await tenant.sql<{ on: string }>(`SELECT (club_today() - interval '19 years')::date::text AS on`);
    const nineteen = await addStudent(tenant, 'Bia', row!.on);
    const guardian = await addGuardian(tenant, nineteen);
    await tenant.sql(`UPDATE guardian_link SET kind = 'accompanying' WHERE student_id = $1`, [nineteen]);
    await sendFpn(tenant, guardian, 'guardian', nineteen);
    assert.equal((await pendingOf(tenant, nineteen))[0]!.submittedByRole, 'guardian');
  });
});

test('QA 12–14: the banner knows what there is to check the date against', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await addStudent(tenant, 'Rui', '1990-09-05');
    const guardian = await addGuardian(tenant, adult);
    await tenant.sql(`UPDATE student SET birth_date_declared_at = now() WHERE id = $1`, [adult]);
    const state = async () =>
      (await asOffice(tenant, () => new StudentsController().one(adult))).birthDateState?.idDocument;
    assert.equal(await state(), 'none');

    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, () =>
      new AppController().sendDocument('id_document', adult, 'cc.pdf', undefined, PDF),
    );
    assert.equal(await state(), 'pending');

    const [sent] = await pendingOf(tenant, adult);
    await asOffice(tenant, () => new StudentDocumentsController().accept(adult, sent!.id, { birthDate: '1990-09-05' }));
    assert.equal(await state(), 'on_file');
  });
});
