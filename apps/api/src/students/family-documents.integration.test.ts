import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../app/app.controller.js';
import { BoletimController, StudentDocumentsController } from './documents.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-179, slice 1 — a family's *Documentos*: a status per paper, filtered by
 * the child's sports, and the club's filled forms for its own child only.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  guardian: string;
  child: string;
  stranger: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET tax_number = '123456789' WHERE id = $1`, [guardian]);
  const student = async (first: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, sns_number)
       VALUES ($1, $2, 'Silva', club_today() - interval '10 years', '123456789') RETURNING id`,
      [org, first],
    );
    return row!.id;
  };
  const child = await student('Alice');
  const stranger = await student('Bruna');
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, child, guardian],
  );
  return { guardian, child, stranger };
}

async function enrol(tenant: ScratchTenant, student: string, name: string): Promise<string> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, name],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 10)`,
    [tenant.organizationId, group!.id, student],
  );
  return group!.id;
}

const asGuardian = <T>(tenant: ScratchTenant, family: Family, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: family.guardian, roles: ['guardian'] }, fn);

test('a swimmer’s list has the FPN declaration, and says what is missing (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await enrol(tenant, family.child, 'Golfinhos');
    const { children } = await asGuardian(tenant, family, () => new AppController().documents());
    const rows = children[0]!.documents;
    assert.deepEqual(rows.map((one) => one.kind), ['fpn_declaration', 'socio_form', 'id_document', 'medical_exam']);
    for (const row of rows) assert.equal(row.status, 'missing');
  });
});

test('with no form set up the line says so, and nothing prints (QA 2)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await enrol(tenant, family.child, 'Golfinhos');
    const { children } = await asGuardian(tenant, family, () => new AppController().documents());
    const fpn = children[0]!.documents.find((one) => one.kind === 'fpn_declaration')!;
    assert.equal(fpn.notConfigured, true);
    assert.equal(fpn.print, null);
  });
});

test('the list holds no number, no file and nobody’s name', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await tenant.sql(`UPDATE student SET id_document_valid_until = club_today() + 100 WHERE id = $1`, [family.child]);
    const answer = await asGuardian(tenant, family, () => new AppController().documents());
    const raw = JSON.stringify(answer);
    assert.doesNotMatch(raw, /fileId|123456789/);
  });
});

test('a family reads its own child’s form with no SNS number, and the print is on the record', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const form = await asGuardian(tenant, family, () => new BoletimController().print(family.child));
    assert.match(form.name, /Alice/);
    assert.equal(form.snsNumber, null, 'the SNS number is the office’s');

    const [entry] = await tenant.sql<{ data: { kind: string }; actor_membership_id: string }>(
      `SELECT data, actor_membership_id FROM audit_log
        WHERE entity_id = $1 AND action = 'student.document_printed'`,
      [family.child],
    );
    assert.equal(entry!.data.kind, 'boletim');
    assert.equal(entry!.actor_membership_id, family.guardian);
  });
});

test('another family’s child is a 404 on the list and both forms, and staff are refused (QA 7)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await asGuardian(tenant, family, async () => {
      await expectStatus(() => new AppController().documents(family.stranger), 404);
      await expectStatus(() => new BoletimController().print(family.stranger), 404);
      await expectStatus(() => new StudentDocumentsController().print(family.stranger), 404);
    });
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(() => new AppController().documents(), 403);
      await expectStatus(() => new BoletimController().print(family.child), 403);
    });
  });
});

test('the office prints as it did, the SNS number included where the form places it', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    const form = await actingAs(tenant, { roles: ['owner'] }, () => new BoletimController().print(family.child));
    assert.match(form.name, /Alice/);
    const entries = await tenant.sql(`SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'student.document_printed'`, [family.child]);
    assert.equal(entries.length, 0, 'an office print is not a family print');
  });
});
