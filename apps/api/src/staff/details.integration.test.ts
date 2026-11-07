import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StaffController } from './staff.controller.js';
import { RetentionService } from '../retention/retention.service.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * A staff member's personal details — POOLSE-149 slice A, QA 1–3 and the
 * retention half: who reads and edits, the NIF and NISS checks, the person's
 * own fields against the club's, the change log naming fields without values,
 * and the NISS and emergency contact erased after the person leaves.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

const NIF = '123456789';
const NISS = '12345678902';

test('POOLSE-149 A — the owner sets every detail, the person their own, a colleague nothing; values stay out of the log', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const colleague = await addMember(tenant, 'Bruno', 'Lima', ['instructor']);
    const staff = new StaffController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // QA 1: every field, normalised on the way in.
      const saved = await staff.editDetails(coach, {
        address: '  Rua das Flores,   12 ',
        locality: 'Lisboa',
        postalCode: ' 1200-195 ',
        taxNumber: '123 456 789',
        niss: '123 456 789 02',
        nationality: 'pt',
        birthplace: 'Porto',
        emergencyName: 'Rita Ribeiro',
        emergencyPhone: '912 345 678',
        emergencyRelation: 'Irmã',
      });
      assert.deepEqual(saved, {
        address: 'Rua das Flores, 12',
        locality: 'Lisboa',
        postalCode: '1200-195',
        taxNumber: NIF,
        niss: NISS,
        nationality: 'PT',
        birthplace: 'Porto',
        emergencyName: 'Rita Ribeiro',
        emergencyPhone: '912 345 678',
        emergencyRelation: 'Irmã',
      });

      // QA 2: a value that cannot be what it says is refused under its field.
      for (const body of [
        { niss: '12345678903' },
        { taxNumber: '123456788' },
        { postalCode: '1200' },
        { nationality: 'Portugal' },
      ]) {
        await expectStatus(() => staff.editDetails(coach, body), 400);
      }
      // An empty box clears; an absent key is not asked about.
      const cleared = await staff.editDetails(coach, { birthplace: '' });
      assert.equal(cleared.birthplace, null);
      assert.equal(cleared.locality, 'Lisboa');

      // One NIF is one person in a club.
      await expectStatus(() => staff.editDetails(colleague, { taxNumber: NIF }), 409);
    });

    // The log names what moved and never the values.
    const entries = await tenant.sql<{ data: { withheld: string[] } }>(
      `SELECT data FROM audit_log WHERE action = 'membership.details_updated' AND entity_id = $1 ORDER BY created_at`,
      [coach],
    );
    assert.equal(entries.length, 2);
    assert.ok(entries[0]!.data.withheld.includes('niss'));
    assert.ok(!JSON.stringify(entries).includes(NISS));
    assert.ok(!JSON.stringify(entries).includes('Rua das Flores'));

    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      // The person reads their own and edits their own fields…
      const own = await staff.details(coach);
      assert.equal(own.niss, NISS);
      const moved = await staff.editDetails(coach, { locality: 'Sintra', emergencyPhone: '913 000 000' });
      assert.equal(moved.locality, 'Sintra');
      // …sending the club's fields unchanged passes, changing one is refused.
      await staff.editDetails(coach, { taxNumber: NIF, niss: NISS, locality: 'Sintra' });
      await expectStatus(() => staff.editDetails(coach, { niss: '20999999998' }), 403);
      await expectStatus(() => staff.editDetails(coach, { taxNumber: '' }), 403);

      // QA 3: a colleague's details are not theirs to read or write.
      await expectStatus(() => staff.details(colleague), 403);
      await expectStatus(() => staff.editDetails(colleague, { locality: 'Faro' }), 403);
    });

    // Retention: archived thirteen months ago, the NISS and the emergency contact
    // go with the ID document; the address, NIF and nationality stay.
    await owner.query(`UPDATE membership SET archived_at = now() - interval '13 months' WHERE id = $1`, [coach]);
    await new RetentionService().run(tenant.organizationId);
    const [kept] = await tenant.sql<Record<string, string | null>>(
      `SELECT niss, emergency_name, emergency_phone, emergency_relation, address, tax_number, nationality
         FROM membership WHERE id = $1`,
      [coach],
    );
    assert.deepEqual(kept, {
      niss: null,
      emergency_name: null,
      emergency_phone: null,
      emergency_relation: null,
      address: 'Rua das Flores, 12',
      tax_number: NIF,
      nationality: 'PT',
    });
  });
});
