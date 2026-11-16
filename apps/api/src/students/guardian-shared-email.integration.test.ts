import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { StudentsController } from './students.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * Security review, 16-11-2026 (S2): an adult student picked as a guardian was
 * linked to whichever person shared her NIF *or email*. A family shares one
 * email, so Sara's student record went to her mother's person, whose login then
 * read Sara's consents and invoices as her own, and the mother became the
 * child's encarregado instead of Sara.
 *
 * Now: matched by NIF only. An email that is another person's stays theirs, and
 * Sara's person is made without it; the save says so (Rui, 16-11-2026).
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

test('an adult student picked as guardian is never linked to another person by a shared email', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();
      // Mãe Ana is a person already: the encarregado of a younger child.
      await students.create({
        firstName: 'Rita',
        lastName: 'Costa',
        birthDate: '2016-03-03',
        guardians: [{ name: 'Ana Costa', relationship: 'mãe', email: 'casa.costa@exemplo.pt' }],
      });
      const [ana] = await tenant.sql<{ id: string }>(
        `SELECT id FROM membership WHERE email = 'casa.costa@exemplo.pt'`,
      );
      // Sara, 30, an adult swimmer whose file carries the household address.
      const { id: saraId } = await students.create({
        firstName: 'Sara',
        lastName: 'Costa',
        birthDate: '1996-06-07',
        contactEmail: 'casa.costa@exemplo.pt',
      });
      const asPicked = {
        firstName: 'Tomás',
        lastName: 'Costa',
        birthDate: '2017-09-09',
        guardians: [{ membershipId: null, studentId: saraId, name: 'Sara Costa', email: 'casa.costa@exemplo.pt', relationship: 'tia' }],
      };

      // No NIF and the email is Ana's: nothing to tell her apart by, so refused, nothing written.
      await assert.rejects(
        () => students.create(asPicked),
        (error: { getResponse?: () => unknown }) =>
          (error.getResponse?.() as { code?: string } | undefined)?.code === 'guardian_email_taken',
      );
      const [before] = await tenant.sql<{ membership_id: string | null }>(
        `SELECT membership_id FROM student WHERE id = $1`,
        [saraId],
      );
      assert.equal(before!.membership_id, null, 'the refusal linked nothing');

      // With her NIF typed, she becomes her own person, without the household email.
      const saved = await students.create({
        firstName: 'Tomás',
        lastName: 'Costa',
        birthDate: '2017-09-09',
        guardians: [{ ...asPicked.guardians[0]!, taxNumber: '123456789' }],
      });
      assert.equal(saved.guardianEmailWithheld, true, 'the save says the email was somebody else’s');

      const [sara] = await tenant.sql<{ membership_id: string | null; email: string | null }>(
        `SELECT s.membership_id, m.email::text AS email
           FROM student s LEFT JOIN membership m ON m.id = s.membership_id
          WHERE s.id = $1`,
        [saraId],
      );
      assert.ok(sara!.membership_id, 'Sara has a person of her own');
      assert.notEqual(sara!.membership_id, ana!.id, "Sara's record is not Ana's");
      assert.equal(sara!.email, null, 'made without the household email');

      const child = await students.one(saved.id);
      assert.deepEqual(
        child.guardians.map((guardian) => guardian.membershipId),
        [sara!.membership_id],
        'Tomás’s encarregado is Sara, not Ana',
      );
    });
  });
});

test('an adult student picked as guardian is linked to the person who holds her NIF', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();
      // Sara is a person already (an encarregado), and a student with the same NIF.
      await students.create({
        firstName: 'Rui',
        lastName: 'Lopes',
        birthDate: '2016-03-03',
        guardians: [{ name: 'Sara Lopes', relationship: 'mãe', taxNumber: '123456789' }],
      });
      const [person] = await tenant.sql<{ id: string }>(`SELECT id FROM membership WHERE tax_number = '123456789'`);
      const { id: saraId } = await students.create({
        firstName: 'Sara',
        lastName: 'Lopes',
        birthDate: '1990-01-01',
        taxNumber: '123456789',
      });
      const saved = await students.create({
        firstName: 'Inês',
        lastName: 'Lopes',
        birthDate: '2018-09-09',
        guardians: [{ membershipId: null, studentId: saraId, name: 'Sara Lopes', taxNumber: '123456789', relationship: 'mãe' }],
      });
      assert.equal(saved.guardianEmailWithheld, false);
      const [sara] = await tenant.sql<{ membership_id: string | null }>(
        `SELECT membership_id FROM student WHERE id = $1`,
        [saraId],
      );
      assert.equal(sara!.membership_id, person!.id, 'one NIF, one human');
    });
  });
});

test('a guardian id that is not a uuid is a 400, not a 500', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      for (const ids of [{ studentId: 'not-a-uuid' }, { membershipId: 'not-a-uuid' }]) {
        await assert.rejects(
          () =>
            new StudentsController().create({
              firstName: 'Tomás',
              lastName: 'Costa',
              birthDate: '2017-09-09',
              guardians: [{ membershipId: null, ...ids, name: 'X', email: 'x@exemplo.pt', relationship: 'tia' }],
            }),
          (error: { getStatus?: () => number }) => error.getStatus?.() === 400,
        );
      }
    });
  });
});
