import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SensitiveController } from './sensitive.controller.js';
import { StudentsController } from '../students/students.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * The adult and senior path — POOLSE-23.
 *
 * An adult signing up for hidroginástica should not be walked through a form
 * built for somebody else's child. Most of that is branching, and what these
 * hold still is the two things the branch must not get wrong:
 *
 * **Which path somebody is on is a server answer, and it moves on its own.**
 * There is no `is_adult` column — an adult is at or above the club's age of
 * majority with no live guardian link — so correcting a birth date or adding a
 * guardian moves a person between paths with nothing to migrate. QA 23.12 is
 * that, from the direction that matters: an adult corrected to a minor gets the
 * guardian block back and loses nothing.
 *
 * **A minor cannot self-sign.** QA 23.3 is a request straight to the API, past
 * whatever form the screen chose, and the answer is a 422.
 *
 * **The emergency contact grants nothing.** QA 23.4 checks it from the other
 * end: the person named holds no role and no guardian edge afterwards.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A birth date `years` ago, safely inside the year rather than on the boundary. */
function bornYearsAgo(years: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCFullYear(day.getUTCFullYear() - years);
  day.setUTCDate(day.getUTCDate() - 30);
  return day.toISOString().slice(0, 10);
}

async function student(
  tenant: ScratchTenant,
  firstName: string,
  birthDate: string | null,
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, $2, 'Marques', $3::date) RETURNING id`,
    [tenant.organizationId, firstName, birthDate],
  );
  return row!.id;
}

async function giveGuardian(tenant: ScratchTenant, studentId: string): Promise<string> {
  const guardian = await addMember(tenant, 'Sofia', 'Marques', ['guardian']);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
     VALUES ($1, $2, $3, 'mae')`,
    [tenant.organizationId, studentId, guardian],
  );
  return guardian;
}

test('an adult with no guardian is on the adult path and self-signs', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const id = await student(tenant, 'Manuel', bornYearsAgo(45));
      const seen = await new SensitiveController().read(id);

      assert.equal(seen.enrolment?.adultPath, true);
      assert.equal(seen.enrolment?.hasGuardian, false);
      assert.equal(seen.enrolment?.consentForm, 'self');
      assert.equal(seen.enrolment?.ageYears, 45);
      // The club's own threshold travels with the answer, so a screen never has
      // to know what eighteen means at this club.
      assert.equal(seen.enrolment?.ageOfMajority, 18);
    });
  });
});

test('a minor, and an adult who has a guardian, are both on the guardian path', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();

      const child = await student(tenant, 'Rita', bornYearsAgo(9));
      await giveGuardian(tenant, child);
      assert.equal((await controller.read(child)).enrolment?.consentForm, 'guardian');

      /*
       * An adult *with* a guardian edge is not on the adult path either — the
       * definition is the absence of the edge, and a supported adult is exactly
       * who that distinction exists for. Age alone would have got this wrong.
       */
      const supported = await student(tenant, 'Jorge', bornYearsAgo(52));
      await giveGuardian(tenant, supported);
      const seen = await controller.read(supported);
      assert.equal(seen.enrolment?.adultPath, false);
      assert.equal(seen.enrolment?.hasGuardian, true);
    });
  });
});

test('a student with no birth date is not assumed to be an adult', async () => {
  // The guess that skips the guardian block for a child nobody has finished
  // registering is the one that cannot be recovered from. The other way round
  // is a guardian an adult is corrected out of.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const id = await student(tenant, 'Sem-data', null);
      const seen = await new SensitiveController().read(id);

      assert.equal(seen.enrolment?.adultPath, false);
      assert.equal(seen.enrolment?.ageYears, null);
      assert.equal(seen.enrolment?.consentForm, 'guardian');
    });
  });
});

test('23.3 — a minor cannot self-sign, whatever the client sends', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();
      const child = await student(tenant, 'Rita', bornYearsAgo(15));
      await giveGuardian(tenant, child);

      // Straight to the API, past whatever form the screen chose. A 422: the
      // request is well-formed and the claim it makes about who signed is not.
      await expectStatus(
        () => controller.record(child, { kind: 'photo', granted: true, signedBy: 'self' }),
        422,
      );

      // And nothing was recorded — the refusal is not a half-write.
      const seen = await controller.read(child);
      assert.equal(seen.consent.length, 0);

      // The guardian's signature on the same consent is ordinary.
      await controller.record(child, { kind: 'photo', granted: true, signedBy: 'guardian' });
      assert.equal((await controller.read(child)).consent.length, 1);
    });
  });
});

test('an adult cannot have consent signed by a guardian they do not have', async () => {
  // The other direction of the same guard. Both are wrong claims about who
  // signed, and a rule that only ran one way would be half a check.
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();
      const adult = await student(tenant, 'Manuel', bornYearsAgo(45));

      await expectStatus(
        () => controller.record(adult, { kind: 'photo', granted: true, signedBy: 'guardian' }),
        422,
      );
      await controller.record(adult, { kind: 'photo', granted: true, signedBy: 'self' });
      assert.equal((await controller.read(adult)).consent.length, 1);
    });
  });
});

test('a caller that says nothing about who signed is accepted, as every existing one does', async () => {
  // `signedBy` is new; every caller that predates it omits it and must go on
  // working. Absent means "the client did not say", not "the client said self".
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();
      const child = await student(tenant, 'Rita', bornYearsAgo(10));
      await giveGuardian(tenant, child);

      await controller.record(child, { kind: 'photo', granted: true });
      assert.equal((await controller.read(child)).consent.length, 1);
    });
  });
});

test('23.12 — an adult corrected to a minor gets the guardian path back, losing nothing', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();
      const id = await student(tenant, 'Duarte', bornYearsAgo(20));

      await controller.write(id, {
        medicalNotes: 'Asma leve.',
        mobilityNotes: 'Ombro direito limitado.',
      });
      assert.equal((await controller.read(id)).enrolment?.adultPath, true);

      // The birth date was wrong. There is no flag to migrate — the answer moves
      // because the definition is computed, which is the whole reason there is
      // no `is_adult` column.
      await tenant.sql(`UPDATE student SET birth_date = $2::date WHERE id = $1`, [
        id,
        bornYearsAgo(12),
      ]);

      const seen = await controller.read(id);
      assert.equal(seen.enrolment?.adultPath, false);
      assert.equal(seen.enrolment?.consentForm, 'guardian');
      // And the notes written on the adult path are still there.
      assert.equal(seen.notes.medicalNotes, 'Asma leve.');
      assert.equal(seen.notes.mobilityNotes, 'Ombro direito limitado.');
    });
  });
});

test('mobility notes are encrypted, audited and read by the same people as the medical ones', async () => {
  await withScratchTenant(async (tenant) => {
    let id = '';

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      id = await student(tenant, 'Amélia', bornYearsAgo(72));
      await new SensitiveController().write(id, {
        medicalNotes: 'Hipertensão controlada.',
        mobilityNotes: 'Usa bengala. Precisa de entrada pela rampa.',
      });

      // Never in the clear in the database — the app holds the key and Postgres
      // is handed the ciphertext.
      const [row] = await tenant.sql<{ stored: string }>(
        `SELECT mobility_notes_encrypted AS stored FROM student_sensitive WHERE student_id = $1`,
        [id],
      );
      assert.ok(row !== undefined);
      assert.ok(!row!.stored.includes('bengala'), 'the note is stored encrypted');
    });

    const instructor = await addMember(tenant, 'Rita', 'Instrutora', ['instructor']);

    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, async () => {
      /*
       * Any instructor, not only the turma's own — the rule slice 1.12 settled
       * for the medical notes, which these now share. A cover instructor is
       * exactly who would otherwise be locked out, and the unconditional audit
       * log is what makes the open read safe.
       */
      const seen = await new SensitiveController().read(id);
      assert.equal(seen.notes.mobilityNotes, 'Usa bengala. Precisa de entrada pela rampa.');
      // Reading is theirs; writing is not.
      assert.equal(seen.canManage, false);
      await expectStatus(
        () => new SensitiveController().write(id, { mobilityNotes: 'alterado' }),
        403,
      );
    });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const reads = await tenant.sql<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'student_sensitive.read'`,
        [id],
      );
      assert.ok(reads.length >= 1, 'every read of these notes is an event in its own right');
    });
  });
});

test('23.4 — an emergency contact grants nothing at all', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();
      const id = await student(tenant, 'Amélia', bornYearsAgo(72));
      // Somebody already in the club, in no role that grants anything.
      const neighbour = await addMember(tenant, 'Carlos', 'Vizinho', ['maintenance']);

      await controller.setEmergencyContact(id, {
        membershipId: neighbour,
        relationship: 'Filho',
      });

      const seen = await controller.read(id);
      assert.equal(seen.emergencyContact?.membershipId, neighbour);
      // The name comes from the membership, so it stays right when they change it.
      assert.ok((seen.emergencyContact?.name ?? '').includes('Carlos'));

      // The point of the scenario: naming them conferred nothing.
      const edges = await tenant.sql(
        `SELECT 1 FROM guardian_link
          WHERE student_id = $1 AND guardian_membership_id = $2 AND archived_at IS NULL`,
        [id, neighbour],
      );
      assert.equal(edges.length, 0, 'an emergency contact is not a guardian edge');

      const roles = await tenant.sql<{ role: string }>(
        `SELECT role FROM membership_role WHERE membership_id = $1`,
        [neighbour],
      );
      assert.deepEqual(
        roles.map((row) => row.role),
        ['maintenance'],
        'and it granted no role',
      );
    });
  });
});

test('an emergency contact is a person or free text, never both', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const controller = new SensitiveController();
      const id = await student(tenant, 'Amélia', bornYearsAgo(72));
      const neighbour = await addMember(tenant, 'Carlos', 'Vizinho', ['maintenance']);

      // Free text, for a contact who is not in the system.
      await controller.setEmergencyContact(id, {
        name: 'Ana Sobrinha',
        phone: '912 345 678',
        relationship: 'Sobrinha',
      });
      let seen = await controller.read(id);
      assert.equal(seen.emergencyContact?.name, 'Ana Sobrinha');
      assert.equal(seen.emergencyContact?.phone, '912 345 678');

      /*
       * Switching to a link clears the typed pair rather than refusing the save.
       * The two are alternatives and the operator has just chosen one; making
       * them delete the other first is asking them to tidy up after a rule they
       * cannot see.
       */
      await controller.setEmergencyContact(id, {
        membershipId: neighbour,
        name: 'Ana Sobrinha',
        phone: '912 345 678',
      });
      seen = await controller.read(id);
      assert.equal(seen.emergencyContact?.membershipId, neighbour);

      const [row] = await tenant.sql<{ name: string | null }>(
        `SELECT emergency_contact_name AS name FROM student WHERE id = $1`,
        [id],
      );
      assert.equal(row?.name, null, 'the free text went with the choice');

      // A phone with nobody attached to it is not a contact.
      await expectStatus(
        () => controller.setEmergencyContact(id, { phone: '912 000 000' }),
        400,
      );
    });
  });
});

test('23.6 — an adult student who is also an EE is one record with both badges', async () => {
  /*
   * The avó who swims on Tuesdays and brings her granddaughter on Thursdays.
   *
   * Two things are being asserted and the second is the one the ticket warns
   * about. She appears **once** — which she must, because Alunos is a list over
   * `student` and she has one record. And she is on the **adult path**, because
   * her guardian edges point *away* from her: asking "does this person have any
   * guardian edges at all" would find the ones she holds over her
   * granddaughter, take her off the adult path and address her consent form to
   * a parent she does not have.
   */
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const avo = await student(tenant, 'Amélia', bornYearsAgo(72));

      // She is a person in the club, and that person is her student record.
      const membership = await addMember(tenant, 'Amélia', 'Marques', ['guardian']);
      await tenant.sql(`UPDATE student SET membership_id = $2 WHERE id = $1`, [avo, membership]);

      // And she is the encarregada of her granddaughter — an outbound edge.
      const neta = await student(tenant, 'Rita', bornYearsAgo(8));
      await tenant.sql(
        `INSERT INTO guardian_link
           (organization_id, student_id, guardian_membership_id, relationship)
         VALUES ($1, $2, $3, 'avo')`,
        [tenant.organizationId, neta, membership],
      );

      // Still an adult: the edges she holds are not edges over her.
      const seen = await new SensitiveController().read(avo);
      assert.equal(seen.enrolment?.adultPath, true);
      assert.equal(seen.enrolment?.hasGuardian, false);
      assert.equal(seen.enrolment?.consentForm, 'self');

      const { students } = await new StudentsController().list();
      const rows = students.items.filter((row) => row.id === avo);
      assert.equal(rows.length, 1, 'one person, one row');
      assert.equal(rows[0]?.isAdultStudent, true);
      assert.equal(rows[0]?.isGuardian, true, 'and both badges on it');

      // Her granddaughter is neither, and is on the guardian path.
      const child = students.items.find((row) => row.id === neta);
      assert.equal(child?.isAdultStudent, false);
      assert.equal(child?.isGuardian, false);
    });
  });
});
