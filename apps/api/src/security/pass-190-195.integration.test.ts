import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AppController } from '../app/app.controller.js';
import { AvisosController } from '../messages/avisos.controller.js';
import { StudentMessagesController } from '../messages/student-messages.controller.js';
import { BoletimController } from '../students/documents.controller.js';
import { completeFpnForm } from '../test/fpn-fixture.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The security pass of 06-11-2026 over POOLSE-190 to 195: each finding that could
 * come back, pinned.
 *
 * Run: pnpm api:test
 */

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
after(async () => {
  await owner.end();
  await closeHarness();
});

async function student(tenant: ScratchTenant, first: string, birth: string, membership: string | null = null): Promise<string> {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id, contact_phone)
     VALUES ($1, $2, 'Silva', $3::date, $4, '912345678') RETURNING id`,
    [tenant.organizationId, first, birth, membership],
  );
  return row!.id;
}

async function enrol(tenant: ScratchTenant, id: string, instructor: string | null = null): Promise<void> {
  const [group] = await tenant.sql<{ id: string }>(
    `INSERT INTO class_group (organization_id, season_id, facility_id, name, instructor_membership_id)
     VALUES ($1, $2, $3, 'Turma ' || gen_random_uuid(), $4) RETURNING id`,
    [tenant.organizationId, tenant.seasonId, tenant.facilityId, instructor],
  );
  await tenant.sql(
    `INSERT INTO enrollment (organization_id, class_group_id, student_id, status, joined_on)
     VALUES ($1, $2, $3, 'active', club_today() - 10)`,
    [tenant.organizationId, group!.id, id],
  );
}

test('a date of birth only typed opens neither the FPN details nor the form', async () => {
  await withScratchTenant(async (tenant) => {
    const login = await addMember(tenant, 'Rita', 'Silva', ['student']);
    const id = await student(tenant, 'Rita', '1990-01-01', login);
    await enrol(tenant, id);
    await completeFpnForm(tenant, id);
    await tenant.sql(`UPDATE student SET birth_date_declared_at = now() WHERE id = $1`, [id]);

    await actingAs(tenant, { membershipId: login, roles: ['student'] }, async () => {
      const app = new AppController();
      await expectStatus(() => app.fpnReview(id), 403);
      await expectStatus(() => app.saveFpnDetails(id, { disciplines: ['pura'] }), 403);
      const { children } = await app.documents(id);
      const row = children[0]!.documents.find((one) => one.kind === 'fpn_declaration')!;
      assert.equal(row.print, null);
      assert.equal(row.awaitsDate, true);
    });

    await tenant.sql(`UPDATE student SET birth_date_declared_at = NULL, birth_date_verified_at = now() WHERE id = $1`, [id]);
    await actingAs(tenant, { membershipId: login, roles: ['student'] }, async () => {
      assert.equal((await new AppController().fpnReview(id)).idDocumentNumber, '12345678');
    });
  });
});

test('a minor’s own login does not get the ID number from the boletim', async () => {
  await withScratchTenant(async (tenant) => {
    const login = await addMember(tenant, 'Alice', 'Silva', ['student']);
    const id = await student(tenant, 'Alice', '2016-01-01', login);
    await completeFpnForm(tenant, id);
    const form = await actingAs(tenant, { membershipId: login, roles: ['student'] }, () => new BoletimController().print(id));
    assert.equal(form.idDocumentNumber, null);
  });
});

test('an instructor gets no WhatsApp link to a child’s own phone; the office and an adult’s remain', async () => {
  await withScratchTenant(async (tenant) => {
    const coach = await addMember(tenant, 'Nuno', 'Costa', ['instructor']);
    const child = await student(tenant, 'Alice', '2016-01-01');
    const adult = await student(tenant, 'Carlos', '1990-01-01');
    await enrol(tenant, child, coach);
    await enrol(tenant, adult, coach);
    const words = { channel: 'whatsapp', subject: 'a', body: 'b' };
    const tab = new StudentMessagesController();

    await actingAs(tenant, { membershipId: coach, roles: ['instructor'] }, async () => {
      assert.equal((await tab.list(child)).recipients[0]!.hasPhone, false);
      await expectStatus(() => tab.send(child, words), 409);
      assert.equal((await tab.send(adult, words)).links!.length, 1);
    });
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      assert.equal((await tab.send(child, words)).links!.length, 1);
    });
  });
});

test('a child no FPN form is asked of has nothing to correct, and an ID group sent in part is refused', async () => {
  await withScratchTenant(async (tenant) => {
    const guardian = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
    const id = await student(tenant, 'Alice', '2016-01-01');
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true)`,
      [tenant.organizationId, id, guardian],
    );
    const app = new AppController();
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, () =>
      expectStatus(() => app.saveFpnDetails(id, { disciplines: ['pura'] }), 404),
    );
    await enrol(tenant, id);
    await actingAs(tenant, { membershipId: guardian, roles: ['guardian'] }, () =>
      expectStatus(() => app.saveFpnDetails(id, { idDocumentType: 'other' }), 400),
    );
  });
});

test('a personal aviso is not ended through the general route, which would log its subject', async () => {
  await withScratchTenant(async (tenant) => {
    const adult = await student(tenant, 'Carlos', '1990-01-01');
    await tenant.sql(`UPDATE student SET contact_email = 'c@x.pt' WHERE id = $1`, [adult]);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new StudentMessagesController().send(adult, {
        channel: 'email',
        subject: 'Privado',
        body: 'b',
        shownUntil: '2099-01-01',
      });
    });
    const [aviso] = await tenant.sql<{ id: string }>(
      `SELECT id FROM message WHERE student_id = $1 AND channel = 'app'`,
      [adult],
    );
    await actingAs(tenant, { roles: ['owner'] }, () => expectStatus(() => new AvisosController().archive(aviso!.id), 404));
  });
});
