import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { MajorityNoticeService } from './majority-notice.service.js';
import { AppConsentsController } from '../app/app-consents.controller.js';
import { AppController } from '../app/app.controller.js';
import type { Email } from '../notifications/notifier.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-208 — at 18 the family is told once, and the young adult confirms or
 * withdraws what a parent signed.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

interface Family {
  mother: string;
  self: string;
  student: string;
  photo: string;
}

async function turnsToday(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const mother = await addMember(tenant, 'Marta', 'Lopes', ['guardian']);
  await tenant.sql(`UPDATE membership SET email = 'marta-208@exemplo.pt' WHERE id = $1`, [mother]);
  const self = await addMember(tenant, 'Afonso', 'Lopes', ['student']);
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email, membership_id)
     VALUES ($1, 'Afonso', 'Lopes', (club_today() - interval '18 years')::date, 'afonso-208@exemplo.pt', $2)
     RETURNING id`,
    [org, self],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'Mãe', true)`,
    [org, row!.id, mother],
  );
  const [photo] = await tenant.sql<{ id: string }>(
    `INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
     VALUES ($1, $2, 'photo', true, $3) RETURNING id`,
    [org, row!.id, mother],
  );
  return { mother, self, student: row!.id, photo: photo!.id };
}

test('QA 1: run twice, two emails — the mother and the student — each once', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await turnsToday(tenant);
    const sent: Email[] = [];
    const send = async (email: Email): Promise<boolean> => {
      sent.push(email);
      return true;
    };
    const service = new MajorityNoticeService();
    await service.run(tenant.organizationId, send);
    await service.run(tenant.organizationId, send);
    // The student's own account email comes before the record's contact email.
    const [own] = await tenant.sql<{ email: string }>(`SELECT person_email($1)::text AS email`, [family.self]);
    assert.deepEqual(sent.map((one) => one.to).sort(), [own!.email, 'marta-208@exemplo.pt'].sort());
    const mother = sent.find((one) => one.to === 'marta-208@exemplo.pt')!;
    assert.match(mother.text, /Continua a ser quem paga/);
    assert.equal(mother.organizationId, tenant.organizationId, 'it leaves as the club (POOLSE-209)');
  });
});

test('QA 3, 4: the young adult confirms one consent and withdraws it; the tag goes', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await turnsToday(tenant);
    const controller = new AppConsentsController();
    const asSelf = <T>(fn: () => Promise<T>): Promise<T> =>
      actingAs(tenant, { membershipId: family.self, roles: ['student'] }, fn);

    const before = await asSelf(() => controller.list());
    assert.deepEqual(before.consents.map((one) => one.id), [family.photo]);

    await asSelf(() => controller.confirm(family.photo));
    assert.deepEqual((await asSelf(() => controller.list())).consents, []);
    const [mine] = await tenant.sql<{ id: string; by: string }>(
      `SELECT id, granted_by_membership_id AS by FROM consent
        WHERE student_id = $1 AND kind = 'photo' AND withdrawn_at IS NULL`,
      [family.student],
    );
    assert.equal(mine!.by, family.self, 'a new record, granted by them');

    // A second parent-signed consent, withdrawn: no live photo consent is left.
    await tenant.sql(`UPDATE consent SET withdrawn_at = now() WHERE id = $1`, [mine!.id]);
    const [again] = await tenant.sql<{ id: string }>(
      `INSERT INTO consent (organization_id, student_id, kind, granted, granted_by_membership_id)
       VALUES ($1, $2, 'photo', true, $3) RETURNING id`,
      [tenant.organizationId, family.student, family.mother],
    );
    await asSelf(() => controller.withdraw(again!.id));
    const [live] = await tenant.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM consent WHERE student_id = $1 AND kind = 'photo' AND withdrawn_at IS NULL`,
      [family.student],
    );
    assert.equal(live!.n, 0);
  });
});

test('QA 5: a parent is refused (403); another club’s consent is a 404', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await turnsToday(tenant);
    const controller = new AppConsentsController();
    await expectStatus(
      () => actingAs(tenant, { membershipId: family.mother, roles: ['guardian'] }, () => controller.confirm(family.photo)),
      403,
    );
    await withScratchTenant(async (other) => {
      const stranger = await addMember(other, 'Rui', 'Outro', ['student']);
      await expectStatus(
        () => actingAs(other, { membershipId: stranger, roles: ['student'] }, () => controller.confirm(family.photo)),
        404,
      );
    });
  });
});

test('QA 6 and rule 5: a minor has nothing to confirm; the mother sees the adult on Pagamentos, marked', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await turnsToday(tenant);
    await tenant.sql(`UPDATE student SET birth_date = (club_today() - interval '16 years')::date WHERE id = $1`, [
      family.student,
    ]);
    const minor = await actingAs(tenant, { membershipId: family.self, roles: ['student'] }, () =>
      new AppConsentsController().list(),
    );
    assert.deepEqual(minor.consents, []);

    await tenant.sql(`UPDATE student SET birth_date = (club_today() - interval '18 years')::date WHERE id = $1`, [
      family.student,
    ]);
    const fees = await actingAs(tenant, { membershipId: family.mother, roles: ['guardian'] }, () =>
      new AppController().fees(),
    );
    const row = fees.children.find((one) => one.id === family.student) as { paidOnly?: boolean } | undefined;
    assert.equal(row?.paidOnly, true);
  });
});
