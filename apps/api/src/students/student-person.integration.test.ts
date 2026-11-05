import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutTenantScope } from '@poolse/db';
import { StudentsController } from './students.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  removeAppUser,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * POOLSE-177 — an edit in the app reaches the student's record.
 *
 * An adult student with a login reads their name, email, birth date and phone
 * from their account, on the record and in the list alike; a guardian's phone
 * reads through to the child's *Contactos*. The office may correct a linked
 * adult's birth date and phone and may not rename them. A minor with a login,
 * and a student with none, are exactly what they were.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

async function login(tenant: ScratchTenant, tag: string, first: string, last: string): Promise<{ clerk: string; id: string }> {
  const clerk = `user_${tag}_${tenant.organizationId.slice(0, 8)}`;
  const id = await withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT provision_app_user($1, $2, $3, $4, NULL, now()) AS id`,
      [clerk, `${clerk}@example.test`, first, last],
    );
    return rows[0]!.id;
  });
  return { clerk, id };
}

async function linkLogin(tenant: ScratchTenant, membershipId: string, appUserId: string): Promise<void> {
  await tenant.sql(
    `UPDATE membership SET app_user_id = $2, first_name = NULL, last_name = NULL, email = NULL WHERE id = $1`,
    [membershipId, appUserId],
  );
}

/** Lets the tenant's teardown and `removeAppUser` run in either order. */
async function unlink(tenant: ScratchTenant, membershipId: string): Promise<void> {
  await tenant.sql(
    `UPDATE membership SET app_user_id = NULL, first_name = 'Saiu', last_name = 'Daqui' WHERE id = $1`,
    [membershipId],
  );
}

async function student(
  tenant: ScratchTenant,
  values: { first: string; last: string; born: string; phone?: string; membershipId?: string },
): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_phone, membership_id)
     VALUES ($1, $2, $3, $4::date, $5, $6) RETURNING id`,
    [tenant.organizationId, values.first, values.last, values.born, values.phone ?? null, values.membershipId ?? null],
  );
  return row!.id;
}

/** What the student form posts: every field, as the record showed it. */
function formOf(record: Awaited<ReturnType<StudentsController['one']>>): Record<string, unknown> {
  return {
    firstName: record.firstName,
    lastName: record.lastName,
    birthDate: record.birthDate,
    contactEmail: record.contactEmail,
    contactPhone: record.contactPhone,
    adultConsent: true,
  };
}

async function asOwner<T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> {
  return actingAs(tenant, { roles: ['owner'] }, fn);
}

test('an adult with a login: the app’s phone is on the record and the list, and search finds their account’s name (QA 1, 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await login(tenant, 'adult', 'Inês', 'Conta');
    const membershipId = await addMember(tenant, 'Ines', 'Clube', ['student']);
    await linkLogin(tenant, membershipId, person.id);
    try {
      const id = await student(tenant, { first: 'Ines', last: 'Clube', born: '1990-03-04', phone: '910000000', membershipId });
      const routes = new StudentsController();

      // What `PUT /me/profile` writes, on the account.
      await tenant.sql(`UPDATE app_user SET contact_phone = '919999999' WHERE id = $1`, [person.id]);

      const record = await asOwner(tenant, () => routes.one(id));
      assert.equal(record.contactPhone, '919999999');
      assert.equal(record.firstName, 'Inês');
      assert.equal(record.lastName, 'Conta');
      assert.equal(record.identityFromLogin, true);
      // No birth date on the account yet: the club's stands.
      assert.equal(record.birthDate, '1990-03-04');

      const list = await asOwner(tenant, () => routes.list('Conta'));
      assert.deepEqual(list.students.items.map((one) => one.id), [id]);
      assert.equal(list.students.items[0]!.contactPhone, '919999999');
      const oldName = await asOwner(tenant, () => routes.list('Clube'));
      assert.deepEqual(oldName.students.items.map((one) => one.id), [], 'the list and the record agree');
    } finally {
      await unlink(tenant, membershipId);
      await removeAppUser(person.clerk);
    }
  });
});

test('a student the club has no birth date for reads through, both ways (Rui’s own account, 05-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await login(tenant, 'blank', 'Inês', 'Conta');
    const membershipId = await addMember(tenant, 'Ines', 'Clube', ['student']);
    await linkLogin(tenant, membershipId, person.id);
    try {
      const [row] = await tenant.sql<{ id: string }>(
        `INSERT INTO student (organization_id, first_name, last_name, membership_id) VALUES ($1, 'Ines', 'Clube', $2) RETURNING id`,
        [tenant.organizationId, membershipId],
      );
      const id = row!.id;
      await tenant.sql(`UPDATE app_user SET birth_date = '1990-09-05', contact_phone = '967000000' WHERE id = $1`, [person.id]);
      const routes = new StudentsController();

      // From the phone to the desk.
      const record = await asOwner(tenant, () => routes.one(id));
      assert.equal(record.birthDate, '1990-09-05');
      assert.equal(record.contactPhone, '967000000');
      assert.equal(record.identityFromLogin, true);

      // From the desk to the phone, and the rules gain the club's own date.
      await asOwner(tenant, () => routes.update(id, { ...formOf(record), contactPhone: '967111111' }));
      const [account] = await tenant.sql<{ contact_phone: string }>(
        `SELECT contact_phone FROM app_user WHERE id = $1`,
        [person.id],
      );
      assert.equal(account!.contact_phone, '967111111');
      const [own] = await tenant.sql<{ birth_date: string }>(
        `SELECT birth_date::text AS birth_date FROM student WHERE id = $1`,
        [id],
      );
      assert.equal(own!.birth_date, '1990-09-05');
    } finally {
      await unlink(tenant, membershipId);
      await removeAppUser(person.clerk);
    }
  });
});

test('a guardian’s phone in the app is on the child’s Contactos, and the child is untouched (QA 2)', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await login(tenant, 'guardian', 'Marta', 'Conta');
    const guardianId = await addMember(tenant, 'Marta', 'Clube', ['guardian']);
    await linkLogin(tenant, guardianId, person.id);
    await tenant.sql(`UPDATE membership SET tax_number = '123456789' WHERE id = $1`, [guardianId]);
    try {
      const child = await student(tenant, { first: 'Rita', last: 'Conta', born: '2017-03-04', phone: '920000000' });
      await tenant.sql(
        `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
         VALUES ($1, $2, $3, 'mae', true)`,
        [tenant.organizationId, child, guardianId],
      );
      await tenant.sql(`UPDATE app_user SET contact_phone = '933333333' WHERE id = $1`, [person.id]);

      const record = await asOwner(tenant, () => new StudentsController().one(child));
      assert.equal(record.guardians[0]!.phone, '933333333');
      assert.equal(record.contactPhone, '920000000');
      assert.equal(record.identityFromLogin, false);
    } finally {
      await unlink(tenant, guardianId);
      await removeAppUser(person.clerk);
    }
  });
});

test('the office may correct a linked adult’s birth date and phone, and may not rename them (QA 3)', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await login(tenant, 'office', 'Inês', 'Conta');
    const membershipId = await addMember(tenant, 'Ines', 'Clube', ['student']);
    await linkLogin(tenant, membershipId, person.id);
    try {
      const id = await student(tenant, { first: 'Ines', last: 'Clube', born: '1990-03-04', phone: '910000000', membershipId });
      const routes = new StudentsController();
      const record = await asOwner(tenant, () => routes.one(id));

      await expectStatus(() => asOwner(tenant, () => routes.update(id, { ...formOf(record), firstName: 'Outra' })), 409);
      await expectStatus(
        () => asOwner(tenant, () => routes.update(id, { ...formOf(record), contactEmail: 'outro@example.test' })),
        409,
      );

      await asOwner(tenant, () =>
        routes.update(id, { ...formOf(record), birthDate: '1989-02-03', contactPhone: '911111111' }),
      );

      const [account] = await tenant.sql<{ birth_date: string; contact_phone: string }>(
        `SELECT birth_date::text AS birth_date, contact_phone FROM app_user WHERE id = $1`,
        [person.id],
      );
      assert.deepEqual(account, { birth_date: '1989-02-03', contact_phone: '911111111' });

      const [own] = await tenant.sql<{ first_name: string; birth_date: string }>(
        `SELECT first_name, birth_date::text AS birth_date FROM student WHERE id = $1`,
        [id],
      );
      assert.equal(own!.first_name, 'Ines', 'the club’s own name is not overwritten with the login’s');
      assert.equal(own!.birth_date, '1989-02-03', 'the rules read this one');

      const [entry] = await tenant.sql<{ data: { withheld: string[] } }>(
        `SELECT data FROM audit_log
          WHERE entity_id = $1 AND action = 'student.updated' ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      assert.deepEqual([...entry!.data.withheld].sort(), ['birthDate', 'contactPhone']);
    } finally {
      await unlink(tenant, membershipId);
      await removeAppUser(person.clerk);
    }
  });
});

test('saving a linked adult’s form untouched moves nothing and logs no change', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await login(tenant, 'noop', 'Inês', 'Conta');
    const membershipId = await addMember(tenant, 'Ines', 'Clube', ['student']);
    await linkLogin(tenant, membershipId, person.id);
    try {
      const id = await student(tenant, { first: 'Ines', last: 'Clube', born: '1990-03-04', phone: '910000000', membershipId });
      const routes = new StudentsController();
      const record = await asOwner(tenant, () => routes.one(id));
      await asOwner(tenant, () => routes.update(id, formOf(record)));

      const [entry] = await tenant.sql<{ data: { withheld?: string[] } }>(
        `SELECT data FROM audit_log
          WHERE entity_id = $1 AND action = 'student.updated' ORDER BY created_at DESC LIMIT 1`,
        [id],
      );
      assert.deepEqual(entry!.data.withheld ?? [], []);
    } finally {
      await unlink(tenant, membershipId);
      await removeAppUser(person.clerk);
    }
  });
});

test('a minor with a login and a student with none are the club’s record, and the office edits them as ever (QA 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const person = await login(tenant, 'minor', 'Tomás', 'Conta');
    const membershipId = await addMember(tenant, 'Tomas', 'Clube', ['student']);
    await linkLogin(tenant, membershipId, person.id);
    try {
      const year = new Date().getUTCFullYear();
      const minor = await student(tenant, { first: 'Tomas', last: 'Clube', born: `${year - 13}-01-01`, phone: '940000000', membershipId });
      const plain = await student(tenant, { first: 'Sem', last: 'Login', born: '1980-01-01', phone: '950000000' });
      await tenant.sql(`UPDATE app_user SET contact_phone = '949999999' WHERE id = $1`, [person.id]);
      const routes = new StudentsController();

      const record = await asOwner(tenant, () => routes.one(minor));
      assert.equal(record.firstName, 'Tomas');
      assert.equal(record.contactPhone, '940000000');
      assert.equal(record.identityFromLogin, false);

      const other = await asOwner(tenant, () => routes.one(plain));
      await asOwner(tenant, () => routes.update(plain, { ...formOf(other), firstName: 'Novo' }));
      assert.equal((await asOwner(tenant, () => routes.one(plain))).firstName, 'Novo');
    } finally {
      await unlink(tenant, membershipId);
      await removeAppUser(person.clerk);
    }
  });
});

test('an instructor may not edit a linked student at all (permission denial)', async () => {
  await withScratchTenant(async (tenant) => {
    const id = await student(tenant, { first: 'Sem', last: 'Login', born: '1980-01-01' });
    await expectStatus(
      () => actingAs(tenant, { roles: ['instructor'] }, () => new StudentsController().update(id, { firstName: 'X' })),
      403,
    );
  });
});
