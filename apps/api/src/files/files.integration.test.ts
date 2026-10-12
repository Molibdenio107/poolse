import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Readable } from 'node:stream';
import { InsurancePoliciesController } from '../billing/insurance.controller.js';
import { AttachmentsController } from './attachments.controller.js';
import { FilesController } from './files.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * File storage — 12 October 2026.
 *
 * Against S3Mock (`docker compose up -d storage`), the same protocol R2 speaks.
 * The properties worth the most:
 *
 * **A file is what its bytes say.** The name and the browser's type are never
 * trusted; an executable called `apolice.pdf` is refused.
 *
 * **Reading is the purpose's rule.** An instructor sees a site's photographs and
 * not the club's apólice; a family sees the logo and nothing else.
 *
 * **Another club's file is no file at all** — to read, and to attach.
 *
 * Run: pnpm api:test   (needs pnpm db:up, and the storage container)
 */

after(closeHarness);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not really an image, but it starts like one'),
]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1');

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

async function asOwner<T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> {
  return actingAs(tenant, { roles: ['owner'] }, fn);
}

async function upload(purpose: string, bytes: Buffer, name = 'ficheiro'): Promise<string> {
  return (await new FilesController().upload(purpose, name, bytes)).id;
}

test('an apólice is filed with its document, and the document comes back byte for byte', async () => {
  await withScratchTenant(async (tenant) => {
    await asOwner(tenant, async () => {
      const policies = new InsurancePoliciesController();
      const { id: policyId } = await policies.create(tenant.facilityId, {
        insurer: 'Fidelidade',
        policyNumber: 'AP-1',
        validFrom: '2026-09-01',
        validTo: '2027-08-31',
        costPerPersonCents: 850,
      });

      const stored = await new FilesController().upload('policy_document', 'Apólice 2026.pdf', PDF);
      assert.equal(stored.contentType, 'application/pdf');
      assert.equal(stored.originalName, 'Apólice 2026.pdf');
      assert.equal(stored.byteSize, PDF.length);

      await new AttachmentsController().policyDocument(tenant.facilityId, policyId, { fileId: stored.id });
      const { policies: list } = await policies.list(tenant.facilityId);
      assert.equal(list[0]?.documentFileId, stored.id);

      const file = await new FilesController().read(stored.id);
      assert.deepEqual(await bytesOf(file.getStream()), PDF);
      assert.equal(file.getHeaders().type, 'application/pdf');

      // The audit trail records the upload — its size and purpose, never the bytes.
      const [audit] = await tenant.sql<{ data: { purpose: string } }>(
        `SELECT data FROM audit_log WHERE action = 'file.uploaded' AND entity_id = $1`,
        [stored.id],
      );
      assert.equal(audit?.data.purpose, 'policy_document');

      // And it can be taken off again.
      await new AttachmentsController().policyDocument(tenant.facilityId, policyId, { fileId: null });
      assert.equal((await policies.list(tenant.facilityId)).policies[0]?.documentFileId, null);
    });
  });
});

test('a file is judged by its bytes: an executable named .pdf, an empty body and a PDF photograph are refused', async () => {
  await withScratchTenant(async (tenant) => {
    await asOwner(tenant, async () => {
      await expectStatus(() => upload('policy_document', EXE, 'apolice.pdf'), 400);
      await expectStatus(() => upload('policy_document', Buffer.alloc(0)), 400);
      await expectStatus(() => upload('facility_photo', PDF), 400);
      await expectStatus(() => upload('not_a_purpose', PDF), 400);
      // Named in the enum, switched on in a later slice (photo consent).
      await expectStatus(() => upload('student_photo', PNG), 400);
      await expectStatus(() => upload('policy_document', Buffer.alloc(10 * 1024 * 1024 + 1, 0x25)), 400);

      const [{ count } = { count: -1 }] = await tenant.sql<{ count: number }>(
        'SELECT count(*)::int AS count FROM stored_file',
      );
      assert.equal(count, 0);
    });
  });
});

test('who reads a file is decided by what it is for', async () => {
  await withScratchTenant(async (tenant) => {
    const { policyDoc, photo, logo } = await asOwner(tenant, async () => ({
      policyDoc: await upload('policy_document', PDF),
      photo: await upload('facility_photo', PNG),
      logo: await upload('logo', PNG),
    }));

    const instructor = await addMember(tenant, 'Ana', 'Instrutora', ['instructor']);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      // The office's paperwork is the office's.
      await expectStatus(() => new FilesController().read(policyDoc), 403);
      // The site's photographs and the logo are everybody's on the staff.
      await new FilesController().read(photo);
      await new FilesController().read(logo);
      // And writing is the office's.
      await expectStatus(() => upload('facility_photo', PNG), 403);
    });

    const guardian = await addMember(tenant, 'Rita', 'Mãe', ['guardian']);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, async () => {
      await new FilesController().read(logo);
      await expectStatus(() => new FilesController().read(photo), 403);
      await expectStatus(() => new FilesController().read(policyDoc), 403);
    });
  });
});

test("another club's file is no file: unreadable, and refused as an attachment", async () => {
  await withScratchTenant(async (theirs) => {
    const theirFile = await asOwner(theirs, () => upload('facility_photo', PNG));

    await withScratchTenant(async (ours) => {
      await asOwner(ours, async () => {
        await expectStatus(() => new FilesController().read(theirFile), 404);
        await expectStatus(
          () => new AttachmentsController().addFacilityPhoto(ours.facilityId, { fileId: theirFile }),
          400,
        );
      });
    });
  });
});

test('a file attaches only as what it was uploaded for', async () => {
  await withScratchTenant(async (tenant) => {
    await asOwner(tenant, async () => {
      const logo = await upload('logo', PNG);
      // A logo is not a site photograph.
      await expectStatus(
        () => new AttachmentsController().addFacilityPhoto(tenant.facilityId, { fileId: logo }),
        400,
      );

      await new AttachmentsController().setLogo({ fileId: logo });
      assert.equal((await new AttachmentsController().logo()).fileId, logo);
    });
  });
});

test('a site photograph joins the gallery and leaves it, and the file stays on record', async () => {
  await withScratchTenant(async (tenant) => {
    await asOwner(tenant, async () => {
      const fileId = await upload('facility_photo', PNG);
      const attachments = new AttachmentsController();
      const { id } = await attachments.addFacilityPhoto(tenant.facilityId, { fileId, caption: 'Entrada' });

      const [live] = await tenant.sql<{ caption: string }>(
        'SELECT caption FROM facility_photo WHERE id = $1 AND archived_at IS NULL',
        [id],
      );
      assert.equal(live?.caption, 'Entrada');

      await attachments.removeFacilityPhoto(tenant.facilityId, id);
      const gone = await tenant.sql('SELECT 1 FROM facility_photo WHERE id = $1 AND archived_at IS NULL', [id]);
      assert.equal(gone.length, 0);
      // Soft-deleted: the object and its row are history, not rubbish.
      const kept = await tenant.sql('SELECT 1 FROM stored_file WHERE id = $1 AND archived_at IS NULL', [fileId]);
      assert.equal(kept.length, 1);
    });
  });
});

test('a certificate is attached once, and the person it certifies may read it', async () => {
  await withScratchTenant(async (tenant) => {
    const instructor = await addMember(tenant, 'Nuno', 'Nadador', ['instructor']);
    const [type] = await tenant.sql<{ id: string }>(
      `INSERT INTO qualification_type (organization_id, name) VALUES ($1, 'Nadador-salvador') RETURNING id`,
      [tenant.organizationId],
    );
    const [record] = await tenant.sql<{ id: string }>(
      `INSERT INTO qualification (organization_id, membership_id, qualification_type_id, issued_on, expires_on)
       VALUES ($1, $2, $3, '2026-01-01', '2028-01-01') RETURNING id`,
      [tenant.organizationId, instructor, type!.id],
    );

    const certificate = await asOwner(tenant, async () => {
      const first = await upload('qualification_document', PDF);
      await new AttachmentsController().qualificationDocument(record!.id, { fileId: first });

      // A second scan is a second record, never a swap under the first.
      const second = await upload('qualification_document', PDF);
      await expectStatus(
        () => new AttachmentsController().qualificationDocument(record!.id, { fileId: second }),
        409,
      );
      return first;
    });

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      const file = await new FilesController().read(certificate);
      assert.deepEqual(await bytesOf(file.getStream()), PDF);
    });

    const colleague = await addMember(tenant, 'Outro', 'Colega', ['instructor']);
    await actingAs(tenant, { membershipId: colleague, roles: ['instructor'] }, async () => {
      await expectStatus(() => new FilesController().read(certificate), 403);
    });
  });
});
