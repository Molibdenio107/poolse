import { withOrg, type Tx } from '@poolse/db';
import {
  ALERT_WINDOW_HOURS,
  gradeLabResult,
  METRIC_UNITS,
  ORGANISM_UNITS,
  ORGANISMS,
  POOL_METRICS,
  type LabGrading,
  type LabValues,
  type Organism,
  type PoolMetric,
} from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { readPoolContext } from './analyses.repository.js';
import { resolveSample, type SampleMoment } from './sample-moment.js';

/**
 * Laboratory results — POOLSE-72.
 *
 * A lab report is its own record: a laboratory, a reference, a sample point,
 * the seven organisms of NP 4542 Quadro 3 and whatever chemistry the lab
 * measured. **Its grade is never stored**: every read derives it with
 * `gradeLabResult()` against the national reference for the tank, so the
 * page, the alert and the public page cannot disagree.
 */

export type LabParameter = Organism | PoolMetric;

export const LAB_PARAMETERS: readonly LabParameter[] = [...ORGANISMS, ...POOL_METRICS];

export function unitOf(parameter: LabParameter): string {
  return (ORGANISMS as readonly string[]).includes(parameter)
    ? ORGANISM_UNITS[parameter as Organism]
    : METRIC_UNITS[parameter as PoolMetric];
}

export interface LabResultInput {
  /** Resolved in the facility's timezone by `resolveSample` — 13-10-2026 sweep. */
  sampledAt: SampleMoment;
  laboratory: string | null;
  reportReference: string | null;
  samplePoint: string | null;
  sampleDepth: 'surface' | 'subsurface' | null;
  notes: string | null;
  values: { parameter: LabParameter; value: number }[];
}

export interface LabResult {
  id: string;
  sampledAt: string;
  laboratory: string | null;
  reportReference: string | null;
  samplePoint: string | null;
  sampleDepth: 'surface' | 'subsurface' | null;
  notes: string | null;
  values: { parameter: LabParameter; value: number; unit: string }[];
  grading: LabGrading;
  /** Null when this report raised no alert. */
  alert: { raisedAt: string; recipients: string[]; deliveredAt: string | null } | null;
}

/** Split stored values into what `gradeLabResult` reads. */
export function labValues(values: { parameter: string; value: number; unit: string }[]): LabValues {
  const organisms: LabValues['organisms'] = {};
  const chemistry: LabValues['chemistry'] = [];
  for (const entry of values) {
    if ((ORGANISMS as readonly string[]).includes(entry.parameter)) {
      organisms[entry.parameter as Organism] = entry.value;
    } else if ((POOL_METRICS as readonly string[]).includes(entry.parameter)) {
      chemistry.push({ metric: entry.parameter as PoolMetric, value: entry.value, unit: entry.unit });
    }
  }
  return { organisms, chemistry };
}

export async function listLabResults(organizationId: string, poolId: string): Promise<LabResult[]> {
  return withOrg(organizationId, async (tx) => {
    const pool = await readPoolContext(tx, poolId);
    const { rows } = await tx.query<{
      id: string;
      sampled_at: Date;
      laboratory: string | null;
      report_reference: string | null;
      sample_point: string | null;
      sample_depth: 'surface' | 'subsurface' | null;
      notes: string | null;
      values: { parameter: string; value: number; unit: string }[] | null;
      raised_at: Date | null;
      recipients: string[] | null;
      delivered_at: Date | null;
    }>(
      `SELECT r.id, r.sampled_at, r.laboratory, r.report_reference, r.sample_point,
              r.sample_depth::text AS sample_depth, r.notes,
              (SELECT json_agg(json_build_object(
                        'parameter', v.parameter::text,
                        -- ::float8, or numeric arrives as a string
                        'value', v.value::float8,
                        'unit', v.unit) ORDER BY v.parameter)
                 FROM lab_result_value v
                WHERE v.lab_result_id = r.id AND v.organization_id = r.organization_id) AS values,
              al.raised_at, al.recipients, al.delivered_at
         FROM lab_result r
         LEFT JOIN lab_result_alert al
           ON al.lab_result_id = r.id AND al.organization_id = r.organization_id
        WHERE r.pool_id = $1 AND r.archived_at IS NULL
        ORDER BY r.sampled_at DESC
        LIMIT 50`,
      [poolId],
    );
    return rows.map((row) => {
      const values = (row.values ?? []).map((v) => ({
        parameter: v.parameter as LabParameter,
        value: v.value,
        unit: v.unit,
      }));
      return {
        id: row.id,
        sampledAt: row.sampled_at.toISOString(),
        laboratory: row.laboratory,
        reportReference: row.report_reference,
        samplePoint: row.sample_point,
        sampleDepth: row.sample_depth,
        notes: row.notes,
        values,
        grading: gradeLabResult(labValues(values), pool),
        alert:
          row.raised_at === null
            ? null
            : {
                raisedAt: row.raised_at.toISOString(),
                recipients: row.recipients ?? [],
                deliveredAt: row.delivered_at?.toISOString() ?? null,
              },
      };
    });
  });
}

/**
 * Records one report, and its alert when it grades não conforme.
 *
 * Null when the pool is not this club's (RLS hides it, the composite key would
 * refuse it). The alert is written **inside** this transaction and sent after
 * it, the division 4.2's water alert makes: sending must never roll back the
 * thing it announces. Only a sample within `ALERT_WINDOW_HOURS` raises one —
 * a club importing last winter's reports is not told about last winter.
 */
export async function createLabResult(
  organizationId: string,
  poolId: string,
  input: LabResultInput,
  recordedBy: string,
): Promise<{ id: string; alertId: string | null } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: pools } = await tx.query('SELECT 1 FROM pool WHERE id = $1 AND archived_at IS NULL', [
      poolId,
    ]);
    if (pools.length === 0) return null;
    const sampledAt = await resolveSample(tx, poolId, input.sampledAt);
    if (sampledAt === null) return null;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO lab_result (
         organization_id, pool_id, sampled_at, laboratory, report_reference,
         sample_point, sample_depth, notes, recorded_by_membership_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::lab_sample_depth, $8, $9)
       RETURNING id`,
      [
        organizationId,
        poolId,
        sampledAt,
        input.laboratory,
        input.reportReference,
        input.samplePoint,
        input.sampleDepth,
        input.notes,
        recordedBy,
      ],
    );
    const id = rows[0]!.id;

    const values = input.values.map((v) => ({ ...v, unit: unitOf(v.parameter) }));
    await tx.query(
      `INSERT INTO lab_result_value (organization_id, lab_result_id, parameter, value, unit)
       SELECT $1, $2, p::lab_parameter, v, u
         FROM unnest($3::text[], $4::numeric[], $5::text[]) AS t(p, v, u)`,
      [
        organizationId,
        id,
        values.map((v) => v.parameter),
        values.map((v) => v.value),
        values.map((v) => v.unit),
      ],
    );

    await recordAudit(tx, {
      action: 'lab_result.recorded',
      entityType: 'pool',
      entityId: poolId,
      data: { labResultId: id, parameters: values.map((v) => v.parameter) },
    });

    const alertId = await raiseLabAlert(tx, organizationId, poolId, id, values);
    return { id, alertId };
  });
}

async function raiseLabAlert(
  tx: Tx,
  organizationId: string,
  poolId: string,
  labResultId: string,
  values: { parameter: string; value: number; unit: string }[],
): Promise<string | null> {
  const grading = gradeLabResult(labValues(values), await readPoolContext(tx, poolId));
  if (grading.grade !== 'nao_conforme') return null;

  const failed = grading.failures.filter((f) => f.kind === 'limit').map((f) => f.parameter);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO lab_result_alert (organization_id, pool_id, lab_result_id, parameters)
     SELECT $1, $2, $3, $4::text[]::lab_parameter[]
       FROM lab_result r
      WHERE r.id = $3
        AND r.sampled_at > now() - make_interval(hours => $5::int)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [organizationId, poolId, labResultId, failed, ALERT_WINDOW_HOURS],
  );
  return rows[0]?.id ?? null;
}

/** Archived, never deleted. A correction is a new report. */
export async function archiveLabResult(
  organizationId: string,
  poolId: string,
  labResultId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE lab_result SET archived_at = now()
        WHERE id = $1 AND pool_id = $2 AND archived_at IS NULL`,
      [labResultId, poolId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'lab_result.archived',
      entityType: 'pool',
      entityId: poolId,
      data: { labResultId },
    });
    return true;
  });
}

export interface LabAlertNotice {
  organizationName: string;
  organizationLocale: string;
  facilityName: string;
  facilityTimezone: string;
  poolName: string;
  sampledAt: Date;
  laboratory: string | null;
  grading: LabGrading;
  recipients: string[];
}

/**
 * Everything the email needs, read after the report is committed. Recipients
 * by role — owner, admin, maintenance — over the same coalesce the water alert
 * uses, so a contact with no login is still told.
 */
export async function findLabAlertNotice(
  organizationId: string,
  alertId: string,
): Promise<LabAlertNotice | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      organization_name: string;
      organization_locale: string;
      facility_name: string;
      facility_timezone: string;
      pool_id: string;
      pool_name: string;
      sampled_at: Date;
      laboratory: string | null;
      values: { parameter: string; value: number; unit: string }[] | null;
    }>(
      `SELECT o.name AS organization_name, o.locale AS organization_locale,
              f.name AS facility_name, f.timezone AS facility_timezone,
              p.id AS pool_id, p.name AS pool_name,
              r.sampled_at, r.laboratory,
              (SELECT json_agg(json_build_object('parameter', v.parameter::text,
                                                 'value', v.value::float8, 'unit', v.unit))
                 FROM lab_result_value v
                WHERE v.lab_result_id = r.id AND v.organization_id = r.organization_id) AS values
         FROM lab_result_alert al
         JOIN lab_result r ON r.id = al.lab_result_id AND r.organization_id = al.organization_id
         JOIN pool p       ON p.id = al.pool_id       AND p.organization_id = al.organization_id
         JOIN facility f   ON f.id = p.facility_id    AND f.organization_id = p.organization_id
         JOIN organization o ON o.id = al.organization_id
        WHERE al.id = $1`,
      [alertId],
    );
    const row = rows[0];
    if (!row) return null;

    const { rows: people } = await tx.query<{ email: string }>(
      `SELECT DISTINCT coalesce(u.cached_email::text, m.email::text) AS email
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
        ORDER BY email`,
      [organizationId],
    );

    return {
      organizationName: row.organization_name,
      organizationLocale: row.organization_locale,
      facilityName: row.facility_name,
      facilityTimezone: row.facility_timezone,
      poolName: row.pool_name,
      sampledAt: row.sampled_at,
      laboratory: row.laboratory,
      grading: gradeLabResult(labValues(row.values ?? []), await readPoolContext(tx, row.pool_id)),
      recipients: people.map((person) => person.email),
    };
  });
}

export async function markLabAlertSent(
  organizationId: string,
  alertId: string,
  recipients: string[],
  delivered: boolean,
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE lab_result_alert
          SET recipients = $2::text[],
              delivered_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
        WHERE id = $1`,
      [alertId, recipients, delivered],
    );
  });
}
