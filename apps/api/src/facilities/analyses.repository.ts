import { withOrg, type Tx } from '@poolse/db';
// Imported as well as re-exported below: `export … from` creates no local
// binding, and this file writes the unit and judges the readings itself.
import {
  ALERT_WINDOW_HOURS,
  METRIC_UNITS,
  excursions,
  type Excursion,
  type PoolMetric,
} from '@poolse/rules';
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

/**
 * The metrics, their units and the bands — re-exported from `@poolse/rules`.
 *
 * They were declared here, and `apps/web/src/lib/pool-metrics.ts` declared the
 * list a second time with a comment saying the two were kept in step by hand.
 * Slice 4.2 needed the *bands* on this side as well, to judge an analysis as it
 * is written, so all of it moved to the shared package and there is now one
 * definition. Re-exported rather than repointed at every call site: this file is
 * where the rest of the API already looks for them.
 */
export {
  POOL_METRICS,
  METRIC_UNITS,
  HEALTHY,
  excursions,
  ALERT_WINDOW_HOURS,
  type PoolMetric,
  type Excursion,
} from '@poolse/rules';

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
export interface CreatedAnalysis {
  id: string;
  /**
   * The alert this reading raised, if it raised one — slice 4.2.
   *
   * Null covers three different fine outcomes: the water was in range, the
   * sample is older than the alert window, or this analysis had already
   * alerted. The controller sends only when there is an id, and never inside
   * this transaction.
   */
  alertId: string | null;
}

export async function createAnalysis(
  organizationId: string,
  input: CreateAnalysisInput,
): Promise<CreatedAnalysis> {
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

    // Before the audit line, so an alert that cannot be written takes the whole
    // analysis with it rather than leaving a reading nobody was told about.
    const alertId = await raiseAlert(tx, organizationId, input.poolId, id, input.values);

    await recordAudit(tx, {
      action: 'pool.analysisRecorded',
      entityType: 'pool_analysis',
      entityId: id,
      data: {
        poolId: input.poolId,
        metrics: input.values.map((v) => v.metric),
        alerted: alertId !== null,
      },
    });

    return { id, alertId };
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
  /**
   * The alerts this import raised — slice 4.2. Present only on a commit.
   *
   * Usually empty even when the file is full of bad water: `raiseAlert` only
   * writes one for a sample inside the alert window, and a club's first act is
   * to import its history. See `ALERT_WINDOW_HOURS`.
   */
  alertIds?: string[];
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
    const alertIds: string[] = [];

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

      // One alert per recent sample, the same call the single form makes. A
      // year of lab sheets therefore imports in silence, which is the point:
      // forty emails about water that was dosed last winter would teach a club
      // to filter the channel before it ever carried something urgent.
      const alertId = await raiseAlert(tx, organizationId, request.poolId, id, row.values);
      if (alertId !== null) alertIds.push(alertId);

      created += 1;
    }

    await recordAudit(tx, {
      action: 'pool.analysesImported',
      entityType: 'pool',
      entityId: request.poolId,
      data: {
        created,
        skipped,
        refused: checked.summary.refused,
        alerted: alertIds.length,
      },
    });

    return { ...checked, created, skipped, alertIds };
  });
}

// ---------------------------------------------------------------------------
// Out-of-range alerts — slice 4.2
// ---------------------------------------------------------------------------
//
// The roadmap's "done when" for this slice is one sentence: an out-of-range
// reading reaches someone. Both halves of that are here — the record, written
// inside the transaction that wrote the analysis so it cannot be forgotten, and
// the read the send path needs afterwards.
//
// **The judgement is `@poolse/rules`', not this file's.** `excursions()` is what
// the pool page already draws its warning from, so the email and the screen
// cannot disagree about whether a reading is bad. Nothing here re-derives it.

/**
 * Raise the alert for one analysis, if it deserves one.
 *
 * Returns the new alert's id, or null when there is nothing to say — the water
 * was fine, the sample is too old, or this analysis has already alerted.
 *
 * **Inside the caller's transaction, on purpose.** The row is the record that a
 * reading crossed a band, and it has to exist or not exist with the reading
 * itself; a second statement afterwards is a second thing that can fail. The
 * *sending* is deliberately not here — see `notifyWaterAlert` on the controller.
 *
 * **The window is the database's clock, not Node's.** `taken_at` is a
 * `timestamptz` and the comparison belongs beside it, which also means a test
 * can write a sample four days old and get the real answer rather than one
 * assembled from two clocks. `ALERT_WINDOW_HOURS` travels as a parameter so the
 * constant stays in one place.
 *
 * **`ON CONFLICT DO NOTHING` rather than a check-then-insert.** A double submit
 * and two people pressing Guardar at once are the same event as far as a family
 * of emails is concerned, and the unique index is what makes that safe without
 * a lock.
 */
async function raiseAlert(
  tx: Tx,
  organizationId: string,
  poolId: string,
  analysisId: string,
  values: { metric: PoolMetric; value: number }[],
): Promise<string | null> {
  // The unit comes from METRIC_UNITS, exactly as the row's own does — the bands
  // are stated in those units and a reading judged in another one is nonsense.
  const failed = excursions(
    values.map((reading) => ({ ...reading, unit: METRIC_UNITS[reading.metric] })),
  );
  if (failed.length === 0) return null;

  const { rows } = await tx.query<{ id: string }>(
    `
    INSERT INTO pool_analysis_alert (organization_id, pool_id, analysis_id, metrics)
    SELECT $1, $2, $3, $4::text[]::pool_metric[]
      FROM pool_analysis a
     WHERE a.id = $3
       AND a.organization_id = $1
       AND a.taken_at > now() - make_interval(hours => $5::int)
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [
      organizationId,
      poolId,
      analysisId,
      failed.map((excursion) => excursion.metric),
      ALERT_WINDOW_HOURS,
    ],
  );

  return rows[0]?.id ?? null;
}

export interface PoolAlertRecord {
  id: string;
  /** When somebody was told. */
  raisedAt: string;
  /** When the sample was taken, which is a different instant. */
  takenAt: string;
  metrics: PoolMetric[];
  /**
   * How many addresses were written to, not which.
   *
   * The readings panel is readable by any member — an instructor needs to know
   * which pool their class is in — and the club's staff addresses are not part
   * of what that panel is for. The count answers the question somebody actually
   * has, which is "did this reach anybody".
   */
  recipients: number;
  /** Null means recorded and not sent. The screen says so rather than implying it went. */
  deliveredAt: string | null;
}

/**
 * This tank's alerts, newest first.
 *
 * Newest first, unlike the analyses beside them, because this is a list read
 * from the top — "has anything gone wrong lately" — rather than a series read
 * left to right. Capped: an alert history is a compliance record and grows
 * without bound, and the panel it renders in is one section of a pool's page.
 *
 * Not filtered on the analysis being archived. Archiving a mistyped reading does
 * not unsend the email, and a history that quietly dropped the alert would be
 * the record disagreeing with what happened.
 */
export async function listPoolAlerts(
  organizationId: string,
  poolId: string,
  limit = 10,
): Promise<PoolAlertRecord[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      raised_at: Date;
      taken_at: Date;
      metrics: string[];
      recipients: number;
      delivered_at: Date | null;
    }>(
      `
      SELECT al.id,
             al.raised_at,
             a.taken_at,
             -- ::text[], because pool_metric[] is a custom array type that
             -- node-postgres has no parser for: it arrives as the literal
             -- '{ph}' and mapping over it iterates characters. text[] pg parses
             -- natively. Found by the integration test, which is the only thing
             -- that could have -- tsc believes whatever row type it is told.
             al.metrics::text[] AS metrics,
             cardinality(al.recipients) AS recipients,
             al.delivered_at
        FROM pool_analysis_alert al
        JOIN pool_analysis a
          ON a.id = al.analysis_id AND a.organization_id = al.organization_id
       WHERE al.pool_id = $1
       ORDER BY al.raised_at DESC
       LIMIT $2
      `,
      [poolId, limit],
    );

    // toISOString, never to_char. A hand-written format string is what put
    // "Invalid Date" on the invoice page — `+00` is not a legal ISO offset.
    return rows.map((row) => ({
      id: row.id,
      raisedAt: row.raised_at.toISOString(),
      takenAt: row.taken_at.toISOString(),
      metrics: row.metrics as PoolMetric[],
      recipients: Number(row.recipients),
      deliveredAt: row.delivered_at === null ? null : row.delivered_at.toISOString(),
    }));
  });
}

export interface WaterAlertNotice {
  organizationName: string;
  organizationLocale: string;
  facilityName: string;
  /** Where the sample was taken, and therefore the clock the email states it in. */
  facilityTimezone: string;
  poolName: string;
  takenAt: Date;
  /** Recomputed for the body, so the email names the numbers and the bands. */
  excursions: Excursion[];
  /** Resolved by role at send time. Empty is a real answer — see below. */
  recipients: string[];
}

/**
 * Everything the alert email needs, read after the analysis is committed.
 *
 * Afterwards rather than during, for the reason `findDecisionNotice` gives about
 * leave: sending must never be able to roll back the thing it was announcing. A
 * reading is recorded either way, and the email is the courtesy.
 *
 * **Recipients resolve by role, not by name** — owner, admin and maintenance.
 * Staff turnover then cannot silently orphan an alert, which is the rule
 * POOLSE-26 states and this borrows early. Instructors are deliberately out: an
 * instructor at the poolside cannot dose a tank, and an alert channel that
 * writes to people who cannot act on it is one everybody learns to filter.
 *
 * **Only active memberships with an address, and `app_user` is not the only
 * place one lives.** `LEFT JOIN` and a coalesce, because `membership` carries a
 * name and an email of its own for the people who have no login — POOLSE-17's
 * whole point — and a club's maintenance contact is very often exactly that
 * person. An inner join on `app_user` would have silently skipped them, which is
 * the same shape of bug as the parceria sessions dropped by three inner joins to
 * `class_group`. Clerk's copy wins where both exist, per the standing rule that
 * `cached_email` is the authority for anybody who signs in.
 *
 * A suspended member is not staff this week and is left out. DISTINCT because
 * the owner who is also the maintenance contact is one person and gets one
 * email.
 *
 * An empty recipient list is not an error: a club whose staff have no addresses
 * on file is a real club, and the alert is still recorded and still on the
 * pool's page. Saying "sent" would be the lie.
 */
export async function findWaterAlertNotice(
  organizationId: string,
  alertId: string,
): Promise<WaterAlertNotice | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      organization_name: string;
      organization_locale: string;
      facility_name: string;
      facility_timezone: string;
      pool_name: string;
      taken_at: Date;
      metrics: string[];
      values: AnalysisValue[] | null;
    }>(
      `
      SELECT o.name   AS organization_name,
             o.locale AS organization_locale,
             f.name     AS facility_name,
             f.timezone AS facility_timezone,
             p.name     AS pool_name,
             a.taken_at,
             -- ::text[] for the reason listPoolAlerts gives. Here it was worse
             -- than a cosmetic bug: the set below is what decides which readings
             -- the email names, and a set of characters matched none of them, so
             -- the message would have gone out with an empty list.
             al.metrics::text[] AS metrics,
             (
               SELECT coalesce(
                 json_agg(
                   json_build_object(
                     'metric', v.metric,
                     -- ::float8, or numeric arrives as a string and every
                     -- comparison against a band silently becomes a string one.
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
        FROM pool_analysis_alert al
        JOIN pool_analysis a  ON a.id = al.analysis_id AND a.organization_id = al.organization_id
        JOIN pool p           ON p.id = al.pool_id     AND p.organization_id = al.organization_id
        JOIN facility f       ON f.id = p.facility_id  AND f.organization_id = p.organization_id
        JOIN organization o   ON o.id = al.organization_id
       WHERE al.id = $1
      `,
      [alertId],
    );

    const row = rows[0];
    if (!row) return null;

    const { rows: people } = await tx.query<{ email: string }>(
      `
      SELECT DISTINCT coalesce(u.cached_email::text, m.email::text) AS email
        FROM membership m
        JOIN membership_role r
          ON r.membership_id = m.id AND r.organization_id = m.organization_id
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE m.organization_id = $1
         AND m.archived_at IS NULL
         AND m.status = 'active'
         AND r.archived_at IS NULL
         AND r.role IN ('owner', 'admin', 'maintenance')
         AND btrim(coalesce(u.cached_email::text, m.email::text, '')) <> ''
       ORDER BY email
      `,
      [organizationId],
    );

    // The snapshot decides which readings the email talks about; the values
    // supply the numbers and the bands. They agree at send time — this is
    // microseconds after the insert — and filtering by the snapshot means a
    // re-send could never widen what an old alert claimed.
    const named = new Set(row.metrics);

    return {
      organizationName: row.organization_name,
      organizationLocale: row.organization_locale,
      facilityName: row.facility_name,
      facilityTimezone: row.facility_timezone,
      poolName: row.pool_name,
      takenAt: row.taken_at,
      excursions: excursions(row.values ?? []).filter((one) => named.has(one.metric)),
      recipients: people.map((person) => person.email),
    };
  });
}

/**
 * Stamp what the send actually did.
 *
 * `recipients` is written whichever way it went: "we tried to write to these
 * three people and the provider refused" is worth more to somebody reading this
 * next month than an empty row. `delivered_at` is set only when mail left the
 * building, which is what lets the screen distinguish the two instead of
 * implying a club was contacted.
 */
export async function markAlertSent(
  organizationId: string,
  alertId: string,
  recipients: string[],
  delivered: boolean,
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE pool_analysis_alert
          SET recipients = $2::text[],
              delivered_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
        WHERE id = $1`,
      [alertId, recipients, delivered],
    );
  });
}
