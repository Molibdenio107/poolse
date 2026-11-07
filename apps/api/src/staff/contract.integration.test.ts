import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Readable } from 'node:stream';
import { StaffController } from './staff.controller.js';
import { FilesController } from '../files/files.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A staff member's contract — POOLSE-149 slice C, QA 8–10: versions kept, the
 * facts held together, the Owner's absent for an Admin (read, write and file),
 * the person reading their own, nobody else reading any, and an Admin not
 * filing their own.
 *
 * Against S3Mock (`docker compose up -d storage`).
 *
 * Run: pnpm api:test
 */

after(closeHarness);

const PDF = Buffer.from('%PDF-1.4\nContrato de trabalho.\n%%EOF\n', 'utf8');
// A .docx is a ZIP holding word/document.xml, which is what the sniffer looks for.
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(26),
  Buffer.from('[Content_Types].xml', 'utf8'),
  Buffer.from('word/document.xml', 'utf8'),
]);

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

test('POOLSE-149 C — a contract keeps its versions and facts, and follows the pay rule', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const colleague = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const admin = await addMember(tenant, 'Rita', 'Secretaria', ['admin']);
    const staff = new StaffController();
    const files = new FilesController();

    // The owner files a contract twice and sets its facts.
    const first = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const one = await staff.fileContract(coach, 'contrato-2025.pdf', PDF);
      await staff.fileContract(coach, 'contrato-2026.pdf', PDF);
      // QA 10: a fixed term needs its end; an end before the start is refused.
      await expectStatus(() => staff.editContract(coach, { kind: 'fixed_term', startsOn: '2026-09-01' }), 400);
      await expectStatus(
        () => staff.editContract(coach, { kind: 'fixed_term', startsOn: '2026-09-01', endsOn: '2026-08-01' }),
        400,
      );
      await expectStatus(() => staff.editContract(coach, { kind: 'open_ended', endsOn: '2027-01-01' }), 400);
      const saved = await staff.editContract(coach, { kind: 'fixed_term', startsOn: '2026-09-01', endsOn: '2027-08-31' });
      assert.deepEqual(saved.facts, { kind: 'fixed_term', startsOn: '2026-09-01', endsOn: '2027-08-31' });
      // QA 9: the current file and the earlier one, each downloadable.
      assert.equal(saved.current?.originalName, 'contrato-2026.pdf');
      assert.equal(saved.history.length, 1);
      assert.equal(saved.history[0]!.originalName, 'contrato-2025.pdf');
      assert.deepEqual(await bytesOf((await files.read(one.fileId)).getStream()), PDF);
      return one;
    });

    // The facts are named in the log, never valued.
    const [entry] = await tenant.sql<{ data: { withheld: string[] } }>(
      `SELECT data FROM audit_log WHERE action = 'staff.contract_updated' AND entity_id = $1`,
      [coach],
    );
    assert.deepEqual(entry!.data.withheld.sort(), ['endsOn', 'kind', 'startsOn']);

    // The person reads their own, and the file; writes nothing.
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      const own = await staff.contract(coach);
      assert.equal(own.facts?.kind, 'fixed_term');
      await bytesOf((await files.read(first.fileId)).getStream());
      await expectStatus(() => staff.editContract(coach, { kind: 'open_ended' }), 403);
      await expectStatus(() => staff.fileContract(coach, 'x.pdf', PDF), 403);
    });

    // A colleague reads none of it.
    await actingAs(tenant, { membershipId: colleague, roles: ['instructor'] }, async () => {
      await expectStatus(() => staff.contract(coach), 403);
      await expectStatus(() => files.read(first.fileId), 403);
    });

    // QA 8: the Owner's contract is absent for an Admin — read, write and file.
    const ownerFile = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const filed = await staff.fileContract(tenant.ownerMembershipId, 'contrato-dono.docx', DOCX);
      // A Word contract is a download.
      const served = await files.read(filed.fileId);
      assert.match(String(served.getHeaders().disposition), /^attachment/);
      return filed;
    });
    await actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () => {
      await expectStatus(() => staff.contract(tenant.ownerMembershipId), 404);
      await expectStatus(() => staff.editContract(tenant.ownerMembershipId, { kind: 'services' }), 403);
      await expectStatus(() => staff.fileContract(tenant.ownerMembershipId, 'x.pdf', PDF), 403);
      await expectStatus(() => staff.removeContract(tenant.ownerMembershipId), 403);
      await expectStatus(() => files.read(ownerFile.fileId), 403);
      // Nor their own: the Owner files an Admin's contract.
      await expectStatus(() => staff.fileContract(admin, 'x.pdf', PDF), 403);
    });

    // Removing keeps the file in the history.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await staff.removeContract(coach);
      const after = await staff.contract(coach);
      assert.equal(after.current, null);
      assert.equal(after.history.length, 2);
      await expectStatus(() => staff.removeContract(coach), 404);
    });
  });
});
