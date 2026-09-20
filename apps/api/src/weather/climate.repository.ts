import { withOrg } from '@poolse/db';
import { type ClimateDay } from './open-meteo.js';

/**
 * Monthly outside air temperature at a site — roadmap 5.4b, POOLSE-28 AC 7.
 *
 * **Context, never a correction.** Nothing here adjusts a consumption or a cost.
 * The club is told what it used, what it cost, and how cold it was; a
 * "weather-normalised" figure would be a model with opinions wearing the clothes
 * of a measurement.
 *
 * **A cache of public data.** Every row is refetchable by (place, month), no
 * person writes one, and a refetch overwrites in place — which is why the table
 * has no soft delete and no author, and why the grant carries no `DELETE`.
 */

/**
 * The threshold below which a building is assumed to need heating.
 *
 * 15.5 °C is the usual European figure (60 °F, kept because that is what the
 * historical series were built on). It is **stored on every row** rather than
 * read back from here, so changing it later leaves old figures meaning what
 * they meant — a constant that silently re-means a year of history is the same
 * failure as a stored rate that drifts from its definition.
 */
export const HDD_BASE_C = 15.5;

export interface ClimateMonth {
  /** `YYYY-MM`, in the site's own clock. */
  month: string;
  meanC: number;
  minC: number | null;
  maxC: number | null;
  /** Sum over the month of how far each day fell below `hddBaseC`. */
  heatingDegreeDays: number;
  hddBaseC: number;
  /** Days the archive actually had. A short month is not a mild one. */
  daysCounted: number;
}

/**
 * Folds daily means into calendar months.
 *
 * Done here rather than in SQL because the days arrive from an HTTP call and
 * never touch a table in their raw form: storing 730 rows per site to derive 24
 * is a cost with no reader, and the daily series is refetchable in one request
 * if a finer grain is ever wanted.
 *
 * **HDD is summed per day, never derived from the monthly mean.** A month of
 * steady 10 °C days and a month averaging 10 °C around one cold snap need
 * different amounts of heating, and a mean cannot tell them apart — which is the
 * whole reason this column exists beside the mean rather than instead of it.
 */
export function foldIntoMonths(days: ClimateDay[], base = HDD_BASE_C): ClimateMonth[] {
  const buckets = new Map<string, { means: number[]; mins: number[]; maxes: number[]; hdd: number }>();

  for (const day of days) {
    const month = day.date.slice(0, 7);
    const bucket = buckets.get(month) ?? { means: [], mins: [], maxes: [], hdd: 0 };
    bucket.means.push(day.meanC);
    if (day.minC !== null) bucket.mins.push(day.minC);
    if (day.maxC !== null) bucket.maxes.push(day.maxC);
    bucket.hdd += Math.max(0, base - day.meanC);
    buckets.set(month, bucket);
  }

  return [...buckets.entries()]
    .map(([month, bucket]) => ({
      month,
      meanC: round(bucket.means.reduce((a, b) => a + b, 0) / bucket.means.length),
      minC: bucket.mins.length === 0 ? null : round(Math.min(...bucket.mins)),
      maxC: bucket.maxes.length === 0 ? null : round(Math.max(...bucket.maxes)),
      heatingDegreeDays: round(bucket.hdd),
      hddBaseC: base,
      daysCounted: bucket.means.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** One decimal, which is what the columns hold and what a temperature deserves. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Writes the months, overwriting whatever was there.
 *
 * An upsert rather than an insert-if-absent: the current month is partial and
 * gets longer every day, so the filler is expected to rewrite it, and a past
 * month that the archive has since corrected should take the correction. This
 * is the one table here where overwriting is right, because the row is a cache
 * of somebody else's fact rather than a record of ours.
 */
export async function saveClimate(
  organizationId: string,
  facilityId: string,
  months: ClimateMonth[],
): Promise<number> {
  if (months.length === 0) return 0;

  return withOrg(organizationId, async (tx) => {
    let written = 0;
    for (const m of months) {
      const { rowCount } = await tx.query(
        `INSERT INTO facility_climate_month
           (organization_id, facility_id, month, mean_temp_c, min_temp_c, max_temp_c,
            heating_degree_days, hdd_base_c, days_counted, source, fetched_at)
         VALUES ($1, $2, ($3 || '-01')::date, $4, $5, $6, $7, $8, $9, 'open_meteo', now())
         ON CONFLICT (organization_id, facility_id, month) DO UPDATE
           SET mean_temp_c = EXCLUDED.mean_temp_c,
               min_temp_c = EXCLUDED.min_temp_c,
               max_temp_c = EXCLUDED.max_temp_c,
               heating_degree_days = EXCLUDED.heating_degree_days,
               hdd_base_c = EXCLUDED.hdd_base_c,
               days_counted = EXCLUDED.days_counted,
               fetched_at = now()`,
        [
          organizationId, facilityId, m.month, m.meanC, m.minC, m.maxC,
          m.heatingDegreeDays, m.hddBaseC, m.daysCounted,
        ],
      );
      written += rowCount ?? 0;
    }
    return written;
  });
}

/** What is already known for a site, newest last, over a window of months. */
export async function readClimate(
  organizationId: string,
  facilityId: string,
  months: number,
): Promise<ClimateMonth[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      month: string;
      mean_temp_c: number;
      min_temp_c: number | null;
      max_temp_c: number | null;
      heating_degree_days: number;
      hdd_base_c: number;
      days_counted: number;
    }>(
      `SELECT to_char(month, 'YYYY-MM') AS month,
              -- ::float8, or numeric arrives as a string and "12.4" renders as "12.40".
              mean_temp_c::float8         AS mean_temp_c,
              min_temp_c::float8          AS min_temp_c,
              max_temp_c::float8          AS max_temp_c,
              heating_degree_days::float8 AS heating_degree_days,
              hdd_base_c::float8          AS hdd_base_c,
              days_counted
         FROM facility_climate_month
        WHERE organization_id = $1 AND facility_id = $2
          AND month >= (date_trunc('month', current_date) - (($3::int - 1) || ' months')::interval)::date
        ORDER BY month`,
      [organizationId, facilityId, months],
    );

    return rows.map((row) => ({
      month: row.month,
      meanC: row.mean_temp_c,
      minC: row.min_temp_c,
      maxC: row.max_temp_c,
      heatingDegreeDays: row.heating_degree_days,
      hddBaseC: row.hdd_base_c,
      daysCounted: row.days_counted,
    }));
  });
}

/** Where a site is, and null when nobody has placed it on the map. */
export async function facilityPoint(
  organizationId: string,
  facilityId: string,
): Promise<{ latitude: number; longitude: number } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ latitude: number | null; longitude: number | null }>(
      `SELECT latitude::float8 AS latitude, longitude::float8 AS longitude
         FROM facility WHERE organization_id = $1 AND id = $2`,
      [organizationId, facilityId],
    );
    const row = rows[0];
    if (row === undefined || row.latitude === null || row.longitude === null) return null;
    return { latitude: row.latitude, longitude: row.longitude };
  });
}
