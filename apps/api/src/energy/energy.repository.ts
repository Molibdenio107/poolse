import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { liveTariffJoin } from './tariffs.repository.js';

/**
 * Energy — slices 5.1 and 5.2.
 *
 * A meter at a site, and what it read. The only rule that matters lives on the
 * meter: **`reads` says whether a value is the dial or a consumption**, and
 * every figure this module derives — the month's kWh, the bar on the chart —
 * is computed from that flag once, here, in SQL. The screen renders what it is
 * given, the way it renders the overdue-cleaning boolean.
 *
 * **Consumption is attributed to the reading that closes the interval.** A dial
 * read on 1 August and again on 1 September yields one figure, and it lands in
 * September's bucket, because that is when the club knew it. This is the only
 * honest choice for readings that are not on the first of the month — a reading
 * on the 15th spans two calendar months and the database cannot know how the
 * energy split between them. The screen says "consumo entre leituras", not
 * "consumo em Agosto", for that reason.
 */

export type MeterKind = 'pump' | 'heating' | 'lighting' | 'total' | 'other';
export type MeterReads = 'cumulative_index' | 'interval_consumption';

export interface EnergyMeter {
  id: string;
  facilityId: string;
  facilityName: string;
  poolId: string | null;
  poolName: string | null;
  name: string;
  kind: MeterKind;
  unit: string;
  reads: MeterReads;
  initialIndex: number | null;
  replacedMeterId: string | null;
  replacedMeterName: string | null;
  /** Código do Ponto de Entrega, compact, as a bill prints it minus the spaces — 5.3. */
  cpe: string | null;
  /** The number on the dial, as a bill prints it. */
  serial: string | null;
  notes: string | null;
  archived: boolean;

  /** The most recent live reading, or null. */
  latestAt: string | null;
  latestValue: number | null;
  readingCount: number;
}

export interface MeterInput {
  facilityId: string;
  poolId: string | null;
  name: string;
  kind: MeterKind;
  unit: string;
  reads: MeterReads;
  initialIndex: number | null;
  replacedMeterId: string | null;
  cpe: string | null;
  serial: string | null;
  notes: string | null;
}

export interface EnergyReading {
  /** ISO instant, UTC — the key, with the meter. */
  takenAt: string;
  value: number;
  source: 'manual' | 'import' | 'feed';
  recordedByName: string | null;
  note: string | null;
  /**
   * What this reading says was used since the one before it, or null for the
   * first reading of a dial with no initial index — there is nothing to
   * measure it from, and the screen says so rather than showing a zero.
   */
  consumed: number | null;
  /**
   * What that consumption cost, at the tariff live on the day this reading was
   * taken. Null when the meter had no rate then — a dash, never a zero.
   *
   * **An estimate, never a billed euro.** It is `consumed x unit_price` and
   * nothing else: no standing charge, no potência contratada, no tax that the
   * site's own fatura already carries. `costProvenance` says how weak it is.
   */
  costCents: number | null;
  costProvenance: CostProvenance | null;
}

/**
 * How much weight a derived cost carries — docs/financials.md §2.
 *
 * Never `actual` and never `contracted`: the kWh were metered and the euros
 * were multiplied, so the strongest this can be is `estimated`. A rate the club
 * marked `assumed` makes the cost `assumed` too, because a total is labelled
 * with its weakest component.
 */
export type CostProvenance = 'estimated' | 'assumed';

/** One calendar month in the facility's timezone. */
export interface MonthlyConsumption {
  /** `YYYY-MM`. */
  month: string;
  /** Null when no reading closed an interval in that month. */
  consumed: number | null;
  /**
   * The month's estimated cost, or null.
   *
   * **Null when any reading in the month had no rate**, not merely when they
   * all lacked one: a bar built from half a month's consumption is drawn the
   * same height as one built from all of it, and nothing on it says which. A
   * partial answer here is worse than an absent one.
   */
  costCents: number | null;

  /**
   * The same month a year earlier — slice 5.4.
   *
   * Null means there was no reading then, which is ordinary for a club in its
   * first eighteen months. It is drawn as a gap and said as "sem comparação",
   * never as a fall to zero: a missing counterpart is not a saving.
   */
  previousConsumed: number | null;
  previousCostCents: number | null;
}

/**
 * This window against the same window a year earlier — slice 5.4.
 *
 * **Computed over the months where BOTH years have a figure, and nothing
 * else.** A club with eighteen months of readings would otherwise compare
 * twelve months against six and be told it had halved its consumption.
 * `comparableMonths` sits on screen beside the figures, for the same reason
 * every aggregate here reports its coverage.
 *
 * **Consumption and cost are never merged into one "energy went up".** A flat
 * year of kWh with a bill forty per cent higher is a tariff change, not a pool,
 * and those are different things to do something about. Dividing each period's
 * cost by its own kWh makes that exact — an implied unit price per period —
 * rather than a guess at what size of divergence is worth mentioning.
 */
export interface YearOnYear {
  comparableMonths: number;
  consumed: number | null;
  previousConsumed: number | null;
  /** Both null unless every comparable month carried a rate in both years. */
  costCents: number | null;
  previousCostCents: number | null;
}

/**
 * The twelve months, and how much of them the tariffs actually reached.
 *
 * Coverage is not decoration — an unqualified total over partial data has the
 * same shape as a complete one (docs/financials.md §6), so the panel says
 * "9 de 12 meses" or it shows no total at all.
 */
export interface ConsumptionSeries {
  months: MonthlyConsumption[];
  /** Months in the window that had any consumption at all. */
  monthsWithConsumption: number;
  /** Of those, how many were fully priced. */
  monthsPriced: number;
  /** The sum of the priced months. Null when none were. */
  costCents: number | null;
  /** The weakest provenance among the rates used, or null when none were. */
  costProvenance: CostProvenance | null;
  /** The same window a year earlier, over the months that have both — 5.4. */
  yearOnYear: YearOnYear;
}

/** A pool at the site, for the meter form's picker. */
export interface Option {
  id: string;
  name: string;
}

/** Composed name of whoever is on a membership, from the cache or the row. */
const ACTOR_NAME = (alias: string, user: string): string =>
  `nullif(btrim(concat_ws(' ',
     coalesce(${user}.cached_first_name, ${alias}.first_name),
     coalesce(${user}.cached_last_name,  ${alias}.last_name))), '')`;

const METER_JOINS = `
  JOIN facility f ON f.id = m.facility_id AND f.organization_id = m.organization_id
  LEFT JOIN pool p ON p.id = m.pool_id AND p.organization_id = m.organization_id
  LEFT JOIN energy_meter rm
    ON rm.id = m.replaced_meter_id AND rm.organization_id = m.organization_id
  LEFT JOIN LATERAL (
    SELECT r.taken_at, r.value
      FROM energy_reading r
     WHERE r.meter_id = m.id AND r.organization_id = m.organization_id
       AND r.archived_at IS NULL
     ORDER BY r.taken_at DESC
     LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n
      FROM energy_reading r
     WHERE r.meter_id = m.id AND r.organization_id = m.organization_id
       AND r.archived_at IS NULL
  ) counted ON true`;

const METER_COLUMNS = `
  m.id, m.facility_id, f.name AS facility_name,
  m.pool_id, p.name AS pool_name,
  m.name, m.kind::text AS kind, m.unit, m.reads::text AS reads,
  -- ::float8, or numeric arrives as a string and the form shows "18402.000".
  m.initial_index::float8 AS initial_index,
  m.replaced_meter_id, rm.name AS replaced_meter_name,
  m.cpe, m.serial,
  m.notes, (m.archived_at IS NOT NULL) AS archived,
  latest.taken_at AS latest_at, latest.value::float8 AS latest_value,
  counted.n AS reading_count`;

interface MeterRow {
  id: string;
  facility_id: string;
  facility_name: string;
  pool_id: string | null;
  pool_name: string | null;
  name: string;
  kind: MeterKind;
  unit: string;
  reads: MeterReads;
  initial_index: number | null;
  replaced_meter_id: string | null;
  replaced_meter_name: string | null;
  cpe: string | null;
  serial: string | null;
  notes: string | null;
  archived: boolean;
  latest_at: Date | null;
  latest_value: number | null;
  reading_count: number;
}

function meterOf(row: MeterRow): EnergyMeter {
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    poolId: row.pool_id,
    poolName: row.pool_name,
    name: row.name,
    kind: row.kind,
    unit: row.unit,
    reads: row.reads,
    initialIndex: row.initial_index,
    replacedMeterId: row.replaced_meter_id,
    replacedMeterName: row.replaced_meter_name,
    cpe: row.cpe,
    serial: row.serial,
    notes: row.notes,
    archived: row.archived,
    latestAt: row.latest_at?.toISOString() ?? null,
    latestValue: row.latest_value,
    readingCount: row.reading_count,
  };
}

/** Every live meter at one site, the site-wide ones first, then by name. */
export async function listMeters(organizationId: string, facilityId: string): Promise<EnergyMeter[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<MeterRow>(
      `SELECT ${METER_COLUMNS}
         FROM energy_meter m
         ${METER_JOINS}
        WHERE m.organization_id = $1 AND m.facility_id = $2 AND m.archived_at IS NULL
        ORDER BY (m.pool_id IS NOT NULL), p.name NULLS FIRST, m.name`,
      [organizationId, facilityId],
    );
    return rows.map(meterOf);
  });
}

/** One meter, archived or not — its page still opens after a swap. */
export async function getMeter(organizationId: string, meterId: string): Promise<EnergyMeter | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<MeterRow>(
      `SELECT ${METER_COLUMNS}
         FROM energy_meter m
         ${METER_JOINS}
        WHERE m.organization_id = $1 AND m.id = $2`,
      [organizationId, meterId],
    );
    const row = rows[0];
    return row === undefined ? null : meterOf(row);
  });
}

/** The tanks at a site, for "which pool does this meter serve". */
export async function listPools(organizationId: string, facilityId: string): Promise<Option[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Option>(
      `SELECT id, name FROM pool
        WHERE organization_id = $1 AND facility_id = $2 AND archived_at IS NULL
        ORDER BY name`,
      [organizationId, facilityId],
    );
    return rows;
  });
}

/** Raised when a name is already taken at this site, or a target is not at it. */
export class MeterConflictError extends Error {
  constructor(readonly field: 'name' | 'poolId' | 'replacedMeterId' | 'cpe') {
    super(`energy meter conflict on ${field}`);
  }
}

/**
 * The shapes the database refuses, translated to a field.
 *
 * `23505` on the name index is a duplicate; `23503` is a pool or a replaced
 * meter that is not at this site — the composite key through `facility_id`
 * says so. Anything else is not ours.
 */
function asMeterError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const constraint = (error as { constraint?: string }).constraint ?? '';
  if (code === '23505' && constraint === 'energy_meter_name_uq') throw new MeterConflictError('name');
  if (code === '23505' && constraint === 'energy_meter_cpe_uq') throw new MeterConflictError('cpe');
  if (code === '23514' && constraint === 'energy_meter_cpe_shape') throw new MeterConflictError('cpe');
  if (code === '23503' && constraint.includes('pool')) throw new MeterConflictError('poolId');
  if (code === '23503' && constraint.includes('replaced')) throw new MeterConflictError('replacedMeterId');
  throw error;
}

export async function addMeter(organizationId: string, input: MeterInput): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    /*
     * A replaced meter is retired by its replacement: its readings stay, its
     * page still opens, and it no longer offers a reading form. Done here rather
     * than asked of the operator as a second step, because the second step is
     * the one that gets forgotten and then two live meters share a name.
     *
     * Retired *before* the insert, because the replacement usually carries the
     * same name and the unique index is partial on `archived_at` — the first
     * run of the test for this found the index firing first. One transaction,
     * so a refused insert un-retires it.
     */
    if (input.replacedMeterId !== null) {
      const { rowCount } = await tx.query(
        `UPDATE energy_meter SET archived_at = now()
          WHERE organization_id = $1 AND id = $2 AND facility_id = $3 AND archived_at IS NULL`,
        [organizationId, input.replacedMeterId, input.facilityId],
      );
      if (rowCount === 0) throw new MeterConflictError('replacedMeterId');
    }

    const { rows } = await tx
      .query<{ id: string }>(
        `INSERT INTO energy_meter
           (organization_id, facility_id, pool_id, name, kind, unit, reads,
            initial_index, replaced_meter_id, cpe, serial, notes)
         VALUES ($1, $2, $3, $4, $5::energy_meter_kind, $6, $7::energy_meter_reads, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          organizationId,
          input.facilityId,
          input.poolId,
          input.name,
          input.kind,
          input.unit,
          input.reads,
          input.initialIndex,
          input.replacedMeterId,
          input.cpe,
          input.serial,
          input.notes,
        ],
      )
      .catch(asMeterError);

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not create the meter');

    await recordAudit(tx, {
      action: 'energy.meterCreated',
      entityType: 'energy_meter',
      entityId: id,
      data: { name: input.name, kind: input.kind, reads: input.reads, replaced: input.replacedMeterId },
    });

    return id;
  });
}

/**
 * The facility and the replaced meter never move; `reads` does not either —
 * changing what a value means under a hundred existing readings would make
 * every one of them wrong at once. A meter that was set up wrong is archived
 * and made again.
 */
export async function updateMeter(
  organizationId: string,
  meterId: string,
  input: Pick<MeterInput, 'poolId' | 'name' | 'kind' | 'unit' | 'initialIndex' | 'cpe' | 'serial' | 'notes'>,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx
      .query(
        `UPDATE energy_meter
            SET pool_id = $3, name = $4, kind = $5::energy_meter_kind, unit = $6,
                initial_index = $7, cpe = $8, serial = $9, notes = $10
          WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
        [
          organizationId, meterId, input.poolId, input.name, input.kind, input.unit,
          input.initialIndex, input.cpe, input.serial, input.notes,
        ],
      )
      .catch(asMeterError);

    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'energy.meterUpdated',
      entityType: 'energy_meter',
      entityId: meterId,
      data: { name: input.name, kind: input.kind, initialIndex: input.initialIndex },
    });
    return true;
  });
}

export async function archiveMeter(organizationId: string, meterId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE energy_meter SET archived_at = now()
        WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [organizationId, meterId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'energy.meterArchived',
      entityType: 'energy_meter',
      entityId: meterId,
      data: {},
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/*
 * What each reading says was used, from the flag on the meter — the one
 * definition, read by the list and by the monthly rollup.
 *
 * An interval meter's value *is* the consumption. A dial's is the difference
 * from the previous live reading, or from the initial index for the first, or
 * nothing at all when there is no initial index. `lag` over the live rows
 * only: an archived reading is out of the series, exactly as the trigger
 * treats it.
 */
const CONSUMED = `
  SELECT r.organization_id, r.meter_id, r.taken_at, r.value, r.source, r.recorded_by, r.note,
         CASE
           WHEN m.reads = 'interval_consumption' THEN r.value
           ELSE r.value - coalesce(
                  lag(r.value) OVER (PARTITION BY r.meter_id ORDER BY r.taken_at),
                  m.initial_index)
         END AS consumed
    FROM energy_reading r
    JOIN energy_meter m ON m.id = r.meter_id AND m.organization_id = r.organization_id
   WHERE r.organization_id = $1 AND r.meter_id = $2 AND r.archived_at IS NULL`;

/*
 * What a reading's consumption cost, from the rate live on the day it was
 * taken — the second half of slice 5.3, and the one definition of it.
 *
 * **Priced at the closing reading's date**, because that is the date the
 * consumption is attributed to: an interval that straddles a price change is
 * priced at the rate in force when it closed. With a club reading its dials
 * once a month that is at most one interval per change, and the alternative —
 * splitting an interval across two rates pro rata by day — invents a
 * distribution of energy across days that the meter never measured. Said here
 * rather than discovered later from a figure that is out by a few euros.
 *
 * `$3` is the facility's timezone: a tariff runs by calendar day, and an
 * instant does not know which day it is until somebody says where.
 */
const PRICED = (tz: string): string => `
  SELECT c.*, tar.unit_price, tar.provenance AS tariff_provenance,
         CASE WHEN c.consumed IS NULL OR tar.unit_price IS NULL THEN NULL
              ELSE c.consumed * tar.unit_price END AS cost
    FROM c
    ${liveTariffJoin('c', `(c.taken_at AT TIME ZONE ${tz})::date`)}`;

/**
 * The weakest thing a cost derived from this rate can be called.
 *
 * A cost is never stronger than `estimated` — the euros were multiplied, not
 * metered — and never stronger than the rate it came from.
 */
function costProvenanceOf(tariffProvenance: string | null): CostProvenance | null {
  if (tariffProvenance === null) return null;
  return tariffProvenance === 'assumed' ? 'assumed' : 'estimated';
}

/** Every live reading of one meter, newest first, with what each one consumed. */
export async function listReadings(
  organizationId: string,
  meterId: string,
  timezone: string,
): Promise<EnergyReading[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      taken_at: Date;
      value: number;
      source: EnergyReading['source'];
      recorded_by_name: string | null;
      note: string | null;
      consumed: number | null;
      cost_cents: number | null;
      tariff_provenance: string | null;
    }>(
      `WITH c AS (${CONSUMED}), p AS (${PRICED('$3')})
       SELECT p.taken_at, p.value::float8 AS value, p.source::text AS source, p.note,
              p.consumed::float8 AS consumed,
              -- Rounded to the cent once, here, at the edge. Never in TypeScript.
              round(p.cost * 100)::int AS cost_cents,
              p.tariff_provenance,
              ${ACTOR_NAME('bm', 'bu')} AS recorded_by_name
         FROM p
         LEFT JOIN membership bm ON bm.id = p.recorded_by AND bm.organization_id = p.organization_id
         LEFT JOIN app_user bu   ON bu.id = bm.app_user_id
        ORDER BY p.taken_at DESC`,
      [organizationId, meterId, timezone],
    );

    return rows.map((row) => ({
      takenAt: row.taken_at.toISOString(),
      value: row.value,
      source: row.source,
      recordedByName: row.recorded_by_name,
      note: row.note,
      consumed: row.consumed,
      costCents: row.cost_cents,
      costProvenance: costProvenanceOf(row.tariff_provenance),
    }));
  });
}

/**
 * Consumption by calendar month in the facility's timezone, for the last
 * `months` months ending now.
 *
 * Every month is present, empty ones as null, so the chart draws twelve
 * columns whatever the club logged — a chart of only the months with data
 * would make a gap in the record look like continuity.
 */
export async function monthlyConsumption(
  organizationId: string,
  meterId: string,
  timezone: string,
  months = 12,
): Promise<ConsumptionSeries> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      month: string;
      consumed: number | null;
      cost_cents: number | null;
      unpriced: number;
      any_assumed: boolean | null;
    }>(
      `WITH c AS (${CONSUMED}), p AS (${PRICED('$3')}),
       months AS (
         SELECT to_char(
                  date_trunc('month', (now() AT TIME ZONE $3)) - (n || ' months')::interval,
                  'YYYY-MM') AS month
           FROM generate_series($4::int - 1, 0, -1) AS n
       )
       SELECT months.month,
              sum(p.consumed)::float8 AS consumed,
              /*
               * The month's cost, or nothing. A month with one priced reading
               * and one unpriced one is *not* partly costed: it is uncosted,
               * because a short bar and an incomplete bar look identical.
               */
              CASE WHEN count(p.consumed) > 0
                    AND count(p.consumed) FILTER (WHERE p.unit_price IS NULL) = 0
                   THEN round(sum(p.cost) * 100)
                   ELSE NULL END::int AS cost_cents,
              count(p.consumed) FILTER (WHERE p.unit_price IS NULL)::int AS unpriced,
              bool_or(p.tariff_provenance = 'assumed') AS any_assumed
         FROM months
         LEFT JOIN p ON to_char(p.taken_at AT TIME ZONE $3, 'YYYY-MM') = months.month
                    AND p.consumed IS NOT NULL
        GROUP BY months.month
        ORDER BY months.month`,
      // Twice the window: the months to report, preceded by the months they
      // are compared against. One query rather than two, because the second
      // would be the same query with a different offset and they would drift.
      [organizationId, meterId, timezone, months * 2],
    );

    /*
     * `rows` is ordered by month ascending over `months * 2`, so the window to
     * report is the tail and each month's counterpart sits exactly `months`
     * rows earlier. Pairing by index rather than by recomputing a date avoids a
     * second definition of "the same month last year" — and of what happens in
     * a 13-month year, which is a thing no calendar has but a date arithmetic
     * bug can invent.
     */
    const earlier = rows.slice(0, months);
    const current = rows.slice(months);

    const series: MonthlyConsumption[] = current.map((row, index) => ({
      month: row.month,
      consumed: row.consumed,
      costCents: row.cost_cents,
      previousConsumed: earlier[index]?.consumed ?? null,
      previousCostCents: earlier[index]?.cost_cents ?? null,
    }));

    /*
     * The headline, over the months that have both years and nothing else.
     * Cost needs both to be *priced*, not merely present: a month costed this
     * year and unpriced last year would otherwise compare a figure against
     * nothing and call the difference a rise.
     */
    const comparable = series.filter(
      (m) => m.consumed !== null && m.previousConsumed !== null,
    );
    const bothPriced = comparable.filter(
      (m) => m.costCents !== null && m.previousCostCents !== null,
    );
    const total = (values: (number | null)[]): number | null =>
      values.length === 0 ? null : values.reduce((sum: number, v) => sum + (v ?? 0), 0);

    const yearOnYear: YearOnYear = {
      comparableMonths: comparable.length,
      consumed: total(comparable.map((m) => m.consumed)),
      previousConsumed: total(comparable.map((m) => m.previousConsumed)),
      costCents: total(bothPriced.map((m) => m.costCents)),
      previousCostCents: total(bothPriced.map((m) => m.previousCostCents)),
    };

    const withConsumption = current.filter((row) => row.consumed !== null);
    const priced = withConsumption.filter((row) => row.cost_cents !== null);

    return {
      months: series,
      monthsWithConsumption: withConsumption.length,
      monthsPriced: priced.length,
      // A total over none of them is not zero, it is nothing to say.
      costCents:
        priced.length === 0
          ? null
          : priced.reduce((total, row) => total + (row.cost_cents ?? 0), 0),
      // Weakest component wins, and only the months actually in the total count.
      costProvenance:
        priced.length === 0
          ? null
          : priced.some((row) => row.any_assumed === true)
            ? 'assumed'
            : 'estimated',
      yearOnYear,
    };
  });
}

/** The site's clock, which is what a month is measured in. */
export async function meterTimezone(organizationId: string, meterId: string): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ timezone: string }>(
      `SELECT f.timezone
         FROM energy_meter m
         JOIN facility f ON f.id = m.facility_id AND f.organization_id = m.organization_id
        WHERE m.organization_id = $1 AND m.id = $2`,
      [organizationId, meterId],
    );
    return rows[0]?.timezone ?? null;
  });
}

/**
 * A dial ran backwards, or a figure is already there for that instant.
 *
 * `neighbour` is the reading the trigger compared against — the previous one
 * for `backwards`, the next for `ahead` — carried as a number so the API can
 * say "the reading before was 41,235" without recomputing it here.
 */
export class ReadingRefusedError extends Error {
  constructor(
    readonly reason: 'backwards' | 'ahead' | 'duplicate' | 'meter_archived',
    readonly neighbour: number | null,
    readonly value: number | null,
  ) {
    super(`reading refused: ${reason}`);
  }
}

function asReadingError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const detail = (error as { detail?: unknown }).detail;
  if (code === '23514' && typeof detail === 'string' && detail.startsWith('energy_index_')) {
    const [tag, neighbour, value] = detail.split('|');
    throw new ReadingRefusedError(
      tag === 'energy_index_ahead' ? 'ahead' : 'backwards',
      Number(neighbour),
      Number(value),
    );
  }
  if (code === '23505') throw new ReadingRefusedError('duplicate', null, null);
  throw error;
}

export interface ReadingInput {
  takenAt: string;
  value: number;
  note: string | null;
}

/**
 * Records a figure. A reading archived at exactly this instant is revived and
 * overwritten — that is a correction, and the key says it is the same reading.
 * A *live* one at this instant is refused: two people typing the same minute
 * is a conversation, not an overwrite.
 */
export async function addReading(
  organizationId: string,
  meterId: string,
  membershipId: string,
  input: ReadingInput,
): Promise<void> {
  return withOrg(organizationId, async (tx) => {
    const { rows: meters } = await tx.query<{ archived: boolean }>(
      `SELECT (archived_at IS NOT NULL) AS archived FROM energy_meter
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, meterId],
    );
    const meter = meters[0];
    if (meter === undefined) throw new Error('No such meter');
    if (meter.archived) throw new ReadingRefusedError('meter_archived', null, null);

    await tx
      .query(
        `INSERT INTO energy_reading
           (organization_id, meter_id, taken_at, value, source, recorded_by, note)
         VALUES ($1, $2, $3, $4, 'manual', $5, $6)
         ON CONFLICT (organization_id, meter_id, taken_at) DO UPDATE
           SET value = EXCLUDED.value, recorded_by = EXCLUDED.recorded_by,
               note = EXCLUDED.note, archived_at = NULL
           WHERE energy_reading.archived_at IS NOT NULL`,
        [organizationId, meterId, input.takenAt, input.value, membershipId, input.note],
      )
      .then(({ rowCount }) => {
        // DO UPDATE with a WHERE that did not match writes nothing and raises
        // nothing — a live row at that instant is exactly that silence.
        if (rowCount === 0) throw new ReadingRefusedError('duplicate', null, null);
      })
      .catch(asReadingError);

    await recordAudit(tx, {
      action: 'energy.readingRecorded',
      entityType: 'energy_meter',
      entityId: meterId,
      data: { takenAt: input.takenAt, value: input.value },
    });
  });
}

/** A reading that never happened. The next one is judged against its new neighbours. */
export async function archiveReading(
  organizationId: string,
  meterId: string,
  takenAt: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE energy_reading SET archived_at = now()
        WHERE organization_id = $1 AND meter_id = $2 AND taken_at = $3 AND archived_at IS NULL`,
      [organizationId, meterId, takenAt],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'energy.readingArchived',
      entityType: 'energy_meter',
      entityId: meterId,
      data: { takenAt },
    });
    return true;
  });
}
