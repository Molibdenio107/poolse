import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { StudentsController } from './students.controller.js';
import { actingAs, closeHarness, withScratchTenant } from '../test/harness.js';

/**
 * A guardian needs a NIF or an email — the create form's half of POOLSE-17.
 *
 * `guardian_needs_a_key` has demanded one of those two since the person-merge
 * migration, for a reason that is about deduplication rather than about contact:
 * guardians are where duplicate people come from, and a telephone number does
 * not dedupe anybody.
 *
 * `parseStudent` was asking for a phone number **or** an email instead. A
 * guardian carrying only a mobile therefore passed validation, reached the
 * insert, and was refused by the trigger during the commit — which surfaced as a
 * 500 and rolled the whole student back. The import path already refused the row
 * on its preview; the create form did not, and this is the test that keeps the
 * two rules the same one.
 *
 * The failure mode is worth naming because it is invisible in the happy case:
 * every guardian somebody types an email for works perfectly, so the bug only
 * appears for the club that records phone numbers.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** A minor, so the guardian rules apply at all. */
const CHILD = {
  firstName: 'Matilde',
  lastName: 'Reis',
  birthDate: '2016-04-12',
};

test('a minor whose guardian has only a phone number is refused, not 500', async () => {
  await withScratchTenant(async (tenant) => {
    const students = new StudentsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await assert.rejects(
        students.create({
          ...CHILD,
          guardianName: 'Sofia Melo',
          guardianRelationship: 'mother',
          guardianPhone: '912345678',
        }),
        (error: unknown) => {
          // A 400 naming the field, not a 500 from the constraint. That is the
          // whole point: the operator can fix it, in the box it belongs to.
          assert.ok(error instanceof BadRequestException);
          const body = error.getResponse() as {
            code: string;
            fields: Record<string, string>;
          };
          assert.equal(body.code, 'guardian_required');
          assert.equal(body.fields['guardianTaxNumber'], 'students.guardianKeyRequired');
          return true;
        },
      );
    });
  });
});

test('a NIF is enough, and so is an email', async () => {
  await withScratchTenant(async (tenant) => {
    const students = new StudentsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // Either key satisfies the rule, and the phone number is still recorded —
      // it was never the problem, it simply was not sufficient on its own.
      await students.create({
        ...CHILD,
        guardianName: 'Sofia Melo',
        guardianRelationship: 'mother',
        guardianPhone: '912345678',
        guardianTaxNumber: '123456789',
      });

      await students.create({
        firstName: 'Tomás',
        lastName: 'Reis',
        birthDate: '2015-02-03',
        guardianName: 'Rui Melo',
        guardianRelationship: 'father',
        guardianEmail: 'rui.melo@example.pt',
      });

      const listed = await students.list();
      assert.equal(listed.students.total, 2);
    });
  });
});

test('an adult student needs no guardian and no key of their own', async () => {
  await withScratchTenant(async (tenant) => {
    const students = new StudentsController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // The asymmetry is deliberate and worth pinning: a student may carry
      // neither NIF nor email — plenty of adults joining a masters squad give
      // only a phone number — while a guardian must carry one of the two.
      await students.create({
        firstName: 'Alberto',
        lastName: 'Nunes',
        birthDate: '1958-11-30',
        contactPhone: '912345678',
      });

      const listed = await students.list();
      assert.equal(listed.students.total, 1);
    });
  });
});
