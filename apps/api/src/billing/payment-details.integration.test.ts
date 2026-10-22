import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { StudentFeesController } from './fees.controller.js';
import { InvoicesController } from './invoices.controller.js';
import { deliverPaymentChangeNotice } from './payment-change-delivery.js';
import { SettingsController } from '../organizations/organizations.controller.js';
import { DeliveryRetryService } from '../notifications/delivery-retry.service.js';
import type { Email } from '../notifications/notifier.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Where families pay — POOLSE-94.
 *
 * One account per club: an IBAN with a good checksum, a Portuguese mobile for
 * MB WAY, and the club's own words beside them. A family reads them with the
 * reference to give; an IBAN that moves is emailed to every owner.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(() => owner.end());

const IBAN = 'PT50000201231234567890154';
/** The same bank and account with one digit changed — the checksum no longer holds. */
const BAD_IBAN = 'PT50000201231234567890155';
/** A second valid IBAN, for a change. */
const OTHER_IBAN = 'PT50003300004530008788903';

/** The field errors of a 400, which `expectStatus` does not hand back. */
async function fieldErrors(fn: () => Promise<unknown>): Promise<Record<string, string>> {
  try {
    await fn();
  } catch (error) {
    assert.equal((error as { status?: number }).status, 400);
    return ((error as { getResponse(): { fields: Record<string, string> } }).getResponse()).fields;
  }
  throw new Error('Expected HTTP 400, but the call succeeded');
}

function outbox(): { sent: Email[]; send: (email: Email) => Promise<boolean> } {
  const sent: Email[] = [];
  return { sent, send: async (email) => (sent.push(email), true) };
}

/** A child with a guardian and a mensalidade agreed. */
async function family(tenant: ScratchTenant): Promise<{ guardianId: string; studentId: string }> {
  const guardianId = await addMember(tenant, 'Maria', 'Costa', ['guardian']);
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );
  const [period] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
     VALUES ($1, $2, 'Mensal', 1, true, 1) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, 4500, true) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, level!.id],
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Ana', 'Costa', DATE '2016-03-04') RETURNING id`,
    [tenant.organizationId],
  );
  await tenant.sql(
    `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
     VALUES ($1, $2, $3, 'mãe', true)`,
    [tenant.organizationId, student!.id, guardianId],
  );
  await tenant.sql(
    `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
     VALUES ($1, $2, $3, $4, 4500, DATE '2026-09-01')`,
    [tenant.organizationId, student!.id, plan!.id, period!.id],
  );
  return { guardianId, studentId: student!.id };
}

test('QA 1 — an IBAN whose checksum fails is refused beside its field; a good one is stored without spaces', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const settings = new SettingsController();
      assert.deepEqual(await fieldErrors(() => settings.savePaymentDetails({ iban: BAD_IBAN })), {
        iban: 'clubData.payment.ibanChecksum',
      });
      const shape = await fieldErrors(() =>
        settings.savePaymentDetails({ iban: 'ES9121000418450200051332', mbwayPhone: '212345678' }),
      );
      assert.deepEqual(shape, {
        iban: 'clubData.payment.ibanShape',
        mbwayPhone: 'clubData.payment.mbwayShape',
      });

      const saved = await settings.savePaymentDetails({
        iban: 'pt50 0002 0123 1234 5678 9015 4',
        accountHolder: '  Clube Azul, Lda. ',
        mbwayPhone: '912 345 678',
      });
      assert.equal(saved.paymentIban, IBAN);
      assert.equal(saved.paymentAccountHolder, 'Clube Azul, Lda.');
      assert.equal(saved.paymentMbwayPhone, '+351912345678');
    });
  });
});

test('QA 2 — a guardian reads the IBAN, MB WAY and the reference to give', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardianId, studentId } = await family(tenant);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new SettingsController().savePaymentDetails({ iban: IBAN, mbwayPhone: '912345678' }),
    );

    // Nothing invoiced yet: the child's name is the reference.
    let fees = await actingAs(tenant, { membershipId: guardianId, roles: ['guardian'] }, () =>
      new StudentFeesController().list(studentId),
    );
    assert.equal(fees.payTo?.destinations.iban, IBAN);
    // No holder typed: the club's own name stands for it.
    assert.equal(fees.payTo?.destinations.accountHolder, tenant.name);
    assert.equal(fees.payTo?.destinations.mbwayPhone, '+351912345678');
    assert.equal(fees.payTo?.reference, 'Ana Costa');

    // Once a document is open, its number is what the office matches.
    const run = await actingAs(tenant, { roles: ['owner'] }, () =>
      new InvoicesController().issue(tenant.facilityId, { periodStart: '2026-10-01', dueOn: '2026-10-08' }),
    );
    fees = await actingAs(tenant, { membershipId: guardianId, roles: ['guardian'] }, () =>
      new StudentFeesController().list(studentId),
    );
    assert.equal(fees.payTo?.reference, run.drafts[0]!.documentNo);

    // The office's own read carries none of it: they are the ones being paid.
    const office = await actingAs(tenant, { roles: ['admin'] }, () => new StudentFeesController().list(studentId));
    assert.equal(office.payTo, null);
  });
});

test('QA 3 — only MB WAY filled is only MB WAY, and invoicing off is nothing at all', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardianId, studentId } = await family(tenant);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new SettingsController().savePaymentDetails({ mbwayPhone: '+351 912 345 678', accountHolder: 'Ninguém' }),
    );
    const fees = await actingAs(tenant, { membershipId: guardianId, roles: ['guardian'] }, () =>
      new StudentFeesController().list(studentId),
    );
    assert.equal(fees.payTo?.destinations.iban, null);
    // A holder without an account is not kept.
    assert.equal(fees.payTo?.destinations.accountHolder, null);
    assert.equal(fees.payTo?.destinations.mbwayPhone, '+351912345678');

    await owner.query(`UPDATE organization SET disabled_modules = '{invoicing,reception}' WHERE id = $1`, [
      tenant.organizationId,
    ]);
    const off = await actingAs(tenant, { membershipId: guardianId, roles: ['guardian'] }, () =>
      new StudentFeesController().list(studentId),
    );
    assert.equal(off.payTo, null);
  });
});

test('QA 4 — an instructor, a guardian and a student cannot change where the club is paid', async () => {
  await withScratchTenant(async (tenant) => {
    for (const roles of [['instructor'], ['maintenance'], ['guardian'], ['student']] as const) {
      await actingAs(tenant, { roles: [...roles] }, async () => {
        await expectStatus(() => new SettingsController().savePaymentDetails({ iban: IBAN }), 403);
      });
    }
    const [org] = await tenant.sql<{ iban: string | null }>(
      'SELECT payment_iban AS iban FROM organization WHERE id = $1',
      [tenant.organizationId],
    );
    assert.equal(org!.iban, null);
  });
});

test('QA 5 — an IBAN change is audited in full and emailed to every owner by its last four digits', async () => {
  await withScratchTenant(async (tenant) => {
    const adminId = await addMember(tenant, 'Rita', 'Admin', ['admin']);
    const coOwnerEmail = await tenant.sql<{ email: string }>(
      `SELECT coalesce(u.cached_email::text, m.email::text) AS email
         FROM membership m LEFT JOIN app_user u ON u.id = m.app_user_id WHERE m.id = $1`,
      [tenant.ownerMembershipId],
    );

    await actingAs(tenant, { roles: ['owner'] }, () =>
      new SettingsController().savePaymentDetails({ iban: IBAN }),
    );
    await actingAs(tenant, { membershipId: adminId, roles: ['admin'] }, () =>
      new SettingsController().savePaymentDetails({ iban: OTHER_IBAN, mbwayPhone: '912345678' }),
    );

    const notices = await tenant.sql<{ id: string; old_end: string | null; new_end: string; recipients: string[] }>(
      `SELECT id, old_iban_end AS old_end, new_iban_end AS new_end, recipients::text[] AS recipients
         FROM payment_change_notice ORDER BY created_at`,
    );
    assert.equal(notices.length, 2, 'the first IBAN is a change too');
    assert.deepEqual([notices[0]!.old_end, notices[0]!.new_end], [null, '0154']);
    assert.deepEqual([notices[1]!.old_end, notices[1]!.new_end], ['0154', '8903']);
    assert.deepEqual(notices[1]!.recipients, [coOwnerEmail[0]!.email], 'owners only, not the admin who changed it');

    const [entry] = await tenant.sql<{ data: { before: Record<string, unknown>; after: Record<string, unknown> } }>(
      `SELECT data FROM audit_log
        WHERE action = 'organization.payment_details_changed' AND actor_membership_id = $1`,
      [adminId],
    );
    assert.deepEqual(entry!.data.before, { iban: IBAN, mbwayPhone: null });
    assert.deepEqual(entry!.data.after, { iban: OTHER_IBAN, mbwayPhone: '+351912345678' });

    const box = outbox();
    assert.equal(await deliverPaymentChangeNotice(tenant.organizationId, notices[1]!.id, box.send), true);
    assert.equal(box.sent.length, 1);
    assert.equal(box.sent[0]!.to, coOwnerEmail[0]!.email);
    assert.match(box.sent[0]!.subject, /IBAN do clube foi alterado/);
    assert.match(box.sent[0]!.text, /Rita Admin alterou o IBAN/);
    assert.match(box.sent[0]!.text, /Antes: terminado em 0154\.\nAgora: terminado em 8903\./);
    assert.doesNotMatch(box.sent[0]!.text, new RegExp(OTHER_IBAN.slice(0, 12)), 'never the whole account');
    // Delivered once: a second call sends nothing.
    assert.equal(await deliverPaymentChangeNotice(tenant.organizationId, notices[1]!.id, box.send), false);
    assert.equal(box.sent.length, 1);
  });
});

test('QA 5 — an MB WAY or holder change alone tells nobody, and an unchanged save writes nothing', async () => {
  await withScratchTenant(async (tenant) => {
    const settings = new SettingsController();
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await settings.savePaymentDetails({ iban: IBAN });
      await settings.savePaymentDetails({ iban: IBAN, accountHolder: 'Clube Azul', mbwayPhone: '912345678' });
      await settings.savePaymentDetails({ iban: IBAN, accountHolder: 'Clube Azul', mbwayPhone: '912345678' });
    });
    const [counts] = await tenant.sql<{ notices: number; audits: number }>(
      `SELECT (SELECT count(*)::int FROM payment_change_notice) AS notices,
              (SELECT count(*)::int FROM audit_log WHERE action = 'organization.payment_details_changed') AS audits`,
    );
    assert.deepEqual(counts, { notices: 1, audits: 2 });
  });
});

test('a notice that did not leave is retried hourly', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new SettingsController().savePaymentDetails({ iban: IBAN }),
    );
    await owner.query(
      `UPDATE payment_change_notice SET created_at = now() - interval '1 hour' WHERE organization_id = $1`,
      [tenant.organizationId],
    );
    const box = outbox();
    const result = await new DeliveryRetryService().run({ organizationId: tenant.organizationId, send: box.send });
    assert.equal(result.delivered, 1);
    assert.match(box.sent[0]!.subject, /IBAN/);
  });
});
