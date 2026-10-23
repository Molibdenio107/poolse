import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { personName } from '../people/names.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { storeFile } from '../files/files.repository.js';

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
  /**
   * The atestado — POOLSE-109. `file` is null for a reader who may know it
   * exists but not open it (a coach): *atestado anexado* and the date, never
   * the document or its name, which can carry a diagnosis.
   */
  certificate: { attachedAt: string; file: CertificateFile | null } | null;
  /** Earlier atestados, newest first — only for a reader who may open them. */
  previousCertificates: (CertificateFile & { replacedAt: string; replacedBy: string })[];
}

export interface CertificateFile {
  fileId: string;
  originalName: string;
  contentType: string;
  attachedAt: string;
  attachedBy: string;
}

export async function listMedicalLeave(
  organizationId: string,
  studentId: string,
  /** Whether the reader may open an atestado, or only be told there is one. */
  mayOpenCertificates: boolean,
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
      /*
       * ::text on both dates — round 5, ticket 10.3.
       *
       * The row type has always said string, and it was not one: pg parses a
       * date column into a JS Date at *local* midnight, so 2026-08-16 left this
       * API as "2026-08-15T23:00:00.000Z". Not merely a time nobody entered —
       * the day *before*, because local midnight in WEST is 23:00 the previous
       * day in UTC. Every client rendering that ISO string in UTC showed a
       * medical leave starting a day early.
       *
       * Cast in SQL rather than formatted in TypeScript: the column holds a
       * calendar date with no timezone in it, and the moment it becomes a Date
       * a timezone has been invented. This never lets one exist.
       */
      SELECT l.id,
             l.starts_on::text AS starts_on,
             l.ends_on::text   AS ends_on,
             l.reason,
             l.justification_reference,
             nullif(btrim(coalesce(u.cached_first_name, '') || ' ' ||
                          coalesce(u.cached_last_name, '')), '') AS recorded_by_name,
             -- current_date, not a value from the caller: two clients with two
             -- clocks must not disagree about whether a student is off today.
             (l.starts_on <= club_today()
              AND (l.ends_on IS NULL OR l.ends_on >= club_today())) AS active
        FROM student_medical_leave l
        LEFT JOIN membership m ON m.id = l.recorded_by AND m.organization_id = l.organization_id
        LEFT JOIN app_user u   ON u.id = m.app_user_id
       WHERE l.student_id = $1
         AND l.archived_at IS NULL
       ORDER BY l.starts_on DESC
      `,
      [studentId],
    );

    const versions = await tx.query<{
      leave_id: string;
      file_id: string;
      original_name: string;
      content_type: string;
      attached_at: Date;
      attached_by: string;
      replaced_at: Date | null;
      replaced_by: string | null;
    }>(
      `SELECT c.leave_id, c.file_id, f.original_name, f.content_type, c.attached_at,
              ${personName('c.attached_by')} AS attached_by,
              c.replaced_at,
              CASE WHEN c.replaced_by IS NULL THEN NULL ELSE ${personName('c.replaced_by')} END AS replaced_by
         FROM medical_leave_certificate c
         JOIN student_medical_leave l ON l.organization_id = c.organization_id AND l.id = c.leave_id
         JOIN stored_file f ON f.organization_id = c.organization_id AND f.id = c.file_id
        WHERE l.student_id = $1
          AND f.key_shredded_at IS NULL
        ORDER BY c.replaced_at DESC NULLS FIRST, c.attached_at DESC`,
      [studentId],
    );
    const fileOf = (row: (typeof versions.rows)[number]): CertificateFile => ({
      fileId: row.file_id,
      originalName: row.original_name,
      contentType: row.content_type,
      attachedAt: row.attached_at.toISOString(),
      attachedBy: row.attached_by,
    });

    return rows.map((row) => {
      const mine = versions.rows.filter((version) => version.leave_id === row.id);
      const current = mine.find((version) => version.replaced_at === null);
      return {
        id: row.id,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        reason: row.reason,
        justificationReference: row.justification_reference,
        recordedByName: row.recorded_by_name,
        active: row.active,
        certificate:
          current === undefined
            ? null
            : {
                attachedAt: current.attached_at.toISOString(),
                file: mayOpenCertificates ? fileOf(current) : null,
              },
        previousCertificates: mayOpenCertificates
          ? mine
              .filter((version) => version.replaced_at !== null)
              .map((version) => ({
                ...fileOf(version),
                replacedAt: version.replaced_at!.toISOString(),
                replacedBy: version.replaced_by ?? '',
              }))
          : [],
      };
    });
  });
}

/** Whether a live leave belongs to this student — asked before a file is put in the bucket. */
export async function leaveOfStudent(organizationId: string, studentId: string, leaveId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT 1 FROM student_medical_leave WHERE id = $1 AND student_id = $2 AND archived_at IS NULL`,
      [leaveId, studentId],
    );
    return rows.length > 0;
  });
}

/**
 * Files an atestado on a leave — POOLSE-109. The file is sealed, registered and
 * attached in one transaction; the atestado it replaces stays in the history.
 * False when the leave is not this student's live leave.
 */
export async function attachCertificate(
  organizationId: string,
  studentId: string,
  leaveId: string,
  bytes: Buffer,
  contentType: string,
  originalName: string,
): Promise<{ fileId: string } | null> {
  if (!(await leaveOfStudent(organizationId, studentId, leaveId))) return null;
  const { membershipId } = currentTenant();
  const stored = await storeFile(organizationId, 'medical_certificate', bytes, contentType, originalName, async (tx, fileId) => {
    const leave = await tx.query(
      `SELECT 1 FROM student_medical_leave WHERE id = $1 AND student_id = $2 AND archived_at IS NULL FOR UPDATE`,
      [leaveId, studentId],
    );
    if (leave.rows.length === 0) throw new LeaveGone();
    const closed = await tx.query(
      `UPDATE medical_leave_certificate SET replaced_at = now(), replaced_by = $2
        WHERE leave_id = $1 AND replaced_at IS NULL
       RETURNING id`,
      [leaveId, membershipId],
    );
    await tx.query(
      `INSERT INTO medical_leave_certificate (organization_id, leave_id, file_id, attached_by)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, leaveId, fileId, membershipId],
    );
    await tx.query(`UPDATE student_medical_leave SET document_file_id = $2 WHERE id = $1`, [leaveId, fileId]);
    // Who and which leave — never the file's name, which can carry a diagnosis.
    await recordAudit(tx, {
      action: 'student.medicalCertificateAttached',
      entityType: 'student_medical_leave',
      entityId: leaveId,
      data: { studentId, fileId, replaced: closed.rows.length > 0 },
    });
  }).catch((error: unknown) => {
    if (error instanceof LeaveGone) return null;
    throw error;
  });
  return stored === null ? null : { fileId: stored.id };
}

class LeaveGone extends Error {}

/** Takes the atestado off a leave; the file stays in the history. False when there was none. */
export async function detachCertificate(
  organizationId: string,
  studentId: string,
  leaveId: string,
): Promise<boolean> {
  const { membershipId } = currentTenant();
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE medical_leave_certificate c SET replaced_at = now(), replaced_by = $3
         FROM student_medical_leave l
        WHERE l.organization_id = c.organization_id AND l.id = c.leave_id
          AND c.leave_id = $1 AND l.student_id = $2 AND c.replaced_at IS NULL
       RETURNING c.id`,
      [leaveId, studentId, membershipId],
    );
    if (rows.length === 0) return false;
    await tx.query(`UPDATE student_medical_leave SET document_file_id = NULL WHERE id = $1`, [leaveId]);
    await recordAudit(tx, {
      action: 'student.medicalCertificateRemoved',
      entityType: 'student_medical_leave',
      entityId: leaveId,
      data: { studentId },
    });
    return true;
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
