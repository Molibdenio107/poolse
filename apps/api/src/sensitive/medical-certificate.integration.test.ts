import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Readable } from 'node:stream';
import { SensitiveController } from './sensitive.controller.js';
import { FilesController } from '../files/files.controller.js';
import { AppController } from '../app/app.controller.js';
import { getObjectBytes } from '../files/storage.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Saúde e consentimentos — POOLSE-109, QA 1–4 through the API.
 *
 * Against S3Mock (`docker compose up -d storage`), as the files test is, and
 * with SENSITIVE_DATA_KEY set (the envelope refuses to seal without it).
 *
 * Run: pnpm api:test
 */

after(closeHarness);

const PDF = Buffer.from('%PDF-1.4\nAtestado: dispensado da natação.\n%%EOF\n', 'utf8');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fotografia do atestado', 'utf8'),
]);

async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

interface Club {
  admin: string;
  coach: string;
  mother: string;
  otherParent: string;
  stranger: string;
  child: string;
  otherChild: string;
  leave: string;
  otherLeave: string;
}

async function aClub(tenant: ScratchTenant): Promise<Club> {
  const org = tenant.organizationId;
  const admin = await addMember(tenant, 'Rita', 'Receção', ['admin']);
  const coach = await addMember(tenant, 'Rui', 'Treinador', ['instructor']);
  const mother = await addMember(tenant, 'Ana', 'Mãe', ['guardian']);
  const otherParent = await addMember(tenant, 'Paulo', 'Pai', ['guardian']);
  const stranger = await addMember(tenant, 'Sem', 'Filhos', ['guardian']);
  const [child] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Alice', 'Silva') RETURNING id`,
    [org],
  );
  const [otherChild] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Bruno', 'Costa') RETURNING id`,
    [org],
  );
  for (const [student, guardian] of [
    [child!.id, mother],
    [otherChild!.id, otherParent],
  ] as const) {
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Encarregado', true)`,
      [org, student, guardian],
    );
  }
  const leaveOf = async (student: string): Promise<string> =>
    actingAs(tenant, { membershipId: admin, roles: ['admin'] }, async () =>
      (
        await new SensitiveController().addLeave(student, {
          startsOn: '2026-10-01',
          endsOn: '2026-11-15',
          reason: 'Lesão no ombro',
        })
      ).id,
    );
  return {
    admin,
    coach,
    mother,
    otherParent,
    stranger,
    child: child!.id,
    otherChild: otherChild!.id,
    leave: await leaveOf(child!.id),
    otherLeave: await leaveOf(otherChild!.id),
  };
}

test('QA 1 — the emergency contact is found by name, with roles, and the saved record names the person and their phone', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    const marta = await addMember(tenant, 'Marta', 'Sousa', ['guardian']);
    const mario = await addMember(tenant, 'Mário', 'Lopes', ['instructor', 'maintenance']);
    await addMember(tenant, 'Joana', 'Pires', ['guardian']);
    await tenant.sql(`UPDATE membership SET phone = '912 000 111' WHERE id = $1`, [marta]);

    await actingAs(tenant, { membershipId: club.admin, roles: ['admin'] }, async () => {
      const sensitive = new SensitiveController();
      const found = (await sensitive.candidates(club.child, 'mar')).people;
      const names = found.map((person) => person.name);
      assert.ok(names.includes('Marta Sousa'));
      assert.ok(names.includes('Mário Lopes'), 'accents aside');
      assert.ok(!names.includes('Joana Pires'));
      assert.deepEqual(found.find((person) => person.id === mario)?.roles, ['instructor', 'maintenance']);
      assert.deepEqual((await sensitive.candidates(club.child, 'm')).people, [], 'two letters before anything is asked');

      await sensitive.setEmergencyContact(club.child, { membershipId: marta, relationship: 'Tia' });
      const seen = await sensitive.read(club.child);
      assert.equal(seen.emergencyContact?.name, 'Marta Sousa');
      assert.equal(seen.emergencyContact?.phone, '912 000 111');
    });

    // An instructor reads the notes and may not search the club's people.
    await actingAs(tenant, { membershipId: club.coach, roles: ['instructor'] }, () =>
      expectStatus(() => new SensitiveController().candidates(club.child, 'mar'), 403),
    );
  });
});

test('QA 2 — reception files a PDF atestado: sealed at rest, read by the office, the coach told and refused', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    const { fileId } = await actingAs(tenant, { membershipId: club.admin, roles: ['admin'] }, () =>
      new SensitiveController().attachCertificate(club.child, club.leave, 'Atestado Alice.pdf', PDF),
    );

    // At rest: ciphertext, under a key of its own.
    const [row] = await tenant.sql<{ storage_key: string; wrapped_key: string | null; content_type: string }>(
      `SELECT storage_key, wrapped_key, content_type FROM stored_file WHERE id = $1`,
      [fileId],
    );
    assert.equal(row!.content_type, 'application/pdf');
    assert.match(row!.wrapped_key ?? '', /^v1\./);
    const atRest = await getObjectBytes(row!.storage_key);
    assert.equal(atRest.includes('%PDF', 0, 'latin1'), false, 'the bucket holds no readable PDF');
    assert.equal(atRest.includes('natação', 0, 'utf8'), false);

    for (const [membershipId, roles] of [
      [club.admin, ['admin']],
      [tenant.ownerMembershipId, ['owner']],
    ] as const) {
      await actingAs(tenant, { membershipId, roles: [...roles] }, async () => {
        const served = await new FilesController().read(fileId);
        assert.deepEqual(await bytesOf(served.getStream()), PDF);
        assert.match(String(served.getHeaders().disposition), /Atestado%20Alice\.pdf/);
        const leave = (await new SensitiveController().read(club.child)).medicalLeave[0]!;
        assert.equal(leave.certificate?.file?.fileId, fileId);
      });
    }

    await actingAs(tenant, { membershipId: club.coach, roles: ['instructor'] }, async () => {
      const leave = (await new SensitiveController().read(club.child)).medicalLeave[0]!;
      assert.ok(leave.certificate !== null, 'atestado anexado');
      assert.ok(Date.parse(leave.certificate.attachedAt) > 0, 'and when');
      assert.equal(leave.certificate.file, null, 'never the file, nor its name');
      assert.deepEqual(leave.previousCertificates, []);
      assert.equal(leave.startsOn, '2026-10-01');
      await expectStatus(() => new FilesController().read(fileId), 403);
      await expectStatus(
        () => new SensitiveController().attachCertificate(club.child, club.leave, 'x.pdf', PDF),
        403,
      );
      await expectStatus(() => new SensitiveController().detachCertificate(club.child, club.leave), 403);
    });

    // Replacing keeps the first one, listed for the office.
    await actingAs(tenant, { membershipId: club.admin, roles: ['admin'] }, async () => {
      await new SensitiveController().attachCertificate(club.child, club.leave, 'Atestado novo.png', PNG);
      const leave = (await new SensitiveController().read(club.child)).medicalLeave[0]!;
      assert.equal(leave.certificate?.file?.originalName, 'Atestado novo.png');
      assert.equal(leave.previousCertificates.length, 1);
      assert.equal(leave.previousCertificates[0]!.fileId, fileId);
      assert.ok(leave.previousCertificates[0]!.replacedBy.includes('Rita'));

      // A Word file or a stranger's leave is refused; the office may take it off.
      await expectStatus(
        () => new SensitiveController().attachCertificate(club.child, club.otherLeave, 'x.pdf', PDF),
        404,
      );
      await new SensitiveController().detachCertificate(club.child, club.leave);
      const after = (await new SensitiveController().read(club.child)).medicalLeave[0]!;
      assert.equal(after.certificate, null);
      assert.equal(after.previousCertificates.length, 2);
    });
  });
});

test('QA 3 — a guardian files the atestado for their own child, and nobody else’s', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    const { fileId } = await actingAs(tenant, { membershipId: club.mother, roles: ['guardian'] }, async () => {
      const attached = await new SensitiveController().attachCertificate(club.child, club.leave, 'atestado.pdf', PDF);
      const { leaves } = await new AppController().medicalLeave();
      assert.equal(leaves.length, 1, 'only her own child’s leave');
      assert.equal(leaves[0]!.studentId, club.child);
      assert.equal(leaves[0]!.certificate?.fileId, attached.fileId);
      assert.equal('reason' in leaves[0]!, false, 'never the reason the office typed');
      assert.deepEqual(await bytesOf((await new FilesController().read(attached.fileId)).getStream()), PDF);

      await expectStatus(
        () => new SensitiveController().attachCertificate(club.otherChild, club.otherLeave, 'x.pdf', PDF),
        404,
      );
      // Her child, the other child's leave: not this student's leave.
      await expectStatus(
        () => new SensitiveController().attachCertificate(club.child, club.otherLeave, 'x.pdf', PDF),
        404,
      );
      await expectStatus(() => new SensitiveController().detachCertificate(club.child, club.leave), 403);
      return attached;
    });

    await actingAs(tenant, { membershipId: club.otherParent, roles: ['guardian'] }, () =>
      expectStatus(() => new FilesController().read(fileId), 403),
    );
    await actingAs(tenant, { membershipId: club.stranger, roles: ['guardian'] }, async () => {
      await expectStatus(() => new FilesController().read(fileId), 403);
      await expectStatus(
        () => new SensitiveController().attachCertificate(club.child, club.leave, 'x.pdf', PDF),
        404,
      );
      assert.deepEqual((await new AppController().medicalLeave()).leaves, []);
    });

    // Unlinked from the child, the uploader reads it no longer.
    await tenant.sql(`UPDATE guardian_link SET archived_at = now() WHERE guardian_membership_id = $1`, [club.mother]);
    await actingAs(tenant, { membershipId: club.mother, roles: ['guardian'] }, () =>
      expectStatus(() => new FilesController().read(fileId), 403),
    );
  });
});

test('QA 4 — every download is in the audit log: who, whose, when', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    const { fileId } = await actingAs(tenant, { membershipId: club.admin, roles: ['admin'] }, () =>
      new SensitiveController().attachCertificate(club.child, club.leave, 'atestado.pdf', PDF),
    );
    await actingAs(tenant, { roles: ['owner'] }, () => new FilesController().read(fileId));
    await actingAs(tenant, { membershipId: club.mother, roles: ['guardian'] }, () => new FilesController().read(fileId));
    // A refusal is not a download.
    await actingAs(tenant, { membershipId: club.coach, roles: ['instructor'] }, () =>
      expectStatus(() => new FilesController().read(fileId), 403),
    );

    const reads = await tenant.sql<{ actor: string; student: string; at: Date }>(
      `SELECT actor_membership_id AS actor, data->>'studentId' AS student, created_at AS at
         FROM audit_log
        WHERE action = 'file.read' AND entity_id = $1
        ORDER BY created_at`,
      [fileId],
    );
    assert.deepEqual(
      reads.map((one) => one.actor),
      [tenant.ownerMembershipId, club.mother],
    );
    assert.ok(reads.every((one) => one.student === club.child && one.at instanceof Date));
  });
});

test('retention — an atestado whose student’s health data is erased can no longer be opened', async () => {
  await withScratchTenant(async (tenant) => {
    const club = await aClub(tenant);
    const { fileId } = await actingAs(tenant, { membershipId: club.admin, roles: ['admin'] }, () =>
      new SensitiveController().attachCertificate(club.child, club.leave, 'atestado.pdf', PDF),
    );
    await tenant.sql(`UPDATE student SET health_erased_at = now() WHERE id = $1`, [club.child]);
    await actingAs(tenant, { roles: ['owner'] }, () => expectStatus(() => new FilesController().read(fileId), 404));
    const [row] = await tenant.sql<{ wrapped_key: string | null }>(`SELECT wrapped_key FROM stored_file WHERE id = $1`, [
      fileId,
    ]);
    assert.equal(row!.wrapped_key, null, 'the key is gone, so the bytes in the bucket are noise');
  });
});
