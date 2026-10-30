import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { StudentsController } from './students.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * POOLSE-131 — a student's address and identity, against the real database.
 *
 * Saved and read back, the shapes refused with a field, the SNS number kept from
 * everybody but owner and admin, the change log naming without valuing, an
 * import-style body leaving it alone, and anonymisation clearing it.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const FULL = {
  firstName: 'Inês',
  lastName: 'Morais',
  addressLine: 'Rua Pedro Álvares Cabral, 12',
  locality: 'Santo Tirso',
  postalCode: '4780-518',
  parentOneName: 'Rui Morais',
  parentTwoName: 'Ana Morais',
  maritalStatus: 'single',
  profession: 'Estudante',
  education: 'Secundário',
  birthplace: 'Porto',
  nationality: 'pt',
  snsNumber: '123 456 789',
};

test('POOLSE-131 — identity is saved, shaped, guarded and logged', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const routes = new StudentsController();
    const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
      actingAs(tenant, { membershipId: admin, roles: ['admin'] }, fn);

    // QA 1: saved and read back, normalised.
    const { id } = await asAdmin(() => routes.create(FULL));
    const read = await asAdmin(() => routes.one(id));
    assert.equal(read.identity.postalCode, '4780-518');
    assert.equal(read.identity.nationality, 'PT');
    assert.equal(read.identity.snsNumber, '123456789');
    assert.equal(read.identity.maritalStatus, 'single');

    // QA 2: a postal code of the wrong shape is a field error, nothing saved.
    await asAdmin(() => expectStatus(() => routes.update(id, { ...FULL, postalCode: '4000' }), 400));
    assert.equal((await asAdmin(() => routes.one(id))).identity.postalCode, '4780-518');

    // QA 3: an instructor learns only that a number is on file.
    const seen = await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () => routes.one(id));
    assert.equal(seen.identity.snsNumber, null);
    assert.equal(seen.identity.snsRecorded, true);
    assert.equal(seen.identity.locality, 'Santo Tirso');

    // QA 4: the change log names the field and never its value.
    await asAdmin(() => routes.update(id, { ...FULL, parentOneName: 'Rui M. Morais' }));
    const [entry] = await tenant.sql<{ data: { withheld?: string[] } & Record<string, unknown> }>(
      `SELECT data FROM audit_log WHERE entity_id = $1 AND action = 'student.updated'
        ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    assert.ok(entry!.data.withheld?.includes('parentOneName'));
    assert.equal(JSON.stringify(entry!.data).includes('Rui M. Morais'), false);

    // A body without the group (an import, a lead) leaves it alone.
    await asAdmin(() => routes.update(id, { firstName: 'Inês', lastName: 'Morais' }));
    assert.equal((await asAdmin(() => routes.one(id))).identity.birthplace, 'Porto');

    // QA 5: anonymisation clears it.
    await tenant.sql('UPDATE student SET anonymised_at = now() WHERE id = $1', [id]);
    const [gone] = await tenant.sql<{ n: number }>(
      `SELECT num_nonnulls(address_line, locality, postal_code, parent_one_name, parent_two_name,
                           marital_status, profession, education, birthplace, nationality, sns_number)::int AS n
         FROM student WHERE id = $1`,
      [id],
    );
    assert.equal(gone!.n, 0);
  });
});
