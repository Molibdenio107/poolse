import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { clubToday } from '../common/club-day.js';
import { liveTariffJoin } from '../energy/tariffs.repository.js';

/**
 * The cost ledger — POOLSE-182. One place every euro the club spends is read
 * from, in one shape: an amount and its VAT per month, with its kind and its
 * basis (`invoice`, a document exists; `estimate`, arithmetic).
 *
 * Three sources, never copied into each other:
 *
 * - **`cost_month`**, kept by triggers on bills, recorded costs, purchases and
 *   premiums (migration `cost-ledger`).
 * - **Salaries**, accrued on read by `salary_months()`. An Admin's figure
 *   leaves the Owner's pay out, as every pay read does.
 * - **Supply estimates**: a supply (a meter with its own CPE/CUI) priced by its
 *   tariff in a month **no bill of that meter covers** — the gap a late bill
 *   leaves. A sub-meter is never here: it is a slice of the general supply's
 *   bill, and adding its estimate to that bill would count the same euros twice
 *   (decided 05-11-2026; POOLSE-28's per-tank report remains its home).
 */

export type CostKind =
  | 'electricity'
  | 'gas'
  | 'water'
  | 'maintenance_service'
  | 'materials'
  | 'insurance'
  | 'salary'
  | 'fixed'
  | 'other';
export type CostBasis = 'invoice' | 'estimate';

export interface LedgerMonth {
  /** `YYYY-MM`. */
  month: string;
  kind: CostKind;
  basis: CostBasis;
  facilityId: string | null;
  netCents: number;
  vatCents: number;
}

export interface Ledger {
  months: LedgerMonth[];
  /** People with an hourly rate and no weekly hours: left out of the salaries, and said so. */
  salariesWithoutHours: number;
  /** Supply-months that had consumption and no rate, so no estimate. */
  unpricedSupplyMonths: number;
}

/** First and last day of the months a window touches, for reading month rows. */
function monthBounds(from: string, to: string): [string, string] {
  return [`${from.slice(0, 7)}-01`, to];
}

/**
 * Every month a window touches, by kind and basis. A month the window covers
 * only in part is given whole: the window's day-split is `costWindow`'s job,
 * and a chart of months wants months.
 */
export async function ledgerMonths(
  organizationId: string,
  from: string,
  to: string,
  withoutOwner: boolean,
): Promise<Ledger> {
  return withOrg(organizationId, async (tx) => {
    await tx.query('SELECT materialise_fixed_costs($1::date)', [clubToday()]);
    const [start, end] = monthBounds(from, to);

    const { rows: recorded } = await tx.query<{
      month: string;
      kind: CostKind;
      basis: CostBasis;
      facility_id: string | null;
      net: string;
      vat: string;
    }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, kind::text AS kind, basis::text AS basis, facility_id,
              sum(share_cents)::text AS net, sum(vat_cents)::text AS vat
         FROM cost_month
        WHERE month >= $1::date AND month <= $2::date
        GROUP BY 1, 2, 3, 4
        ORDER BY 1, 2`,
      [start, end],
    );

    const { rows: salaries } = await tx.query<{ month: string; cents: string; without_hours: number }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, cents::text AS cents, without_hours
         FROM salary_months($1::date, $2::date, $3)`,
      [start, end, withoutOwner],
    );

    const estimates = await supplyEstimates(tx, start, end);

    const months: LedgerMonth[] = [
      ...recorded.map((row) => ({
        month: row.month,
        kind: row.kind,
        basis: row.basis,
        facilityId: row.facility_id,
        netCents: Number(row.net),
        vatCents: Number(row.vat),
      })),
      ...salaries
        .filter((row) => Number(row.cents) !== 0)
        .map((row) => ({
          month: row.month,
          kind: 'salary' as const,
          basis: 'estimate' as const,
          facilityId: null,
          netCents: Number(row.cents),
          vatCents: 0,
        })),
      ...estimates.rows,
    ];
    return {
      months,
      salariesWithoutHours: Math.max(0, ...salaries.map((row) => row.without_hours)),
      unpricedSupplyMonths: estimates.unpriced,
    };
  });
}

/**
 * A supply's estimated cost in the months none of its bills covers. Consumption
 * is read as the energy module reads it (an index's difference, or an interval
 * value) and priced by `liveTariffJoin`, the energy module's own rule for which
 * rate applies on a day — reused, not rewritten. Net of VAT, since a tariff is.
 */
async function supplyEstimates(
  tx: Tx,
  start: string,
  end: string,
): Promise<{ rows: LedgerMonth[]; unpriced: number }> {
  const { rows } = await tx.query<{
    month: string;
    carrier: CostKind;
    facility_id: string;
    cents: number | null;
  }>(
    `WITH c AS (
       SELECT r.organization_id, r.meter_id, r.taken_at, f.timezone,
              CASE WHEN m.reads = 'interval_consumption' THEN r.value
                   ELSE r.value - coalesce(lag(r.value) OVER (PARTITION BY r.meter_id ORDER BY r.taken_at), m.initial_index)
              END AS consumed
         FROM energy_reading r
         JOIN energy_meter m ON m.id = r.meter_id AND m.organization_id = r.organization_id
         JOIN facility f ON f.id = m.facility_id AND f.organization_id = m.organization_id
        WHERE r.archived_at IS NULL AND m.archived_at IS NULL AND m.cpe IS NOT NULL
     ), p AS (
       SELECT c.*, date_trunc('month', (c.taken_at AT TIME ZONE c.timezone))::date AS month, tar.unit_price
         FROM c
         ${liveTariffJoin('c', '(c.taken_at AT TIME ZONE c.timezone)::date')}
        WHERE c.consumed IS NOT NULL
     )
     SELECT to_char(p.month, 'YYYY-MM') AS month, m.carrier::text AS carrier, m.facility_id,
            CASE WHEN count(*) FILTER (WHERE p.unit_price IS NULL) = 0
                 THEN round(sum(p.consumed * p.unit_price) * 100)::int END AS cents
       FROM p
       JOIN energy_meter m ON m.id = p.meter_id AND m.organization_id = p.organization_id
      WHERE p.month >= $1::date AND p.month <= $2::date
        -- Only where no bill of this meter overlaps the month.
        AND NOT EXISTS (
          SELECT 1 FROM energy_invoice i
           WHERE i.organization_id = p.organization_id AND i.meter_id = p.meter_id AND i.archived_at IS NULL
             AND i.period_start <= (p.month + interval '1 month - 1 day')::date
             AND i.period_end >= p.month)
      GROUP BY 1, 2, 3, p.meter_id`,
    [start, end],
  );
  return {
    rows: rows
      .filter((row) => row.cents !== null)
      .map((row) => ({
        month: row.month,
        kind: row.carrier,
        basis: 'estimate' as const,
        facilityId: row.facility_id,
        netCents: row.cents!,
        vatCents: 0,
      })),
    unpriced: rows.filter((row) => row.cents === null).length,
  };
}

export interface WindowTotal {
  kind: CostKind;
  basis: CostBasis;
  netCents: number;
  vatCents: number;
}

/** Days of `[from, to]` inside the month starting `month` (YYYY-MM), over the month's days. */
function partOfMonth(month: string, from: string, to: string): number {
  const first = new Date(`${month}-01T00:00:00Z`);
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const last = new Date(next.getTime() - 86_400_000);
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const lo = start > first ? start : first;
  const hi = end < last ? end : last;
  const days = Math.round((hi.getTime() - lo.getTime()) / 86_400_000) + 1;
  const inMonth = Math.round((next.getTime() - first.getTime()) / 86_400_000);
  return days <= 0 ? 0 : days / inMonth;
}

/**
 * A window's totals by kind and basis — a civil year, an época, any span (rule
 * 3). A month the window covers in part counts its days' share, the rule
 * `cost_window()` applies in SQL; rounded once per kind and basis at the end, so
 * a year read in pieces adds up.
 */
export async function costWindow(
  organizationId: string,
  from: string,
  to: string,
  withoutOwner: boolean,
): Promise<{ totals: WindowTotal[]; salariesWithoutHours: number; unpricedSupplyMonths: number }> {
  const ledger = await ledgerMonths(organizationId, from, to, withoutOwner);
  const sums = new Map<string, { kind: CostKind; basis: CostBasis; net: number; vat: number }>();
  for (const row of ledger.months) {
    const part = partOfMonth(row.month, from, to);
    if (part === 0) continue;
    const key = `${row.kind}|${row.basis}`;
    const sum = sums.get(key) ?? { kind: row.kind, basis: row.basis, net: 0, vat: 0 };
    sum.net += row.netCents * part;
    sum.vat += row.vatCents * part;
    sums.set(key, sum);
  }
  return {
    totals: [...sums.values()].map((sum) => ({
      kind: sum.kind,
      basis: sum.basis,
      netCents: Math.round(sum.net),
      vatCents: Math.round(sum.vat),
    })),
    salariesWithoutHours: ledger.salariesWithoutHours,
    unpricedSupplyMonths: ledger.unpricedSupplyMonths,
  };
}

export interface CostEntryInput {
  facilityId: string | null;
  kind: 'water' | 'maintenance_service' | 'fixed' | 'other';
  amountCents: number;
  vatCents: number;
  /** A one-off: both set. A recurring cost: `recurrence` and `effectiveFrom`. */
  periodFrom: string | null;
  periodTo: string | null;
  recurrence: 'none' | 'monthly' | 'yearly';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  supplier: string | null;
  documentNumber: string | null;
  note: string | null;
  maintenanceRequestId: string | null;
  taskCompletionId: string | null;
}

export interface CostEntryRow {
  id: string;
  kind: CostKind;
  amountCents: number;
  recurrence: 'none' | 'monthly' | 'yearly';
  startsOn: string;
  endsOn: string | null;
  supplier: string | null;
}

/**
 * What a person typed, newest first — POOLSE-189. Never a recurring cost's
 * generated months: the template stands for them, and archiving it stops them.
 */
export async function listCostEntries(organizationId: string): Promise<CostEntryRow[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<CostEntryRow>(
      `SELECT id, kind::text AS kind, amount_cents AS "amountCents", recurrence::text AS recurrence,
              to_char(coalesce(effective_from, period_from), 'YYYY-MM-DD') AS "startsOn",
              to_char(coalesce(effective_to, period_to), 'YYYY-MM-DD') AS "endsOn",
              supplier
         FROM cost_entry
        WHERE organization_id = $1 AND archived_at IS NULL AND template_id IS NULL
        ORDER BY created_at DESC
        LIMIT 50`,
      [organizationId],
    );
    return rows;
  });
}

export async function recordCost(organizationId: string, membershipId: string, input: CostEntryInput): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO cost_entry (organization_id, facility_id, kind, amount_cents, vat_cents, period_from, period_to,
                               recurrence, effective_from, effective_to, supplier, document_number, note,
                               maintenance_request_id, task_completion_id, recorded_by)
       VALUES ($1, $2, $3::cost_kind, $4, $5, $6::date, $7::date, $8::cost_recurrence, $9::date, $10::date,
               $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        organizationId,
        input.facilityId,
        input.kind,
        input.amountCents,
        input.vatCents,
        input.periodFrom,
        input.periodTo,
        input.recurrence,
        input.effectiveFrom,
        input.effectiveTo,
        input.supplier,
        input.documentNumber,
        input.note,
        input.maintenanceRequestId,
        input.taskCompletionId,
        membershipId,
      ],
    );
    const id = rows[0]!.id;
    if (input.recurrence !== 'none') await tx.query('SELECT materialise_fixed_costs($1::date)', [clubToday()]);
    // The amount is the club's own spending, so it is named in the trail.
    await recordAudit(tx, {
      action: 'cost.recorded',
      entityType: 'cost_entry',
      entityId: id,
      data: { kind: input.kind, amountCents: input.amountCents, recurrence: input.recurrence },
    });
    return id;
  });
}

/** Not paid, or recorded by mistake: archived. An occurrence archived is not generated again. */
export async function archiveCost(organizationId: string, costId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      'UPDATE cost_entry SET archived_at = now() WHERE id = $1 AND archived_at IS NULL',
      [costId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, { action: 'cost.archived', entityType: 'cost_entry', entityId: costId, data: {} });
    return true;
  });
}

export interface PurchaseInput {
  inventoryItemId: string;
  quantity: number;
  amountCents: number;
  vatCents: number;
  boughtOn: string;
  supplier: string | null;
  documentNumber: string | null;
}

/** Materials bought: the stock rises in the same transaction, and the unit cost is the last purchase's. */
export async function recordPurchase(
  organizationId: string,
  membershipId: string,
  input: PurchaseInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE inventory_item SET quantity = quantity + $2, unit_cost_cents = round($3::numeric / $2)::int
        WHERE id = $1 AND archived_at IS NULL`,
      [input.inventoryItemId, input.quantity, input.amountCents],
    );
    if (rowCount === 0) return null;
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO inventory_purchase (organization_id, inventory_item_id, quantity, amount_cents, vat_cents,
                                       bought_on, supplier, document_number, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9) RETURNING id`,
      [
        organizationId,
        input.inventoryItemId,
        input.quantity,
        input.amountCents,
        input.vatCents,
        input.boughtOn,
        input.supplier,
        input.documentNumber,
        membershipId,
      ],
    );
    await recordAudit(tx, {
      action: 'inventory.purchased',
      entityType: 'inventory_item',
      entityId: input.inventoryItemId,
      data: { purchaseId: rows[0]!.id, quantity: input.quantity, amountCents: input.amountCents },
    });
    return rows[0]!.id;
  });
}

/** The policy's premium — its period is the policy's own. Null clears it. */
export async function setPremium(
  organizationId: string,
  policyId: string,
  premiumCents: number | null,
  premiumVatCents: number | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE insurance_policy SET premium_cents = $2, premium_vat_cents = $3
        WHERE id = $1 AND archived_at IS NULL`,
      [policyId, premiumCents, premiumCents === null ? null : (premiumVatCents ?? 0)],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'insurance.premium_set',
      entityType: 'insurance_policy',
      entityId: policyId,
      data: { premiumCents },
    });
    return true;
  });
}
