import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentsController } from './attachments.controller.js';
import { FilesController } from './files.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * Photographs of people — Rui, 28-10-2026.
 *
 * **A student's photograph needs a live photo consent**, to be filed and to be
 * read: withdrawing the consent hides it on the next request, with nothing
 * deleted. Staff read it, and so does the child's own family; another family
 * does not.
 *
 * **A staff member with a login sets their own**, on *O meu perfil*, as with
 * their name; the office files one only for somebody with no login.
 *
 * Run: pnpm api:test   (needs pnpm db:up, and the storage container)
 */

after(closeHarness);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not really an image, but it starts like one'),
]);

test("a student's photograph is filed and shown only with a photo consent", async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const [child] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, 'Inês', 'Rocha') RETURNING id`,
      [org],
    );
    const studentId = child!.id;
    const mother = await addMember(tenant, 'Marta', 'Rocha', ['guardian']);
    const stranger = await addMember(tenant, 'Rui', 'Alves', ['guardian']);
    const coach = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [org, studentId, mother],
    );

    let fileId = '';
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      fileId = (await new FilesController().upload('student_photo', 'ines.png', PNG)).id;
      // No consent yet: the club may not keep what it may not show.
      await expectStatus(
        () => new AttachmentsController().setStudentPhoto(studentId, { fileId }),
        409,
      );
    });

    await tenant.sql(
      `INSERT INTO consent (organization_id, student_id, kind, granted, evidence_note)
       VALUES ($1, $2, 'photo', true, 'formulário assinado')`,
      [org, studentId],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new AttachmentsController().setStudentPhoto(studentId, { fileId });
    });

    // Staff and the child's own family read it; another family does not.
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      await new FilesController().read(fileId);
    });
    await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, async () => {
      await new FilesController().read(fileId);
    });
    await actingAs(tenant, { membershipId: stranger, roles: ['guardian'] }, async () => {
      await expectStatus(() => new FilesController().read(fileId), 403);
    });

    // A withdrawal hides it at once, from everybody, owner included.
    await tenant.sql(
      `UPDATE consent SET withdrawn_at = now() WHERE organization_id = $1 AND student_id = $2`,
      [org, studentId],
    );
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(() => new FilesController().read(fileId), 403);
      // Taking it off is never refused.
      await new AttachmentsController().setStudentPhoto(studentId, { fileId: null });
    });
  });
});

test('the office files a photograph for staff with no login, never for somebody with one', async () => {
  await withScratchTenant(async (tenant) => {
    const lifeguard = await addMember(tenant, 'Nuno', 'Teixeira', ['instructor']);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const fileId = (await new FilesController().upload('staff_photo', 'nuno.png', PNG)).id;
      await new AttachmentsController().setStaffPhoto(lifeguard, { fileId });
      const [row] = await tenant.sql<{ photo_file_id: string | null }>(
        `SELECT photo_file_id FROM membership WHERE id = $1`,
        [lifeguard],
      );
      assert.equal(row?.photo_file_id, fileId);

      // A logo cannot be filed as somebody's face.
      const logo = (await new FilesController().upload('logo', 'logo.png', PNG)).id;
      await expectStatus(() => new AttachmentsController().setStaffPhoto(lifeguard, { fileId: logo }), 400);

      // The owner has a login: their photograph is their own to set.
      await expectStatus(
        () => new AttachmentsController().setStaffPhoto(tenant.ownerMembershipId, { fileId }),
        409,
      );
    });

    // An instructor reads a colleague's photograph; a family does not.
    const coach = await addMember(tenant, 'Sandra', 'Moreira', ['instructor']);
    const parent = await addMember(tenant, 'Marta', 'Rocha', ['guardian']);
    const [row] = await tenant.sql<{ photo_file_id: string }>(
      `SELECT photo_file_id FROM membership WHERE id = $1`,
      [lifeguard],
    );
    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      await new FilesController().read(row!.photo_file_id);
    });
    await actingAs(tenant, { membershipId: parent, roles: ['guardian'] }, async () => {
      await expectStatus(() => new FilesController().read(row!.photo_file_id), 403);
    });
  });
});
