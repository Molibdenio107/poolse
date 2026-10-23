import { withOrg } from '@poolse/db';
import { poolCostReport, poolTimezone } from './cost-report.repository.js';
import { BILLED_KWH } from './invoices.repository.js';

/**
 * The Energia page's dashboard — POOLSE-106. The whole club, a fixed window.
 *
 * **Two sources, never added together** (`docs/financials.md`). The running
 * costs by month and carrier are **bills**: euros a supplier charged, *actual*.
 * Cost per lesson hour and per swimmer are POOLSE-28's figures: the tanks' own
 * meters priced by a tariff, *estimated*. They sit side by side on the screen
 * with their own words, and neither is ever summed into the other.
 *
 * **A month is the month a billing period ends in**, as `energyCosts` already
 * says it — a period is attributed to the moment the club knew it. So the
 * current month usually has no bill yet, and the answer says which month was
 * billed last rather than showing a zero.
 *
 * **A year-on-year change compares only the months that have a bill in both
 * years** (slice 5.4a's rule): a club with fourteen months of bills would
 * otherwise be told it had halved its spend. How many months were compared
 * travels with the figure.
 *
 * **Money is withheld from maintenance** by the query, not the screen: every
 * `cents` is null and `canSeeMoney` false, and the kWh stay — what the site
 * consumes is maintenance's business, what it costs is the office's.
 */

export const CARRIERS = ['electricity', 'gas', 'water'] as const;
export type Carrier = (typeof CARRIERS)[number];

/** The last day a supply may go without a bill before it is listed as missing. */
export const MISSING_BILL_DAYS = 45;

export interface CarrierMonth {
  /** Bills' total incl. VAT, or null when no bill ended that month — or when withheld. */
  cents: number | null;
  /** kWh billed (m³ for water), or null when no bill ended that month. */
  quantity: number | null;
  bills: number;
}

export interface SummaryMonth {
  month: string;
  carriers: Record<Carrier, CarrierMonth>;
}

/** A total, and how it compares with the same months a year earlier. */
export interface Compared {
  cents: number | null;
  quantity: number | null;
  /** Over the months with a bill in both years only; null when there are none. */
  previousCents: number | null;
  currentComparedCents: number | null;
  comparedMonths: number;
}

export interface MissingBill {
  meterId: string;
  meterName: string;
  facilityName: string;
  carrier: Carrier;
  /** The end of the last bill's period, or null when the supply was never billed. */
  lastPeriodEnd: string | null;
}

export interface PerUse {
  /** Heat allocated to taught months, over the tanks that have a priced meter. */
  allocatedCents: number;
  lessonHours: number;
  bathers: number;
  perLessonHourCents: number | null;
  perBatherCents: number | null;
  /** Coverage: tanks whose cost could be counted, of the club's tanks. */
  poolsCounted: number;
  pools: number;
}

export interface EnergySummary {
  canSeeMoney: boolean;
  /** The twelve months, oldest first, ending with the current one. */
  months: SummaryMonth[];
  /** Which carriers have a live meter at all — water with none says so. */
  metered: Record<Carrier, number>;
  thisMonth: { month: string; carriers: Record<Carrier, Compared> };
  lastTwelve: Record<Carrier, Compared>;
  /** The last month any bill ended in, for "no bill yet this month". */
  lastBilledMonth: string | null;
  perUse: PerUse | null;
  missing: MissingBill[];
}

interface Row {
  month: string;
  carrier: Carrier;
  cents: number | null;
  quantity: number | null;
  bills: number;
}

function emptyMonth(): Record<Carrier, CarrierMonth> {
  return {
    electricity: { cents: null, quantity: null, bills: 0 },
    gas: { cents: null, quantity: null, bills: 0 },
    water: { cents: null, quantity: null, bills: 0 },
  };
}

/** Sum two optional figures, keeping null when neither has one. */
function add(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : a + b;
}

/**
 * A total over `months`, compared with the month exactly a year before each —
 * paired by index, never by recomputing a date, as `monthlyConsumption` does.
 */
function compare(current: CarrierMonth[], previous: CarrierMonth[], money: boolean): Compared {
  let cents: number | null = null;
  let quantity: number | null = null;
  let previousCents: number | null = null;
  let currentComparedCents: number | null = null;
  let comparedMonths = 0;
  current.forEach((month, index) => {
    cents = add(cents, month.cents);
    quantity = add(quantity, month.quantity);
    const before = previous[index];
    if (before !== undefined && month.bills > 0 && before.bills > 0) {
      comparedMonths += 1;
      previousCents = add(previousCents, before.cents);
      currentComparedCents = add(currentComparedCents, month.cents);
    }
  });
  return {
    cents: money ? cents : null,
    quantity,
    previousCents: money && comparedMonths > 0 ? previousCents : null,
    currentComparedCents: money && comparedMonths > 0 ? currentComparedCents : null,
    comparedMonths,
  };
}

export async function energySummary(organizationId: string, money: boolean): Promise<EnergySummary> {
  const base = await withOrg(organizationId, async (tx) => {
    // Twenty-four months: the twelve shown and the twelve they are compared with.
    const { rows } = await tx.query<Row>(
      `WITH months AS (
         SELECT to_char(date_trunc('month', club_today()) - (n || ' months')::interval, 'YYYY-MM') AS month
           FROM generate_series(23, 0, -1) AS n
       ),
       billed AS (
         SELECT to_char(i.period_end, 'YYYY-MM') AS month,
                m.carrier::text AS carrier,
                i.total_cents,
                ${BILLED_KWH} AS quantity
           FROM energy_invoice i
           JOIN energy_meter m ON m.id = i.meter_id AND m.organization_id = i.organization_id
          WHERE i.organization_id = $1 AND i.archived_at IS NULL
       )
       SELECT months.month, c.carrier,
              sum(billed.total_cents)::int AS cents,
              sum(billed.quantity)::float8 AS quantity,
              count(billed.month)::int AS bills
         FROM months
         CROSS JOIN unnest(enum_range(NULL::energy_carrier)::text[]) AS c(carrier)
         LEFT JOIN billed ON billed.month = months.month AND billed.carrier = c.carrier
        GROUP BY months.month, c.carrier
        ORDER BY months.month`,
      [organizationId],
    );

    const { rows: metered } = await tx.query<{ carrier: Carrier; n: number }>(
      `SELECT carrier::text AS carrier, count(*)::int AS n
         FROM energy_meter WHERE organization_id = $1 AND archived_at IS NULL
        GROUP BY carrier`,
      [organizationId],
    );

    /*
     * A supply that should have a bill and has none recent. "Should" is a meter
     * with a supply point (a CPE or CUI) or one billed before: a sub-meter
     * behind the general supply never gets a bill of its own, and listing it
     * for ever would teach the club to ignore the list.
     */
    const { rows: missing } = await tx.query<{
      meter_id: string; meter_name: string; facility_name: string; carrier: Carrier; last_end: string | null;
    }>(
      `SELECT m.id AS meter_id, m.name AS meter_name, f.name AS facility_name, m.carrier::text AS carrier,
              to_char(max(i.period_end), 'YYYY-MM-DD') AS last_end
         FROM energy_meter m
         JOIN facility f ON f.id = m.facility_id AND f.organization_id = m.organization_id AND f.archived_at IS NULL
         LEFT JOIN energy_invoice i
           ON i.meter_id = m.id AND i.organization_id = m.organization_id AND i.archived_at IS NULL
        WHERE m.organization_id = $1 AND m.archived_at IS NULL
        GROUP BY m.id, m.name, f.name, m.carrier, m.cpe
       HAVING (m.cpe IS NOT NULL OR count(i.id) > 0)
          AND (max(i.period_end) IS NULL OR max(i.period_end) < club_today() - $2::int)
        ORDER BY f.name, m.name`,
      [organizationId, MISSING_BILL_DAYS],
    );

    const { rows: pools } = await tx.query<{ id: string }>(
      `SELECT p.id FROM pool p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id AND f.archived_at IS NULL
        WHERE p.organization_id = $1 AND p.archived_at IS NULL
        ORDER BY p.created_at`,
      [organizationId],
    );

    return { rows, metered, missing, poolIds: pools.map((pool) => pool.id) };
  });

  // The twenty-four months, each with every carrier.
  const byMonth = new Map<string, Record<Carrier, CarrierMonth>>();
  for (const row of base.rows) {
    const month = byMonth.get(row.month) ?? emptyMonth();
    month[row.carrier] = { cents: row.cents, quantity: row.quantity, bills: row.bills };
    byMonth.set(row.month, month);
  }
  const all = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const previous = all.slice(0, 12);
  const shown = all.slice(12);

  const series = (list: typeof all, carrier: Carrier): CarrierMonth[] => list.map(([, m]) => m[carrier]);
  const lastTwelve = Object.fromEntries(
    CARRIERS.map((carrier) => [carrier, compare(series(shown, carrier), series(previous, carrier), money)]),
  ) as Record<Carrier, Compared>;
  const thisMonth = {
    month: shown.at(-1)![0],
    carriers: Object.fromEntries(
      CARRIERS.map((carrier) => [
        carrier,
        compare(series(shown.slice(-1), carrier), series(previous.slice(-1), carrier), money),
      ]),
    ) as Record<Carrier, Compared>,
  };
  const lastBilledMonth =
    [...all].reverse().find(([, m]) => CARRIERS.some((carrier) => m[carrier].bills > 0))?.[0] ?? null;

  return {
    canSeeMoney: money,
    months: shown.map(([month, carriers]) => ({
      month,
      carriers: money
        ? carriers
        : (Object.fromEntries(
            CARRIERS.map((carrier) => [carrier, { ...carriers[carrier], cents: null }]),
          ) as Record<Carrier, CarrierMonth>),
    })),
    metered: {
      electricity: base.metered.find((m) => m.carrier === 'electricity')?.n ?? 0,
      gas: base.metered.find((m) => m.carrier === 'gas')?.n ?? 0,
      water: base.metered.find((m) => m.carrier === 'water')?.n ?? 0,
    },
    thisMonth,
    lastTwelve,
    lastBilledMonth,
    perUse: money ? await perUse(organizationId, base.poolIds) : null,
    missing: base.missing.map((m) => ({
      meterId: m.meter_id,
      meterName: m.meter_name,
      facilityName: m.facility_name,
      carrier: m.carrier,
      lastPeriodEnd: m.last_end,
    })),
  };
}

/**
 * POOLSE-28's figures for the whole club: each tank's own report, summed.
 *
 * **Read off `poolCostReport`, never recomputed**, so the club's cost per
 * lesson hour and a tank's page cannot disagree about what an hour cost. One
 * report per tank — a club has a handful, by nature — rather than a second
 * grouped query that would be a second definition of a taught hour.
 *
 * A tank counts when its whole window was priced; one with no meter, or a
 * month unpriced, is left out and the coverage says so. Unallocated heat (a
 * month nothing was taught) is not charged to the hours that were.
 */
async function perUse(organizationId: string, poolIds: string[]): Promise<PerUse> {
  let allocatedCents = 0;
  let minutes = 0;
  let bathers = 0;
  let poolsCounted = 0;
  for (const poolId of poolIds) {
    const timezone = (await poolTimezone(organizationId, poolId)) ?? 'Europe/Lisbon';
    const report = await poolCostReport(organizationId, poolId, timezone);
    if (report === null || report.costCents === null || report.sources.length === 0) continue;
    poolsCounted += 1;
    allocatedCents += report.costCents - (report.unallocatedCents ?? 0);
    minutes += report.allocatableMinutes;
    bathers += report.bathers;
  }
  const lessonHours = minutes / 60;
  return {
    allocatedCents,
    lessonHours,
    bathers,
    perLessonHourCents: lessonHours > 0 ? Math.round(allocatedCents / lessonHours) : null,
    perBatherCents: bathers > 0 ? Math.round(allocatedCents / bathers) : null,
    poolsCounted,
    pools: poolIds.length,
  };
}
