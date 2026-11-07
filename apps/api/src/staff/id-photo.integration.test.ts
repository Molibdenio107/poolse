import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { Readable } from 'node:stream';
import { StaffController } from './staff.controller.js';
import { FilesController } from '../files/files.controller.js';
import { RetentionService } from '../retention/retention.service.js';
import { getObjectBytes } from '../files/storage.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * The photograph of a staff member's ID document — POOLSE-149 slice B, QA 4–6:
 * sealed at rest, read by the office and the person and nobody else, a read by
 * anybody but the person audited, a replaced or removed side shredded, and both
 * sides shredded by retention with the number.
 *
 * Against S3Mock (`docker compose up -d storage`) with SENSITIVE_DATA_KEY set.
 *
 * Run: pnpm api:test
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('Cartão de Cidadão — frente', 'utf8')]);
const PDF = Buffer.from('%PDF-1.4\nCartão de Cidadão — verso.\n%%EOF\n', 'utf8');

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

test('POOLSE-149 B — an ID photo is sealed, read by the office and the person, audited, and shredded when let go', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const colleague = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const staff = new StaffController();
    const files = new FilesController();
    const reads = async (): Promise<number> =>
      (
        await tenant.sql<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log WHERE action = 'membership.id_document_read' AND entity_id = $1`,
          [coach],
        )
      )[0]!.n;

    // An admin files the front; the person files the back of their own.
    const front = await actingAs(tenant, { roles: ['owner'] }, () => staff.fileIdPhoto(coach, 'front', 'cc-frente.jpg', JPEG));
    const back = await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, () =>
      staff.fileIdPhoto(coach, 'back', 'cc-verso.pdf', PDF),
    );

    // QA 4: ciphertext at rest, under a key of its own.
    const [row] = await tenant.sql<{ storage_key: string; wrapped_key: string | null }>(
      `SELECT storage_key, wrapped_key FROM stored_file WHERE id = $1`,
      [front.fileId],
    );
    assert.match(row!.wrapped_key ?? '', /^v1\./);
    assert.equal((await getObjectBytes(row!.storage_key)).includes('Cidadão', 0, 'utf8'), false);

    // The identity read carries both sides.
    const identity = await actingAs(tenant, { roles: ['owner'] }, () => staff.identity(coach));
    assert.equal(identity.photos.front?.fileId, front.fileId);
    assert.equal(identity.photos.back?.originalName, 'cc-verso.pdf');

    // The owner reads it, and that is on the record; the person's own read is not.
    const before = await reads();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.deepEqual(await bytesOf((await files.read(front.fileId)).getStream()), JPEG);
    });
    assert.equal(await reads(), before + 1);
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      assert.deepEqual(await bytesOf((await files.read(back.fileId)).getStream()), PDF);
    });
    assert.equal(await reads(), before + 1, 'the person looking at their own is not an audited read');

    // A colleague may neither read nor file nor remove it.
    await actingAs(tenant, { membershipId: colleague, roles: ['instructor'] }, async () => {
      await expectStatus(() => files.read(front.fileId), 403);
      await expectStatus(() => staff.fileIdPhoto(coach, 'front', 'x.jpg', JPEG), 403);
      await expectStatus(() => staff.removeIdPhoto(coach, 'front'), 403);
    });
    // Never through POST /files, and a side is front or back.
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => files.upload('staff_id_document', 'x.jpg', JPEG), 400);
      await expectStatus(() => staff.fileIdPhoto(coach, 'side', 'x.jpg', JPEG), 400);
    });

    // Replacing the front shreds the old one; removing the back shreds it.
    const replaced = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const again = await staff.fileIdPhoto(coach, 'front', 'cc-frente-2.jpg', JPEG);
      await staff.removeIdPhoto(coach, 'back');
      await expectStatus(() => staff.removeIdPhoto(coach, 'back'), 404);
      return again;
    });
    const shredded = await tenant.sql<{ id: string; wrapped_key: string | null; key_shredded_at: Date | null }>(
      `SELECT id, wrapped_key, key_shredded_at FROM stored_file WHERE id = ANY ($1::uuid[]) ORDER BY id`,
      [[front.fileId, back.fileId]],
    );
    for (const file of shredded) {
      assert.equal(file.wrapped_key, null);
      assert.ok(file.key_shredded_at !== null);
    }

    // QA 6: retention lets the front go with the number, shredded.
    await owner.query(`UPDATE membership SET archived_at = now() - interval '13 months' WHERE id = $1`, [coach]);
    await new RetentionService().run(tenant.organizationId);
    const [gone] = await tenant.sql<{ front: string | null; wrapped_key: string | null }>(
      `SELECT m.id_document_front_file_id AS front, f.wrapped_key
         FROM membership m, stored_file f WHERE m.id = $1 AND f.id = $2`,
      [coach, replaced.fileId],
    );
    assert.deepEqual(gone, { front: null, wrapped_key: null });
  });
});
