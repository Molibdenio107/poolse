import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { StudentsController } from './students.controller.js';
import {
  actingAs,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * A NIF has to be a possible NIF, and one NIF is one person — F-02.
 *
 * QA put `134167211` — a wrong check digit — on a student *and* on their inline
 * guardian in one submit, and both went in. Two separate holes:
 *
 * **No checksum anywhere.** The old comment argued a wrong-but-plausible number
 * is a correction rather than a crash. But the duplicate-person guard is *keyed*
 * on the NIF, so a number that cannot exist quietly defeats the thing that is
 * supposed to stop one club holding two records for one person.
 *
 * **Nothing compared the numbers in one request.** `student.tax_number` and
 * `membership.tax_number` have a unique index each, per table — so a child and
 * their mother sharing a number violates neither.
 *
 * What is deliberately *not* refused: an inline guardian whose NIF matches
 * somebody already in the club. That attaches them to the existing person, which
 * is what stops the second sibling producing a second mother.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** Nine digits with a computed check digit. Two individuals and one company. */
const VALID = '123456789';
const ALSO_VALID = '199999996';
const COMPANY = '501442600';
/** The number from the QA report. Its correct check digit is 0, not 1. */
const BAD_CHECKSUM = '134167211';

function minor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Chico',
    lastName: 'Silva',
    birthDate: '2016-04-11',
    guardians: [
      {
        name: 'Ana Silva',
        relationship: 'mãe',
        email: 'ana.silva@exemplo.pt',
      },
    ],
    ...overrides,
  };
}

/** The guardian block with one inline person, overridable. */
function withGuardian(fields: Record<string, unknown>): Record<string, unknown>[] {
  return [{ name: 'Ana Silva', relationship: 'mãe', ...fields }];
}

test('F-02 — a NIF with a wrong check digit is refused, on the student', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      await expectStatus(
        async () => await students.create(minor({ taxNumber: BAD_CHECKSUM })),
        400,
      );

      // And the same number with its real check digit goes in.
      const ok = await students.create(minor({ taxNumber: '134167210' }));
      assert.ok(ok.id);
    });
  });
});

test('F-02 — a NIF with a wrong check digit is refused on the inline guardian', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      /*
       * The path the report found. The standalone person form validated nothing
       * either, but this one is the form an operator actually uses at the
       * counter, and it takes a NIF for somebody who is being created on the
       * spot.
       */
      await expectStatus(
        async () =>
          await students.create(
            minor({ guardians: withGuardian({ taxNumber: BAD_CHECKSUM }) }),
          ),
        400,
      );
    });
  });
});

test('F-02 — eight digits is not a NIF', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();
      await expectStatus(
        async () => await students.create(minor({ taxNumber: '12345678' })),
        400,
      );
    });
  });
});

test('F-02 — a student and their guardian cannot share a NIF', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      // Both valid, and both the same — which is what QA submitted. A NIF is a
      // national identity number; a child is not their own mother.
      await expectStatus(
        async () =>
          await students.create(
            minor({
              taxNumber: VALID,
              guardians: withGuardian({ taxNumber: VALID }),
            }),
          ),
        400,
      );

      // Different numbers are fine.
      const ok = await students.create(
        minor({
          taxNumber: VALID,
          guardians: withGuardian({ taxNumber: ALSO_VALID }),
        }),
      );
      assert.ok(ok.id);
    });
  });
});

test('F-02 — two guardians on one student cannot share a NIF', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      await expectStatus(
        async () =>
          await students.create(
            minor({
              guardians: [
                { name: 'Ana Silva', relationship: 'mãe', taxNumber: COMPANY },
                { name: 'Rui Silva', relationship: 'pai', taxNumber: COMPANY },
              ],
            }),
          ),
        400,
      );
    });
  });
});

test('F-02 — an empty NIF is still allowed, everywhere it was', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      // Most students have none recorded, and requiring one would be a different
      // decision entirely.
      const ok = await students.create(minor());
      assert.ok(ok.id);

      /*
       * The guardian still needs an email, because `guardian_needs_a_key` has
       * always demanded a NIF *or* an email — being dedupable is the rule, and
       * this change does not touch it.
       */
      const blank = await students.create(
        minor({
          taxNumber: '',
          guardians: withGuardian({ taxNumber: '', email: 'ana.silva@exemplo.pt' }),
        }),
      );
      assert.ok(blank.id);
    });
  });
});

test('F-02 — an inline guardian is still attached to the person who holds that NIF', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      // The first child creates the mother.
      await students.create(
        minor({ guardians: withGuardian({ taxNumber: COMPANY, email: 'ana@exemplo.pt' }) }),
      );

      /*
       * The second child names the same NIF, and must reach the *same* person.
       * This is the case the dedupe exists for, and the reason F-02's "NIF
       * already belongs to another person" check was deliberately not extended
       * here: refusing it would give every family a second mother.
       */
      await students.create({
        firstName: 'Maria',
        lastName: 'Silva',
        birthDate: '2018-02-02',
        guardians: withGuardian({ taxNumber: COMPANY }),
      });

      const mothers = await tenant.sql<{ count: string }>(
        `SELECT count(*)::text AS count FROM membership
          WHERE tax_number = $1 AND archived_at IS NULL`,
        [COMPANY],
      );
      assert.equal(mothers[0]?.count, '1', 'one person, two children');
    });
  });
});

// ---------------------------------------------------------------------------
// Every refusal names its field — F-09
// ---------------------------------------------------------------------------
//
// A rejected create came back as a bare 400: a generic toast, no field marked,
// and — because the inputs were uncontrolled — the whole form cleared. Somebody
// who mistyped a year lost the name, the level, the contact details and the
// guardian they had just entered.
//
// The form half is React's (controlled fields keep what was typed); this is the
// server half, which is what tells the form *which* box to mark.

test('F-09 — a future date of birth is refused, and names the field', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      try {
        await students.create(minor({ birthDate: '2030-01-01' }));
        assert.fail('a student born in 2030 should be refused');
      } catch (error) {
        const refusal = error as { status?: number; response?: { fields?: Record<string, string> } };
        assert.equal(refusal.status, 400);
        // The field, so the message lands under the date rather than at the top
        // of a page with a dozen boxes on it.
        assert.equal(refusal.response?.fields?.['birthDate'], 'students.birthDateFuture');
      }
    });
  });
});

test('F-09 — a malformed date and a missing name name their fields too', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const students = new StudentsController();

      const named = async (
        body: Record<string, unknown>,
        field: string,
        key: string,
      ): Promise<void> => {
        try {
          await students.create(body);
          assert.fail(`${field} should have been refused`);
        } catch (error) {
          const refusal = error as {
            status?: number;
            response?: { fields?: Record<string, string> };
          };
          assert.equal(refusal.status, 400);
          assert.equal(refusal.response?.fields?.[field], key);
        }
      };

      await named(minor({ birthDate: '11-04-2016' }), 'birthDate', 'students.birthDateInvalid');
      await named(minor({ firstName: '' }), 'firstName', 'students.required');
      await named(minor({ lastName: '  ' }), 'lastName', 'students.required');
      await named(
        minor({ contactPhone: 'x'.repeat(41) }),
        'contactPhone',
        'students.tooLong',
      );
    });
  });
});
