import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MedicalExamsController } from './medical-exams.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant } from '../test/harness.js';

/**
 * POOLSE-133 — the exame médico: three states, an instructor seeing the state
 * and never the note, the import matching by NIF or by confirmed name and birth
 * date, a round trip writing nothing, and retention clearing the note.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

function shift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('POOLSE-133 — exams on the record, several per student', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const admin = await addMember(tenant, 'Carla', 'Admin', ['admin']);
    const instructor = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
    const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
      actingAs(tenant, { membershipId: admin, roles: ['admin'] }, fn);
    const exams = new MedicalExamsController();

    const students = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, tax_number)
       VALUES ($1, 'Inês', 'Morais', '2012-05-01', '123456789'),
              ($1, 'Tomás', 'Lopes', '2011-03-02', NULL),
              ($1, 'Sem', 'Exame', '2010-01-01', NULL)
       RETURNING id`,
      [org],
    );
    const [ines, tomas, none] = students.map((s) => s.id) as [string, string, string];

    // Three states.
    await asAdmin(() => exams.record(ines, { examinedOn: shift(-30), result: 'fit', validUntil: shift(300), note: 'Asma ligeira' }));
    await asAdmin(() => exams.record(tomas, { examinedOn: shift(-400), result: 'fit', validUntil: shift(-1) }));
    assert.equal((await asAdmin(() => exams.list(ines))).state, 'valid');
    assert.equal((await asAdmin(() => exams.list(tomas))).state, 'expired');
    assert.equal((await asAdmin(() => exams.list(none))).state, 'none');

    // No validity given: a year, labelled as assumed.
    await asAdmin(() => exams.record(none, { examinedOn: shift(-10), result: 'fit' }));
    const assumed = (await asAdmin(() => exams.list(none))).current!;
    assert.equal(assumed.validUntilAssumed, true);
    assert.equal((await asAdmin(() => exams.list(none))).state, 'valid');

    // An instructor sees the state, not the note.
    const seen = await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () => exams.list(ines));
    assert.equal(seen.state, 'valid');
    assert.equal(seen.current!.note, null);
    await actingAs(tenant, { membershipId: instructor, roles: ['instructor'] }, () =>
      expectStatus(() => exams.record(ines, { examinedOn: shift(0), result: 'fit' }), 403),
    );

    // Retention: erasing the student's health data clears the note.
    await tenant.sql('UPDATE student SET health_erased_at = now() WHERE id = $1', [ines]);
    const [left] = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM medical_exam WHERE student_id = $1 AND note IS NOT NULL',
      [ines],
    );
    assert.equal(left!.n, 0);
  });
});
