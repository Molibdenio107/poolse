import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Medical leave — round 5.
 *
 * A period a student cannot swim. It does not write attendance: it makes
 * *falta justificada* the mark the register offers, which the instructor then
 * saves like any other. The migration header sets out why, and the short version
 * is that rows nobody stood at the poolside to record are not a register.
 */

export interface MedicalLeave {
  id: string;
  startsOn: string;
  /** Null means open-ended — the honest state on the day of an injury. */
  endsOn: string | null;
  reason: string | null;
  /** Where the atestado is filed. Not a diagnosis — see the migration. */
  justificationReference: string | null;
  recordedByName: string | null;
  /** Whether it covers today, computed by the database so no clock disagrees. */
  active: boolean;
}

export async function listMedicalLeave(
  organizationId: string,
  studentId: string,
): Promise<MedicalLeave[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      starts_on: string;
      ends_on: string | null;
      reason: string | null;
      justification_reference: string | null;
      recorded_by_name: string | null;
      active: boolean;
    }>(
      `
      SELECT l.id,
             l.starts_on,
             l.ends_on,
             l.reason,
             l.justification_reference,
             nullif(btrim(coalesce(u.cached_first_name, '') || ' ' ||
                          coalesce(u.cached_last_name, '')), '') AS recorded_by_name,
             -- current_date, not a value from the caller: two clients with two
             -- clocks must not disagree about whether a student is off today.
             (l.starts_on <= current_date
              AND (l.ends_on IS NULL OR l.ends_on >= current_date)) AS active
        FROM student_medical_leave l
        LEFT JOIN membership m ON m.id = l.recorded_by AND m.organization_id = l.organization_id
        LEFT JOIN app_user u   ON u.id = m.app_user_id
       WHERE l.student_id = $1
         AND l.archived_at IS NULL
       ORDER BY l.starts_on DESC
      `,
      [studentId],
    );

    return rows.map((row) => ({
      id: row.id,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      reason: row.reason,
      justificationReference: row.justification_reference,
      recordedByName: row.recorded_by_name,
      active: row.active,
    }));
  });
}

export async function createMedicalLeave(
  organizationId: string,
  input: {
    studentId: string;
    startsOn: string;
    endsOn: string | null;
    reason: string | null;
    justificationReference: string | null;
    recordedBy: string | null;
  },
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_medical_leave
         (organization_id, student_id, starts_on, ends_on, reason,
          justification_reference, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        organizationId,
        input.studentId,
        input.startsOn,
        input.endsOn,
        input.reason,
        input.justificationReference,
        input.recordedBy,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not record the medical leave');

    /*
     * The dates are audited; the reason is not.
     *
     * "Lesão no ombro" is about somebody's body, and the audit log is read by
     * more people and kept longer than the record it describes. What an auditor
     * needs is that a leave was created, for whom, covering what — not why.
     */
    await recordAudit(tx, {
      action: 'student.medicalLeaveRecorded',
      entityType: 'student_medical_leave',
      entityId: id,
      data: {
        studentId: input.studentId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        // Whether there is paperwork, not what it is. The reference can name a
        // patient's file, and the audit log outlives the record it describes.
        justified: input.justificationReference !== null,
      },
    });

    return id;
  });
}

export async function archiveMedicalLeave(
  organizationId: string,
  leaveId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; student_id: string }>(
      `UPDATE student_medical_leave SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id, student_id`,
      [leaveId],
    );

    const row = rows[0];
    if (!row) return false;

    await recordAudit(tx, {
      action: 'student.medicalLeaveRemoved',
      entityType: 'student_medical_leave',
      entityId: leaveId,
      data: { studentId: row.student_id },
    });

    return true;
  });
}

/**
 * Whether a student is on leave on a given date — what the register asks.
 *
 * A date rather than "now", because the register is taken for a session, and a
 * session that happened on Tuesday is marked on Tuesday's terms even if somebody
 * is filling it in on Thursday.
 */
export async function leaveOnDate(
  organizationId: string,
  studentIds: string[],
  onDate: string,
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ student_id: string }>(
      `SELECT DISTINCT student_id
         FROM student_medical_leave
        WHERE archived_at IS NULL
          AND student_id = ANY($1::uuid[])
          AND starts_on <= $2::date
          AND (ends_on IS NULL OR ends_on >= $2::date)`,
      [studentIds, onDate],
    );

    return new Set(rows.map((row) => row.student_id));
  });
}
