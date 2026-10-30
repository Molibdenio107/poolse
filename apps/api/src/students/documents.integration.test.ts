import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BoletimController, FpnSettingsController, StudentDocumentsController } from './documents.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * POOLSE-132 — *Documentos*: the ID document encrypted and audited, the FPN
 * disciplines kept on the record, the club's settings, the Anexo 2's print data
 * and the signed copies per season with history.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

// A Cartão de Cidadão number that passes the check digits.
const CC = '000000000ZZ4';

test('POOLSE-132 — documents, print data and filed copies', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
      actingAs(tenant, { membershipId: admin, roles: ['admin'] }, fn);
    const routes = new StudentDocumentsController();

    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, address_line, locality, postal_code)
       VALUES ($1, 'Rui', 'Fonseca', '1990-09-24', 'Rua Pedro Álvares Cabral', 'Santo Tirso', '4780-518')
       RETURNING id`,
      [org],
    );
    const id = student!.id;
    const [season] = await tenant.sql<{ id: string; name: string }>(
      `SELECT id, name FROM season WHERE organization_id = $1 AND archived_at IS NULL ORDER BY starts_on DESC LIMIT 1`,
      [org],
    );

    // Missing before anything is set.
    const empty = await asAdmin(() => routes.read(id));
    assert.ok(empty.missing.includes('idDocumentNumber'));
    assert.ok(empty.missing.includes('fpnAssociation'));
    assert.equal(empty.minor, false);

    // A bad Cartão de Cidadão number is a field error.
    await asAdmin(() =>
      expectStatus(() => routes.save(id, { idDocumentType: 'cc', idDocumentNumber: '123' }), 400),
    );

    await asAdmin(() =>
      routes.save(id, {
        idDocumentType: 'cc',
        idDocumentNumber: CC,
        idDocumentValidUntil: '2031-09-24',
        disciplines: ['masters', 'masters', 'pura'],
      }),
    );
    await asAdmin(() => new FpnSettingsController().save({ association: 'ANNP', clubCode: 'GCST' }));

    // The number is ciphertext at rest, never plaintext.
    const [stored] = await tenant.sql<{ n: string }>(
      'SELECT id_document_number_encrypted AS n FROM student WHERE id = $1',
      [id],
    );
    assert.match(stored!.n, /^v1\./);
    assert.equal(stored!.n.includes('000000000'), false);

    const read = await asAdmin(() => routes.read(id));
    assert.deepEqual([...read.disciplines].sort(), ['masters', 'pura']);
    assert.equal(read.idDocument.hasNumber, true);
    assert.deepEqual(read.club, { association: 'ANNP', clubCode: 'GCST' });

    // The print decrypts, and that read is audited.
    const print = await asAdmin(() => routes.print(id, season!.id, undefined));
    assert.equal(print.idDocumentNumber, CC);
    assert.equal(print.signerName, 'Rui Fonseca');
    assert.equal(print.seasonName, season!.name);
    const [audited] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'student.id_document_read'`,
      [id],
    );
    assert.equal(audited!.n, 1);

    // An instructor reaches none of it.
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      await expectStatus(() => routes.read(id), 403);
      await expectStatus(() => routes.print(id, undefined, undefined), 403);
    });

    // Two signed copies for one season: the second is current, the first kept.
    const files = await tenant.sql<{ id: string }>(
      `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
       SELECT $1::uuid, 'student_document', $1::text || '/test/' || g || '.pdf', 'application/pdf', 10, 'anexo2.pdf', $2
         FROM generate_series(1, 2) g RETURNING id`,
      [org, admin],
    );
    for (const file of files) {
      await asAdmin(() => routes.file(id, { kind: 'fpn_declaration', seasonId: season!.id, fileId: file.id }));
    }
    const copies = (await asAdmin(() => routes.read(id))).copies;
    assert.equal(copies.length, 2);
    assert.equal(copies.filter((c) => c.replacedAt === null).length, 1);

    // Anonymisation clears the ID document.
    await tenant.sql('UPDATE student SET anonymised_at = now() WHERE id = $1', [id]);
    const [gone] = await tenant.sql<{ n: number }>(
      `SELECT num_nonnulls(id_document_type, id_document_number_encrypted, id_document_valid_until)::int AS n
         FROM student WHERE id = $1`,
      [id],
    );
    assert.equal(gone!.n, 0);
  });
});

test('POOLSE-134 — the boletim reads the record, a minor names the guardian, and the SNS number never prints', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const mother = await addMember(tenant, 'Eva', 'Lopes', ['guardian']);
    await tenant.sql(`UPDATE membership SET phone = '912000111' WHERE id = $1`, [mother]);
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, is_socio, socio_number, socio_since,
                            address_line, locality, postal_code, nationality, sns_number)
       VALUES ($1, 'Tomás', 'Lopes', current_date - interval '10 years', true, '412', '2024-09-01',
               'Rua A, 1', 'Santo Tirso', '4780-518', 'PT', '123456789')
       RETURNING id`,
      [org],
    );
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'mãe', true)`,
      [org, student!.id, mother],
    );

    const print = await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, () =>
      new BoletimController().print(student!.id),
    );
    assert.equal(print.socioNumber, '412');
    assert.equal(print.socioSince, '2024-09-01');
    assert.equal(print.postalCode, '4780-518');
    assert.equal(print.minor, true);
    assert.equal(print.guardian?.phone, '912000111');
    assert.equal(JSON.stringify(print).includes('123456789'), false, 'the SNS number never prints');
  });
});
