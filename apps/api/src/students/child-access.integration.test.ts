import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutTenantScope } from '@poolse/db';
import { StudentsController } from './students.controller.js';
import { FamilyInvitationsBulkController } from './family-invitations.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  ownerSql,
  removeAppUser,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * POOLSE-218 — a child's access is the guardian's.
 *
 * The door: *Convidar aluno* asks who uses the app, and the guardian option
 * makes student, guardian, parental link and a guardian's invitation together.
 * The safety net: a record whose own login is really a parent's (a confirmed
 * age under 12) is turned round by *O acesso é do encarregado*.
 *
 * Run: pnpm api:test
 */

after(closeHarness);

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
}

const owner = <T>(tenant: ScratchTenant, fn: () => Promise<T>): Promise<T> => actingAs(tenant, { roles: ['owner'] }, fn);

test('the guardian option creates the child, the guardian, a parental primary link and a guardian invitation (QA 1)', async () => {
  await withScratchTenant(async (tenant) => {
    const issued = await owner(tenant, () =>
      new FamilyInvitationsBulkController().newStudent({
        for: 'guardian',
        firstName: 'Tomás',
        lastName: 'Silva',
        birthDate: yearsAgo(2),
        guardianFirstName: 'Maria',
        guardianLastName: 'Silva',
        guardianEmail: 'maria.silva@familia.test',
        guardianPhone: '915000000',
        guardianRelationship: 'Mãe',
      }),
    );
    assert.ok('guardian' in issued && issued.guardian === 'invited');
    assert.match(issued.link ?? '', /\/join\?token=/);

    const [row] = await tenant.sql<{
      student_login: string | null;
      guardian: string;
      kind: string;
      primary: boolean;
      roles: string[];
      invited: string;
      name: string;
    }>(
      `SELECT s.membership_id AS student_login, g.guardian_membership_id AS guardian, g.kind::text AS kind,
              g.is_primary AS primary, i.roles::text[] AS roles, i.membership_id AS invited,
              m.first_name || ' ' || m.last_name AS name
         FROM student s
         JOIN guardian_link g ON g.student_id = s.id AND g.archived_at IS NULL
         JOIN membership m ON m.id = g.guardian_membership_id
         JOIN invitation i ON i.id = $2
        WHERE s.id = $1`,
      [issued.studentId, issued.invitationId],
    );
    assert.equal(row!.student_login, null, 'the child has no login');
    assert.equal(row!.kind, 'parental');
    assert.equal(row!.primary, true);
    assert.deepEqual(row!.roles, ['guardian']);
    assert.equal(row!.invited, row!.guardian, 'the invitation names the guardian');
    assert.equal(row!.name, 'Maria Silva');
  });
});

test('an admin cannot point the guardian invitation at a member of staff or at another address (13-11-2026)', async () => {
  await withScratchTenant(async (tenant) => {
    const admin = await addMember(tenant, 'Sandra', 'Marques', ['admin']);
    const coach = await addMember(tenant, 'Rui', 'Treinador', ['instructor']);
    const parent = await addMember(tenant, 'Joana', 'Costa', ['guardian']);
    await tenant.sql(`UPDATE membership SET tax_number = '123456789' WHERE id = $1`, [coach]);
    await tenant.sql(`UPDATE membership SET tax_number = '234567899' WHERE id = $1`, [parent]);
    const [onFile] = await tenant.sql<{ email: string }>('SELECT person_email($1)::text AS email', [parent]);

    const routes = new FamilyInvitationsBulkController();
    const child = (taxNumber: string, email: string) => ({
      for: 'guardian',
      firstName: 'Tomás',
      lastName: 'Costa',
      birthDate: yearsAgo(6),
      guardianFirstName: 'Joana',
      guardianLastName: 'Costa',
      guardianEmail: email,
      guardianTaxNumber: taxNumber,
      guardianRelationship: 'Mãe',
    });
    const asAdmin = <T>(fn: () => Promise<T>) => actingAs(tenant, { membershipId: admin, roles: ['admin'] }, fn);

    await asAdmin(() => expectStatus(() => routes.newStudent(child('123456789', 'outro@familia.test')), 403));
    await asAdmin(() => expectStatus(() => routes.newStudent(child('234567899', 'outro@familia.test')), 403));
    const [left] = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM student WHERE organization_id = $1',
      [tenant.organizationId],
    );
    assert.equal(left?.n ?? 0, 0, 'a refusal leaves no child behind');

    // The sibling's parent, invited to the address the club already has: the office's.
    const sibling = await asAdmin(() => routes.newStudent(child('234567899', onFile!.email)));
    assert.ok('guardian' in sibling);

    // The Owner may do either.
    const byOwner = await owner(tenant, () =>
      routes.newStudent({ ...child('123456789', 'outro@familia.test'), firstName: 'Inês' }),
    );
    assert.ok('guardian' in byOwner);
  });
});

test('the guardian option needs a date of birth and a guardian who can be told apart', async () => {
  await withScratchTenant(async (tenant) => {
    const routes = new FamilyInvitationsBulkController();
    const base = { for: 'guardian', firstName: 'Tomás', lastName: 'Silva', guardianFirstName: 'Maria', guardianLastName: 'Silva' };
    await owner(tenant, () => expectStatus(() => routes.newStudent({ ...base, guardianEmail: 'a@b.test' }), 400));
    // A phone alone does not tell one parent from another (POOLSE-17): email or NIF.
    await owner(tenant, () =>
      expectStatus(() => routes.newStudent({ ...base, birthDate: yearsAgo(2), guardianPhone: '915000000' }), 400),
    );
    const [count] = await tenant.sql<{ n: number }>(`SELECT count(*)::int AS n FROM student`);
    assert.equal(count!.n, 0, 'nothing is left behind');
  });
});

test('the student option refuses a child under 12 and leaves nothing behind (QA 3); no date is as before (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    const routes = new FamilyInvitationsBulkController();
    await owner(tenant, () =>
      expectStatus(
        () => routes.newStudent({ firstName: 'Rita', lastName: 'Nova', phone: '916000000', birthDate: yearsAgo(8) }),
        422,
      ),
    );
    const [none] = await tenant.sql<{ n: number }>(`SELECT count(*)::int AS n FROM student`);
    assert.equal(none!.n, 0);

    const issued = await owner(tenant, () => routes.newStudent({ firstName: 'Rita', lastName: 'Nova', phone: '916000000' }));
    assert.match(issued.link ?? '', /\/join\?token=/);
  });
});

/** A student whose own login is a parent's: Rui's case of 10-11-2026. */
async function wrongLogin(
  tenant: ScratchTenant,
  years: number,
  declared = false,
): Promise<{ studentId: string; membershipId: string; appUserId: string; clerk: string; born: string }> {
  const born = yearsAgo(years);
  const clerk = `user_child_${tenant.organizationId.slice(0, 8)}_${years}${declared ? 'd' : ''}`;
  const appUserId = await withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT provision_app_user($1, $2, 'Maria', 'Silva', NULL, now()) AS id`,
      [clerk, `${clerk}@example.test`],
    );
    return rows[0]!.id;
  });
  const membershipId = await addMember(tenant, 'Maria', 'Silva', ['student']);
  await tenant.sql(
    `UPDATE membership SET app_user_id = $2, first_name = NULL, last_name = NULL, email = NULL WHERE id = $1`,
    [membershipId, appUserId],
  );
  // The owner connection: with no club in scope, row security hides the login.
  await ownerSql(`UPDATE app_user SET birth_date = $2::date WHERE id = $1`, [appUserId, born]);
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id, birth_date_declared_at)
     VALUES ($1, 'Tomás', 'Silva', $2::date, $3, $4) RETURNING id`,
    [tenant.organizationId, born, membershipId, declared ? new Date() : null],
  );
  await tenant.sql(
    `INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
     VALUES ($1, $2, 'photo', true, $3)`,
    [tenant.organizationId, student!.id, membershipId],
  );
  return { studentId: student!.id, membershipId, appUserId, clerk, born };
}

test('a confirmed age under 12 on the student’s own login is flagged, and handed to the guardian (QA 5, 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const child = await wrongLogin(tenant, 2);
    try {
      const before = await owner(tenant, () => new StudentsController().one(child.studentId));
      assert.equal(before.loginChildAge, 2);

      const done = await owner(tenant, () => new StudentsController().handToGuardian(child.studentId));
      assert.deepEqual(done, { kind: 'done', consentsEnded: 1, birthDateCleared: true });

      const [after] = await tenant.sql<{ login: string | null; roles: string[]; kind: string; primary: boolean; first: string }>(
        `SELECT s.membership_id AS login,
                (SELECT array_agg(r.role::text ORDER BY r.role) FROM membership_role r
                  WHERE r.membership_id = $2 AND r.archived_at IS NULL) AS roles,
                g.kind::text AS kind, g.is_primary AS primary, sp.first_name AS first
           FROM student s
           JOIN guardian_link g ON g.student_id = s.id AND g.guardian_membership_id = $2 AND g.archived_at IS NULL
           JOIN student_person sp ON sp.id = s.id
          WHERE s.id = $1`,
        [child.studentId, child.membershipId],
      );
      assert.equal(after!.login, null);
      assert.deepEqual(after!.roles, ['guardian']);
      assert.equal(after!.kind, 'parental');
      assert.equal(after!.primary, true);
      assert.equal(after!.first, 'Tomás', 'the record reads its own name now');

      const [born] = await tenant.sql<{ birth_date: string | null }>(
        `SELECT birth_date::text FROM app_user WHERE id = $1`,
        [child.appUserId],
      );
      assert.equal(born!.birth_date, null, 'the child’s date leaves the parent’s account');

      const [consent] = await tenant.sql<{ live: number }>(
        `SELECT count(*)::int AS live FROM consent WHERE student_id = $1 AND withdrawn_at IS NULL`,
        [child.studentId],
      );
      assert.equal(consent!.live, 0, 'the guardian is asked again');

      const [audit] = await tenant.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'student.access_handed_to_guardian' AND entity_id = $1`,
        [child.studentId],
      );
      assert.equal(audit!.n, 1);

      const again = await owner(tenant, () => new StudentsController().one(child.studentId));
      assert.equal(again.loginChildAge, null, 'the warning is gone');
      await owner(tenant, () => expectStatus(() => new StudentsController().handToGuardian(child.studentId), 409));
    } finally {
      await tenant.sql(`UPDATE membership SET app_user_id = NULL, first_name = 'Maria', last_name = 'Silva', email = 'm-' || $1::text || '@familia.test' WHERE id = $1`, [
        child.membershipId,
      ]);
      await removeAppUser(child.clerk);
    }
  });
});

test('no warning at 12 or more, nor on a declared date (QA 7)', async () => {
  await withScratchTenant(async (tenant) => {
    const teen = await wrongLogin(tenant, 13);
    const declared = await wrongLogin(tenant, 3, true);
    try {
      for (const one of [teen, declared]) {
        const read = await owner(tenant, () => new StudentsController().one(one.studentId));
        assert.equal(read.loginChildAge, null);
        await owner(tenant, () => expectStatus(() => new StudentsController().handToGuardian(one.studentId), 409));
      }
    } finally {
      for (const one of [teen, declared]) {
        await tenant.sql(`UPDATE membership SET app_user_id = NULL, first_name = 'Maria', last_name = 'Silva', email = 'm-' || $1::text || '@familia.test' WHERE id = $1`, [
          one.membershipId,
        ]);
        await removeAppUser(one.clerk);
      }
    }
  });
});

test('an instructor and a support session are refused; another club’s student is not found (QA 8, 9)', async () => {
  await withScratchTenant(async (mine) => {
    await withScratchTenant(async (theirs) => {
      const child = await wrongLogin(theirs, 2);
      try {
        const instructor = await addMember(theirs, 'Ana', 'Ribeiro', ['instructor']);
        await actingAs(theirs, { membershipId: instructor, roles: ['instructor'] }, () =>
          expectStatus(() => new StudentsController().handToGuardian(child.studentId), 403),
        );
        await actingAs(theirs, { roles: ['admin'], support: true }, () =>
          expectStatus(() => new StudentsController().handToGuardian(child.studentId), 403),
        );
        await owner(mine, () => expectStatus(() => new StudentsController().handToGuardian(child.studentId), 404));
        const [still] = await theirs.sql<{ login: string | null }>(`SELECT membership_id AS login FROM student WHERE id = $1`, [
          child.studentId,
        ]);
        assert.equal(still!.login, child.membershipId, 'nothing changed');
      } finally {
        await theirs.sql(`UPDATE membership SET app_user_id = NULL, first_name = 'Maria', last_name = 'Silva', email = 'm-' || $1::text || '@familia.test' WHERE id = $1`, [
          child.membershipId,
        ]);
        await removeAppUser(child.clerk);
      }
    });
  });
});
