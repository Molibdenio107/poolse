import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvoicesController } from './invoices.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Settlement and chasing — phase 2.3.
 *
 * The three worth more than the rest:
 *
 * **A document's state is derived, every time it is read.** Nothing writes a
 * status: recording a payment changes no column on the invoice — that table has
 * no UPDATE grant — and the state the operator sees is `total − paid`, the due
 * date against today, and whether a credit note exists. A test that asserts the
 * status after a payment is asserting that derivation, not a write.
 *
 * **Half of nothing arriving on time is still late.** A partly paid document
 * past its due date is overdue, and it is the assertion most likely to be
 * "simplified" into the wrong order.
 *
 * **The chase list is what is *outstanding*, not what is overdue.** A club
 * working through its debtors wants Friday's document in front of it too, and a
 * list that appeared only after the date had passed is a list nobody can get
 * ahead of.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

/** `days` from today, as an ISO date. Noon, so no zone can shift the day. */
function inDays(days: number): string {
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * One student, one mensalidade, and a document already issued against it.
 *
 * Dated relative to today rather than to a calendar day: a fixture that pins
 * "overdue" to a date passes for three weeks a month and fails for one, which
 * is a fixture that cannot tell a regression from a Tuesday.
 */
async function issued(
  tenant: ScratchTenant,
  options: { dueInDays: number } = { dueInDays: 30 },
): Promise<{ invoiceId: string; documentNo: string; totalCents: number; studentId: string }> {
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order)
     VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [tenant.organizationId],
  );
  const [period] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
     VALUES ($1, $2, 'Mensal', 1, true, 1) RETURNING id`,
    [tenant.organizationId, tenant.facilityId],
  );
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                           amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, 4500, true) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, level!.id],
  );
  const [student] = await tenant.sql<{ id: string }>(
    `INSERT INTO student (organization_id, first_name, last_name, birth_date)
     VALUES ($1, 'Carlos', 'Nunes', DATE '1968-01-20') RETURNING id`,
    [tenant.organizationId],
  );
  await tenant.sql(
    `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                              amount_cents, starts_on)
     VALUES ($1, $2, $3, $4, 4500, DATE '2026-09-01')`,
    [tenant.organizationId, student!.id, plan!.id, period!.id],
  );

  const run = await actingAs(tenant, { roles: ['owner'] }, async () =>
    await new InvoicesController().issue(tenant.facilityId, {
      periodStart: '2026-10-01',
      dueOn: inDays(options.dueInDays),
    }),
  );

  const draft = run.drafts[0]!;
  return {
    invoiceId: draft.invoiceId!,
    documentNo: draft.documentNo!,
    totalCents: draft.totalCents,
    studentId: student!.id,
  };
}

test('a document starts open, and the state is derived rather than stored', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const read = await invoices.read(tenant.facilityId, document.invoiceId);

      assert.equal(read.status, 'open');
      assert.equal(read.paidCents, 0);
      assert.equal(read.outstandingCents, document.totalCents);
      // Only while it is still owed: "12 days late" on a settled document is a
      // number that starts an unnecessary telephone call.
      assert.equal(read.daysOverdue, null);
      assert.equal(read.chaseCount, 0);
      assert.equal(read.lastChasedOn, null);
    });
  });
});

test('two payments add up, and settle the document without writing to it', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();

      await invoices.pay(tenant.facilityId, document.invoiceId, {
        amountCents: 2000,
        paidOn: inDays(-2),
        source: 'manual',
        reference: 'Transferência 1',
      });

      const halfway = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(halfway.status, 'partly_paid');
      assert.equal(halfway.paidCents, 2000);
      assert.equal(halfway.outstandingCents, 2500);

      await invoices.pay(tenant.facilityId, document.invoiceId, {
        amountCents: 2500,
        source: 'mbway',
      });

      const settled = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(settled.status, 'paid');
      assert.equal(settled.outstandingCents, 0);
      // The document itself is untouched — it has no UPDATE grant, and its
      // total is still what it was issued for.
      assert.equal(settled.totalCents, document.totalCents);
      assert.equal(settled.documentNo, document.documentNo);

      assert.equal(settled.payments?.length, 2);
      const first = settled.payments?.[0];
      assert.equal(first?.amountCents, 2000);
      assert.equal(first?.source, 'manual');
      assert.equal(first?.reference, 'Transferência 1');
      // Who entered it, from the membership rather than from a name typed in.
      assert.ok(first?.recordedByName !== null);
    });
  });
});

test('an overpayment settles rather than owing the family money', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      await invoices.pay(tenant.facilityId, document.invoiceId, { amountCents: 5000 });

      const read = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(read.status, 'paid');
      // Floored: a negative figure on a chase list is a number somebody would
      // try to collect.
      assert.equal(read.outstandingCents, 0);
      assert.equal(read.paidCents, 5000);
    });
  });
});

test('a payment entered against the wrong document is archived, not erased', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const { id } = await invoices.pay(tenant.facilityId, document.invoiceId, {
        amountCents: 4500,
      });

      assert.equal(
        (await invoices.read(tenant.facilityId, document.invoiceId)).status,
        'paid',
      );

      await invoices.unpay(tenant.facilityId, document.invoiceId, id);

      const back = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(back.status, 'open');
      assert.equal(back.paidCents, 0);
      assert.equal(back.payments?.length, 0, 'archived payments stop counting');
    });

    // The row is still there. Money is history, and a hard delete would take
    // the record of the mistake with it.
    const [kept] = await tenant.sql<{ count: string }>(
      `SELECT count(*)::text AS count FROM invoice_payment WHERE archived_at IS NOT NULL`,
    );
    assert.equal(kept?.count, '1');
  });
});

test('a late document is overdue, and a late part-payment still is', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant, { dueInDays: -10 });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();

      const late = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(late.status, 'overdue');
      assert.equal(late.daysOverdue, 10);

      await invoices.pay(tenant.facilityId, document.invoiceId, { amountCents: 2000 });

      // Half of nothing arriving on time is still late.
      const partly = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(partly.status, 'overdue');
      assert.equal(partly.outstandingCents, 2500);

      // Paid beats overdue: a document settled after its due date is settled.
      await invoices.pay(tenant.facilityId, document.invoiceId, { amountCents: 2500 });
      const settled = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(settled.status, 'paid');
      assert.equal(settled.daysOverdue, null);
    });
  });
});

test('a credited document is owed by nobody, whatever was paid against it', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant, { dueInDays: -10 });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      await invoices.pay(tenant.facilityId, document.invoiceId, { amountCents: 2000 });
      await invoices.credit(tenant.facilityId, document.invoiceId, {});

      const credited = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(credited.status, 'credited');
      assert.equal(credited.daysOverdue, null);
      // The payment is still on the record: the money did arrive, and crediting
      // the document does not unmake that.
      assert.equal(credited.paidCents, 2000);
    });
  });
});

test('a credit note is neither paid nor chased', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const note = await invoices.credit(tenant.facilityId, document.invoiceId, {});

      const read = await invoices.read(tenant.facilityId, note.id);
      assert.equal(read.status, 'credit_note');

      // Money against a credit note is money against the wrong document, and
      // the rule is the database's because there will be a second way in.
      await expectStatus(
        async () =>
          await invoices.pay(tenant.facilityId, note.id, { amountCents: 4500 }),
        409,
      );
      await expectStatus(
        async () => await invoices.chase(tenant.facilityId, note.id, { channel: 'phone' }),
        409,
      );
    });
  });
});

test('chases are a history, and the list says when a family was last asked', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant, { dueInDays: -20 });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();

      await invoices.chase(tenant.facilityId, document.invoiceId, {
        channel: 'email',
        chasedOn: inDays(-7),
        note: 'Primeiro aviso',
      });
      await invoices.chase(tenant.facilityId, document.invoiceId, {
        channel: 'phone',
        chasedOn: inDays(-1),
        note: 'Falei com a mãe; paga sexta',
      });

      const read = await invoices.read(tenant.facilityId, document.invoiceId);
      assert.equal(read.chaseCount, 2);
      assert.equal(read.lastChasedOn, inDays(-1));
      // Newest first: what was said most recently is what the next person needs.
      assert.equal(read.chases?.[0]?.channel, 'phone');
      assert.equal(read.chases?.[0]?.note, 'Falei com a mãe; paga sexta');

      // Saying nothing about how the family was asked is a 400 naming the field.
      await expectStatus(
        async () => await invoices.chase(tenant.facilityId, document.invoiceId, {}),
        400,
      );
    });
  });
});

test('the chase list is what is outstanding, oldest debt first', async () => {
  await withScratchTenant(async (tenant) => {
    const late = await issued(tenant, { dueInDays: -20 });

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();

      // A second document, due in the future and still owed.
      const soon = await invoices.issue(tenant.facilityId, {
        periodStart: '2026-11-01',
        dueOn: inDays(15),
      });
      const soonId = soon.drafts[0]!.invoiceId!;

      // And a third, settled.
      const paid = await invoices.issue(tenant.facilityId, {
        periodStart: '2026-12-01',
        dueOn: inDays(45),
      });
      await invoices.pay(tenant.facilityId, paid.drafts[0]!.invoiceId!, {
        amountCents: paid.drafts[0]!.totalCents,
      });

      const { invoices: owing } = await invoices.list(
        tenant.facilityId,
        undefined,
        undefined,
        '1',
      );

      assert.equal(owing.length, 2, 'the settled document is not on the chase list');
      // Oldest debt first: this is a job to work through, not a record to look
      // something up in.
      assert.equal(owing[0]?.id, late.invoiceId);
      assert.equal(owing[0]?.status, 'overdue');
      // Not "overdue only": a club wants Friday's document in front of it too.
      assert.equal(owing[1]?.id, soonId);
      assert.equal(owing[1]?.status, 'open');
    });
  });
});

test('instructors may not record payments or chases', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);
    const instructorId = await addMember(tenant, 'Nuno', 'Pereira', ['instructor']);

    await actingAs(tenant, { membershipId: instructorId, roles: ['instructor'] }, async () => {
      const invoices = new InvoicesController();

      await expectStatus(
        async () =>
          await invoices.pay(tenant.facilityId, document.invoiceId, { amountCents: 4500 }),
        403,
      );
      await expectStatus(
        async () =>
          await invoices.chase(tenant.facilityId, document.invoiceId, { channel: 'phone' }),
        403,
      );
      await expectStatus(
        async () =>
          await invoices.unpay(tenant.facilityId, document.invoiceId, document.invoiceId),
        403,
      );
    });
  });
});

test('a payment against a document at another site answers 404', async () => {
  await withScratchTenant(async (tenant) => {
    const document = await issued(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      // That a resource exists at another site is not something an error should
      // confirm.
      await expectStatus(
        async () =>
          await new InvoicesController().pay(
            '11111111-1111-1111-1111-111111111111',
            document.invoiceId,
            { amountCents: 4500 },
          ),
        404,
      );
    });
  });
});
