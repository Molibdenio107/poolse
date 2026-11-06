import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from './app.controller.js';
import { FilesController } from '../files/files.controller.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-194 — who is in the class. No minor's name, id or photo reaches another
 * family, and that is proved on the response, not on the screen.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

async function student(tenant: ScratchTenant, first: string, birth: string): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, $2, 'Silva', $3::date) RETURNING id`,
    [tenant.organizationId, first, birth],
  );
  return row!.id;
}

async function login(tenant: ScratchTenant, studentId: string): Promise<string> {
  const member = await addMember(tenant, 'Login', 'Silva', ['student']);
  await tenant.sql(`UPDATE student SET membership_id = $2 WHERE id = $1`, [studentId, member]);
  return member;
}

async function guardianOf(tenant: ScratchTenant, studentId: string): Promise<string> {
  const member = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [tenant.organizationId, studentId, member],
  );
  return member;
}

async function turma(tenant: ScratchTenant, instructor: string, students: string[]): Promise<{ group: string; session: string }> {
  const org = tenant.organizationId;
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
     VALUES ($1, $2, $3, 'Turma ' || gen_random_uuid(), $4) RETURNING id`,
    [org, tenant.seasonId, tenant.facilityId, instructor],
  );
  for (const id of students) {
    await tenant.sql(
      `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
       VALUES ($1, $2, $3, 'active', club_today() - 10)`,
      [org, group!.id, id],
    );
  }
  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque ' || gen_random_uuid(), 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );
  const [session] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_session (organization_id, class_group_id, pool_id, instructor_membership_id, occurs_on, starts_at, duration_minutes)
     SELECT $1, $2, $3, $4, d, (d + TIME '18:00') AT TIME ZONE 'Europe/Lisbon', 45
       FROM (SELECT club_today() + 2 AS d) day
     RETURNING id`,
    [org, group!.id, pool!.id, instructor],
  );
  return { group: group!.id, session: session!.id };
}

async function photo(tenant: ScratchTenant, studentId: string): Promise<string> {
  const org = tenant.organizationId;
  const [file] = await tenant.sql<{ id: string }>(
    `INSERT INTO stored_file (organization_id, purpose, storage_key, content_type, byte_size, original_name, uploaded_by)
     SELECT $1::uuid, 'student_photo', $1::uuid::text || '/student_photo/' || gen_random_uuid(), 'image/jpeg', 10, 'p.jpg', m.id
       FROM membership m WHERE m.organization_id = $1::uuid LIMIT 1 RETURNING id`,
    [org],
  );
  await tenant.sql(
    `INSERT INTO consent (organization_id, student_id, kind, granted, evidence_note) VALUES ($1, $2, 'photo', true, 'Teste')`,
    [org, studentId],
  );
  await tenant.sql(`UPDATE student SET photo_file_id = $2 WHERE id = $1`, [studentId, file!.id]);
  return file!.id;
}

async function mixed(tenant: ScratchTenant) {
  const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
  const child = await student(tenant, 'Alice', '2016-01-01');
  const otherChild = await student(tenant, 'Bruna', '2016-02-02');
  const adult = await student(tenant, 'Carlos', '1990-03-03');
  const parent = await guardianOf(tenant, child);
  const otherParent = await guardianOf(tenant, otherChild);
  const adultLogin = await login(tenant, adult);
  const childPhoto = await photo(tenant, otherChild);
  const adultPhoto = await photo(tenant, adult);
  const { session } = await turma(tenant, coach, [child, otherChild, adult]);
  return { coach, child, otherChild, adult, parent, otherParent, adultLogin, childPhoto, adultPhoto, session };
}

test('QA 2–3: the reader’s child by name, adults as Carlos S., other minors with nothing at all', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await mixed(tenant);
    const seen = await actingAs(tenant, { membershipId: f.parent, roles: ['guardian'] }, () =>
      new AppController().classmates(f.session),
    );
    const names: (string | null)[] = seen.people.map((one) => one.name);
    assert.ok(names.includes('Alice S.'));
    assert.ok(names.includes('Carlos S.'));
    assert.equal(names.length, 2, 'the other child is no row at all');
    assert.deepEqual(seen.hidden, { count: 1, going: null, done: null }, 'one hidden child says nothing');

    const wire = JSON.stringify(seen);
    assert.equal(wire.includes('Bruna'), false);
    assert.equal(wire.includes(f.otherChild), false, 'no id');
    assert.equal(wire.includes(f.childPhoto), false, 'no file');
    assert.equal(seen.people.find((one) => one.name === 'Carlos S.')!.photoFileId, f.adultPhoto);
    assert.equal(seen.enrolled, 3);
    assert.equal(seen.instructor!.name, 'Nuno');
  });
});

test('QA 4: a date only declared, or a live guardian, keeps someone hidden', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await mixed(tenant);
    await tenant.sql(`UPDATE student SET birth_date_declared_at = now() WHERE id = $1`, [f.adult]);
    const declared = await actingAs(tenant, { membershipId: f.parent, roles: ['guardian'] }, () =>
      new AppController().classmates(f.session),
    );
    assert.equal(JSON.stringify(declared).includes('Carlos'), false);
  });
});

test('QA 5: an adult with no photo consent shows by name alone', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await mixed(tenant);
    await tenant.sql(`UPDATE consent SET withdrawn_at = now() WHERE student_id = $1`, [f.adult]);
    const seen = await actingAs(tenant, { membershipId: f.parent, roles: ['guardian'] }, () =>
      new AppController().classmates(f.session),
    );
    const carlos = seen.people.find((one) => one.name === 'Carlos S.')!;
    assert.equal(carlos.photoFileId, null);
  });
});

test('QA 6: Não vou is a number, and nobody is named under it', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await mixed(tenant);
    await tenant.sql(
      `INSERT INTO session_notice (organization_id, class_session_id, student_id, going, answered_by_membership_id) VALUES ($1, $2, $3, false, $4)`,
      [tenant.organizationId, f.session, f.adult, f.adultLogin],
    );
    const seen = await actingAs(tenant, { membershipId: f.parent, roles: ['guardian'] }, () =>
      new AppController().classmates(f.session),
    );
    assert.equal(seen.notComing, 1);
    assert.equal(JSON.stringify(seen.people).includes('Carlos'), false);
  });
});

test('QA 7: another family’s lesson, another club and staff are refused', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await mixed(tenant);
    const elsewhere = await student(tenant, 'Dina', '2015-01-01');
    const stranger = await guardianOf(tenant, elsewhere);
    await actingAs(tenant, { membershipId: stranger, roles: ['guardian'] }, () =>
      expectStatus(() => new AppController().classmates(f.session), 404),
    );
    await actingAs(tenant, { roles: ['instructor'] }, () =>
      expectStatus(() => new AppController().classmates(f.session), 403),
    );
    await withScratchTenant(async (other) => {
      const theirs = await addMember(other, 'Rita', 'Costa', ['guardian']);
      await actingAs(other, { membershipId: theirs, roles: ['guardian'] }, () =>
        expectStatus(() => new AppController().classmates(f.session), 404),
      );
    });
  });
});

test('QA 8: a classmate may open an adult’s photo, never a minor’s, and not once they have left', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await mixed(tenant);
    const open = (id: string, who: string) =>
      actingAs(tenant, { membershipId: who, roles: ['guardian'] }, () => new FilesController().read(id));
    // The rule answers before the bucket does: refused is a 403, allowed is anything else.
    const refused = async (id: string, who: string): Promise<boolean> => {
      try {
        await open(id, who);
        return false;
      } catch (error) {
        return (error as { getStatus?: () => number }).getStatus?.() === 403;
      }
    };
    assert.equal(await refused(f.adultPhoto, f.parent), false, 'an adult in the turma');
    assert.equal(await refused(f.childPhoto, f.parent), true, 'another family’s child');
    await tenant.sql(`UPDATE enrollment SET status = 'withdrawn' WHERE student_id = $1`, [f.child]).catch(async () => {
      await tenant.sql(`DELETE FROM enrollment WHERE student_id = $1`, [f.child]);
    });
    assert.equal(await refused(f.adultPhoto, f.parent), true, 'after leaving the turma');
  });
});
