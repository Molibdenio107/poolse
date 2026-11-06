import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'jpeg-js';
import { AppController } from '../app/app.controller.js';
import { StudentDocumentsController } from './documents.controller.js';
import { StudentsController } from './students.controller.js';
import { getObjectBytes } from '../files/storage.js';
import { completeFpnForm } from '../test/fpn-fixture.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-179, slice 2 — a family sends a document, and nothing the office holds
 * changes until the office accepts it.
 *
 * Run: pnpm api:test   (needs pnpm db:up and storage, as every upload test does)
 */

after(closeHarness);

/** A real 8×8 JPEG, so the sniffing sees what a phone sends. */
const JPEG = Buffer.from(encode({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 200) }, 80).data);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);

interface Family {
  guardian: string;
  child: string;
  stranger: string;
  /** A ten-year-old with their own login. */
  ownLogin: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const ownLogin = await addMember(tenant, 'Alice', 'Silva', ['student']);
  const student = async (first: string, membership: string | null): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, $2, 'Silva', club_today() - interval '10 years', $3) RETURNING id`,
      [org, first, membership],
    );
    return row!.id;
  };
  const child = await student('Alice', ownLogin);
  const stranger = await student('Bruna', null);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child, guardian],
  );
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name) VALUES ($1, $2, $3, 'Golfinhos') RETURNING id`,
    [org, tenant.seasonId, tenant.facilityId],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 10)`,
    [org, group!.id, child],
  );
  await completeFpnForm(tenant, child);
  return { guardian, child, stranger, ownLogin };
}

const asGuardian = <T>(tenant: ScratchTenant, family: Family, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: family.guardian, roles: ['guardian'] }, fn);
const asOffice = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);

const status = async (tenant: ScratchTenant, family: Family, kind: string): Promise<string> => {
  const { children } = await asGuardian(tenant, family, () => new AppController().documents(family.child));
  return children[0]!.documents.find((one) => one.kind === kind)!.status;
};

test('an ID photo sent is sealed, waits for the office, and changes nothing it holds (QA 5, AC 3)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('id_document', family.child, 'cc.jpg', undefined, JPEG),
    );
    assert.equal(await status(tenant, family, 'id_document'), 'sent');

    const [file] = await tenant.sql<{ purpose: string; sealed: boolean; storage_key: string }>(
      `SELECT f.purpose::text AS purpose, f.wrapped_key IS NOT NULL AS sealed, f.storage_key
         FROM family_submission s JOIN stored_file f ON f.id = s.file_id WHERE s.student_id = $1`,
      [family.child],
    );
    assert.equal(file!.purpose, 'student_id_document');
    assert.equal(file!.sealed, true);
    const inBucket = await getObjectBytes(file!.storage_key);
    assert.equal(inBucket.includes(JPEG.subarray(0, 64)), false, 'the bucket holds ciphertext');

    const filed = await tenant.sql('SELECT 1 FROM student_document WHERE student_id = $1', [family.child]);
    assert.equal(filed.length, 0, 'nothing is filed until the office accepts');

    // One waits at a time.
    await asGuardian(tenant, family, () =>
      expectStatus(() => new AppController().sendDocument('id_document', family.child, 'cc.jpg', undefined, JPEG), 409),
    );
  });
});

test('refusals: a stranger’s child, a minor’s own login, a renamed executable, an exam with no date (QA 4, 6, 7)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, async () => {
      await expectStatus(() => new AppController().sendDocument('id_document', family.stranger, 'f.pdf', undefined, PDF), 404);
      await expectStatus(() => new AppController().sendDocument('id_document', family.child, 'f.pdf', undefined, EXE), 400);
      // The boletim is only ever downloaded (Rui, 06-11-2026).
      await expectStatus(() => new AppController().sendDocument('socio_form', family.child, 'f.pdf', undefined, PDF), 404);
      await expectStatus(() => new AppController().sendDocument('medical_exam', family.child, 'e.pdf', undefined, PDF), 400);
      await expectStatus(() => new AppController().sendDocument('nonsense', family.child, 'e.pdf', undefined, PDF), 404);
    });
    await actingAs(tenant, { membershipId: family.ownLogin, roles: ['student'] }, async () => {
      await expectStatus(() => new AppController().sendDocument('fpn_declaration', family.child, 'f.pdf', undefined, PDF), 403);
      // …and still reads the statuses.
      const { children } = await new AppController().documents(family.child);
      assert.ok(children[0]!.documents.every((one) => one.canSend === false));
    });
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new AppController().sendDocument('fpn_declaration', family.child, 'f.pdf', undefined, PDF), 403),
    );
  });
});

test('the office accepts: the copy is filed as the office files one, sealed for an ID photo', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('id_document', family.child, 'cc.jpg', undefined, JPEG),
    );
    const { submissions } = await asOffice(tenant, () => new StudentDocumentsController().submissions(family.child));
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0]!.submittedByName, 'Marta Silva');

    await asOffice(tenant, () => new StudentDocumentsController().accept(family.child, submissions[0]!.id, {}));
    const [doc] = await tenant.sql<{ purpose: string }>(
      `SELECT f.purpose::text AS purpose FROM student_document d JOIN stored_file f ON f.id = d.file_id
        WHERE d.student_id = $1 AND d.kind = 'id_document' AND d.replaced_at IS NULL`,
      [family.child],
    );
    assert.equal(doc!.purpose, 'student_id_document');
    assert.notEqual(await status(tenant, family, 'id_document'), 'sent');
    // Decided once.
    await asOffice(tenant, () =>
      expectStatus(() => new StudentDocumentsController().accept(family.child, submissions[0]!.id, {}), 404),
    );
  });
});

test('an exam is accepted only with its result; a rejected one is shredded and recorded nowhere', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('medical_exam', family.child, 'exame.pdf', '2026-10-01', PDF),
    );
    const [first] = (await asOffice(tenant, () => new StudentDocumentsController().submissions(family.child))).submissions;
    assert.equal(first!.examinedOn, '2026-10-01');
    // The family's exam is not the child's standing while it waits.
    const waiting = await tenant.sql('SELECT 1 FROM medical_exam WHERE student_id = $1', [family.child]);
    assert.equal(waiting.length, 0);

    await asOffice(tenant, async () => {
      await expectStatus(() => new StudentDocumentsController().accept(family.child, first!.id, {}), 400);
      await new StudentDocumentsController().accept(family.child, first!.id, { result: 'fit' });
    });
    const [exam] = await tenant.sql<{ result: string; has_file: boolean }>(
      'SELECT result::text AS result, file_id IS NOT NULL AS has_file FROM medical_exam WHERE student_id = $1',
      [family.child],
    );
    assert.equal(exam!.result, 'fit');
    assert.equal(exam!.has_file, true);

    // A second sending, rejected: its key is destroyed.
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('medical_exam', family.child, 'exame2.pdf', '2026-10-20', PDF),
    );
    const [second] = (await asOffice(tenant, () => new StudentDocumentsController().submissions(family.child))).submissions;
    await asOffice(tenant, () => new StudentDocumentsController().reject(family.child, second!.id));
    const [file] = await tenant.sql<{ shredded: boolean }>(
      `SELECT f.key_shredded_at IS NOT NULL AND f.wrapped_key IS NULL AS shredded
         FROM family_submission s JOIN stored_file f ON f.id = s.file_id WHERE s.id = $1`,
      [second!.id],
    );
    assert.equal(file!.shredded, true);
    const exams = await tenant.sql('SELECT 1 FROM medical_exam WHERE student_id = $1', [family.child]);
    assert.equal(exams.length, 1, 'a rejected exam is recorded nowhere');
  });
});

test('a rejected plain form is archived, so nobody can open it again', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('fpn_declaration', family.child, 'fpn.pdf', undefined, PDF),
    );
    const [sent] = (await asOffice(tenant, () => new StudentDocumentsController().submissions(family.child))).submissions;
    await asOffice(tenant, () => new StudentDocumentsController().reject(family.child, sent!.id));
    const [file] = await tenant.sql<{ archived: boolean }>(
      'SELECT archived_at IS NOT NULL AS archived FROM stored_file WHERE id = $1',
      [sent!.fileId],
    );
    assert.equal(file!.archived, true);
    // The family that sent it is refused too, as for any archived file.
    const { FilesController } = await import('../files/files.controller.js');
    await asGuardian(tenant, family, () => expectStatus(() => new FilesController().read(sent!.fileId), 404));
  });
});

test('a photo’s GPS position never reaches the bucket', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    // An APP1 EXIF segment carrying a position, as a phone writes it.
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x1c]), Buffer.from('Exif\0\0', 'latin1'), Buffer.from('II*\0', 'latin1'), Buffer.from('GPS:41.1579N,8.6291W', 'latin1')]);
    exif.writeUInt16BE(exif.length - 2, 2);
    const photo = Buffer.concat([JPEG.subarray(0, 2), exif, JPEG.subarray(2)]);
    await asGuardian(tenant, family, () => new AppController().sendDocument('fpn_declaration', family.child, 'f.jpg', undefined, photo));
    const [sent] = (await asOffice(tenant, () => new StudentDocumentsController().submissions(family.child))).submissions;
    const [row] = await tenant.sql<{ storage_key: string }>('SELECT storage_key FROM stored_file WHERE id = $1', [sent!.fileId]);
    const stored = await getObjectBytes(row!.storage_key);
    assert.equal(stored.includes(Buffer.from('41.1579N')), false);
    assert.deepEqual(stored, JPEG, 'only the metadata went');
  });
});

test('the family’s actions are on the record, named, never valued', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('fpn_declaration', family.child, 'fpn.pdf', undefined, PDF),
    );
    const [entry] = await tenant.sql<{ actor_membership_id: string; data: { kind: string } }>(
      `SELECT actor_membership_id, data FROM audit_log WHERE entity_id = $1 AND action = 'student.document_sent'`,
      [family.child],
    );
    assert.equal(entry!.actor_membership_id, family.guardian);
    assert.equal(entry!.data.kind, 'fpn_declaration_minor');
  });
});

test('POOLSE-186: an ID accepted with a date confirms it, and a correction stays out of the log', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, () =>
      new AppController().sendDocument('id_document', family.child, 'cc.jpg', undefined, JPEG),
    );
    const { submissions } = await asOffice(tenant, () => new StudentDocumentsController().submissions(family.child));
    assert.notEqual(submissions[0]!.studentBirthDate, null);

    await asOffice(tenant, () =>
      new StudentDocumentsController().accept(family.child, submissions[0]!.id, { birthDate: '2016-05-06' }),
    );
    const [row] = await tenant.sql<{ birth_date: string; verified: boolean }>(
      `SELECT birth_date::text, birth_date_verified_at IS NOT NULL AS verified FROM student WHERE id = $1`,
      [family.child],
    );
    assert.equal(row!.birth_date, '2016-05-06');
    assert.equal(row!.verified, true);
    const [log] = await tenant.sql<{ data: string }>(
      `SELECT data::text FROM audit_log WHERE action = 'student.birth_date_confirmed' AND entity_id = $1`,
      [family.child],
    );
    assert.equal(log!.data.includes('2016'), false);
    assert.equal(log!.data.includes('"corrected": true'), true);
  });
});

test('POOLSE-186: the office confirms a declared date, which opens the adult path; no date is a 409', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [adult] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, birth_date_declared_at)
       VALUES ($1, 'Rui', 'Adulto', '1990-09-05', now()) RETURNING id`,
      [org],
    );
    const [blank] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Sem', 'Data') RETURNING id`,
      [org],
    );
    const adultPath = async (): Promise<boolean> => {
      const [row] = await tenant.sql<{ adult: boolean }>(`SELECT student_is_adult_path($1, $2) AS adult`, [org, adult!.id]);
      return row!.adult;
    };
    assert.equal(await adultPath(), false);
    const before = await asOffice(tenant, () => new StudentsController().one(adult!.id));
    assert.equal(before.birthDateState?.declared, true);

    await asOffice(tenant, () => new StudentsController().confirmBirthDate(adult!.id, {}));
    assert.equal(await adultPath(), true);
    const after = await asOffice(tenant, () => new StudentsController().one(adult!.id));
    assert.equal(after.birthDateState?.declared, false);
    assert.notEqual(after.birthDateState?.verifiedAt, null);

    await expectStatus(() => asOffice(tenant, () => new StudentsController().confirmBirthDate(blank!.id, {})), 409);
  });
});
