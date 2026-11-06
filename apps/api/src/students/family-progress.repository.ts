import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * What a family records on *Progressos* (Rui, 06-11-2026): its own swim times,
 * marked `self_reported`, and weight, height and distance swum. Who may write is
 * `family_may_answer()`, the rule *Vem à aula?* reads. A family removes only what
 * it entered; the office removes a time through its own route.
 *
 * Weight and height are health data, so the audit names the kind and never the
 * value, and only the office and the family read them.
 */

export const MEASURE_UNITS = { weight: 'kg', height: 'cm', distance_swum: 'm' } as const;
export type MeasureKind = keyof typeof MEASURE_UNITS;

export interface StudentMeasure {
  id: string;
  kind: MeasureKind;
  value: number;
  unit: string;
  measuredOn: string;
  /** This reader entered it, so this reader may remove it. */
  mine: boolean;
}

export async function mayEnterProgress(
  organizationId: string,
  studentId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ ok: boolean }>(
      'SELECT family_may_answer($1, $2, $3) AS ok',
      [organizationId, studentId, membershipId],
    );
    return rows[0]?.ok === true;
  });
}

export async function listMeasures(
  organizationId: string,
  studentId: string,
  membershipId: string,
): Promise<StudentMeasure[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: MeasureKind;
      value: string;
      unit: string;
      measured_on: string;
      mine: boolean;
    }>(
      `SELECT id, kind::text AS kind, value::text, unit, to_char(measured_on, 'YYYY-MM-DD') AS measured_on,
              entered_by_membership_id = $3 AS mine
         FROM student_measure
        WHERE organization_id = $1 AND student_id = $2 AND archived_at IS NULL
        ORDER BY measured_on DESC, created_at DESC
        LIMIT 100`,
      [organizationId, studentId, membershipId],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      value: Number(row.value),
      unit: row.unit,
      measuredOn: row.measured_on,
      mine: row.mine,
    }));
  });
}

export async function addMeasure(
  organizationId: string,
  studentId: string,
  membershipId: string,
  input: { kind: MeasureKind; value: number; measuredOn: string },
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_measure (organization_id, student_id, kind, value, unit, measured_on, entered_by_membership_id)
       VALUES ($1, $2, $3::student_measure_kind, $4, $5, $6::date, $7)
       RETURNING id`,
      [organizationId, studentId, input.kind, input.value, MEASURE_UNITS[input.kind], input.measuredOn, membershipId],
    );
    await recordAudit(tx, {
      action: 'student_measure.created',
      entityType: 'student',
      entityId: studentId,
      data: { kind: input.kind },
    });
    return rows[0]!.id;
  });
}

/** `onlyBy` limits it to what that person entered: a family's own, never the office's. */
export async function archiveMeasure(
  organizationId: string,
  studentId: string,
  measureId: string,
  onlyBy: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE student_measure SET archived_at = now()
        WHERE organization_id = $1 AND student_id = $2 AND id = $3 AND archived_at IS NULL
          AND ($4::uuid IS NULL OR entered_by_membership_id = $4)`,
      [organizationId, studentId, measureId, onlyBy],
    );
    return (rowCount ?? 0) > 0;
  });
}

/** A family takes back a time it typed, and nothing else. */
export async function archiveOwnTime(
  organizationId: string,
  studentId: string,
  recordId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE student_record SET archived_at = now()
        WHERE organization_id = $1 AND student_id = $2 AND id = $3 AND archived_at IS NULL
          AND self_reported AND recorded_by_membership_id = $4`,
      [organizationId, studentId, recordId, membershipId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'student_record.archived',
      entityType: 'student',
      entityId: studentId,
      data: { recordId, selfReported: true },
    });
    return true;
  });
}
