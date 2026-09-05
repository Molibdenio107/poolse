import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import {
  checkAnalysisRows,
  type AnalysisImportRow,
  type AnalysisImportSummary,
  type RawAnalysisRow,
} from './analysis-import.js';

/**
 * Water-quality analyses — round 4.
 *
 * Its own file rather than more of `facilities.repository.ts`, which is already
 * the longest in the app: analyses are a self-contained pair of tables with
 * their own vocabulary, and a reader looking for how a pH reading is stored
 * should not have to scroll past facility hours to find it.
 */

/** The metrics `pool_metric` allows. Kept in step with the enum by hand — adding one is a migration. */
export const POOL_METRICS = [
  'ph',
  'temperature',
  'free_chlorine',
  'combined_chlorine',
  'total_alkalinity',
  'calcium_hardness',
  'cyanuric_acid',
  'turbidity',
  'salt',
] as const;

export type PoolMetric = (typeof POOL_METRICS)[number];

/**
 * The unit each metric is measured in.
 *
 * The single source of it. The column stores a unit per row — so a reading taken
 * today still says what it meant in five years, whatever this table comes to say
 * — but every row Poolse writes takes its unit from here, so the app never
 * produces two spellings of "ppm" for the same metric.
 */
export const METRIC_UNITS: Record<PoolMetric, string> = {
  ph: 'pH',
  temperature: '°C',
  free_chlorine: 'ppm',
  combined_chlorine: 'ppm',
  total_alkalinity: 'ppm',
  calcium_hardness: 'ppm',
  cyanuric_acid: 'ppm',
  turbidity: 'NTU',
  salt: 'ppm',
};

export interface AnalysisValue {
  metric: PoolMetric;
  value: number;
  unit: string;
}

export interface PoolAnalysis {
  id: string;
  takenAt: string;
  notes: string | null;
  recordedByName: string | null;
  values: AnalysisValue[];
}

/**
 * Every analysis of one pool, oldest first.
 *
 * Oldest first because the only two consumers are a trend line and a report, and
 * both read left to right in time. A list that wanted newest first can reverse
 * it far more cheaply than a chart can re-sort it.
 *
 * The values arrive as a nested aggregate rather than as a second query and a
 * join in TypeScript: one round trip, and the grouping is done by the thing that
 * already has the rows in order.
 */
export async function listAnalyses(
  organizationId: string,
  poolId: string,
): Promise<PoolAnalysis[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      taken_at: string;
      notes: string | null;
      recorded_by_name: string | null;
      values: AnalysisValue[] | null;
    }>(
      `
      SELECT a.id,
             a.taken_at,
             a.notes,
             nullif(btrim(coalesce(u.cached_first_name, '') || ' ' ||
                          coalesce(u.cached_last_name, '')), '') AS recorded_by_name,
             (
               SELECT coalesce(
                 json_agg(
                   json_build_object(
                     'metric', v.metric,
                     -- ::float8, or numeric arrives as a string and the chart
                     -- silently plots NaN.
                     'value', v.value::float8,
                     'unit', v.unit
                   )
                   ORDER BY v.metric
                 ),
                 '[]'::json
               )
                 FROM pool_analysis_value v
                WHERE v.analysis_id = a.id
                  AND v.organization_id = a.organization_id
             ) AS values
        FROM pool_analysis a
        LEFT JOIN membership m ON m.id = a.recorded_by AND m.organization_id = a.organization_id
        LEFT JOIN app_user u   ON u.id = m.app_user_id
       WHERE a.pool_id = $1
         AND a.archived_at IS NULL
       ORDER BY a.taken_at ASC
      `,
      [poolId],
    );

    return rows.map((row) => ({
      id: row.id,
      takenAt: row.taken_at,
      notes: row.notes,
      recordedByName: row.recorded_by_name,
      values: row.values ?? [],
    }));
  });
}

export interface CreateAnalysisInput {
  poolId: string;
  takenAt: string;
  notes: string | null;
  recordedBy: string | null;
  values: { metric: PoolMetric; value: number }[];
}

/**
 * Record one analysis and its measurements.
 *
 * One transaction, because an analysis with none of its values written is not a
 * partial record — it is a date with nothing in it, and it would draw a gap in
 * the trend that looks like a missed reading rather than a failed save.
 *
 * The unit is not taken from the caller. It comes from `METRIC_UNITS`, so a
 * client cannot post pH in ppm.
 */
export async function createAnalysis(
  organizationId: string,
  input: CreateAnalysisInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO pool_analysis (organization_id, pool_id, taken_at, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [organizationId, input.poolId, input.takenAt, input.notes, input.recordedBy],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not record the analysis');

    for (const measurement of input.values) {
      await tx.query(
        `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
         VALUES ($1, $2, $3::pool_metric, $4, $5)`,
        [
          organizationId,
          id,
          measurement.metric,
          measurement.value,
          METRIC_UNITS[measurement.metric],
        ],
      );
    }

    await recordAudit(tx, {
      action: 'pool.analysisRecorded',
      entityType: 'pool_analysis',
      entityId: id,
      data: { poolId: input.poolId, metrics: input.values.map((v) => v.metric) },
    });

    return id;
  });
}

/** Soft delete, as everything an operator can see is. */
export async function archiveAnalysis(
  organizationId: string,
  analysisId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE pool_analysis SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [analysisId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'pool.analysisArchived',
      entityType: 'pool_analysis',
      entityId: analysisId,
      data: {},
    });

    return true;
  });
}

// ---------------------------------------------------------------------------
// The import — round 5, ticket 5
// ---------------------------------------------------------------------------
//
// The same arrangement as the register's and the store room's: one function,
// called with `commit` false and then true, so a preview and the write that
// follows it cannot be produced by two code paths that agree until the evening
// they do not.

export interface AnalysisImportRequest {
  poolId: string;
  rows: RawAnalysisRow[];
  commit: boolean;
  /**
   * The row indexes the operator ticked, or null for "everything importable".
   *
   * Only consulted on a commit, and the server still refuses any row with a
   * problem whatever arrives here — a tick on a broken row is a client that is
   * out of date, not permission.
   */
  include: number[] | null;
}

export interface AnalysisImportResult {
  rows: AnalysisImportRow[];
  summary: AnalysisImportSummary;
  /** Present only on a commit. */
  created?: number;
  /** Importable rows the operator did not tick. */
  skipped?: number;
}

/**
 * When this tank was last sampled, as the deduplicator needs it.
 *
 * Read as text in the facility's own reckoning rather than as a timestamp,
 * because the sheet says "2026-09-01 08:30" and the column holds an instant. One
 * conversion, done by Postgres, beats two done here in opposite directions.
 *
 * Unpaginated and comfortably so: a tank's log is a few hundred rows after
 * years, held for the length of one request.
 */
async function recordedMoments(tx: Tx, poolId: string): Promise<Set<string>> {
  const { rows } = await tx.query<{ moment: string; day: string }>(
    `SELECT to_char(taken_at, 'YYYY-MM-DD HH24:MI') AS moment,
            to_char(taken_at, 'YYYY-MM-DD') AS day
       FROM pool_analysis
      WHERE pool_id = $1 AND archived_at IS NULL`,
    [poolId],
  );

  // Both keys, because a sheet with no time column dedupes on the day alone and
  // one with a time column dedupes on the minute. Holding both means the same
  // set answers either question.
  const moments = new Set<string>();
  for (const row of rows) {
    moments.add(row.moment);
    moments.add(row.day);
  }
  return moments;
}

/**
 * Preview, or write.
 *
 * The whole commit is one transaction. A half-applied water log is worse than
 * none: nobody can tell which half landed, and running it again doubles what
 * did.
 *
 * Returns null when the tank does not exist in this organization — a stale page,
 * or somebody else's pool id, which RLS makes indistinguishable from here.
 */
export async function runAnalysisImport(
  organizationId: string,
  membershipId: string | null,
  request: AnalysisImportRequest,
): Promise<AnalysisImportResult | null> {
  return withOrg(organizationId, async (tx) => {
    const pool = await tx.query<{ name: string }>(
      `SELECT name FROM pool WHERE id = $1 AND archived_at IS NULL`,
      [request.poolId],
    );
    const poolName = pool.rows[0]?.name;
    if (poolName === undefined) return null;

    const checked = checkAnalysisRows(request.rows, {
      poolName,
      existing: await recordedMoments(tx, request.poolId),
    });

    if (!request.commit) return checked;

    const wanted = request.include === null ? null : new Set(request.include);
    let created = 0;
    let skipped = 0;

    for (const row of checked.rows) {
      if (!row.importable) continue;
      if (wanted !== null && !wanted.has(row.index)) {
        skipped += 1;
        continue;
      }

      // Midnight when the sheet carries no time. A club that records the day but
      // not the hour gets one reading a day in order, which is what its log
      // means; inventing "now" would put yesterday's sample after today's.
      const takenAt = `${row.takenOn} ${row.takenTime ?? '00:00'}`;

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO pool_analysis (organization_id, pool_id, taken_at, notes, recorded_by)
         VALUES ($1, $2, $3::timestamptz, $4, $5)
         RETURNING id`,
        [organizationId, request.poolId, takenAt, row.notes, membershipId],
      );

      const id = inserted.rows[0]?.id;
      if (!id) throw new Error('Could not record the analysis');

      for (const measurement of row.values) {
        // The unit comes from METRIC_UNITS, never from the file: a sheet cannot
        // talk this club into recording pH in ppm.
        await tx.query(
          `INSERT INTO pool_analysis_value (organization_id, analysis_id, metric, value, unit)
           VALUES ($1, $2, $3::pool_metric, $4, $5)`,
          [organizationId, id, measurement.metric, measurement.value, METRIC_UNITS[measurement.metric]],
        );
      }

      created += 1;
    }

    await recordAudit(tx, {
      action: 'pool.analysesImported',
      entityType: 'pool',
      entityId: request.poolId,
      data: { created, skipped, refused: checked.summary.refused },
    });

    return { ...checked, created, skipped };
  });
}
