import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceSeriesController, InvoicesController } from './invoices.controller.js';
import {
  actingAs,
  addMember,
  closeHarness,
  expectStatus,
  withScratchTenant,
  type ScratchTenant,
} from '../test/harness.js';

/**
 * Invoicing — phase 2.2.
 *
 * The four worth more than the rest:
 *
 * **A family is one document.** Two siblings under one guardian produce one
 * invoice with two lines, because that is what a family pays and what 2.3's
 * débito direto will collect against. An adult with no guardian is their own
 * payer and gets their own.
 *
 * **A run is safe to press twice.** The second run finds nothing to bill and
 * says how much it left out, which is a different sentence from "there was
 * nothing to bill" and a different thing for an operator to do.
 *
 * **A document cannot be edited.** The correction is a credit note, and after
 * one the occurrence is billable again — which is the whole reason a club can
 * fix a mistake without the numbers going gappy.
 *
 * **The preview is the commit.** Both come from `runInvoices` with a flag, so a
 * test that issues what a preview showed is testing one code path rather than
 * asserting two agree.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

after(closeHarness);

const OCTOBER = '2026-10-01';

/**
 * A guardian, two children, an adult with nobody, and a mensalidade each.
 *
 * Built through the tenant's own connection, so RLS applies exactly as it does
 * in the product — a fixture the application could not create is a fixture that
 * proves nothing.
 */
async function club(tenant: ScratchTenant): Promise<{
  guardianId: string;
  anaId: string;
  ritaId: string;
  adultId: string;
}> {
  const guardianId = await addMember(tenant, 'Maria', 'Costa', ['guardian']);

  await tenant.sql(
    `UPDATE membership SET tax_number = '123456789', address = 'Rua das Flores 12'
      WHERE id = $1`,
    [guardianId],
  );

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

  // Exempt, which is what most sports tuition is under Art. 9.º CIVA — and the
  // case where an exemption and a zero rate must not be confused.
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week,
                           amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, 4500, true) RETURNING id`,
    [tenant.organizationId, tenant.facilityId, level!.id],
  );

  const students: string[] = [];
  for (const [first, last, birth] of [
    ['Ana', 'Costa', '2016-03-04'],
    ['Rita', 'Costa', '2018-04-11'],
    ['Carlos', 'Nunes', '1968-01-20'],
  ]) {
    const [student] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date)
       VALUES ($1, $2, $3, $4::date) RETURNING id`,
      [tenant.organizationId, first, last, birth],
    );
    students.push(student!.id);
  }
  const [anaId, ritaId, adultId] = students as [string, string, string];

  for (const studentId of [anaId, ritaId]) {
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id,
                                  relationship, is_primary)
       VALUES ($1, $2, $3, 'mãe', true)`,
      [tenant.organizationId, studentId, guardianId],
    );
  }

  for (const studentId of [anaId, ritaId, adultId]) {
    await tenant.sql(
      `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id,
                                amount_cents, starts_on)
       VALUES ($1, $2, $3, $4, 4500, DATE '2026-09-01')`,
      [tenant.organizationId, studentId, plan!.id, period!.id],
    );
  }

  return { guardianId, anaId, ritaId, adultId };
}

test('a facility is born with its two books, and the fatura one starts at A/1', async () => {
  await withScratchTenant(async (tenant) => {
    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const { series } = await new InvoiceSeriesController().list(tenant.facilityId);

      assert.equal(series.length, 2);
      const faturas = series.find((s) => s.kind === 'invoice');
      const notes = series.find((s) => s.kind === 'credit_note');

      assert.equal(faturas?.prefix, 'A');
      assert.equal(faturas?.nextNumber, 1);
      assert.equal(faturas?.isDefault, true);
      // Empty, so its letter may still be changed. After the first document it
      // may not, which is the next test.
      assert.equal(faturas?.inUse, false);
      assert.equal(notes?.kind, 'credit_note');
    });
  });
});

test('siblings land on one document and an adult on their own', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardianId, adultId } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const preview = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });

      assert.equal(preview.committed, false);
      assert.equal(preview.drafts.length, 2, 'one document per payer, not per student');
      assert.equal(preview.alreadyChargedCount, 0);

      const family = preview.drafts.find((d) => d.payerKey === `m:${guardianId}`);
      const adult = preview.drafts.find((d) => d.payerKey === `s:${adultId}`);

      assert.equal(family?.lines.length, 2, 'two children on one document');
      assert.equal(family?.totalCents, 9000);
      assert.equal(family?.payerName, 'Maria Costa');
      assert.equal(family?.payerTaxNumber, '123456789');
      assert.equal(family?.payerAddress, 'Rua das Flores 12');

      assert.equal(adult?.lines.length, 1);
      assert.equal(adult?.payerName, 'Carlos Nunes');
      // The adult path is the absence of the guardian edge, so the document is
      // addressed to the student rather than to a membership they do not have.
      assert.equal(adult?.payerMembershipId, null);
      assert.equal(adult?.payerStudentId, adultId);

      // The occurrence is October's, derived from the line's own start walked
      // forward by its periodicity — not from what it is being asked for today.
      assert.equal(family?.lines[0]?.periodStart, OCTOBER);
      // The line carries the club's own word and the frequency, never the
      // translated kind: the interface composes "Mensalidade — Iniciação
      // (2x/semana)" where the catalogue is.
      assert.equal(family?.lines[0]?.description, 'Iniciação');
      assert.equal(family?.lines[0]?.lessonsPerWeek, 2);
      assert.equal(family?.lines[0]?.kind, 'mensalidade');
      // Exempt: no tax inside a gross amount, and the flag rather than the rate
      // is what says so.
      assert.equal(family?.lines[0]?.vatExempt, true);
      assert.equal(family?.lines[0]?.vatCents, 0);
      assert.equal(family?.lines[0]?.netCents, 4500);
    });
  });
});

test('what the preview showed is what is issued, and the numbers are sequential', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const preview = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });
      const run = await invoices.issue(tenant.facilityId, { periodStart: OCTOBER });

      assert.equal(run.committed, true);
      assert.equal(run.drafts.length, preview.drafts.length);

      const numbers = run.drafts.map((d) => d.documentNo).sort();
      assert.deepEqual(numbers, ['FT A/1', 'FT A/2']);

      const { invoices: list } = await invoices.list(tenant.facilityId);
      assert.equal(list.length, 2);

      const first = list.find((i) => i.documentNo === 'FT A/1');
      assert.equal(first?.kind, 'invoice');
      assert.equal(first?.number, 1);
      assert.equal(first?.creditedByDocumentNo, null);
      // The due date comes from the facility's own payment day for the month
      // being billed, not from today.
      assert.equal(first?.dueOn.slice(0, 7), '2026-10');

      /*
       * The registered-at instant has to be readable by a Date — F-04.
       *
       * It was shipped through to_char with an OF offset, which renders +00
       * rather than +00:00, so every document's page threw FORMATTING_ERROR on
       * this one field and took the whole invoice down with it. Asserting the
       * parse rather than the string, because the string's exact shape is not
       * the contract — being an instant a client can read is.
       */
      assert.ok(
        !Number.isNaN(new Date(first!.systemEntryAt).getTime()),
        'systemEntryAt must parse as an instant',
      );
      assert.match(first!.systemEntryAt, /Z$|[+-]\d{2}:\d{2}$/, 'a full ISO 8601 offset');
    });
  });
});

test('a second run finds nothing, and says how much it left out', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      await invoices.issue(tenant.facilityId, { periodStart: OCTOBER });

      const again = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });

      assert.equal(again.drafts.length, 0);
      /*
       * The count is the whole point. "Nothing to bill" and "everything is
       * already billed" look identical on an empty table, and they are different
       * things for an operator to do — silence is what makes a run read as a
       * feature that did nothing.
       */
      assert.equal(again.alreadyChargedCount, 3);

      // And committing the empty run writes nothing rather than throwing.
      const committed = await invoices.issue(tenant.facilityId, { periodStart: OCTOBER });
      assert.equal(committed.drafts.length, 0);

      const { invoices: list } = await invoices.list(tenant.facilityId);
      assert.equal(list.length, 2, 'the second run issued no further documents');
    });
  });
});

test('the per-student action is the same run, narrowed', async () => {
  await withScratchTenant(async (tenant) => {
    const { adultId, guardianId } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const run = await invoices.issue(tenant.facilityId, {
        periodStart: OCTOBER,
        studentIds: [adultId],
      });

      assert.equal(run.drafts.length, 1);
      assert.equal(run.drafts[0]?.payerKey, `s:${adultId}`);

      // The family is untouched and still billable, which is what makes the two
      // actions safe to mix.
      const remaining = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });
      assert.equal(remaining.drafts.length, 1);
      assert.equal(remaining.drafts[0]?.payerKey, `m:${guardianId}`);
    });
  });
});

test('an operator may issue part of a preview', async () => {
  await withScratchTenant(async (tenant) => {
    const { guardianId } = await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const run = await invoices.issue(tenant.facilityId, {
        periodStart: OCTOBER,
        payerKeys: [`m:${guardianId}`],
      });

      assert.equal(run.drafts.length, 1);
      assert.equal(run.drafts[0]?.documentNo, 'FT A/1');

      const { invoices: list } = await invoices.list(tenant.facilityId);
      assert.equal(list.length, 1);
    });
  });
});

test('a document cannot be edited, so the correction is a credit note', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const run = await invoices.issue(tenant.facilityId, { periodStart: OCTOBER });
      const target = run.drafts[0]!;

      const note = await invoices.credit(tenant.facilityId, target.invoiceId!, {
        reason: 'Mensalidade errada',
      });

      // Its own book and its own sequence: NC A/1 whatever the invoice was.
      assert.equal(note.documentNo, 'NC A/1');

      const credited = await invoices.read(tenant.facilityId, target.invoiceId!);
      assert.equal(credited.creditedByDocumentNo, 'NC A/1');
      // The original is untouched — still there, still its own number, still
      // carrying its lines. Nothing was deleted to make the correction.
      assert.equal(credited.totalCents, target.totalCents);
      assert.equal(credited.lines?.length, target.lines.length);

      const read = await invoices.read(tenant.facilityId, note.id);
      assert.equal(read.kind, 'credit_note');
      assert.equal(read.correctsDocumentNo, target.documentNo);
      assert.equal(read.totalCents, target.totalCents, 'mirrors every line');
      assert.equal(read.notes, 'Mensalidade errada');
      // Every line names the one it reverses, so a credit is always traceable.
      assert.ok(read.lines?.every((line) => line.creditsInvoiceLineId !== null));

      // Credited twice is a 409 naming the document, not a 500 quoting an index.
      await expectStatus(
        async () => await invoices.credit(tenant.facilityId, target.invoiceId!, {}),
        409,
      );
    });
  });
});

test('after a credit note the occurrence is billable again', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const run = await invoices.issue(tenant.facilityId, { periodStart: OCTOBER });
      const target = run.drafts[0]!;

      // Before crediting, nothing is billable.
      const blocked = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });
      assert.equal(blocked.drafts.length, 0);

      await invoices.credit(tenant.facilityId, target.invoiceId!, {});

      /*
       * This is what makes "fix a wrong invoice" work at all. A partial unique
       * index would refuse it for ever, because "already charged" would mean
       * "has a line" rather than "has a live line" — which is why the guard is
       * a constraint trigger that can ask whether the document was credited.
       */
      const again = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });
      assert.equal(again.drafts.length, 1);
      assert.equal(again.drafts[0]?.payerKey, target.payerKey);

      const reissued = await invoices.issue(tenant.facilityId, {
        periodStart: OCTOBER,
        payerKeys: [target.payerKey],
      });
      // The sequence carries on rather than reusing the credited number.
      assert.equal(reissued.drafts[0]?.documentNo, 'FT A/3');
    });
  });
});

test('a book that has issued something keeps its letter', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const series = new InvoiceSeriesController();
      const { series: books } = await series.list(tenant.facilityId);
      const faturas = books.find((b) => b.kind === 'invoice')!;

      // While it is empty, both halves may change.
      await series.update(tenant.facilityId, faturas.id, { name: 'Faturas 2026', prefix: 'FA' });

      await new InvoicesController().issue(tenant.facilityId, { periodStart: OCTOBER });

      // The name still may. The letter may not, and the refusal says how many
      // documents have already gone out under it.
      await series.update(tenant.facilityId, faturas.id, { name: 'Faturas', prefix: 'FA' });
      await expectStatus(
        async () =>
          await series.update(tenant.facilityId, faturas.id, { name: 'Faturas', prefix: 'FB' }),
        409,
      );

      const { series: after } = await series.list(tenant.facilityId);
      const used = after.find((b) => b.kind === 'invoice');
      assert.equal(used?.prefix, 'FA');
      assert.equal(used?.inUse, true);
      assert.equal(used?.nextNumber, 3);
    });
  });
});

test('a line charged once is billed once, and never twelve times', async () => {
  await withScratchTenant(async (tenant) => {
    const { adultId } = await club(tenant);

    // An inscrição: no periodicity at all, so `amount_cents` is the whole amount
    // and the occurrence is its start date. A LEFT JOIN to `fee_period` is what
    // keeps it in the run; an inner one drops every inscrição and every seguro.
    const [plan] = await tenant.sql<{ id: string }>(
      `INSERT INTO fee_plan (organization_id, facility_id, kind, amount_cents,
                             recurrence, season_id, vat_exempt)
       VALUES ($1, $2, 'inscricao', 3000, 'one_off', $3, true) RETURNING id`,
      [tenant.organizationId, tenant.facilityId, tenant.seasonId],
    );

    await tenant.sql(
      `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, amount_cents,
                                season_id, starts_on)
       VALUES ($1, $2, $3, 3000, $4, DATE '2026-10-05')`,
      [tenant.organizationId, adultId, plan!.id, tenant.seasonId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const october = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });
      const adult = october.drafts.find((d) => d.payerKey === `s:${adultId}`);

      assert.equal(adult?.lines.length, 2, 'the mensalidade and the joining fee');
      const joining = adult?.lines.find((line) => line.kind === 'inscricao');
      assert.equal(joining?.amountCents, 3000);
      assert.equal(joining?.months, 1);
      // Its occurrence is the day it starts, not the first of the month: a fee
      // charged once has exactly one, on `starts_on`.
      assert.equal(joining?.periodStart, '2026-10-05');

      // And it does not come back in November.
      const november = await invoices.preview(tenant.facilityId, { periodStart: '2026-11-01' });
      const later = november.drafts.find((d) => d.payerKey === `s:${adultId}`);
      assert.equal(later?.lines.length, 1, 'a joining fee is not asked for again');
      assert.equal(later?.lines[0]?.kind, 'mensalidade');
    });
  });
});

test('a trimestral line is billed in its own months and not in between', async () => {
  await withScratchTenant(async (tenant) => {
    const { adultId } = await club(tenant);

    await tenant.sql(
      `UPDATE fee_period SET months = 3, name = 'Trimestral', discount_percent = 5
        WHERE facility_id = $1`,
      [tenant.facilityId],
    );
    /*
     * The discount is the *agreement's*, not the periodicity's.
     *
     * `student_fee` snapshots it when the line is created, so a club correcting
     * its price list never rewrites a family's bill retroactively — the rule the
     * fee module was built around. Setting only the period would leave every
     * existing line at the discount it was agreed on, which is right, and would
     * make this fixture assert the wrong number.
     */
    await tenant.sql(
      `UPDATE student_fee SET discount_percent = 5 WHERE organization_id = $1`,
      [tenant.organizationId],
    );

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();

      // The line starts in September, so its occurrences are September and
      // December. October is not one of them.
      const september = await invoices.preview(tenant.facilityId, { periodStart: '2026-09-01' });
      assert.equal(september.drafts.length, 2);
      // 45,00 EUR x 3 at 5 % is 128,25 EUR, rounded once at the period. Rounding
      // each month and summing gives a different answer and a phone call.
      const line = september.drafts[0]?.lines[0];
      assert.equal(line?.amountCents, 12825);
      assert.equal(line?.months, 3);

      const october = await invoices.preview(tenant.facilityId, { periodStart: OCTOBER });
      assert.equal(october.drafts.length, 0, 'no occurrence falls in October');

      const december = await invoices.preview(tenant.facilityId, { periodStart: '2026-12-01' });
      assert.equal(december.drafts.length, 2);
    });
  });
});

test('an ended line stops being billed after it ends', async () => {
  await withScratchTenant(async (tenant) => {
    const { adultId } = await club(tenant);

    await tenant.sql(`UPDATE student_fee SET ends_on = DATE '2026-09-30' WHERE student_id = $1`, [
      adultId,
    ]);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const preview = await new InvoicesController().preview(tenant.facilityId, {
        periodStart: OCTOBER,
      });

      assert.ok(
        preview.drafts.every((draft) => draft.payerKey !== `s:${adultId}`),
        'a line that ended in September is not asked for in October',
      );
    });
  });
});

test('instructors may not see or issue documents', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);
    const instructorId = await addMember(tenant, 'Nuno', 'Pereira', ['instructor']);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      await new InvoicesController().issue(tenant.facilityId, { periodStart: OCTOBER });
    });

    await actingAs(tenant, { membershipId: instructorId, roles: ['instructor'] }, async () => {
      const invoices = new InvoicesController();

      // What a family is charged is a commercial fact, like the price list — and
      // the rule is the endpoint's, never a screen omitting the link.
      await expectStatus(async () => await invoices.list(tenant.facilityId), 403);
      await expectStatus(
        async () => await invoices.preview(tenant.facilityId, { periodStart: OCTOBER }),
        403,
      );
      await expectStatus(
        async () => await invoices.issue(tenant.facilityId, { periodStart: OCTOBER }),
        403,
      );
      await expectStatus(
        async () => await new InvoiceSeriesController().list(tenant.facilityId),
        403,
      );
    });
  });
});

test('a document at another site answers 404, not 403', async () => {
  await withScratchTenant(async (tenant) => {
    await club(tenant);

    await actingAs(tenant, { roles: ['owner'] }, async () => {
      const invoices = new InvoicesController();
      const run = await invoices.issue(tenant.facilityId, { periodStart: OCTOBER });

      // That a resource exists at another site is not something an error should
      // confirm.
      await expectStatus(
        async () =>
          await invoices.read('11111111-1111-1111-1111-111111111111', run.drafts[0]!.invoiceId!),
        404,
      );
    });
  });
});
