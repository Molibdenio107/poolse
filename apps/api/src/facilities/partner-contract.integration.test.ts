import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Readable } from 'node:stream';
import { PartnersController } from './partners.controller.js';
import { AttachmentsController } from '../files/attachments.controller.js';
import { FilesController } from '../files/files.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The signed contract on a partnership — POOLSE-105, QA 1–4 through the API.
 *
 * Against S3Mock (`docker compose up -d storage`), as the files test is.
 *
 * Run: pnpm api:test   (needs pnpm db:up, and the storage container)
 */

after(closeHarness);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
/** A ZIP whose first part is `word/document.xml` — what makes a .docx a .docx. */
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  Buffer.from('....word/document.xml<w:document/>', 'latin1'),
]);
/** The same shape, but a deck: `ppt/presentation.xml`. */
const PPTX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  Buffer.from('....ppt/presentation.xml<p:presentation/>', 'latin1'),
]);
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

async function aPartner(tenant: ScratchTenant): Promise<string> {
  return actingAs(tenant, { roles: ['owner'] }, async () =>
    (await new PartnersController().create(tenant.facilityId, { name: 'Escola Básica n.º 1', type: 'escola' })).id,
  );
}

async function file(purpose: string, name: string, bytes: Buffer): Promise<string> {
  return (await new FilesController().upload(purpose, name, bytes)).id;
}

test('QA 1 — a new partner with no terms takes the contract, and the agreement says its terms are pending', async () => {
  await withScratchTenant(async (tenant) => {
    const partnerId = await aPartner(tenant);
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const before = await new PartnersController().detail(partnerId);
      assert.equal(before.agreement, null);

      const fileId = await file('agreement_document', 'Protocolo assinado.pdf', PDF);
      await new AttachmentsController().agreementDocument(partnerId, { fileId });

      const after = await new PartnersController().detail(partnerId);
      assert.equal(after.agreement?.termsPending, true);
      assert.equal(after.agreement?.unitPrice, null);
      assert.equal(after.agreement?.documentFileId, fileId);
      assert.equal(after.contract?.originalName, 'Protocolo assinado.pdf');

      // Recording the terms fills that agreement in; the contract stays on it.
      await new PartnersController().recordAgreement(partnerId, {
        billingModel: 'por_hora_pista',
        startDate: '2026-09-01',
        unitPrice: '14.375',
      });
      const filled = await new PartnersController().detail(partnerId);
      assert.equal(filled.agreement?.id, after.agreement?.id, 'the same agreement, now with terms');
      assert.equal(filled.agreement?.termsPending, false);
      assert.equal(filled.agreement?.unitPrice, '14.375000');
      assert.equal(filled.contract?.fileId, fileId);
    });
  });
});

test('QA 2 — a .docx uploads and downloads as itself, by its name; a .pptx is refused, and Word is a contract only', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const files = new FilesController();
      const stored = await files.upload('agreement_document', 'Contrato Escola 2026.docx', DOCX);
      assert.equal(stored.contentType, WORD);

      const served = await files.read(stored.id);
      const headers = served.getHeaders();
      assert.equal(headers.type, WORD);
      assert.match(String(headers.disposition), /^attachment; filename\*=UTF-8''Contrato%20Escola%202026\.docx$/);
      assert.deepEqual(await bytesOf(served.getStream()), DOCX);

      // A PDF still opens in the browser.
      const pdf = await files.read((await files.upload('agreement_document', 'a.pdf', PDF)).id);
      assert.match(String(pdf.getHeaders().disposition), /^inline;/);

      await expectStatus(() => files.upload('agreement_document', 'Apresentação.pptx', PPTX), 400);
      await expectStatus(() => files.upload('policy_document', 'Apólice.docx', DOCX), 400);
      await expectStatus(() => files.upload('logo', 'logo.docx', DOCX), 400);
    });
  });
});

test('QA 3 — replacing the contract keeps the old one, listed with who replaced it and when', async () => {
  await withScratchTenant(async (tenant) => {
    const partnerId = await aPartner(tenant);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const attach = new AttachmentsController();
      const first = await file('agreement_document', 'Versão 1.pdf', PDF);
      await attach.agreementDocument(partnerId, { fileId: first });
      const second = await file('agreement_document', 'Versão 2.docx', DOCX);
      await attach.agreementDocument(partnerId, { fileId: second });

      const detail = await new PartnersController().detail(partnerId);
      assert.equal(detail.contract?.originalName, 'Versão 2.docx');
      assert.equal(detail.agreement?.previousContracts.length, 1);
      const old = detail.agreement!.previousContracts[0]!;
      assert.equal(old.fileId, first);
      assert.equal(old.originalName, 'Versão 1.pdf');
      assert.ok(old.replacedBy.length > 0, 'who replaced it is named');
      assert.ok(Date.parse(old.replacedAt) >= Date.parse(old.attachedAt));

      // The old file is still there to read.
      const served = await new FilesController().read(first);
      assert.deepEqual(await bytesOf(served.getStream()), PDF);
    });
  });
});

test('QA 4 — a coach downloads the contract and may neither upload nor replace it; a family is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const partnerId = await aPartner(tenant);
    const fileId = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const id = await file('agreement_document', 'Protocolo.pdf', PDF);
      await new AttachmentsController().agreementDocument(partnerId, { fileId: id });
      return id;
    });

    // Members of their own: the uploader may always read their own file, so the
    // owner's membership would prove nothing about the purpose's rule.
    const coach = await addMember(tenant, 'Rui', 'Treinador', ['instructor']);
    const parent = await addMember(tenant, 'Ana', 'Mãe', ['guardian']);

    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      const detail = await new PartnersController().detail(partnerId);
      assert.equal(detail.agreement, null, 'the typed terms and the history stay the office’s');
      assert.equal(detail.contract?.fileId, fileId, 'the contract itself is offered');
      const served = await new FilesController().read(fileId);
      assert.deepEqual(await bytesOf(served.getStream()), PDF);

      await expectStatus(() => new FilesController().upload('agreement_document', 'x.pdf', PDF), 403);
      await expectStatus(() => new AttachmentsController().agreementDocument(partnerId, { fileId }), 403);
      await expectStatus(() => new AttachmentsController().agreementDocument(partnerId, { fileId: null }), 403);
    });

    await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, () =>
      expectStatus(() => new FilesController().read(fileId), 403),
    );

    // Another club's partner takes no contract of ours.
    await withScratchTenant(async (other) => {
      await actingAs(other, { roles: ['owner'] }, () =>
        expectStatus(() => new AttachmentsController().agreementDocument(partnerId, { fileId: null }), 404),
      );
    });
  });
});
