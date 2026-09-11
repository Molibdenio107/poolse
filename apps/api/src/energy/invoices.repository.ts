import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Faturas de energia — the bill as a record, slice 5.3 (first half).
 *
 * A bill is written once, whole — header, registers, lines — in one
 * transaction, and removed by archiving. There is no edit: a bill is a
 * document somebody else issued, and a figure typed wrong is a bill filed
 * again, exactly as a reading is. `docs/features/energy.md`.
 *
 * **Preview and commit are one path with a flag**, as every importer here is:
 * `checkInvoice` produces the field errors and the warnings, and `addInvoice`
 * refuses to write anything `checkInvoice` would have flagged as an error. So a
 * preview cannot show a bill the commit then refuses, whichever way in it
 * came — typed, or read off a PDF.
 */

export type RegisterName = 'vazio' | 'ponta' | 'cheias' | 'super_vazio' | 'total';
export type TariffPeriod =
  | 'simples' | 'ponta' | 'cheias' | 'vazio_normal' | 'super_vazio' | 'fora_vazio' | 'vazio';
export type LineKind = 'energy' | 'power' | 'discount' | 'tax' | 'other';
export type ReadingQuality = 'real' | 'estimated';

export interface RegisterInput {
  register: RegisterName;
  previousIndex: number | null;
  currentIndex: number | null;
  kwh: number;
}

export interface LineInput {
  kind: LineKind;
  description: string;
  period: TariffPeriod | null;
  fromOn: string | null;
  toOn: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amountCents: number;
  discountCents: number;
  totalCents: number;
  vatRate: number | null;
}

export interface InvoiceInput {
  supplier: string;
  invoiceNumber: string;
  atcud: string | null;
  documentReference: string | null;
  issuedOn: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string | null;
  contractedPowerKva: number | null;
  tariff: string | null;
  cycle: string | null;
  readingQuality: ReadingQuality | null;
  /** What the bill says the delivery point and the dial are — checked against the meter. */
  cpe: string | null;
  meterSerial: string | null;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  otherChargesCents: number;
  documentTotalCents: number;
  networkAccessCents: number | null;
  regulatedDifferenceCents: number | null;
  notes: string | null;
  source: 'manual' | 'import';
  sourceFileName: string | null;
  registers: RegisterInput[];
  lines: LineInput[];
}

/** A bill in a list: enough to compare months without opening any of them. */
export interface InvoiceSummary {
  id: string;
  supplier: string;
  invoiceNumber: string;
  issuedOn: string;
  periodStart: string;
  periodEnd: string;
  days: number;
  /** Sum of the energy lines' quantities — what was billed, not what the dial said. */
  kwh: number;
  subtotalCents: number;
  totalCents: number;
  documentTotalCents: number;
  source: 'manual' | 'import' | 'feed';
}

export interface InvoiceDetail extends InvoiceSummary {
  meterId: string;
  meterName: string;
  facilityId: string;
  atcud: string | null;
  documentReference: string | null;
  dueOn: string | null;
  contractedPowerKva: number | null;
  tariff: string | null;
  cycle: string | null;
  readingQuality: ReadingQuality | null;
  vatCents: number;
  otherChargesCents: number;
  networkAccessCents: number | null;
  regulatedDifferenceCents: number | null;
  notes: string | null;
  sourceFileName: string | null;
  recordedByName: string | null;
  registers: RegisterInput[];
  lines: LineInput[];
}

/**
 * What a preview says about a bill before anything is written.
 *
 * `fields` are refusals — the commit will not happen with any of them.
 * `warnings` are things a person should look at and may accept: a total that
 * does not add up to its lines, a CPE that is not this meter's, a period that
 * overlaps a bill already filed. Both are keys into the web app's catalogue
 * with the figures as values, never sentences.
 */
export interface InvoiceCheck {
  fields: Record<string, string>;
  warnings: { key: string; values: Record<string, string | number> }[];
  /** Energy kWh as billed, and per the registers, for the preview's headline. */
  billedKwh: number;
  registerKwh: number;
  /** The commit will stamp these onto the meter, which has neither yet. */
  willSetCpe: boolean;
  willSetSerial: boolean;
}

const isoDate = (value: Date | string | null): string | null => {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  const y = value.getFullYear();
  const m = `${value.getMonth() + 1}`.padStart(2, '0');
  const d = `${value.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const ACTOR_NAME = (alias: string, user: string): string =>
  `nullif(btrim(concat_ws(' ',
     coalesce(${user}.cached_first_name, ${alias}.first_name),
     coalesce(${user}.cached_last_name,  ${alias}.last_name))), '')`;

/** The billed energy, summed from the lines — the one definition. */
const BILLED_KWH = `
  (SELECT coalesce(sum(l.quantity), 0)::float8
     FROM energy_invoice_line l
    WHERE l.invoice_id = i.id AND l.organization_id = i.organization_id
      AND l.kind = 'energy' AND l.unit ILIKE 'kwh')`;

const SUMMARY_COLUMNS = `
  i.id, i.supplier, i.invoice_number, i.issued_on, i.period_start, i.period_end,
  (i.period_end - i.period_start + 1) AS days,
  ${BILLED_KWH} AS kwh,
  i.subtotal_cents, i.total_cents, i.document_total_cents, i.source::text AS source`;

interface SummaryRow {
  id: string;
  supplier: string;
  invoice_number: string;
  issued_on: Date;
  period_start: Date;
  period_end: Date;
  days: number;
  kwh: number;
  subtotal_cents: number;
  total_cents: number;
  document_total_cents: number;
  source: 'manual' | 'import' | 'feed';
}

function summaryOf(row: SummaryRow): InvoiceSummary {
  return {
    id: row.id,
    supplier: row.supplier,
    invoiceNumber: row.invoice_number,
    issuedOn: isoDate(row.issued_on) ?? '',
    periodStart: isoDate(row.period_start) ?? '',
    periodEnd: isoDate(row.period_end) ?? '',
    days: row.days,
    kwh: row.kwh,
    subtotalCents: row.subtotal_cents,
    totalCents: row.total_cents,
    documentTotalCents: row.document_total_cents,
    source: row.source,
  };
}

/** Every live bill on one meter, newest period first. */
export async function listInvoices(organizationId: string, meterId: string): Promise<InvoiceSummary[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS}
         FROM energy_invoice i
        WHERE i.organization_id = $1 AND i.meter_id = $2 AND i.archived_at IS NULL
        ORDER BY i.period_end DESC, i.issued_on DESC`,
      [organizationId, meterId],
    );
    return rows.map(summaryOf);
  });
}

export async function getInvoice(organizationId: string, invoiceId: string): Promise<InvoiceDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<
      SummaryRow & {
        meter_id: string;
        meter_name: string;
        facility_id: string;
        atcud: string | null;
        document_reference: string | null;
        due_on: Date | null;
        contracted_power_kva: number | null;
        tariff: string | null;
        cycle: string | null;
        reading_quality: ReadingQuality | null;
        vat_cents: number;
        other_charges_cents: number;
        network_access_cents: number | null;
        regulated_difference_cents: number | null;
        notes: string | null;
        source_file_name: string | null;
        recorded_by_name: string | null;
      }
    >(
      `SELECT ${SUMMARY_COLUMNS},
              i.meter_id, m.name AS meter_name, m.facility_id,
              i.atcud, i.document_reference, i.due_on,
              i.contracted_power_kva::float8 AS contracted_power_kva,
              i.tariff, i.cycle, i.reading_quality::text AS reading_quality,
              i.vat_cents, i.other_charges_cents, i.network_access_cents,
              i.regulated_difference_cents, i.notes, i.source_file_name,
              ${ACTOR_NAME('bm', 'bu')} AS recorded_by_name
         FROM energy_invoice i
         JOIN energy_meter m ON m.id = i.meter_id AND m.organization_id = i.organization_id
         LEFT JOIN membership bm ON bm.id = i.recorded_by AND bm.organization_id = i.organization_id
         LEFT JOIN app_user bu   ON bu.id = bm.app_user_id
        WHERE i.organization_id = $1 AND i.id = $2`,
      [organizationId, invoiceId],
    );
    const row = rows[0];
    if (row === undefined) return null;

    const { rows: registers } = await tx.query<{
      register: RegisterName;
      previous_index: number | null;
      current_index: number | null;
      kwh: number;
    }>(
      `SELECT register::text AS register, previous_index::float8 AS previous_index,
              current_index::float8 AS current_index, kwh::float8 AS kwh
         FROM energy_invoice_register
        WHERE organization_id = $1 AND invoice_id = $2
        ORDER BY register`,
      [organizationId, invoiceId],
    );

    const { rows: lines } = await tx.query<{
      kind: LineKind;
      description: string;
      period: TariffPeriod | null;
      from_on: Date | null;
      to_on: Date | null;
      quantity: number | null;
      unit: string | null;
      unit_price: number | null;
      amount_cents: number;
      discount_cents: number;
      total_cents: number;
      vat_rate: number | null;
    }>(
      `SELECT kind::text AS kind, description, period::text AS period, from_on, to_on,
              quantity::float8 AS quantity, unit, unit_price::float8 AS unit_price,
              amount_cents, discount_cents, total_cents, vat_rate::float8 AS vat_rate
         FROM energy_invoice_line
        WHERE organization_id = $1 AND invoice_id = $2
        ORDER BY position`,
      [organizationId, invoiceId],
    );

    return {
      ...summaryOf(row),
      meterId: row.meter_id,
      meterName: row.meter_name,
      facilityId: row.facility_id,
      atcud: row.atcud,
      documentReference: row.document_reference,
      dueOn: isoDate(row.due_on),
      contractedPowerKva: row.contracted_power_kva,
      tariff: row.tariff,
      cycle: row.cycle,
      readingQuality: row.reading_quality,
      vatCents: row.vat_cents,
      otherChargesCents: row.other_charges_cents,
      networkAccessCents: row.network_access_cents,
      regulatedDifferenceCents: row.regulated_difference_cents,
      notes: row.notes,
      sourceFileName: row.source_file_name,
      recordedByName: row.recorded_by_name,
      registers: registers.map((r) => ({
        register: r.register,
        previousIndex: r.previous_index,
        currentIndex: r.current_index,
        kwh: r.kwh,
      })),
      lines: lines.map((l) => ({
        kind: l.kind,
        description: l.description,
        period: l.period,
        fromOn: isoDate(l.from_on),
        toOn: isoDate(l.to_on),
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unit_price,
        amountCents: l.amount_cents,
        discountCents: l.discount_cents,
        totalCents: l.total_cents,
        vatRate: l.vat_rate,
      })),
    };
  });
}

/** What the meter says about itself, for the checks. Null when there is no such live meter. */
async function meterFacts(
  organizationId: string,
  meterId: string,
): Promise<{ cpe: string | null; serial: string | null } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ cpe: string | null; serial: string | null }>(
      `SELECT cpe, serial FROM energy_meter
        WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [organizationId, meterId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Everything a preview says, computed once, here — the commit calls the same
 * function and refuses on any `fields` entry.
 *
 * The arithmetic checks are warnings, not refusals, because bills round: a
 * supplier's lines sum to 41,11 and its subtotal says 41,12, and a rule that
 * refused the bill over a cent would refuse most bills. The CHECKs that *are*
 * refusals — total = subtotal + VAT, document = total + other — are the ones
 * that mean a figure was mistyped rather than rounded.
 */
export async function checkInvoice(
  organizationId: string,
  meterId: string,
  input: InvoiceInput,
): Promise<InvoiceCheck> {
  const fields: Record<string, string> = {};
  const warnings: InvoiceCheck['warnings'] = [];

  if (input.totalCents !== input.subtotalCents + input.vatCents) {
    fields['totalCents'] = 'energy.invoice.totalMismatch';
  }
  if (input.documentTotalCents !== input.totalCents + input.otherChargesCents) {
    fields['documentTotalCents'] = 'energy.invoice.documentMismatch';
  }
  if (input.periodEnd < input.periodStart) fields['periodEnd'] = 'energy.invoice.periodOrder';
  if (input.dueOn !== null && input.dueOn < input.issuedOn) fields['dueOn'] = 'energy.invoice.dueBeforeIssued';

  input.registers.forEach((r, i) => {
    if (r.previousIndex !== null && r.currentIndex !== null && r.currentIndex < r.previousIndex) {
      fields[`registers.${i}.currentIndex`] = 'energy.invoice.registerBackwards';
    }
  });

  const meter = await meterFacts(organizationId, meterId);
  if (meter === null) {
    fields['meterId'] = 'energy.invoice.noMeter';
    return { fields, warnings, billedKwh: 0, registerKwh: 0, willSetCpe: false, willSetSerial: false };
  }

  const billedKwh = input.lines
    .filter((l) => l.kind === 'energy' && (l.unit ?? '').toLowerCase() === 'kwh')
    .reduce((sum, l) => sum + (l.quantity ?? 0), 0);
  const registerKwh = input.registers.reduce((sum, r) => sum + r.kwh, 0);

  const linesTotal = input.lines.reduce((sum, l) => sum + l.totalCents, 0);
  if (input.lines.length > 0 && Math.abs(linesTotal - input.subtotalCents) > 2) {
    warnings.push({
      key: 'energy.invoice.linesDisagree',
      values: { lines: linesTotal / 100, subtotal: input.subtotalCents / 100 },
    });
  }
  if (input.registers.length > 0 && billedKwh > 0 && Math.abs(registerKwh - billedKwh) > 0.5) {
    warnings.push({
      key: 'energy.invoice.registersDisagree',
      values: { registers: registerKwh, billed: billedKwh },
    });
  }

  const cpe = input.cpe;
  const willSetCpe = cpe !== null && meter.cpe === null;
  if (cpe !== null && meter.cpe !== null && cpe !== meter.cpe) {
    warnings.push({ key: 'energy.invoice.cpeMismatch', values: { bill: cpe, meter: meter.cpe } });
  }
  const willSetSerial = input.meterSerial !== null && meter.serial === null;
  if (input.meterSerial !== null && meter.serial !== null && input.meterSerial !== meter.serial) {
    warnings.push({
      key: 'energy.invoice.serialMismatch',
      values: { bill: input.meterSerial, meter: meter.serial },
    });
  }

  await withOrg(organizationId, async (tx) => {
    const { rows: dupes } = await tx.query<{ id: string }>(
      `SELECT id FROM energy_invoice
        WHERE organization_id = $1 AND lower(supplier) = lower($2)
          AND lower(invoice_number) = lower($3) AND archived_at IS NULL`,
      [organizationId, input.supplier, input.invoiceNumber],
    );
    if (dupes.length > 0) fields['invoiceNumber'] = 'energy.invoice.duplicate';

    const { rows: overlaps } = await tx.query<{ invoice_number: string; period_start: Date; period_end: Date }>(
      `SELECT invoice_number, period_start, period_end FROM energy_invoice
        WHERE organization_id = $1 AND meter_id = $2 AND archived_at IS NULL
          AND period_start <= $4::date AND period_end >= $3::date
        LIMIT 1`,
      [organizationId, meterId, input.periodStart, input.periodEnd],
    );
    const overlap = overlaps[0];
    if (overlap !== undefined) {
      warnings.push({
        key: 'energy.invoice.periodOverlap',
        values: {
          number: overlap.invoice_number,
          from: isoDate(overlap.period_start) ?? '',
          to: isoDate(overlap.period_end) ?? '',
        },
      });
    }
  });

  return { fields, warnings, billedKwh, registerKwh, willSetCpe, willSetSerial };
}

export class InvoiceRefusedError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('invoice refused');
  }
}

/**
 * Writes the bill, whole. Refuses on anything `checkInvoice` calls a field
 * error, so nothing lands that a preview would not have shown as landable.
 * Stamps the meter's CPE and serial from the bill when the meter has none —
 * said on the preview first (`willSetCpe`), never silently.
 */
export async function addInvoice(
  organizationId: string,
  meterId: string,
  membershipId: string,
  input: InvoiceInput,
): Promise<string> {
  const check = await checkInvoice(organizationId, meterId, input);
  if (Object.keys(check.fields).length > 0) throw new InvoiceRefusedError(check.fields);

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO energy_invoice
         (organization_id, meter_id, supplier, invoice_number, atcud, document_reference,
          issued_on, period_start, period_end, due_on,
          contracted_power_kva, tariff, cycle, reading_quality,
          subtotal_cents, vat_cents, total_cents, other_charges_cents, document_total_cents,
          network_access_cents, regulated_difference_cents,
          source, source_file_name, recorded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::energy_reading_quality, $15, $16, $17, $18, $19, $20, $21,
               $22::energy_reading_source, $23, $24, $25)
       RETURNING id`,
      [
        organizationId, meterId, input.supplier, input.invoiceNumber, input.atcud, input.documentReference,
        input.issuedOn, input.periodStart, input.periodEnd, input.dueOn,
        input.contractedPowerKva, input.tariff, input.cycle, input.readingQuality,
        input.subtotalCents, input.vatCents, input.totalCents, input.otherChargesCents, input.documentTotalCents,
        input.networkAccessCents, input.regulatedDifferenceCents,
        input.source, input.sourceFileName, membershipId, input.notes,
      ],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('Could not file the invoice');

    for (const r of input.registers) {
      await tx.query(
        `INSERT INTO energy_invoice_register
           (organization_id, invoice_id, register, previous_index, current_index, kwh)
         VALUES ($1, $2, $3::energy_register, $4, $5, $6)`,
        [organizationId, id, r.register, r.previousIndex, r.currentIndex, r.kwh],
      );
    }

    for (const [position, l] of input.lines.entries()) {
      await tx.query(
        `INSERT INTO energy_invoice_line
           (organization_id, invoice_id, position, kind, description, period, from_on, to_on,
            quantity, unit, unit_price, amount_cents, discount_cents, total_cents, vat_rate)
         VALUES ($1, $2, $3, $4::energy_line_kind, $5, $6::energy_tariff_period, $7, $8,
                 $9, $10, $11, $12, $13, $14, $15)`,
        [
          organizationId, id, position, l.kind, l.description, l.period, l.fromOn, l.toOn,
          l.quantity, l.unit, l.unitPrice, l.amountCents, l.discountCents, l.totalCents, l.vatRate,
        ],
      );
    }

    if (check.willSetCpe || check.willSetSerial) {
      await tx.query(
        `UPDATE energy_meter
            SET cpe = coalesce(cpe, $3), serial = coalesce(serial, $4)
          WHERE organization_id = $1 AND id = $2`,
        [organizationId, meterId, input.cpe, input.meterSerial],
      );
    }

    await recordAudit(tx, {
      action: 'energy.invoiceFiled',
      entityType: 'energy_invoice',
      entityId: id,
      data: {
        supplier: input.supplier,
        invoiceNumber: input.invoiceNumber,
        totalCents: input.totalCents,
        source: input.source,
      },
    });

    return id;
  });
}

export async function archiveInvoice(organizationId: string, invoiceId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE energy_invoice SET archived_at = now()
        WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [organizationId, invoiceId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'energy.invoiceArchived',
      entityType: 'energy_invoice',
      entityId: invoiceId,
      data: {},
    });
    return true;
  });
}
