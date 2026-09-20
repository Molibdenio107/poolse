import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Tariffs — roadmap slice 5.3, second half.
 *
 * What one unit off a meter costs, effective-dated, one live rate at a time.
 * It exists for the meter that has **no fatura**: a billed meter's euros are a
 * fact from `energy_invoice`, and a sub-meter behind the club's one ponto de
 * entrega never receives a bill of its own.
 *
 * **Everything derived from a rate here is an estimate**, whatever the rate's
 * own provenance — the kWh were metered and the euros were not. That is why the
 * schema forbids `actual` on this table and why every figure the costing
 * produces travels with `provenance: 'estimated'` beside it. A billed euro and
 * an estimated one are never added into one unlabelled total; see
 * `docs/financials.md` §2, the rule most likely to be broken by accident.
 *
 * **`liveTariffJoin` is the one definition of "the rate that applied on that
 * day"** and is exported for the costing in `energy.repository.ts`, so the
 * tariff screen and the cost on the chart cannot disagree about which rate a
 * March reading was priced at.
 */

/** Never `actual` — a euro that happened is a document, and this is not one. */
export type TariffProvenance = 'contracted' | 'estimated' | 'assumed';

export const TARIFF_PROVENANCES: readonly TariffProvenance[] = ['contracted', 'estimated', 'assumed'];

export interface Tariff {
  id: string;
  /** €/unit, gross, in the meter's own unit. Never cents — see the migration. */
  unitPrice: number;
  unitPriceLow: number | null;
  unitPriceHigh: number | null;
  provenance: TariffProvenance;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** The last day at this rate, inclusive. Null while it is the live one. */
  effectiveTo: string | null;
  /** True when today falls inside its range — derived here, never stored. */
  live: boolean;
  note: string | null;
  createdByName: string | null;
}

export interface TariffInput {
  unitPrice: number;
  unitPriceLow: number | null;
  unitPriceHigh: number | null;
  provenance: TariffProvenance;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
}

/**
 * The rate live on a given day, as a LATERAL join.
 *
 * `alias` names the row carrying `organization_id` and `meter_id`, and `day` is
 * the date expression to test — already in the facility's clock, because a
 * tariff runs by calendar day and an instant does not know which day it is
 * until somebody says where.
 *
 * A join rather than a scalar subquery because two columns come back: the price
 * and where it came from, and the second is what keeps a cost derived from a
 * guess from being reported as one derived from a contract.
 *
 * At most one row can match, which is why there is no ordering here and no tie
 * to break — `energy_tariff_no_overlap` is the guarantee.
 */
export function liveTariffJoin(alias: string, day: string, as = 'tar'): string {
  return `LEFT JOIN LATERAL (
    SELECT t.unit_price, t.provenance::text AS provenance
      FROM energy_tariff t
     WHERE t.organization_id = ${alias}.organization_id
       AND t.meter_id = ${alias}.meter_id
       AND t.archived_at IS NULL
       AND t.effective_from <= ${day}
       AND (t.effective_to IS NULL OR t.effective_to >= ${day})
     LIMIT 1
  ) ${as} ON true`;
}

/** Composed name of whoever signed the rate, from the Clerk cache or the row. */
const AUTHOR_NAME = `
  nullif(btrim(concat_ws(' ',
    coalesce(au.cached_first_name, am.first_name),
    coalesce(au.cached_last_name,  am.last_name))), '')`;

interface TariffRow {
  id: string;
  unit_price: number;
  unit_price_low: number | null;
  unit_price_high: number | null;
  provenance: TariffProvenance;
  effective_from: string;
  effective_to: string | null;
  live: boolean;
  note: string | null;
  created_by_name: string | null;
}

function tariffOf(row: TariffRow): Tariff {
  return {
    id: row.id,
    unitPrice: row.unit_price,
    unitPriceLow: row.unit_price_low,
    unitPriceHigh: row.unit_price_high,
    provenance: row.provenance,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    live: row.live,
    note: row.note,
    createdByName: row.created_by_name,
  };
}

/**
 * Every live rate this meter has carried, newest first.
 *
 * Dates come back as `YYYY-MM-DD` text rather than as `Date`: a `date` column is
 * a day, and letting node-postgres parse one into a UTC instant is the
 * off-by-one that made a rate effective on 1 October read as 30 September.
 */
export async function listTariffs(organizationId: string, meterId: string): Promise<Tariff[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<TariffRow>(
      `SELECT t.id,
              -- ::float8, or numeric arrives as a string and the form shows "0.154800".
              t.unit_price::float8       AS unit_price,
              t.unit_price_low::float8   AS unit_price_low,
              t.unit_price_high::float8  AS unit_price_high,
              t.provenance::text         AS provenance,
              to_char(t.effective_from, 'YYYY-MM-DD') AS effective_from,
              to_char(t.effective_to,   'YYYY-MM-DD') AS effective_to,
              (t.effective_from <= current_date
                 AND (t.effective_to IS NULL OR t.effective_to >= current_date)) AS live,
              t.note,
              ${AUTHOR_NAME} AS created_by_name
         FROM energy_tariff t
         LEFT JOIN membership am
           ON am.id = t.created_by_membership_id AND am.organization_id = t.organization_id
         LEFT JOIN app_user au ON au.id = am.app_user_id
        WHERE t.organization_id = $1 AND t.meter_id = $2 AND t.archived_at IS NULL
        ORDER BY t.effective_from DESC`,
      [organizationId, meterId],
    );
    return rows.map(tariffOf);
  });
}

/** A rate that would sit on a day another rate already covers. */
export class TariffOverlapError extends Error {
  constructor() {
    super('a rate already covers part of that period');
  }
}

function asTariffError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const constraint = (error as { constraint?: string }).constraint ?? '';
  // 23P01 is exclusion_violation — the one live rate per meter.
  if (code === '23P01' && constraint === 'energy_tariff_no_overlap') throw new TariffOverlapError();
  throw error;
}

export async function addTariff(
  organizationId: string,
  meterId: string,
  membershipId: string,
  input: TariffInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx
      .query<{ id: string }>(
        `INSERT INTO energy_tariff
           (organization_id, meter_id, unit_price, unit_price_low, unit_price_high,
            provenance, effective_from, effective_to, note, created_by_membership_id)
         VALUES ($1, $2, $3, $4, $5, $6::money_provenance, $7, $8, $9, $10)
         RETURNING id`,
        [
          organizationId, meterId, input.unitPrice, input.unitPriceLow, input.unitPriceHigh,
          input.provenance, input.effectiveFrom, input.effectiveTo, input.note, membershipId,
        ],
      )
      .catch(asTariffError);

    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Could not record the tariff');

    /*
     * No amount in the audit trail, the same rule salaries follow: `audit_log`
     * records who changed what, and the effective-dated table is the record of
     * the figure. A rate in a log line is a second copy of a number that is
     * supposed to have one home.
     */
    await recordAudit(tx, {
      action: 'energy.tariffSet',
      entityType: 'energy_meter',
      entityId: meterId,
      data: { tariffId: id, from: input.effectiveFrom, to: input.effectiveTo, provenance: input.provenance },
    });

    return id;
  });
}

/**
 * Corrects a rate that was typed wrong.
 *
 * A *new* rate is a new row — that is what makes "what did the pump cost in
 * March" answerable. This is the other case: the figure or the dates were
 * entered incorrectly and the record should never have said what it says.
 */
export async function updateTariff(
  organizationId: string,
  meterId: string,
  tariffId: string,
  input: TariffInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx
      .query(
        `UPDATE energy_tariff
            SET unit_price = $4, unit_price_low = $5, unit_price_high = $6,
                provenance = $7::money_provenance, effective_from = $8,
                effective_to = $9, note = $10
          WHERE organization_id = $1 AND meter_id = $2 AND id = $3 AND archived_at IS NULL`,
        [
          organizationId, meterId, tariffId, input.unitPrice, input.unitPriceLow,
          input.unitPriceHigh, input.provenance, input.effectiveFrom, input.effectiveTo, input.note,
        ],
      )
      .catch(asTariffError);

    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'energy.tariffUpdated',
      entityType: 'energy_meter',
      entityId: meterId,
      data: { tariffId, from: input.effectiveFrom, to: input.effectiveTo, provenance: input.provenance },
    });
    return true;
  });
}

/**
 * A rate that never applied.
 *
 * Archiving the live one leaves the meter with no live rate — the previous one
 * stays closed and does not reopen, because a closed rate reopening is a price
 * change nobody made. The months it used to price become dashes again, which is
 * the honest answer.
 */
export async function archiveTariff(
  organizationId: string,
  meterId: string,
  tariffId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE energy_tariff SET archived_at = now()
        WHERE organization_id = $1 AND meter_id = $2 AND id = $3 AND archived_at IS NULL`,
      [organizationId, meterId, tariffId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'energy.tariffArchived',
      entityType: 'energy_meter',
      entityId: meterId,
      data: { tariffId },
    });
    return true;
  });
}
