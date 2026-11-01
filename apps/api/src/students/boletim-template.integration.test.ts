import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BOLETIM_FIELDS } from '@poolse/rules';
import { DocumentTemplatesController } from './boletim-template.controller.js';
import { BoletimController, StudentDocumentsController } from './documents.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * POOLSE-142 — a club's own boletim de sócio: the template and its placements,
 * replaced as sets, and the two guarded numbers read only when placed.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const CC = '000000000ZZ4';

test('POOLSE-142 — the field list is the SQL enum', async () => {
  await withScratchTenant(async (tenant) => {
    const [row] = await tenant.sql<{ values: string[] }>(`SELECT enum_range(NULL::boletim_field)::text[] AS values`);
    assert.deepEqual(row!.values, [...BOLETIM_FIELDS]);
  });
});

test('POOLSE-142 — template, placements and the guarded numbers', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
      actingAs(tenant, { membershipId: admin, roles: ['admin'] }, fn);
    const routes = new DocumentTemplatesController();

    const file = async (purpose: string): Promise<string> => {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
         VALUES ($1, $2::file_purpose, $4, 'image/jpeg', 900, 'boletim.jpg', $3)
         RETURNING id`,
        [org, purpose, admin, `${org}/${purpose}/${crypto.randomUUID()}.jpg`],
      );
      return row!.id;
    };

    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, sns_number)
       VALUES ($1, 'Rui', 'Fonseca', '1990-09-24', '123456789') RETURNING id`,
      [org],
    );
    const id = student!.id;
    await asAdmin(() => new StudentDocumentsController().save(id, { idDocumentType: 'cc', idDocumentNumber: CC }));

    const reads = async (): Promise<number> => {
      const [row] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'student.id_document_read'`,
        [id],
      );
      return row!.n;
    };

    // QA 4: an instructor is refused every route.
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      await expectStatus(() => routes.read('socio_form'), 403);
      await expectStatus(() => routes.place('socio_form', { fields: [] }), 403);
    });

    // No template: Poolse's boletim, and neither number is read.
    assert.equal((await asAdmin(() => routes.read('socio_form'))).template, null);
    await expectStatus(() => asAdmin(() => routes.place('socio_form', { fields: [] })), 404);
    let print = await asAdmin(() => new BoletimController().print(id));
    assert.equal(print.template, null);
    assert.equal(print.idDocumentNumber, null);
    assert.equal(print.snsNumber, null);
    assert.equal(await reads(), 0);

    // A file of another purpose is not a template.
    await expectStatus(() => asAdmin(() => routes.set('socio_form', { fileId: 'x' })), 400);
    await expectStatus(async () => asAdmin(async () => routes.set('socio_form', { fileId: await file('logo') })), 400);

    // QA 1–2: upload, place, print.
    const first = await file('boletim_template');
    await asAdmin(() => routes.set('socio_form', { fileId: first }));
    await asAdmin(() =>
      routes.place('socio_form', {
        fields: [
          { field: 'name', x: 0.2, y: 0.18, width: 0.5 },
          { field: 'locality', x: 0.2, y: 0.31, sizePt: 10 },
          { field: 'locality', x: 0.17, y: 0.45 },
        ],
      }),
    );
    const live = (await asAdmin(() => routes.read('socio_form'))).template!;
    assert.equal(live.fields[0]?.width, 0.5, 'the white strip is kept');
    assert.equal(live.fields[1]?.width, null, 'no strip asked, none kept');
    assert.equal(live.fileId, first);
    assert.deepEqual(
      live.fields.map((f) => [f.field, f.sizePt]),
      [['name', 11], ['locality', 10], ['locality', 11]],
    );
    print = await asAdmin(() => new BoletimController().print(id));
    assert.equal(print.template?.fields.length, 3);
    assert.equal(print.idDocumentNumber, null, 'not placed, not read');
    assert.equal(await reads(), 0);

    // QA 6: off the page, unknown or oversized is refused, and nothing changes.
    for (const bad of [{ field: 'name', x: 1.2, y: 0.5 }, { field: 'curling', x: 0.1, y: 0.1 }, { field: 'name', x: 0.1, y: 0.1, sizePt: 50 }]) {
      await expectStatus(() => asAdmin(() => routes.place('socio_form', { fields: [bad] })), 400);
    }
    assert.equal((await asAdmin(() => routes.read('socio_form'))).template!.fields.length, 3);

    // QA 3: placed, both numbers print — the ID read audited.
    await asAdmin(() =>
      routes.place('socio_form', { fields: [{ field: 'id_document_number', x: 0.2, y: 0.6 }, { field: 'sns_number', x: 0.7, y: 0.6 }] }),
    );
    print = await asAdmin(() => new BoletimController().print(id));
    assert.equal(print.idDocumentNumber, CC);
    assert.equal(print.snsNumber, '123456789');
    assert.equal(await reads(), 1);
    const [saved] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM boletim_template_field WHERE organization_id = $1 AND archived_at IS NULL`,
      [org],
    );
    assert.equal(saved!.n, 2, 'a save replaces the set');

    // QA 5: a new template drops the placements; removing it falls back.
    await asAdmin(async () => routes.set('socio_form', { fileId: await file('boletim_template') }));
    assert.deepEqual((await asAdmin(() => routes.read('socio_form'))).template!.fields, []);
    await asAdmin(() => routes.remove('socio_form'));
    assert.equal((await asAdmin(() => routes.read('socio_form'))).template, null);
    print = await asAdmin(() => new BoletimController().print(id));
    assert.equal(print.template, null);

    // The FPN declaration: its own fields, one template per version, each
    // reaching only its own print.
    const adult = await file('boletim_template');
    await asAdmin(() => routes.set('fpn_declaration', { fileId: adult }));
    await expectStatus(
      () => asAdmin(() => routes.place('fpn_declaration', { fields: [{ field: 'sns_number', x: 0.1, y: 0.1 }] })),
      400,
    );
    await asAdmin(() =>
      routes.place('fpn_declaration', {
        fields: [
          { field: 'signer_name', x: 0.2, y: 0.2 },
          { field: 'discipline_masters', x: 0.1, y: 0.5 },
        ],
      }),
    );
    await expectStatus(() => asAdmin(() => routes.read('curling')), 404);
    const docs = new StudentDocumentsController();
    const fpnAdult = await asAdmin(() => docs.print(id, undefined, undefined));
    assert.equal(fpnAdult.template?.fileId, adult);
    assert.deepEqual(fpnAdult.template?.fields.map((f) => f.field), ['signer_name', 'discipline_masters']);
    const fpnMinor = await asAdmin(() => docs.print(id, undefined, '1'));
    assert.equal(fpnMinor.template, null, "the minors' form has its own template, not yet uploaded");
    assert.equal((await asAdmin(() => routes.read('socio_form'))).template, null, 'the boletim is untouched');
  });
});
