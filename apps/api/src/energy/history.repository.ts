import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { TOTAL_COUNT, totalOf, type PageQuery, type Paginated } from '../common/pagination.js';

/**
 * Energia › Histórico — every meter's readings and bills in one list, and their
 * archive, one or all (Rui, 12-11-2026).
 *
 * **Readings have no id.** `energy_reading` is a TimescaleDB hypertable keyed on
 * (organization, meter, moment), so an archive of readings — one or many — is
 * one bin entry *on the meter* (`energy_readings`) listing each reading by its
 * moment. A bill has an id: one bill is its own entry (`energy_invoice`), many
 * of a meter are one entry on the meter (`energy_invoices`). Every entry is
 * restorable from Arquivados; nothing here deletes.
 *
 * A month is the facility's (`Europe/Lisbon`, as the bin's own period filter):
 * a reading by the moment it was taken, a bill by the month its billing period
 * ends — the same month `MonthlyCost` files it under.
 */

const ZONE = 'Europe/Lisbon';

export type HistoryKind = 'readings' | 'invoices';

export interface HistoryFilter {
  kind: HistoryKind;
  meterId: string | null;
  /** `YYYY-MM`, or null for every month. */
  month: string | null;
}

export interface HistoryReading {
  meterId: string;
  meterName: string;
  unit: string;
  takenAt: string;
  value: number;
  note: string | null;
  recordedByName: string | null;
}

export interface HistoryInvoice {
  id: string;
  meterId: string;
  meterName: string;
  supplier: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  totalCents: number;
}

export interface EnergyHistory {
  readings?: Paginated<HistoryReading>;
  invoices?: Paginated<HistoryInvoice>;
  /** The months that hold a record of this kind (and meter), newest first. */
  months: string[];
}

const ACTOR_NAME = `nullif(btrim(concat_ws(' ',
     coalesce(u.cached_first_name, m.first_name),
     coalesce(u.cached_last_name,  m.last_name))), '')`;

/** The month condition, on the facility's clock, for an instant or a date column. */
const READING_MONTH = `($3::text IS NULL OR to_char(r.taken_at AT TIME ZONE '${ZONE}', 'YYYY-MM') = $3)`;
const INVOICE_MONTH = `($3::text IS NULL OR to_char(i.period_end, 'YYYY-MM') = $3)`;

export async function readEnergyHistory(
  organizationId: string,
  filter: HistoryFilter,
  page: PageQuery,
): Promise<EnergyHistory> {
  return withOrg(organizationId, async (tx) => {
    if (filter.kind === 'readings') {
      const { rows } = await tx.query<{
        meter_id: string;
        meter_name: string;
        unit: string;
        taken_at: Date;
        value: number;
        note: string | null;
        recorded_by_name: string | null;
        total_count: number;
      }>(
        `SELECT r.meter_id, em.name AS meter_name, em.unit, r.taken_at, r.value::float8 AS value, r.note,
                ${ACTOR_NAME} AS recorded_by_name, ${TOTAL_COUNT}
           FROM energy_reading r
           JOIN energy_meter em ON em.id = r.meter_id AND em.organization_id = r.organization_id
           LEFT JOIN membership m ON m.id = r.recorded_by AND m.organization_id = r.organization_id
           LEFT JOIN app_user u ON u.id = m.app_user_id
          WHERE r.organization_id = $1 AND r.archived_at IS NULL AND em.archived_at IS NULL
            AND ($2::uuid IS NULL OR r.meter_id = $2)
            AND ${READING_MONTH}
          ORDER BY r.taken_at DESC, em.name
          LIMIT $4 OFFSET $5`,
        [organizationId, filter.meterId, filter.month, page.limit, page.offset],
      );
      return {
        readings: {
          items: rows.map((row) => ({
            meterId: row.meter_id,
            meterName: row.meter_name,
            unit: row.unit,
            takenAt: row.taken_at.toISOString(),
            value: row.value,
            note: row.note,
            recordedByName: row.recorded_by_name,
          })),
          total: totalOf(rows),
          page: page.page,
          limit: page.limit,
        },
        months: await monthsOf(tx, filter),
      };
    }

    const { rows } = await tx.query<{
      id: string;
      meter_id: string;
      meter_name: string;
      supplier: string;
      invoice_number: string;
      period_start: string;
      period_end: string;
      total_cents: number;
      total_count: number;
    }>(
      `SELECT i.id, i.meter_id, em.name AS meter_name, i.supplier, i.invoice_number,
              to_char(i.period_start, 'YYYY-MM-DD') AS period_start,
              to_char(i.period_end, 'YYYY-MM-DD') AS period_end,
              i.total_cents, ${TOTAL_COUNT}
         FROM energy_invoice i
         JOIN energy_meter em ON em.id = i.meter_id AND em.organization_id = i.organization_id
        WHERE i.organization_id = $1 AND i.archived_at IS NULL AND em.archived_at IS NULL
          AND ($2::uuid IS NULL OR i.meter_id = $2)
          AND ${INVOICE_MONTH}
        ORDER BY i.period_end DESC, em.name
        LIMIT $4 OFFSET $5`,
      [organizationId, filter.meterId, filter.month, page.limit, page.offset],
    );
    return {
      invoices: {
        items: rows.map((row) => ({
          id: row.id,
          meterId: row.meter_id,
          meterName: row.meter_name,
          supplier: row.supplier,
          invoiceNumber: row.invoice_number,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          totalCents: row.total_cents,
        })),
        total: totalOf(rows),
        page: page.page,
        limit: page.limit,
      },
      months: await monthsOf(tx, filter),
    };
  });
}

async function monthsOf(tx: Tx, filter: HistoryFilter): Promise<string[]> {
  const { rows } =
    filter.kind === 'readings'
      ? await tx.query<{ month: string }>(
          `SELECT DISTINCT to_char(r.taken_at AT TIME ZONE '${ZONE}', 'YYYY-MM') AS month
             FROM energy_reading r
             JOIN energy_meter em ON em.id = r.meter_id AND em.organization_id = r.organization_id
            WHERE r.archived_at IS NULL AND em.archived_at IS NULL AND ($1::uuid IS NULL OR r.meter_id = $1)
            ORDER BY month DESC`,
          [filter.meterId],
        )
      : await tx.query<{ month: string }>(
          `SELECT DISTINCT to_char(i.period_end, 'YYYY-MM') AS month
             FROM energy_invoice i
             JOIN energy_meter em ON em.id = i.meter_id AND em.organization_id = i.organization_id
            WHERE i.archived_at IS NULL AND em.archived_at IS NULL AND ($1::uuid IS NULL OR i.meter_id = $1)
            ORDER BY month DESC`,
          [filter.meterId],
        );
  return rows.map((row) => row.month);
}

/**
 * Archive what the filter shows — one meter or every meter, one month or all.
 *
 * One bin entry per meter touched, each listing exactly its rows, so the bin
 * restores a meter's batch without guessing. Returns how many rows went.
 */
export async function archiveEnergyHistory(organizationId: string, filter: HistoryFilter): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    if (filter.kind === 'readings') {
      const { rows } = await tx.query<{ meter_id: string; taken_at: string }>(
        `UPDATE energy_reading r SET archived_at = now()
           FROM energy_meter em
          WHERE em.id = r.meter_id AND em.organization_id = r.organization_id AND em.archived_at IS NULL
            AND r.archived_at IS NULL
            AND ($2::uuid IS NULL OR r.meter_id = $2)
            AND r.organization_id = $1
            AND ${READING_MONTH}
        RETURNING r.meter_id, r.taken_at::text AS taken_at`,
        [organizationId, filter.meterId, filter.month],
      );
      for (const [meterId, moments] of groupBy(rows, (row) => row.meter_id)) {
        await auditReadings(tx, meterId, moments.map((row) => row.taken_at));
      }
      return rows.length;
    }

    const { rows } = await tx.query<{ id: string; meter_id: string }>(
      `UPDATE energy_invoice i SET archived_at = now()
         FROM energy_meter em
        WHERE em.id = i.meter_id AND em.organization_id = i.organization_id AND em.archived_at IS NULL
          AND i.archived_at IS NULL
          AND ($2::uuid IS NULL OR i.meter_id = $2)
          AND i.organization_id = $1
          AND ${INVOICE_MONTH}
      RETURNING i.id, i.meter_id`,
      [organizationId, filter.meterId, filter.month],
    );
    for (const [meterId, bills] of groupBy(rows, (row) => row.meter_id)) {
      await recordAudit(tx, {
        action: 'energy.invoicesArchived',
        entityType: 'energy_invoices',
        entityId: meterId,
        data: { cascade: bills.map((bill) => ({ entityType: 'energy_invoice', id: bill.id })) },
      });
    }
    return rows.length;
  });
}

/** The one shape every reading archive writes, a single reading or many. */
export async function auditReadings(tx: Tx, meterId: string, moments: string[]): Promise<void> {
  await recordAudit(tx, {
    action: 'energy.readingsArchived',
    entityType: 'energy_readings',
    entityId: meterId,
    data: { cascade: moments.map((takenAt) => ({ entityType: 'energy_reading', meterId, takenAt })) },
  });
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
  return out;
}
