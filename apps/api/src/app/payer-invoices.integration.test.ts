import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { AppController } from './app.controller.js';
import { InvoicesController } from '../billing/invoices.controller.js';
import { clubToday } from '../common/club-day.js';
import { actingAs, addMember, closeHarness, expectStatus, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * POOLSE-201 — *Extratos*: the documents a reader pays, and nobody else's.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

/** The owner login — only the platform writes `disabled_modules`, so a test sets it directly. */
const owner = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

after(async () => {
  await owner.end();
  await closeHarness();
});

interface Family {
  payer: string;
  second: string;
  alice: string;
  bruna: string;
}

async function seed(tenant: ScratchTenant): Promise<Family> {
  const org = tenant.organizationId;
  const payer = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
  const second = await addMember(tenant, 'Rui', 'Silva', ['guardian']);
  await tenant.sql(`UPDATE membership SET tax_number = '123456789' WHERE id = $1`, [payer]);
  const student = async (first: string): Promise<string> => {
    const [row] = await tenant.sql<{ id: string }>(
      `INSERT INTO student (organization_id, first_name, last_name) VALUES ($1, $2, 'Silva') RETURNING id`,
      [org, first],
    );
    return row!.id;
  };
  const alice = await student('Alice');
  const bruna = await student('Bruna');
  for (const child of [alice, bruna]) {
    await tenant.sql(
      `INSERT INTO guardian_link (organization_id, student_id, guardian_membership_id, relationship, is_primary)
       VALUES ($1, $2, $3, 'Mãe', true), ($1, $2, $4, 'Pai', false)`,
      [org, child, payer, second],
    );
  }
  return { payer, second, alice, bruna };
}

async function monthlyFee(tenant: ScratchTenant, students: string[]): Promise<void> {
  const org = tenant.organizationId;
  const [level] = await tenant.sql<{ id: string }>(
    `INSERT INTO student_level (organization_id, name, sort_order) VALUES ($1, 'Iniciação', 1) RETURNING id`,
    [org],
  );
  const [period] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_period (organization_id, facility_id, name, months, is_default, sort_order)
     VALUES ($1, $2, 'Mensal', 1, true, 1) RETURNING id`,
    [org, tenant.facilityId],
  );
  const [plan] = await tenant.sql<{ id: string }>(
    `INSERT INTO fee_plan (organization_id, facility_id, kind, level_id, lessons_per_week, amount_cents, vat_exempt)
     VALUES ($1, $2, 'mensalidade', $3, 2, 4500, true) RETURNING id`,
    [org, tenant.facilityId, level!.id],
  );
  for (const student of students) {
    await tenant.sql(
      `INSERT INTO student_fee (organization_id, student_id, fee_plan_id, fee_period_id, amount_cents, starts_on)
       VALUES ($1, $2, $3, $4, 4500, date_trunc('month', club_today())::date)`,
      [org, student, plan!.id, period!.id],
    );
  }
}

async function issue(tenant: ScratchTenant): Promise<string> {
  const month = `${clubToday().slice(0, 7)}-01`;
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await actingAs(tenant, { roles: ['owner'] }, () =>
    new InvoicesController().issue(tenant.facilityId, { periodStart: month, dueOn: due }),
  );
  const [row] = await tenant.sql<{ id: string }>(
    `SELECT id FROM invoice WHERE organization_id = $1 AND kind = 'invoice' ORDER BY number DESC LIMIT 1`,
    [tenant.organizationId],
  );
  return row!.id;
}

const as = <T>(tenant: ScratchTenant, membershipId: string, fn: () => Promise<T>): Promise<T> =>
  actingAs(tenant, { membershipId, roles: ['guardian'] }, fn);

test('the payer sees one document for two siblings, and the list carries no NIF or address (QA 1, 6)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await monthlyFee(tenant, [family.alice, family.bruna]);
    await issue(tenant);

    const answer = await as(tenant, family.payer, () => new AppController().invoices());
    assert.equal(answer.payer, true);
    assert.equal(answer.documents.length, 1);
    assert.equal(answer.documents[0]!.students.length, 2);
    assert.equal(answer.next, null);
    const text = JSON.stringify(answer);
    assert.doesNotMatch(text, /123456789/);
    assert.doesNotMatch(text, /payerTaxNumber|payerAddress|payerEmail/);
  });
});

test('a second guardian who is not the payer sees nothing, and the document is a 404 (QA 2)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await monthlyFee(tenant, [family.alice]);
    const id = await issue(tenant);

    const answer = await as(tenant, family.second, () => new AppController().invoices());
    assert.equal(answer.payer, false);
    assert.deepEqual(answer.documents, []);
    await expectStatus(() => as(tenant, family.second, () => new AppController().invoice(id)), 404);
  });
});

test('the payer reads the document, it leaves out the chases, and the read is audited (QA 7)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await monthlyFee(tenant, [family.alice]);
    const id = await issue(tenant);

    const document = await as(tenant, family.payer, () => new AppController().invoice(id));
    assert.equal(document.id, id);
    assert.ok((document.lines ?? []).length > 0);
    assert.equal('chases' in document, false);
    assert.equal('payments' in document, false);

    const [audit] = await tenant.sql<{ count: string }>(
      `SELECT count(*) FROM audit_log WHERE action = 'invoice.read_by_payer' AND entity_id = $1`,
      [id],
    );
    assert.equal(Number(audit!.count), 1);
  });
});

test('a minor on their own login is not a payer; an adult who pays for themselves is (QA 3)', async () => {
  await withScratchTenant(async (tenant) => {
    const org = tenant.organizationId;
    const minorLogin = await addMember(tenant, 'Tomás', 'Costa', ['student']);
    const adultLogin = await addMember(tenant, 'Ana', 'Costa', ['student']);
    await tenant.sql(
      `INSERT INTO student (organization_id, first_name, last_name, birth_date, membership_id)
       VALUES ($1, 'Tomás', 'Costa', club_today() - interval '12 years', $2),
              ($1, 'Ana', 'Costa', club_today() - interval '30 years', $3)`,
      [org, minorLogin, adultLogin],
    );
    const [adult] = await tenant.sql<{ id: string }>(
      `SELECT id FROM student WHERE membership_id = $1`,
      [adultLogin],
    );
    await monthlyFee(tenant, [adult!.id]);
    await issue(tenant);

    const asStudent = <T>(membershipId: string, fn: () => Promise<T>): Promise<T> =>
      actingAs(tenant, { membershipId, roles: ['student'] }, fn);
    assert.equal((await asStudent(minorLogin, () => new AppController().invoices())).payer, false);
    const mine = await asStudent(adultLogin, () => new AppController().invoices());
    assert.equal(mine.payer, true);
    assert.equal(mine.documents.length, 1);
  });
});

test('a credit note is its own row and the original reads credited (QA 4)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await monthlyFee(tenant, [family.alice]);
    const id = await issue(tenant);
    await actingAs(tenant, { roles: ['owner'] }, () =>
      new InvoicesController().credit(tenant.facilityId, id, { reason: 'Engano' }),
    );

    const { documents } = await as(tenant, family.payer, () => new AppController().invoices());
    assert.equal(documents.length, 2);
    const note = documents.find((one) => one.kind === 'credit_note')!;
    const original = documents.find((one) => one.id === id)!;
    assert.ok(note.correctsDocumentNo !== null);
    assert.equal(original.status, 'credited');
  });
});

test('staff are refused, a stranger id is a 404, and a bad offset is a 400 (QA 5)', async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await expectStatus(() => actingAs(tenant, { roles: ['instructor'] }, () => new AppController().invoices()), 403);
    await expectStatus(
      () => as(tenant, family.payer, () => new AppController().invoice('00000000-0000-4000-8000-000000000000')),
      404,
    );
    await expectStatus(() => as(tenant, family.payer, () => new AppController().invoice('not-a-uuid')), 404);
    await expectStatus(() => as(tenant, family.payer, () => new AppController().invoices('-1')), 400);
  });
});

test("another club's document is a 404, and invoicing switched off hides everything (QA 5, security review)", async () => {
  await withScratchTenant(async (tenant) => {
    const family = await seed(tenant);
    await monthlyFee(tenant, [family.alice]);
    const id = await issue(tenant);

    await withScratchTenant(async (other) => {
      const stranger = await addMember(other, 'Ana', 'Costa', ['guardian']);
      await expectStatus(() => as(other, stranger, () => new AppController().invoice(id)), 404);
    });

    await owner.query(`UPDATE organization SET disabled_modules = '{invoicing,reception}' WHERE id = $1`, [tenant.organizationId]);
    const answer = await as(tenant, family.payer, () => new AppController().invoices());
    assert.deepEqual(answer, { payer: false, documents: [], next: null });
    await expectStatus(() => as(tenant, family.payer, () => new AppController().invoice(id)), 404);
  });
});
