import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { InvoicesController } from './invoices.controller.js';
import { deliverInvoiceReminder } from './reminder-delivery.js';
import type { ReminderPreview, ReminderSent } from './reminders.repository.js';
import { SettingsController } from '../organizations/organizations.controller.js';
import { DeliveryRetryService } from '../notifications/delivery-retry.service.js';
import type { Email } from '../notifications/notifier.js';
import { actingAs, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * Invoice reminders by email — POOLSE-86, slice 3.0b.
 *
 * Rui's two answers are the two assertions that matter most: only what is
 * **overdue** is listed, and a payer reminded in the last 7 days is **flagged,
 * never blocked**. A stand-in sender records what would have gone.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
after(() => owner.end());

function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** An adult student who pays for themselves, with one document issued and due in `dueInDays`. */
async function issued(
  tenant: ScratchTenant,
  dueInDays: number,
  email: string | null = 'carlos@example.test',
): Promise<{ invoiceId: string; documentNo: string; studentId: string }> {
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
    `INSERT INTO student (organization_id, first_name, last_name, birth_date, contact_email)
     VALUES ($1, 'Carlos', 'Nunes', DATE '1968-01-20', $2) RETURNING id`,
    [tenant.organizationId, email],
  );
  await tenant.sql(
    `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
     VALUES ($1, $2, $3, $4, 4500, DATE '2026-09-01')`,
    [tenant.organizationId, student!.id, plan!.id, period!.id],
  );
  const run = await actingAs(tenant, { roles: ['owner'] }, () =>
    new InvoicesController().issue(tenant.facilityId, { periodStart: '2026-10-01', dueOn: inDays(dueInDays) }),
  );
  const draft = run.drafts[0]!;
  return { invoiceId: draft.invoiceId!, documentNo: draft.documentNo!, studentId: student!.id };
}

function outbox(): { sent: Email[]; send: (email: Email) => Promise<boolean> } {
  const sent: Email[] = [];
  return { sent, send: async (email) => (sent.push(email), true) };
}

test('only overdue documents are listed; one that is not late yet is said, not chased', async () => {
  await withScratchTenant(async (tenant) => {
    const open = await issued(tenant, 10);
    await actingAs(tenant, { roles: ['admin'] }, async () => {
      const preview = (await new InvoicesController().remind(tenant.facilityId, {
        invoiceIds: [open.invoiceId],
      })) as ReminderPreview;
      assert.deepEqual(preview.payers, []);
      assert.deepEqual(preview.nothingOverdue, ['Carlos Nunes']);
    });
  });
});

test('a reminder is written as a chase per document, sent after the commit, and flagged next time', async () => {
  await withScratchTenant(async (tenant) => {
    const late = await issued(tenant, -12);
    const invoices = new InvoicesController();

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new SettingsController().savePaymentInstructions({
        paymentInstructions: 'IBAN PT50 0000 0000 0000 0000 0000 0\nMB WAY 912 345 678',
      });

      const preview = (await invoices.remind(tenant.facilityId, { invoiceIds: [late.invoiceId] })) as ReminderPreview;
      assert.equal(preview.payers.length, 1);
      const payer = preview.payers[0]!;
      assert.equal(payer.email, 'carlos@example.test');
      assert.deepEqual(payer.documents.map((d) => d.documentNo), [late.documentNo]);
      assert.equal(payer.documents[0]!.outstandingCents, 4500);
      assert.equal(payer.recentlyReminded, false);
      assert.match(preview.paymentInstructions ?? '', /MB WAY/);

      const sent = (await invoices.remind(tenant.facilityId, {
        invoiceIds: [late.invoiceId],
        commit: true,
        payerKeys: [payer.key],
      })) as ReminderSent & { emailConfigured: boolean };
      assert.equal(sent.reminderIds.length, 1);
      // Email is console in tests: written and chased; the answer says nothing can leave.
      assert.equal(sent.emailConfigured, false);

      let read = await invoices.read(tenant.facilityId, late.invoiceId);
      assert.equal(read.chaseCount, 1, 'Em dívida counts it like any chase');
      assert.equal(read.chases?.[0]?.channel, 'poolse_email');
      assert.equal(read.chases?.[0]?.delivered, false);

      const box = outbox();
      assert.equal(await deliverInvoiceReminder(tenant.organizationId, sent.reminderIds[0]!, box.send), true);
      assert.equal(box.sent[0]!.to, 'carlos@example.test');
      assert.match(box.sent[0]!.text, new RegExp(late.documentNo));
      assert.match(box.sent[0]!.text, /45,00 €/);
      assert.match(box.sent[0]!.text, /MB WAY 912 345 678/);
      read = await invoices.read(tenant.facilityId, late.invoiceId);
      assert.equal(read.chases?.[0]?.delivered, true);

      // Rui: warned, never blocked.
      const again = (await invoices.remind(tenant.facilityId, { invoiceIds: [late.invoiceId] })) as ReminderPreview;
      assert.equal(again.payers[0]!.recentlyReminded, true);
      assert.notEqual(again.payers[0]!.lastRemindedOn, null);
      const second = (await invoices.remind(tenant.facilityId, {
        invoiceIds: [late.invoiceId],
        commit: true,
        payerKeys: [payer.key],
      })) as ReminderSent;
      assert.equal(second.reminderIds.length, 1, 'a recent reminder does not stop a second one');
    });
  });
});

test('a payer with no address is named and sent nothing; Como pagar absent says to contact the club', async () => {
  await withScratchTenant(async (tenant) => {
    const late = await issued(tenant, -5, null);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const preview = (await invoices.remind(tenant.facilityId, { invoiceIds: [late.invoiceId] })) as ReminderPreview;
      assert.equal(preview.payers[0]!.email, null);
      const sent = (await invoices.remind(tenant.facilityId, {
        invoiceIds: [late.invoiceId],
        commit: true,
        payerKeys: [preview.payers[0]!.key],
      })) as ReminderSent;
      assert.deepEqual(sent.reminderIds, []);
      assert.deepEqual(sent.noAddress, ['Carlos Nunes']);
      assert.equal((await invoices.read(tenant.facilityId, late.invoiceId)).chaseCount, 0);
    });
  });
});

test('a reminder that did not leave is retried hourly', async () => {
  await withScratchTenant(async (tenant) => {
    const late = await issued(tenant, -3);
    const sent = await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const preview = (await invoices.remind(tenant.facilityId, { invoiceIds: [late.invoiceId] })) as ReminderPreview;
      return (await invoices.remind(tenant.facilityId, {
        invoiceIds: [late.invoiceId],
        commit: true,
        payerKeys: [preview.payers[0]!.key],
      })) as ReminderSent;
    });
    await owner.query(`UPDATE invoice_reminder SET created_at = now() - interval '1 hour' WHERE id = $1`, [
      sent.reminderIds[0],
    ]);
    const box = outbox();
    const result = await new DeliveryRetryService().run({ organizationId: tenant.organizationId, send: box.send });
    assert.equal(result.delivered, 1);
    assert.match(box.sent[0]!.subject, /Lembrete de pagamento|Payment reminder/);
  });
});

test('a person cannot record a Poolse email by hand, and an instructor cannot send one', async () => {
  await withScratchTenant(async (tenant) => {
    const late = await issued(tenant, -3);
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await expectStatus(
        () => new InvoicesController().chase(tenant.facilityId, late.invoiceId, { channel: 'poolse_email' }),
        400,
      );
    });
    await actingAs(tenant, { roles: ['instructor'] }, async () => {
      await expectStatus(
        () => new InvoicesController().remind(tenant.facilityId, { invoiceIds: [late.invoiceId] }),
        403,
      );
    });
  });
});
