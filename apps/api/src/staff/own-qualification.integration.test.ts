import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { QualificationsController } from './qualifications.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * A teacher sends their own qualification from the phone, and the office confirms
 * it (Rui, 07-11-2026). Until then it counts for nothing.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

async function sbv(tenant: ScratchTenant): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `SELECT id FROM qualification_type WHERE name LIKE 'SBV%' AND archived_at IS NULL`,
  );
  return row!.id;
}

async function certificate(tenant: ScratchTenant, uploadedBy: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
     VALUES ($1::uuid, 'qualification_document', $1::text || '/e2e/' || gen_random_uuid(), 'application/pdf', 10, 'sbv.pdf', $2)
     RETURNING id`,
    [tenant.organizationId, uploadedBy],
  );
  return row!.id;
}

test('a teacher sends their own, it waits, and the office makes it count', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const typeId = await sbv(tenant);
    const scan = await certificate(tenant, ana);
    const qualifications = new QualificationsController();

    const id = await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      const { id: sent } = await qualifications.add(ana, { typeId, issuingBody: 'INEM', expiresOn: '2030-01-01', fileId: scan });
      const mine = await qualifications.person(ana);
      assert.equal(mine.history[0]!.pending, true);
      assert.equal(mine.history[0]!.documentFileId, scan);
      // It changes no standing while it waits.
      assert.equal(mine.standings.some((one) => one.qualificationId === sent), false);
      assert.ok(mine.types.some((one) => one.id === typeId));
      // Only the office confirms.
      await expectStatus(() => qualifications.confirm(sent), 403);
      return sent;
    });

    await actingAs(tenant, { roles: ['admin'] }, async () => {
      assert.deepEqual(await qualifications.confirm(id), { confirmed: true });
      await expectStatus(() => qualifications.confirm(id), 404);
      const now = await qualifications.person(ana);
      assert.equal(now.history[0]!.pending, false);
      assert.equal(now.standings.find((one) => one.qualificationId === id)?.status, 'green');
    });

    // An office filing counts at once, as before.
    const filed = await actingAs(tenant, { roles: ['owner'] }, () =>
      qualifications.add(ana, { typeId, issuingBody: 'INEM', expiresOn: '2031-01-01' }),
    );
    const [row] = await tenant.sql<{ confirmed: boolean }>(
      `SELECT confirmed_at IS NOT NULL AS confirmed FROM qualification WHERE id = $1`,
      [filed.id],
    );
    assert.equal(row!.confirmed, true);
  });
});

test('nobody sends for somebody else, or with a file that is not theirs', async () => {
  await withScratchTenant(async (tenant) => {
    const ana = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const bruno = await addMember(tenant, 'Bruno', 'Carvalho', ['instructor']);
    const typeId = await sbv(tenant);
    const brunosScan = await certificate(tenant, bruno);
    const qualifications = new QualificationsController();

    await actingAs(tenant, { membershipId: ana, roles: ['instructor'] }, async () => {
      await expectStatus(() => qualifications.add(bruno, { typeId }), 403);
      await expectStatus(() => qualifications.add(ana, { typeId, fileId: brunosScan }), 400);
    });
    for (const role of ['guardian', 'student'] as const) {
      await actingAs(tenant, { roles: [role] }, () => expectStatus(() => qualifications.add(ana, { typeId }), 403));
    }
    await withScratchTenant(async (away) => {
      const eva = await addMember(away, 'Eva', 'Fora', ['admin']);
      const [sent] = await tenant.sql<{ id: string }>(
        `INSERT INTO qualification (organization_id, membership_id, qualification_type_id, created_by_membership_id, confirmed_at)
         VALUES ($1, $2, $3, $2, NULL) RETURNING id`,
        [tenant.organizationId, ana, typeId],
      );
      await actingAs(away, { membershipId: eva, roles: ['admin'] }, () => expectStatus(() => qualifications.confirm(sent!.id), 404));
    });
  });
});
