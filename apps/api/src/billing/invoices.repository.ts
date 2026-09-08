import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import type { FeeKind } from './fees.repository.js';

/**
 * Invoicing — phase 2.2.
 *
 * **These are internal records, not legal faturas.** Poolse is not certified
 * software under Decreto-Lei 28/2019, so what a club gets here is a priced,
 * numbered, immutable document it hands to whatever issues its faturas. The
 * migration header carries the argument; what matters at this layer is that the
 * shape is the one certification would need, because the shape is the part that
 * cannot be retrofitted onto documents already sent to families.
 *
 * **One code path writes and previews.** `runInvoices` takes a `commit` flag,
 * exactly as every importer here does, and for the same reason: what the
 * operator was shown and what gets written have to come from one place. A
 * preview that computes its lines differently from the commit is a preview that
 * lies, and nobody finds out until a family is charged twice.
 *
 * **The monthly run and the per-student action are the same call.** The second
 * is the first with `studentIds` set. There is no separate "issue one invoice"
 * query to drift out of step.
 */

export type InvoiceDocumentKind = 'invoice' | 'credit_note';

/**
 * What state a document is in — phase 2.3.
 *
 * Derived in SQL by `invoice_status` and shipped as an answer; there is no
 * status column and there must not be one. The precedence is the order an
 * operator cares about: a **credited** document is owed by nobody whatever was
 * paid against it, a **paid** one needs nothing, and a partly paid document
 * past its due date is still **overdue** — half of nothing arriving on time is
 * still late.
 */
export type InvoiceStatus =
  | 'open'
  | 'partly_paid'
  | 'overdue'
  | 'paid'
  | 'credited'
  | 'credit_note';

/** How money reached the club. The same enum the fee register already uses. */
export type PaymentSource = 'manual' | 'mbway' | 'sepa';

/** How a family was asked to pay. A person's action until phase 3.0 exists. */
export type ChaseChannel = 'email' | 'phone' | 'message' | 'in_person' | 'letter';

/** One arrival of money against a document. */
export interface InvoicePayment {
  id: string;
  amountCents: number;
  paidOn: string;
  source: PaymentSource;
  reference: string | null;
  notes: string | null;
  recordedByName: string | null;
}

/** One record of the club having asked. */
export interface InvoiceChase {
  id: string;
  chasedOn: string;
  channel: ChaseChannel;
  note: string | null;
  recordedByName: string | null;
}

/**
 * A numbering book.
 *
 * One per facility per document type, created by a trigger when the facility
 * is. `inUse` is what the screen reads to decide whether the prefix may still
 * be changed: renaming a book that has issued documents would leave two
 * documents of one series carrying two different prefixes.
 */
export interface InvoiceSeries {
  id: string;
  kind: InvoiceDocumentKind;
  name: string;
  prefix: string;
  /** The number the next document will take. 1 on an untouched book. */
  nextNumber: number;
  isDefault: boolean;
  inUse: boolean;
}

/**
 * One fee occurrence, on a document or about to be.
 *
 * The same shape before and after issuing, so the preview table and the
 * document page render from one component and cannot disagree about what a line
 * says.
 */
export interface InvoiceLine {
  /** Null on a candidate — it has no row yet. */
  id: string | null;
  studentId: string;
  studentName: string;
  studentTaxNumber: string | null;
  studentFeeId: string;
  kind: FeeKind;
  /**
   * The club's **own** words for this charge — the level's name, or the
   * season's. Null where the club has none.
   *
   * Never "Mensalidade": `kind` is an enum whose Portuguese is an i18n key, and
   * a document storing the translated word would read half in Portuguese for a
   * club working in English. The interface composes the sentence from `kind`,
   * this, `lessonsPerWeek` and `periodStart`.
   */
  description: string | null;
  lessonsPerWeek: number | null;
  /** The first day of the occurrence being charged. */
  periodStart: string;
  months: number;
  /** Gross, VAT included, integer cents — the rule the price list already follows. */
  amountCents: number;
  vatRate: number;
  vatExempt: boolean;
  vatExemptionReason: string | null;
  /** Both derived in SQL by `invoice_vat_cents`, never recomputed here. */
  vatCents: number;
  netCents: number;
  creditsInvoiceLineId: string | null;
}

/** A document, with its lines when it was read one at a time. */
export interface Invoice {
  id: string;
  kind: InvoiceDocumentKind;
  /** As printed: `FT A/17`. Snapshotted at issue, never rebuilt from a join. */
  documentNo: string;
  number: number;
  seriesId: string;
  facilityId: string;
  facilityName: string;
  issuedOn: string;
  dueOn: string;
  systemEntryAt: string;
  payerMembershipId: string | null;
  payerStudentId: string | null;
  payerName: string;
  payerTaxNumber: string | null;
  payerAddress: string | null;
  payerEmail: string | null;
  /** What this credit note corrects. Null on an invoice. */
  correctsInvoiceId: string | null;
  correctsDocumentNo: string | null;
  /** The credit note against this document, where one exists. */
  creditedByInvoiceId: string | null;
  creditedByDocumentNo: string | null;
  notes: string | null;
  /** Gross, and its two halves. Summed in SQL from the lines. */
  totalCents: number;
  vatCents: number;
  netCents: number;
  lineCount: number;
  /**
   * Settlement — 2.3. All three derived in SQL and rendered by the client.
   *
   * `outstandingCents` floors at zero: a family that overpays by a rounding
   * cent is settled, not owed money, and a negative figure on a chase list is a
   * number somebody would try to collect.
   */
  status: InvoiceStatus;
  paidCents: number;
  outstandingCents: number;
  /**
   * Days past the due date, negative before it. Null once settled or credited.
   *
   * Computed against the database's own date rather than the browser's — a page
   * held open overnight would otherwise still be saying yesterday's answer.
   */
  daysOverdue: number | null;
  /** When this family was last asked, and how often. Null when never. */
  lastChasedOn: string | null;
  chaseCount: number;
  lines?: InvoiceLine[];
  payments?: InvoicePayment[];
  chases?: InvoiceChase[];
}

/**
 * A document about to be issued, or one that was.
 *
 * `payerKey` is how the screen names a draft back to the server when an
 * operator issues part of a preview — a membership or a student, said in one
 * string so the two cannot be confused for each other.
 */
export interface InvoiceDraft {
  payerKey: string;
  payerMembershipId: string | null;
  payerStudentId: string | null;
  payerName: string;
  payerTaxNumber: string | null;
  payerAddress: string | null;
  payerEmail: string | null;
  lines: InvoiceLine[];
  totalCents: number;
  vatCents: number;
  /** Set only on a committed run: the document this draft became. */
  documentNo?: string;
  invoiceId?: string;
}

export interface InvoiceRun {
  /** The month billed, normalised to its first day. */
  periodStart: string;
  dueOn: string;
  seriesId: string;
  drafts: InvoiceDraft[];
  /**
   * Occurrences left out because they are already on a live document.
   *
   * Reported rather than silently dropped: a run that finds nothing has to be
   * able to say whether that is because everything is billed or because nothing
   * is billable, and those are different things for an operator to do.
   */
  alreadyChargedCount: number;
  committed: boolean;
}

export interface InvoiceRunInput {
  /** Any day in the month being billed; normalised to the first of it. */
  periodStart: string;
  /** Defaults to the facility's own payment due day for that month. */
  dueOn?: string | null;
  /** The per-student action: the same run, narrowed to these students. */
  studentIds?: string[] | null;
  /** Issue only these payers' documents. Absent means all of them. */
  payerKeys?: string[] | null;
}

/** Raised when the occurrence is already on a live document. */
export class AlreadyChargedError extends Error {
  constructor(readonly documentNo: string) {
    super(`Already charged on ${documentNo}`);
  }
}

/** Raised when the facility has no book to number the document in. */
export class NoInvoiceSeriesError extends Error {}

/** Raised when a series that has issued something is asked to change its prefix. */
export class SeriesInUseError extends Error {
  constructor(readonly issued: number) {
    super(`${issued} documents have been issued in this series`);
  }
}

/** Raised when money is entered against a credit note, which is never owed. */
export class NotPayableError extends Error {}

/** Raised when a document is credited twice, or an invoice is asked to correct one. */
export class AlreadyCreditedError extends Error {
  constructor(readonly documentNo: string) {
    super(`${documentNo} has already been credited`);
  }
}

/** An absent list and an empty one are the same thing: no filter. */
function notEmpty<T>(values: T[] | null | undefined): T[] | null {
  return values === undefined || values === null || values.length === 0 ? null : values;
}

/**
 * The refusal the constraint trigger raises, turned into something typed.
 *
 * The figures arrive as structure in `DETAIL`, never as prose — the standing
 * rule for every refusal that needs numbers. The sentence is composed on the
 * client, where the locale is.
 */
function chargedFrom(error: unknown): unknown {
  const { code, detail } = error as { code?: string; detail?: string };
  if (code === '23505' && detail?.startsWith('invoice_line_already_charged|') === true) {
    return new AlreadyChargedError(detail.split('|')[1] ?? '');
  }
  return error;
}

// ---------------------------------------------------------------------------
// The books
// ---------------------------------------------------------------------------

export async function listSeries(
  organizationId: string,
  facilityId: string,
): Promise<InvoiceSeries[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: InvoiceDocumentKind;
      name: string;
      prefix: string;
      next_number: number;
      is_default: boolean;
    }>(
      `SELECT id, kind, name, prefix, next_number, is_default
         FROM invoice_series
        WHERE facility_id = $1 AND archived_at IS NULL
        ORDER BY kind, name`,
      [facilityId],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      prefix: row.prefix,
      nextNumber: row.next_number,
      isDefault: row.is_default,
      inUse: row.next_number > 1,
    }));
  });
}

export interface SeriesChanges {
  name: string;
  prefix: string;
}

/**
 * Rename a book, or change the letter its numbers are built from.
 *
 * The prefix only while the book is empty. After that a rename would leave
 * `FT A/1` and `FT B/2` in one series, and neither of them wrong — which is
 * worse than refusing, because nothing would ever report it.
 */
export async function updateSeries(
  organizationId: string,
  facilityId: string,
  seriesId: string,
  changes: SeriesChanges,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows: current } = await tx.query<{ prefix: string; next_number: number }>(
      `SELECT prefix, next_number FROM invoice_series
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL`,
      [facilityId, seriesId],
    );
    const row = current[0];
    if (row === undefined) return false;

    if (row.prefix !== changes.prefix && row.next_number > 1) {
      throw new SeriesInUseError(row.next_number - 1);
    }

    await tx.query(
      `UPDATE invoice_series SET name = $3, prefix = $4
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL`,
      [facilityId, seriesId, changes.name, changes.prefix],
    );

    await recordAudit(tx, {
      action: 'invoice_series.updated',
      entityType: 'invoice_series',
      entityId: seriesId,
      data: { name: changes.name, prefix: changes.prefix },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// What is billable, and for whom
// ---------------------------------------------------------------------------

interface CandidateRow {
  student_fee_id: string;
  student_id: string;
  student_name: string;
  student_tax_number: string | null;
  kind: FeeKind;
  description: string | null;
  lessons_per_week: number | null;
  period_start: string;
  months: number;
  amount_cents: number;
  vat_rate: string;
  vat_exempt: boolean;
  vat_cents: number;
  payer_membership_id: string | null;
  payer_name: string;
  payer_tax_number: string | null;
  payer_address: string | null;
  payer_email: string | null;
}

/*
 * Which fee occurrences fall in the month being billed.
 *
 * A line's occurrences are its own start date walked forward in steps of its
 * periodicity, so `k` is how many months separate the month it started from the
 * month being billed, and the occurrence exists when that is a whole number of
 * periods. A line charged once — an inscrição, a seguro — has exactly one
 * occurrence, on its start date, which is `k = 0` and nothing else.
 *
 * Written here rather than reusing `current_period_start`, which answers a
 * different question: that one is "what is this line being asked for *today*",
 * and a club invoicing March in April needs March.
 *
 * (No backticks in this string: one would end the template literal.)
 */
const CANDIDATE_SQL = `
  SELECT sf.id AS student_fee_id,
         sf.student_id,
         btrim(st.first_name || ' ' || st.last_name) AS student_name,
         st.tax_number AS student_tax_number,
         sf.kind,
         -- The club's own words, and nothing a catalogue could translate. A
         -- plan has no name of its own in this schema: its label is its kind,
         -- its level and its frequency, and only the level is the club's word.
         coalesce(l.name, se.name) AS description,
         p.lessons_per_week,
         to_char(occ.period_start, 'YYYY-MM-DD') AS period_start,
         coalesce(fp.months, 1) AS months,
         -- The one definition of a total, in SQL. Months coalesce to 1 so a
         -- line charged once comes out at its own amount rather than twelve
         -- times it.
         fee_payable_cents(sf.amount_cents, coalesce(fp.months, 1)::smallint,
                           sf.discount_percent, sf.manual_discount_percent,
                           sf.manual_discount_cents) AS amount_cents,
         p.vat_rate, p.vat_exempt,
         invoice_vat_cents(
           fee_payable_cents(sf.amount_cents, coalesce(fp.months, 1)::smallint,
                             sf.discount_percent, sf.manual_discount_percent,
                             sf.manual_discount_cents),
           p.vat_rate) AS vat_cents,
         pay.id AS payer_membership_id,
         -- The payer as the document will say it. A guardian where there is
         -- one, the student themselves otherwise — which is the adult path, and
         -- also a student nobody has given a guardian yet.
         coalesce(person_name(pay.id), btrim(st.first_name || ' ' || st.last_name)) AS payer_name,
         coalesce(pm.tax_number, st.tax_number) AS payer_tax_number,
         pm.address AS payer_address,
         coalesce(person_email(pay.id), st.contact_email)::text AS payer_email
    FROM student_fee sf
    JOIN fee_plan p ON p.id = sf.fee_plan_id
    -- Left, since a line charged once names no periodicity at all. An inner
    -- join here would drop every inscrição and every seguro from the run.
    LEFT JOIN fee_period fp ON fp.id = sf.fee_period_id
    LEFT JOIN student_level l ON l.id = p.level_id AND l.organization_id = p.organization_id
    -- The season an inscrição or a seguro is for, which is the club's own word
    -- for a charge that has no level.
    LEFT JOIN season se ON se.id = sf.season_id AND se.organization_id = sf.organization_id
    JOIN student st ON st.id = sf.student_id
    JOIN LATERAL (
      SELECT (extract(year FROM age($2::date, date_trunc('month', sf.starts_on)::date)) * 12
              + extract(month FROM age($2::date, date_trunc('month', sf.starts_on)::date)))::int AS k
    ) step ON true
    JOIN LATERAL (
      SELECT (sf.starts_on + make_interval(months => step.k))::date AS period_start
    ) occ ON true
    LEFT JOIN LATERAL (
      SELECT invoice_payer_membership_id(sf.organization_id, sf.student_id) AS id
    ) pay ON true
    LEFT JOIN membership pm ON pm.id = pay.id AND pm.organization_id = sf.organization_id
   WHERE p.facility_id = $1
     AND sf.archived_at IS NULL
     AND st.archived_at IS NULL
     AND step.k >= 0
     AND CASE WHEN sf.fee_period_id IS NULL THEN step.k = 0
              ELSE step.k % fp.months = 0 END
     -- A line that has ended is not asking for anything after it ended.
     AND (sf.ends_on IS NULL OR occ.period_start <= sf.ends_on)
     AND ($3::uuid[] IS NULL OR sf.student_id = ANY($3::uuid[]))`;

/**
 * The monthly run, and the per-student action, and the preview of both.
 *
 * `commit` decides whether anything is written. Everything above that decision
 * is shared, which is the point: an operator issues what they were shown.
 *
 * The candidates are grouped by payer here rather than in SQL because grouping
 * is the only part of this that is a presentation decision — one document per
 * payer — and it is the part most likely to change. The arithmetic is all in
 * the database.
 */
export async function runInvoices(
  organizationId: string,
  facilityId: string,
  input: InvoiceRunInput,
  commit: boolean,
): Promise<InvoiceRun | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: facilities } = await tx.query<{
      due_on: string;
      period_start: string;
      name: string;
    }>(
      `SELECT to_char(date_trunc('month', $2::date), 'YYYY-MM-DD') AS period_start,
              to_char(coalesce($3::date,
                               fee_due_on(date_trunc('month', $2::date)::date,
                                          f.payment_due_day)),
                      'YYYY-MM-DD') AS due_on,
              f.name
         FROM facility f
        WHERE f.id = $1 AND f.archived_at IS NULL`,
      [facilityId, input.periodStart, input.dueOn ?? null],
    );
    const facility = facilities[0];
    if (facility === undefined) return null;

    const { rows: series } = await tx.query<{ id: string }>(
      `SELECT id FROM invoice_series
        WHERE facility_id = $1 AND kind = 'invoice' AND archived_at IS NULL
        ORDER BY is_default DESC, created_at
        LIMIT 1`,
      [facilityId],
    );
    const seriesId = series[0]?.id;
    if (seriesId === undefined) throw new NoInvoiceSeriesError();

    // An absent filter and an empty one both mean "every student": a request
    // that narrowed to nobody would silently produce an empty run, which reads
    // exactly like "there is nothing to bill".
    const studentIds = notEmpty(input.studentIds);

    /*
     * Two counts from one candidate set: what is billable, and what was left
     * out because it is already on a live document.
     *
     * `invoice_charged_on` is the same function the constraint trigger calls,
     * which is what stops the preview offering a line the commit then refuses.
     */
    const { rows } = await tx.query<CandidateRow & { charged_on: string | null }>(
      `WITH candidate AS (${CANDIDATE_SQL})
       SELECT c.*,
              invoice_charged_on($4::uuid, c.student_fee_id, c.period_start::date) AS charged_on
         FROM candidate c
        ORDER BY c.payer_name, c.student_name, c.kind, c.description`,
      [facilityId, input.periodStart, studentIds, organizationId],
    );

    const billable = rows.filter((row) => row.charged_on === null);
    const alreadyChargedCount = rows.length - billable.length;

    const keys = notEmpty(input.payerKeys);
    const wanted = keys === null ? null : new Set(keys);
    const byPayer = new Map<string, InvoiceDraft>();

    for (const row of billable) {
      const payerKey =
        row.payer_membership_id === null ? `s:${row.student_id}` : `m:${row.payer_membership_id}`;

      let draft = byPayer.get(payerKey);
      if (draft === undefined) {
        draft = {
          payerKey,
          payerMembershipId: row.payer_membership_id,
          // A student payer is the student the line belongs to. Every line in
          // this draft is theirs, because that is what made the key.
          payerStudentId: row.payer_membership_id === null ? row.student_id : null,
          payerName: row.payer_name,
          payerTaxNumber: row.payer_tax_number,
          payerAddress: row.payer_address,
          payerEmail: row.payer_email,
          lines: [],
          totalCents: 0,
          vatCents: 0,
        };
        byPayer.set(payerKey, draft);
      }

      draft.lines.push({
        id: null,
        studentId: row.student_id,
        studentName: row.student_name,
        studentTaxNumber: row.student_tax_number,
        studentFeeId: row.student_fee_id,
        kind: row.kind,
        description: row.description,
        lessonsPerWeek: row.lessons_per_week,
        periodStart: row.period_start,
        months: row.months,
        amountCents: row.amount_cents,
        // `numeric` arrives as a string from pg, like every other rate here.
        vatRate: Number(row.vat_rate),
        vatExempt: row.vat_exempt,
        vatExemptionReason: null,
        vatCents: row.vat_cents,
        netCents: row.amount_cents - row.vat_cents,
        creditsInvoiceLineId: null,
      });
      draft.totalCents += row.amount_cents;
      draft.vatCents += row.vat_cents;
    }

    const drafts = [...byPayer.values()].filter(
      (draft) => wanted === null || wanted.has(draft.payerKey),
    );

    if (commit) {
      for (const draft of drafts) {
        const issued = await issueDraft(tx, organizationId, facilityId, seriesId, {
          dueOn: facility.due_on,
          draft,
        });
        draft.invoiceId = issued.id;
        draft.documentNo = issued.documentNo;
      }
    }

    return {
      periodStart: facility.period_start,
      dueOn: facility.due_on,
      seriesId,
      drafts,
      alreadyChargedCount,
      committed: commit,
    };
  });
}

/**
 * One document written, inside the run's transaction.
 *
 * The number is not passed in and is not read back to be reused: the trigger on
 * `invoice` allocates it from the series in the same statement that writes the
 * row. This function could not skip a number if it tried, which is the whole
 * arrangement.
 */
async function issueDraft(
  tx: Tx,
  organizationId: string,
  facilityId: string,
  seriesId: string,
  args: { dueOn: string; draft: InvoiceDraft },
): Promise<{ id: string; documentNo: string }> {
  const { draft, dueOn } = args;

  const { rows } = await tx.query<{ id: string; document_no: string }>(
    `INSERT INTO invoice
       (organization_id, facility_id, series_id, due_on,
        payer_membership_id, payer_student_id, payer_name, payer_tax_number,
        payer_address, payer_email)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)
     RETURNING id, document_no`,
    [
      organizationId,
      facilityId,
      seriesId,
      dueOn,
      draft.payerMembershipId,
      draft.payerStudentId,
      draft.payerName,
      draft.payerTaxNumber,
      draft.payerAddress,
      draft.payerEmail,
    ],
  );

  const invoice = rows[0];
  if (invoice === undefined) throw new Error('Could not issue the document');

  for (const [index, line] of draft.lines.entries()) {
    try {
      await tx.query(
        `INSERT INTO invoice_line
           (organization_id, invoice_id, student_id, student_fee_id, student_name,
            student_tax_number, kind, description, lessons_per_week, period_start,
            months, amount_cents, vat_rate, vat_exempt, vat_exemption_reason, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::fee_kind, $8, $9, $10::date, $11, $12, $13, $14, $15, $16)`,
        [
          organizationId,
          invoice.id,
          line.studentId,
          line.studentFeeId,
          line.studentName,
          line.studentTaxNumber,
          line.kind,
          line.description,
          line.lessonsPerWeek,
          line.periodStart,
          line.months,
          line.amountCents,
          line.vatRate,
          line.vatExempt,
          line.vatExemptionReason,
          index,
        ],
      );
    } catch (error) {
      throw chargedFrom(error);
    }
  }

  await recordAudit(tx, {
    action: 'invoice.issued',
    entityType: 'invoice',
    entityId: invoice.id,
    data: {
      documentNo: invoice.document_no,
      payerName: draft.payerName,
      totalCents: draft.totalCents,
      lineCount: draft.lines.length,
    },
  });

  return { id: invoice.id, documentNo: invoice.document_no };
}

// ---------------------------------------------------------------------------
// Reading what was issued
// ---------------------------------------------------------------------------

/*
 * The totals, summed in SQL from the lines and never stored.
 *
 * A stored total on an immutable document could not drift — but neither can
 * this, and this has one definition rather than two. `invoice_vat_cents` is the
 * same function the candidate query calls, so a preview and the document it
 * became show the same tax.
 */
const TOTALS_SQL = `
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(l.amount_cents), 0)::int AS total_cents,
           coalesce(sum(invoice_vat_cents(l.amount_cents, l.vat_rate)), 0)::int AS vat_cents,
           count(*)::int AS line_count
      FROM invoice_line l
     WHERE l.invoice_id = i.id AND l.organization_id = i.organization_id
  ) t ON true
  /*
   * What has arrived, and when this family was last asked — 2.3.
   *
   * Both aggregated in the same statement rather than fetched per document: a
   * chase list of forty overdue invoices would otherwise be eighty round trips,
   * and the bound here is how many times one family has been telephoned.
   */
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(p.amount_cents), 0)::int AS paid_cents
      FROM invoice_payment p
     WHERE p.invoice_id = i.id AND p.organization_id = i.organization_id
       AND p.archived_at IS NULL
  ) pay ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS chase_count, max(c.chased_on) AS last_chased_on
      FROM invoice_chase c
     WHERE c.invoice_id = i.id AND c.organization_id = i.organization_id
       AND c.archived_at IS NULL
  ) ch ON true`;

const INVOICE_COLUMNS = `
  i.id, i.kind, i.document_no, i.number, i.series_id,
  i.facility_id, f.name AS facility_name,
  to_char(i.issued_on, 'YYYY-MM-DD') AS issued_on,
  to_char(i.due_on, 'YYYY-MM-DD') AS due_on,
  to_char(i.system_entry_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS system_entry_at,
  i.payer_membership_id, i.payer_student_id, i.payer_name, i.payer_tax_number,
  i.payer_address, i.payer_email::text AS payer_email,
  i.corrects_invoice_id, orig.document_no AS corrects_document_no,
  note.id AS credited_by_invoice_id, note.document_no AS credited_by_document_no,
  i.notes, t.total_cents, t.vat_cents, t.line_count,
  pay.paid_cents,
  /*
   * The one definition of what state a document is in, called rather than
   * restated — the same discipline every derived answer here follows. A CASE
   * written out in this string would be a second implementation that agrees
   * with the function until somebody edits one of them.
   */
  invoice_status(i.kind, note.id IS NOT NULL, t.total_cents, pay.paid_cents, i.due_on)
    AS status,
  (current_date - i.due_on) AS days_overdue,
  to_char(ch.last_chased_on, 'YYYY-MM-DD') AS last_chased_on,
  ch.chase_count`;

interface InvoiceRow {
  id: string;
  kind: InvoiceDocumentKind;
  document_no: string;
  number: number;
  series_id: string;
  facility_id: string;
  facility_name: string;
  issued_on: string;
  due_on: string;
  system_entry_at: string;
  payer_membership_id: string | null;
  payer_student_id: string | null;
  payer_name: string;
  payer_tax_number: string | null;
  payer_address: string | null;
  payer_email: string | null;
  corrects_invoice_id: string | null;
  corrects_document_no: string | null;
  credited_by_invoice_id: string | null;
  credited_by_document_no: string | null;
  notes: string | null;
  total_cents: number;
  vat_cents: number;
  line_count: number;
  paid_cents: number;
  status: InvoiceStatus;
  days_overdue: number;
  last_chased_on: string | null;
  chase_count: number;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    kind: row.kind,
    documentNo: row.document_no,
    number: row.number,
    seriesId: row.series_id,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    systemEntryAt: row.system_entry_at,
    payerMembershipId: row.payer_membership_id,
    payerStudentId: row.payer_student_id,
    payerName: row.payer_name,
    payerTaxNumber: row.payer_tax_number,
    payerAddress: row.payer_address,
    payerEmail: row.payer_email,
    correctsInvoiceId: row.corrects_invoice_id,
    correctsDocumentNo: row.corrects_document_no,
    creditedByInvoiceId: row.credited_by_invoice_id,
    creditedByDocumentNo: row.credited_by_document_no,
    notes: row.notes,
    totalCents: row.total_cents,
    vatCents: row.vat_cents,
    netCents: row.total_cents - row.vat_cents,
    lineCount: row.line_count,
    status: row.status,
    paidCents: row.paid_cents,
    // Floored: an overpayment settles a document rather than making the club
    // owe a family money on a chase list.
    outstandingCents: Math.max(row.total_cents - row.paid_cents, 0),
    // Only while it is still owed. "12 days late" on a document somebody
    // settled last week is a number that starts an unnecessary telephone call.
    daysOverdue: row.status === 'overdue' ? row.days_overdue : null,
    lastChasedOn: row.last_chased_on,
    chaseCount: row.chase_count,
  };
}

const JOINS_SQL = `
    FROM invoice i
    JOIN facility f ON f.id = i.facility_id
    LEFT JOIN invoice orig
           ON orig.id = i.corrects_invoice_id AND orig.organization_id = i.organization_id
    LEFT JOIN invoice note
           ON note.corrects_invoice_id = i.id AND note.organization_id = i.organization_id
          AND note.kind = 'credit_note'`;

export interface InvoiceFilter {
  /** Any day in the month, or absent for every month. */
  month?: string | null;
  studentId?: string | null;
  payerMembershipId?: string | null;
  /**
   * Only what is still owed — the chase list.
   *
   * Deliberately "outstanding" rather than "overdue": a club working through
   * its debtors wants the document due on Friday in front of it too, and a list
   * that appeared only after the date had passed would be a list nobody could
   * get ahead of. The status on each row says which is which.
   */
  outstandingOnly?: boolean;
}

export async function listInvoices(
  organizationId: string,
  facilityId: string,
  filter: InvoiceFilter = {},
): Promise<Invoice[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS}
         ${JOINS_SQL}
         ${TOTALS_SQL}
        WHERE i.facility_id = $1
          AND ($2::date IS NULL
               OR date_trunc('month', i.issued_on) = date_trunc('month', $2::date))
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM invoice_line l
                 WHERE l.invoice_id = i.id AND l.organization_id = i.organization_id
                   AND l.student_id = $3::uuid))
          AND ($4::uuid IS NULL OR i.payer_membership_id = $4::uuid)
          AND ($5::boolean IS NOT TRUE
               OR invoice_status(i.kind, note.id IS NOT NULL, t.total_cents,
                                 pay.paid_cents, i.due_on)
                  IN ('open', 'partly_paid', 'overdue'))
        -- Oldest debt first on a chase list, newest first otherwise: one is a
        -- job to work through and the other is a record to look something up in.
        ORDER BY CASE WHEN $5::boolean IS TRUE THEN i.due_on END ASC,
                 i.issued_on DESC, i.number DESC`,
      [
        facilityId,
        filter.month ?? null,
        filter.studentId ?? null,
        filter.payerMembershipId ?? null,
        filter.outstandingOnly ?? false,
      ],
    );

    return rows.map(toInvoice);
  });
}

export async function readInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<Invoice | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} ${JOINS_SQL} ${TOTALS_SQL} WHERE i.id = $1`,
      [invoiceId],
    );
    const row = rows[0];
    if (row === undefined) return null;

    const invoice = toInvoice(row);
    invoice.lines = await readLines(tx, invoiceId);
    invoice.payments = await readPayments(tx, invoiceId);
    invoice.chases = await readChases(tx, invoiceId);
    return invoice;
  });
}

async function readLines(tx: Tx, invoiceId: string): Promise<InvoiceLine[]> {
  const { rows } = await tx.query<{
    id: string;
    student_id: string;
    student_name: string;
    student_tax_number: string | null;
    student_fee_id: string;
    kind: FeeKind;
    description: string | null;
    lessons_per_week: number | null;
    period_start: string;
    months: number;
    amount_cents: number;
    vat_rate: string;
    vat_exempt: boolean;
    vat_exemption_reason: string | null;
    vat_cents: number;
    credits_invoice_line_id: string | null;
  }>(
    `SELECT l.id, l.student_id, l.student_name, l.student_tax_number, l.student_fee_id,
            l.kind, l.description, l.lessons_per_week,
            to_char(l.period_start, 'YYYY-MM-DD') AS period_start,
            l.months, l.amount_cents, l.vat_rate, l.vat_exempt, l.vat_exemption_reason,
            invoice_vat_cents(l.amount_cents, l.vat_rate) AS vat_cents,
            l.credits_invoice_line_id
       FROM invoice_line l
      WHERE l.invoice_id = $1
      ORDER BY l.sort_order, l.student_name, l.id`,
    [invoiceId],
  );

  return rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    studentTaxNumber: row.student_tax_number,
    studentFeeId: row.student_fee_id,
    kind: row.kind,
    description: row.description,
    lessonsPerWeek: row.lessons_per_week,
    periodStart: row.period_start,
    months: row.months,
    amountCents: row.amount_cents,
    vatRate: Number(row.vat_rate),
    vatExempt: row.vat_exempt,
    vatExemptionReason: row.vat_exemption_reason,
    vatCents: row.vat_cents,
    netCents: row.amount_cents - row.vat_cents,
    creditsInvoiceLineId: row.credits_invoice_line_id,
  }));
}

// ---------------------------------------------------------------------------
// Correcting one
// ---------------------------------------------------------------------------

/**
 * The credit note against a document, mirroring every line.
 *
 * The only correction there is. A document is never edited and never deleted —
 * the application holds no privilege to do either — so a club that got one
 * wrong credits it and issues a fresh one, and both halves of that stay on the
 * record. Once the credit note exists the occurrences it covers are billable
 * again, which is what makes "issue a corrected invoice" work.
 *
 * Its own book, its own sequence: the first credit note is `NC A/1` whatever
 * number the invoice it corrects carries.
 */
export async function creditInvoice(
  organizationId: string,
  invoiceId: string,
  reason: string | null,
): Promise<{ id: string; documentNo: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: originals } = await tx.query<{
      id: string;
      kind: InvoiceDocumentKind;
      document_no: string;
      facility_id: string;
      payer_membership_id: string | null;
      payer_student_id: string | null;
      payer_name: string;
      payer_tax_number: string | null;
      payer_address: string | null;
      payer_email: string | null;
      credited_by: string | null;
    }>(
      `SELECT i.id, i.kind, i.document_no, i.facility_id,
              i.payer_membership_id, i.payer_student_id, i.payer_name,
              i.payer_tax_number, i.payer_address, i.payer_email::text AS payer_email,
              (SELECT c.document_no FROM invoice c
                WHERE c.corrects_invoice_id = i.id
                  AND c.organization_id = i.organization_id
                  AND c.kind = 'credit_note') AS credited_by
         FROM invoice i WHERE i.id = $1`,
      [invoiceId],
    );
    const original = originals[0];
    if (original === undefined || original.kind !== 'invoice') return null;
    if (original.credited_by !== null) throw new AlreadyCreditedError(original.document_no);

    const { rows: series } = await tx.query<{ id: string }>(
      `SELECT id FROM invoice_series
        WHERE facility_id = $1 AND kind = 'credit_note' AND archived_at IS NULL
        ORDER BY is_default DESC, created_at
        LIMIT 1`,
      [original.facility_id],
    );
    const seriesId = series[0]?.id;
    if (seriesId === undefined) throw new NoInvoiceSeriesError();

    const { rows: notes } = await tx.query<{ id: string; document_no: string }>(
      `INSERT INTO invoice
         (organization_id, facility_id, series_id, kind, corrects_invoice_id, due_on,
          payer_membership_id, payer_student_id, payer_name, payer_tax_number,
          payer_address, payer_email, notes)
       VALUES ($1, $2, $3, 'credit_note', $4, current_date, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, document_no`,
      [
        organizationId,
        original.facility_id,
        seriesId,
        original.id,
        original.payer_membership_id,
        original.payer_student_id,
        original.payer_name,
        original.payer_tax_number,
        original.payer_address,
        original.payer_email,
        reason,
      ],
    );
    const note = notes[0];
    if (note === undefined) throw new Error('Could not issue the credit note');

    /*
     * Every line mirrored, each naming the one it reverses.
     *
     * Copied in SQL rather than read out and written back: the amounts on a
     * credit note have to be exactly the ones on the document it corrects, and
     * a round trip through TypeScript is a chance for them not to be.
     */
    await tx.query(
      `INSERT INTO invoice_line
         (organization_id, invoice_id, student_id, student_fee_id, credits_invoice_line_id,
          student_name, student_tax_number, kind, description, lessons_per_week,
          period_start, months, amount_cents, vat_rate, vat_exempt, vat_exemption_reason,
          sort_order)
       SELECT l.organization_id, $2, l.student_id, l.student_fee_id, l.id,
              l.student_name, l.student_tax_number, l.kind, l.description,
              l.lessons_per_week, l.period_start, l.months, l.amount_cents, l.vat_rate,
              l.vat_exempt, l.vat_exemption_reason, l.sort_order
         FROM invoice_line l
        WHERE l.invoice_id = $1 AND l.organization_id = $3
        ORDER BY l.sort_order, l.id`,
      [original.id, note.id, organizationId],
    );

    await recordAudit(tx, {
      action: 'invoice.credited',
      entityType: 'invoice',
      entityId: original.id,
      data: { documentNo: original.document_no, creditNoteNo: note.document_no, reason },
    });

    return { id: note.id, documentNo: note.document_no };
  });
}

// ---------------------------------------------------------------------------
// Settlement and chasing — phase 2.3
// ---------------------------------------------------------------------------

async function readPayments(tx: Tx, invoiceId: string): Promise<InvoicePayment[]> {
  const { rows } = await tx.query<{
    id: string;
    amount_cents: number;
    paid_on: string;
    source: PaymentSource;
    reference: string | null;
    notes: string | null;
    recorded_by_name: string | null;
  }>(
    `SELECT p.id, p.amount_cents,
            to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on,
            p.source, p.reference, p.notes,
            person_name(p.recorded_by) AS recorded_by_name
       FROM invoice_payment p
      WHERE p.invoice_id = $1 AND p.archived_at IS NULL
      ORDER BY p.paid_on, p.created_at`,
    [invoiceId],
  );

  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    paidOn: row.paid_on,
    source: row.source,
    reference: row.reference,
    notes: row.notes,
    recordedByName: row.recorded_by_name,
  }));
}

async function readChases(tx: Tx, invoiceId: string): Promise<InvoiceChase[]> {
  const { rows } = await tx.query<{
    id: string;
    chased_on: string;
    channel: ChaseChannel;
    note: string | null;
    recorded_by_name: string | null;
  }>(
    `SELECT c.id, to_char(c.chased_on, 'YYYY-MM-DD') AS chased_on,
            c.channel, c.note,
            person_name(c.recorded_by) AS recorded_by_name
       FROM invoice_chase c
      WHERE c.invoice_id = $1 AND c.archived_at IS NULL
      ORDER BY c.chased_on DESC, c.created_at DESC`,
    [invoiceId],
  );

  return rows.map((row) => ({
    id: row.id,
    chasedOn: row.chased_on,
    channel: row.channel,
    note: row.note,
    recordedByName: row.recorded_by_name,
  }));
}

export interface PaymentInput {
  amountCents: number;
  paidOn: string;
  source: PaymentSource;
  reference: string | null;
  notes: string | null;
}

/**
 * Money arriving against a document.
 *
 * A row rather than a flag, because a family paying half in October and half in
 * November is two facts and a single date could hold neither. Nothing about the
 * document itself changes — it has no UPDATE grant, deliberately — so the state
 * an operator sees is recomputed from the sum every time it is read.
 */
export async function recordPayment(
  organizationId: string,
  facilityId: string,
  invoiceId: string,
  input: PaymentInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{ document_no: string }>(
      `SELECT document_no FROM invoice WHERE id = $2 AND facility_id = $1`,
      [facilityId, invoiceId],
    );
    if (found[0] === undefined) return null;

    let rows: { id: string }[];
    try {
      ({ rows } = await tx.query<{ id: string }>(
        `INSERT INTO invoice_payment
           (organization_id, invoice_id, amount_cents, paid_on, source, reference, notes,
            recorded_by)
         VALUES ($1, $2, $3, $4::date, $5::payment_source, $6, $7, $8)
         RETURNING id`,
        [
          organizationId,
          invoiceId,
          input.amountCents,
          input.paidOn,
          input.source,
          input.reference,
          input.notes,
          currentTenant().membershipId,
        ],
      ));
    } catch (error) {
      // A credit note reduces what is owed; money against one was entered
      // against the wrong document. The trigger is what says so, because there
      // will be a second way in when a bank feed arrives.
      const { code, detail } = error as { code?: string; detail?: string };
      if (code === '23514' && detail === 'invoice_payment_on_credit_note') {
        throw new NotPayableError();
      }
      throw error;
    }

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not record the payment');

    await recordAudit(tx, {
      action: 'invoice.payment_recorded',
      entityType: 'invoice',
      entityId: invoiceId,
      data: {
        documentNo: found[0].document_no,
        amountCents: input.amountCents,
        paidOn: input.paidOn,
        source: input.source,
      },
    });
    return id;
  });
}

/**
 * A payment entered against the wrong document, taken back off it.
 *
 * Archived rather than deleted: money is history, and a hard delete would take
 * the record of the mistake with it. Every sum filters `archived_at`.
 */
export async function archivePayment(
  organizationId: string,
  facilityId: string,
  invoiceId: string,
  paymentId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; amount_cents: number }>(
      `UPDATE invoice_payment p SET archived_at = now()
         FROM invoice i
        WHERE p.id = $3 AND p.invoice_id = $2 AND p.archived_at IS NULL
          AND i.id = p.invoice_id AND i.facility_id = $1
      RETURNING p.id, p.amount_cents`,
      [facilityId, invoiceId, paymentId],
    );
    const row = rows[0];
    if (row === undefined) return false;

    await recordAudit(tx, {
      action: 'invoice.payment_removed',
      entityType: 'invoice',
      entityId: invoiceId,
      data: { paymentId, amountCents: row.amount_cents },
    });
    return true;
  });
}

export interface ChaseInput {
  chasedOn: string;
  channel: ChaseChannel;
  note: string | null;
}

/**
 * A record of the club having asked.
 *
 * **Not a message Poolse sent.** The notification subsystem is phase 3.0; until
 * it exists a chase is a person telephoning or writing, and what this records is
 * that they did. That is what makes a second chase a different conversation
 * from the first, and it is what somebody needs to know before picking up the
 * telephone.
 */
export async function recordChase(
  organizationId: string,
  facilityId: string,
  invoiceId: string,
  input: ChaseInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: found } = await tx.query<{ document_no: string; kind: InvoiceDocumentKind }>(
      `SELECT document_no, kind FROM invoice WHERE id = $2 AND facility_id = $1`,
      [facilityId, invoiceId],
    );
    const document = found[0];
    if (document === undefined) return null;
    // Nobody is chased for a credit note: it is money owed the other way.
    if (document.kind !== 'invoice') throw new NotPayableError();

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO invoice_chase
         (organization_id, invoice_id, chased_on, channel, note, recorded_by)
       VALUES ($1, $2, $3::date, $4::invoice_chase_channel, $5, $6)
       RETURNING id`,
      [
        organizationId,
        invoiceId,
        input.chasedOn,
        input.channel,
        input.note,
        currentTenant().membershipId,
      ],
    );

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not record the chase');

    await recordAudit(tx, {
      action: 'invoice.chased',
      entityType: 'invoice',
      entityId: invoiceId,
      data: {
        documentNo: document.document_no,
        channel: input.channel,
        chasedOn: input.chasedOn,
      },
    });
    return id;
  });
}
