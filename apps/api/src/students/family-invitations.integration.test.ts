import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassesController } from '../classes/classes.controller.js';
import { InvitationsController } from '../invitations/invitations.controller.js';
import { PeopleController } from '../invitations/people.controller.js';
import { StudentsController } from './students.controller.js';
import {
  FamilyInvitationsBulkController,
  StudentInvitationsController,
} from './family-invitations.controller.js';
import { FAMILY_INVITATION_DAILY_CEILING } from './family-invitations.repository.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * POOLSE-129 — a family is invited from the student's record (Rui, 30-10-2026).
 *
 * The QA list of the ticket, against the real database as the app login: the
 * invitation names the guardian the club already has (no second person), a
 * phone-only family gets a link with no address, a child is invitable from 12,
 * one live invitation per person, *Convidar famílias* previews then sends and
 * stops at the daily ceiling, an instructor reaches only their own turmas, and
 * Pessoas neither invites nor lists a family.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  childId: string;
  teenId: string;
  motherId: string;
  fatherId: string;
  instructorId: string;
  otherInstructorId: string;
  adminId: string;
}

/** Years ago, as a date the student's birth_date can hold. */
function yearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString().slice(0, 10);
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const adminId = await addMember(tenant, 'Carla', 'Admin', ['admin']);
  const instructorId = await addMember(tenant, 'Ana', 'Ribeiro', ['instructor']);
  const otherInstructorId = await addMember(tenant, 'Beatriz', 'Outra', ['instructor']);

  const [pool] = await tenant.sql<{ id: string }>(
    `INSERT INTO pool (organization_id, facility_id, name, kind)
     VALUES ($1, $2, 'Tanque', 'indoor') RETURNING id`,
    [org, tenant.facilityId],
  );
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name) VALUES ($1, 'Iniciados') RETURNING id`,
    [org],
  );

  // Eleven: no login of her own yet. Fourteen: invitable himself.
  const [child] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, level_id)
     VALUES ($1, 'Inês', 'Lopes', $2, $3) RETURNING id`,
    [org, yearsAgo(11), level!.id],
  );
  const [teen] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email, level_id)
     VALUES ($1, 'Tomás', 'Lopes', $2, 'tomas@familia.test', $3) RETURNING id`,
    [org, yearsAgo(14), level!.id],
  );

  // The mother has an address; the father only a phone and a NIF.
  const [mother] = await tenant.sql<{ id: string }>(
    `INSERT INTO membership (organization_id, status, first_name, last_name, email, phone)
     VALUES ($1, 'active', 'Eva', 'Lopes', 'eva@familia.test', '912000111') RETURNING id`,
    [org],
  );
  const [father] = await tenant.sql<{ id: string }>(
    `INSERT INTO membership (organization_id, status, first_name, last_name, tax_number, phone)
     VALUES ($1, 'active', 'Rui', 'Lopes', '123456789', '913000222') RETURNING id`,
    [org],
  );
  for (const id of [mother!.id, father!.id]) {
    await tenant.sql(
      `INSERT INTO membership_role (organization_id, membership_id, role) VALUES ($1, $2, 'guardian')`,
      [org, id],
    );
    for (const studentId of [child!.id, teen!.id]) {
      await tenant.sql(
        `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship)
         VALUES ($1, $2, $3, 'mãe')`,
        [org, studentId, id],
      );
    }
  }

  // Ana teaches Inês; nobody teaches Tomás.
  const { id: groupId } = await actingAs(tenant, { roles: ['owner'] }, async () =>
    new ClassesController().create({
      name: 'Iniciados A',
      poolId: pool!.id,
      lane: 1,
      levelId: level!.id,
      instructorMembershipId: instructorId,
    }),
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status) VALUES ($1, $2, $3, 'active')`,
    [org, groupId, child!.id],
  );

  return {
    childId: child!.id,
    teenId: teen!.id,
    motherId: mother!.id,
    fatherId: father!.id,
    instructorId,
    otherInstructorId,
    adminId,
  };
}

const asAdmin = <T>(tenant: ScratchTenant, f: Family, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId: f.adminId, roles: ['admin'] }, fn);

test('QA 3, 4, 6, 7 — the record lists who can be invited; a link names the guardian the club has', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    const routes = new StudentInvitationsController();
    const before = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM membership WHERE organization_id = $1',
      [tenant.organizationId],
    );

    // QA 6: an eleven-year-old has no row of her own; a fourteen-year-old has.
    const child = await asAdmin(tenant, f, () => routes.list(f.childId));
    assert.deepEqual(child.invitees.map((i) => i.kind).sort(), ['guardian', 'guardian']);
    assert.equal(child.canInvite, true);
    const teen = await asAdmin(tenant, f, () => routes.list(f.teenId));
    assert.deepEqual(teen.invitees.map((i) => i.kind).sort(), ['guardian', 'guardian', 'self']);

    // QA 3: the mother, by email, to her own record.
    const sent = await asAdmin(tenant, f, () =>
      routes.create(f.childId, { membershipId: f.motherId, channel: 'email' }),
    );
    assert.equal(sent.email, 'eva@familia.test');
    assert.match(sent.link, /\/join\?token=/);

    // QA 4: the father has no address — a link, with none.
    const shared = await asAdmin(tenant, f, () =>
      routes.create(f.childId, { membershipId: f.fatherId, channel: 'link' }),
    );
    assert.equal(shared.email, null);
    assert.equal(shared.emailed, false);

    const [rows] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM invitation
        WHERE organization_id = $1 AND membership_id = ANY($2) AND accepted_at IS NULL AND revoked_at IS NULL`,
      [tenant.organizationId, [f.motherId, f.fatherId]],
    );
    assert.equal(rows!.n, 2, 'both invitations name the guardians themselves');
    const after = await tenant.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM membership WHERE organization_id = $1',
      [tenant.organizationId],
    );
    assert.equal(after[0]!.n, before[0]!.n, 'no placeholder: nobody new exists');

    const listed = await asAdmin(tenant, f, () => routes.list(f.childId));
    assert.deepEqual(listed.invitees.map((i) => i.state), ['invited', 'invited']);

    // QA 7: one live invitation per person; a new link replaces it, same person.
    await asAdmin(tenant, f, () =>
      expectStatus(() => routes.create(f.childId, { membershipId: f.fatherId, channel: 'link' }), 409),
    );
    const renewed = await asAdmin(tenant, f, () => routes.reissue(f.childId, shared.invitationId));
    assert.notEqual(renewed.invitationId, shared.invitationId);
    const [target] = await tenant.sql<{ membership_id: string }>(
      'SELECT membership_id FROM invitation WHERE id = $1',
      [renewed.invitationId],
    );
    assert.equal(target!.membership_id, f.fatherId, 'the new link is still the father’s own');

    // Revoking leaves the father's record alone.
    await asAdmin(tenant, f, () => routes.revoke(f.childId, renewed.invitationId));
    const [father] = await tenant.sql<{ archived_at: Date | null }>(
      'SELECT archived_at FROM membership WHERE id = $1',
      [f.fatherId],
    );
    assert.equal(father!.archived_at, null);

    // The teen invites himself: a membership is made for him, carrying `student`.
    const self = await asAdmin(tenant, f, () => routes.create(f.teenId, { membershipId: null, channel: 'email' }));
    assert.equal(self.email, 'tomas@familia.test');
    const [teenRow] = await tenant.sql<{ role: string }>(
      `SELECT mr.role::text AS role FROM student s
         JOIN membership_role mr ON mr.membership_id = s.membership_id AND mr.archived_at IS NULL
        WHERE s.id = $1`,
      [f.teenId],
    );
    assert.equal(teenRow?.role, 'student');
  });
});

test('QA 5 of the row — an address typed on the row is saved on the person, and a taken one is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    const routes = new StudentInvitationsController();
    await asAdmin(tenant, f, () =>
      expectStatus(() => routes.create(f.childId, { membershipId: f.fatherId, channel: 'email' }), 400),
    );
    await asAdmin(tenant, f, () =>
      expectStatus(
        () => routes.create(f.childId, { membershipId: f.fatherId, channel: 'email', email: 'eva@familia.test' }),
        409,
      ),
    );
    const sent = await asAdmin(tenant, f, () =>
      routes.create(f.childId, { membershipId: f.fatherId, channel: 'email', email: 'Rui@Familia.test ' }),
    );
    assert.equal(sent.email, 'rui@familia.test');
    const [saved] = await tenant.sql<{ email: string }>('SELECT email::text AS email FROM membership WHERE id = $1', [
      f.fatherId,
    ]);
    assert.equal(saved!.email, 'rui@familia.test');
  });
});

test('QA 1, 2 — Pessoas invites and lists staff only', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    await asAdmin(tenant, f, () =>
      expectStatus(
        () => new InvitationsController().create({ email: 'mae@example.test', roles: ['guardian'] }),
        422,
      ),
    );
    const people = await asAdmin(tenant, f, () => new PeopleController().list('staff'));
    assert.equal(people.grantableRoles.includes('guardian'), false);
    assert.equal(people.grantableRoles.includes('student'), false);
    const ids = people.members.items.map((m) => m.membershipId);
    assert.equal(ids.includes(f.motherId), false, 'a guardian is not on Pessoas');

    // A family link is not on Pessoas' pending list either.
    await asAdmin(tenant, f, () =>
      new StudentInvitationsController().create(f.childId, { membershipId: f.fatherId, channel: 'link' }),
    );
    const again = await asAdmin(tenant, f, () => new PeopleController().list('staff'));
    assert.equal(again.invitations.length, 0);
  });
});

test('QA 10, 12 — an instructor reaches their own turmas only; another club’s id is not found', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    const routes = new StudentInvitationsController();
    const mine = await actingAs(tenant, { membershipId: f.instructorId, roles: ['instructor'] }, () =>
      routes.list(f.childId),
    );
    assert.equal(mine.canInvite, true);
    await actingAs(tenant, { membershipId: f.instructorId, roles: ['instructor'] }, () =>
      routes.create(f.childId, { membershipId: f.motherId, channel: 'link' }),
    );

    const notMine = await actingAs(tenant, { membershipId: f.otherInstructorId, roles: ['instructor'] }, () =>
      routes.list(f.childId),
    );
    assert.equal(notMine.canInvite, false);
    await actingAs(tenant, { membershipId: f.otherInstructorId, roles: ['instructor'] }, () =>
      expectStatus(() => routes.create(f.childId, { membershipId: f.fatherId, channel: 'link' }), 403),
    );

    // A support session invites nobody.
    await actingAs(tenant, { membershipId: f.adminId, roles: ['admin'], support: true }, () =>
      expectStatus(() => routes.create(f.childId, { membershipId: f.fatherId, channel: 'link' }), 403),
    );

    // A guardian of another student — or of another club — is nobody on this record.
    await withScratchTenant(async (other) => {
      const g = await seed(other);
      await asAdmin(tenant, f, () =>
        expectStatus(() => routes.create(f.childId, { membershipId: g.motherId, channel: 'link' }), 404),
      );
      await asAdmin(tenant, f, () => expectStatus(() => routes.list(g.childId), 404));
    });
  });
});

test('QA 8, 9 — Convidar famílias previews, sends to the addresses, then stops at the ceiling', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    const bulk = new FamilyInvitationsBulkController();

    const preview = await asAdmin(tenant, f, () => bulk.bulk({}));
    // Mother (email) once for both children, father (phone only) once, the teen himself (email).
    assert.equal(preview.students, 2);
    assert.equal(preview.byEmail, 2);
    assert.equal(preview.phoneOnly, 1);
    assert.equal(preview.sent, 0);

    // *Por convidar* lists both students before.
    const pending = await asAdmin(tenant, f, () =>
      new StudentsController().list(undefined, undefined, undefined, undefined, undefined, 'pending'),
    );
    assert.equal(pending.students.total, 2);

    const sent = await asAdmin(tenant, f, () => bulk.bulk({ commit: true }));
    assert.equal(sent.sent, 2);

    const rerun = await asAdmin(tenant, f, () => bulk.bulk({ commit: true }));
    assert.equal(rerun.sent, 0, 'running it again sends nothing');
    assert.equal(rerun.alreadyInvited, 2);

    // Still pending: the father has no address and nobody shared his link.
    const still = await asAdmin(tenant, f, () =>
      new StudentsController().list(undefined, undefined, undefined, undefined, undefined, 'pending'),
    );
    assert.equal(still.students.total, 2);

    // QA 9 — a day already at the ceiling refuses the run whole.
    await tenant.sql(
      `UPDATE invitation SET revoked_at = now() WHERE organization_id = $1 AND accepted_at IS NULL`,
      [tenant.organizationId],
    );
    await tenant.sql(
      `INSERT INTO invitation (organization_id, email, roles, token_hash, expires_at, membership_id,
                               invited_by_membership_id, revoked_at)
       SELECT $1::uuid, NULL, ARRAY['guardian']::member_role[], 'filler-' || g || '-' || $1::text, now() + interval '1 day',
              $2, $3, now()
         FROM generate_series(1, $4::int) g`,
      [tenant.organizationId, f.fatherId, f.adminId, FAMILY_INVITATION_DAILY_CEILING - 1],
    );
    await asAdmin(tenant, f, () => expectStatus(() => bulk.bulk({ commit: true }), 409));
    const [live] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM invitation
        WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [tenant.organizationId],
    );
    assert.equal(live!.n, 0, 'nothing was sent');
  });
});

test('Convidar aluno — a new student is created and invited in one go; the login is that student', async () => {
  await withScratchTenant(async (tenant) => {
    const f = await seed(tenant);
    const routes = new FamilyInvitationsBulkController();

    // A contact is required, and an instructor may not create students.
    await asAdmin(tenant, f, () => expectStatus(() => routes.newStudent({ firstName: 'Lia', lastName: 'Nova' }), 400));
    await actingAs(tenant, { membershipId: f.instructorId, roles: ['instructor'] }, () =>
      expectStatus(() => routes.newStudent({ firstName: 'Lia', lastName: 'Nova', phone: '914000000' }), 403),
    );

    // Phone only: a link, no address.
    const byPhone = await asAdmin(tenant, f, () =>
      routes.newStudent({ firstName: 'Lia', lastName: 'Nova', phone: '914000000' }),
    );
    assert.equal(byPhone.email, null);
    assert.match(byPhone.link, /\/join\?token=/);
    const [lia] = await tenant.sql<{ phone: string; membership_id: string | null; invited: string }>(
      `SELECT s.contact_phone AS phone, s.membership_id, i.membership_id AS invited
         FROM student s JOIN invitation i ON i.id = $2
        WHERE s.id = $1`,
      [byPhone.studentId, byPhone.invitationId],
    );
    assert.equal(lia!.phone, '914000000');
    assert.equal(lia!.invited, lia!.membership_id, 'the invitation names the new student');

    // With an address: emailed (console in tests), the address on the record.
    const byEmail = await asAdmin(tenant, f, () =>
      routes.newStudent({ firstName: 'Rui', lastName: 'Novo', email: 'Rui.Novo@Exemplo.test', phone: '' }),
    );
    assert.equal(byEmail.email, 'rui.novo@exemplo.test');

    // The same address again: refused, and no second student is left behind.
    const before = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM student WHERE organization_id = $1', [
      tenant.organizationId,
    ]);
    await asAdmin(tenant, f, () =>
      expectStatus(() => routes.newStudent({ firstName: 'Rui', lastName: 'Outro', email: 'rui.novo@exemplo.test' }), 409),
    );
    const after = await tenant.sql<{ n: number }>('SELECT count(*)::int AS n FROM student WHERE organization_id = $1', [
      tenant.organizationId,
    ]);
    assert.equal(after[0]!.n, before[0]!.n);
  });
});
