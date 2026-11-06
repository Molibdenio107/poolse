import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../app/app.controller.js';
import { StudentDocumentsController } from './documents.controller.js';
import { completeFpnForm } from '../test/fpn-fixture.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-193 slice B — the FPN form is checked before it is taken, and nobody signs
 * an incomplete one.
 *
 * Run: pnpm api:test   (needs pnpm db:up and storage, as every upload test does)
 */

after(closeHarness);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function seed(tenant: ScratchTenant): Promise<{ child: string; guardian: string; ownLogin: string }> {
  const org = tenant.organizationId;
  const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const ownLogin = await addMember(tenant, 'Alice', 'Silva', ['student']);
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
     VALUES ($1, 'Alice', 'Silva', club_today() - interval '10 years', $2) RETURNING id`,
    [org, ownLogin],
  );
  const child = row!.id;
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
  return { child, guardian, ownLogin };
}

test('with data missing the review says what, and neither the form nor the sending is taken', async () => {
  await withScratchTenant(async (tenant) => {
    const { child, guardian } = await seed(tenant);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const review = await new AppController().fpnReview(child);
      assert.ok(review.missing.includes('addressLine'));
      assert.ok(review.missing.includes('fpnClubCode'));
      assert.equal(review.canSend, false);

      const { children } = await new AppController().documents(child);
      const row = children[0]!.documents.find((one) => one.kind === 'fpn_declaration')!;
      assert.equal(row.incomplete, true);
      assert.equal(row.canSend, false);

      // Straight to the routes: hiding a button is not the control (QA 6).
      await expectStatus(() => new StudentDocumentsController().print(child), 409);
      await expectStatus(() => new AppController().sendDocument('fpn_declaration', child, 'f.pdf', undefined, PDF), 409);
    });
  });
});

test('complete, the review shows the number in full, audited, and the form can be taken and sent', async () => {
  await withScratchTenant(async (tenant) => {
    const { child, guardian } = await seed(tenant);
    await completeFpnForm(tenant, child);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const review = await new AppController().fpnReview(child);
      assert.deepEqual(review.missing, []);
      assert.equal(review.idDocumentNumber, '12345678');
      assert.equal(review.canSend, true);
      assert.equal((await new StudentDocumentsController().print(child)).idDocumentNumber, '12345678');
      await new AppController().sendDocument('fpn_declaration', child, 'f.pdf', undefined, PDF);
      assert.equal((await new AppController().fpnReview(child)).status, 'sent');
    });
    const reads = await tenant.sql(
      `SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'student.id_document_read'`,
      [child],
    );
    assert.ok(reads.length >= 2, 'each read of the number is on the record');
  });
});

test('a minor’s own login does not take the form; the review is not theirs either (QA 13)', async () => {
  await withScratchTenant(async (tenant) => {
    const { child, ownLogin } = await seed(tenant);
    await completeFpnForm(tenant, child);
    await actingAs(tenant, { membershipId: ownLogin, roles: ['student'] }, async () => {
      await expectStatus(() => new AppController().fpnReview(child), 403);
      await expectStatus(() => new StudentDocumentsController().print(child), 403);
      const { children } = await new AppController().documents(child);
      assert.equal(children[0]!.documents.find((one) => one.kind === 'fpn_declaration')!.print, null);
    });
  });
});

test('another family’s child and another club are a 404; the office’s desk path is untouched (QA 14, 15)', async () => {
  await withScratchTenant(async (tenant) => {
    const { child } = await seed(tenant);
    const other = await addMember(tenant, 'Rita', 'Costa', ['guardian']);
    await actingAs(tenant, { membershipId: other, roles: ['guardian'] }, () =>
      expectStatus(() => new AppController().fpnReview(child), 404),
    );
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new AppController().fpnReview(child), 403),
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Incomplete, and the office may still print for the desk.
      assert.equal((await new StudentDocumentsController().print(child)).studentName.includes('Alice'), true);
    });
    await withScratchTenant(async (club) => {
      const theirs = await addMember(club, 'Rita', 'Costa', ['guardian']);
      await actingAs(club, { membershipId: theirs, roles: ['guardian'] }, () =>
        expectStatus(() => new AppController().fpnReview(child), 404),
      );
    });
  });
});

test('the person corrects their details, named in the log, and the download opens (QA 7, 8)', async () => {
  await withScratchTenant(async (tenant) => {
    const { child, guardian } = await seed(tenant);
    await completeFpnForm(tenant, child);
    await tenant.sql(`UPDATE student SET address_line = NULL, fpn_disciplines = '{}' WHERE id = $1`, [child]);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const app = new AppController();
      assert.ok((await app.fpnReview(child)).missing.includes('addressLine'));

      await expectStatus(() => app.saveFpnDetails(child, { postalCode: '123' }), 400);
      await expectStatus(() => app.saveFpnDetails(child, { idDocumentType: 'cc', idDocumentNumber: '999' }), 400);
      await expectStatus(() => app.saveFpnDetails(child, { disciplines: ['chess'] }), 400);

      await app.saveFpnDetails(child, {
        addressLine: 'Rua Nova 2',
        locality: 'Braga',
        postalCode: '4700-001',
        idDocumentType: 'other',
        idDocumentNumber: 'AB123',
        idDocumentValidUntil: '2099-01-01',
        disciplines: ['pura', 'masters'],
      });
      const review = await app.fpnReview(child);
      assert.deepEqual(review.missing, []);
      assert.equal(review.addressLine, 'Rua Nova 2');
      assert.equal(review.idDocumentNumber, 'AB123');
      assert.deepEqual([...review.disciplines].sort(), ['masters', 'pura']);
      await new StudentDocumentsController().print(child);
    });
    const [entry] = await tenant.sql<{ actor: string; data: string }>(
      `SELECT actor_membership_id AS actor, data::text AS data FROM audit_log
        WHERE entity_id = $1 AND action = 'student.updated' ORDER BY created_at DESC LIMIT 1`,
      [child],
    );
    assert.equal(entry!.actor, guardian);
    assert.ok(entry!.data.includes('addressLine'));
    assert.equal(entry!.data.includes('Rua Nova'), false, 'named, never valued');
    assert.equal(entry!.data.includes('AB123'), false);
  });
});

test('a body cannot clear the number, and a signed copy waiting locks the details (QA 9)', async () => {
  await withScratchTenant(async (tenant) => {
    const { child, guardian } = await seed(tenant);
    await completeFpnForm(tenant, child);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      const app = new AppController();
      await app.saveFpnDetails(child, {
        idDocumentType: 'other',
        idDocumentNumber: '',
        idDocumentClear: true,
        idDocumentValidUntil: '2099-01-01',
      });
      assert.equal((await app.fpnReview(child)).idDocumentNumber, '12345678', 'the number on file stays');
      assert.equal((await app.fpnReview(child)).locality, 'Porto', 'an address not sent stays');
      await expectStatus(() => app.saveFpnDetails(child, { addressLine: 'So isto' }), 400);
      await app.sendDocument('fpn_declaration', child, 'f.pdf', undefined, PDF);
      await expectStatus(() => app.saveFpnDetails(child, { addressLine: 'Outra' }), 409);
    });
  });
});

test('a minor’s own login, another family and the office’s roles cannot use the family’s route', async () => {
  await withScratchTenant(async (tenant) => {
    const { child, ownLogin } = await seed(tenant);
    const other = await addMember(tenant, 'Rita', 'Costa', ['guardian']);
    const body = { addressLine: 'X' };
    await actingAs(tenant, { membershipId: ownLogin, roles: ['student'] }, () =>
      expectStatus(() => new AppController().saveFpnDetails(child, body), 403),
    );
    await actingAs(tenant, { membershipId: other, roles: ['guardian'] }, () =>
      expectStatus(() => new AppController().saveFpnDetails(child, body), 404),
    );
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new AppController().saveFpnDetails(child, body), 403),
    );
  });
});
