import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { storeFile } from '../files/files.repository.js';

/**
 * The exame médico — POOLSE-133 (Rui, 30-10-2026).
 *
 * One row per exam: date, result, valid until (or a year assumed and labelled
 * as such), a note and an optional certificate (a sealed `medical_certificate`
 * file). A student's standing is their latest live row; validity is judged
 * against `club_today()` here, never stored. A warning, never a gate.
 */

export const EXAM_RESULTS = ['fit', 'fit_with_conditions', 'unfit'] as const;
export type ExamResult = (typeof EXAM_RESULTS)[number];
export type ExamState = 'valid' | 'expired' | 'none';

export interface Exam {
  id: string;
  examinedOn: string;
  result: ExamResult;
  validUntil: string | null;
  validUntilAssumed: boolean;
  /** Owner and admin only: null for anybody else. */
  note: string | null;
  /** Owner and admin only: whether a certificate is filed, and its file. */
  fileId: string | null;
  hasCertificate: boolean;
}

export interface StudentExams {
  state: ExamState;
  current: Exam | null;
  history: Exam[];
}

/** The state of one exam row against a day, the one definition. */
export const EXAM_STATE_SQL = (e: string, day: string): string =>
  `CASE WHEN ${e}.valid_until IS NOT NULL AND ${e}.valid_until >= ${day} AND ${e}.result <> 'unfit'
        THEN 'valid' ELSE 'expired' END`;

interface ExamRow {
  id: string;
  examined_on: string;
  result: ExamResult;
  valid_until: string | null;
  valid_until_assumed: boolean;
  note: string | null;
  file_id: string | null;
  state: 'valid' | 'expired';
}

function toExam(row: ExamRow, full: boolean): Exam {
  return {
    id: row.id,
    examinedOn: row.examined_on,
    result: row.result,
    validUntil: row.valid_until,
    validUntilAssumed: row.valid_until_assumed,
    note: full ? row.note : null,
    fileId: full ? row.file_id : null,
    hasCertificate: row.file_id !== null,
  };
}

/** Null when the student is not this club's. `full` is owner/admin. */
export async function listExams(organizationId: string, studentId: string, full: boolean): Promise<StudentExams | null> {
  return withOrg(organizationId, async (tx) => {
    const student = await tx.query('SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL', [studentId]);
    if (student.rowCount === 0) return null;
    const { rows } = await tx.query<ExamRow>(
      `SELECT e.id, e.examined_on::text, e.result, e.valid_until::text, e.valid_until_assumed, e.note, e.file_id,
              ${EXAM_STATE_SQL('e', 'club_today()')} AS state
         FROM medical_exam e
        WHERE e.student_id = $1 AND e.archived_at IS NULL
        ORDER BY e.examined_on DESC, e.created_at DESC`,
      [studentId],
    );
    const [first, ...rest] = rows;
    return {
      state: first === undefined ? 'none' : first.state,
      current: first === undefined ? null : toExam(first, full),
      history: rest.map((row) => toExam(row, full)),
    };
  });
}

export interface ExamInput {
  examinedOn: string;
  result: ExamResult;
  validUntil: string | null;
  note: string | null;
}

/** One exam inside the caller's transaction; a missing validity is a year, assumed. */
export async function insertExamIn(
  tx: Tx,
  organizationId: string,
  studentId: string,
  input: ExamInput,
  recordedBy: string | null,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO medical_exam (organization_id, student_id, examined_on, result, valid_until, valid_until_assumed, note, recorded_by)
     VALUES ($1, $2, $3::date, $4::medical_exam_result,
             coalesce($5::date, ($3::date + interval '1 year' - interval '1 day')::date),
             $5::date IS NULL, $6, $7)
     RETURNING id`,
    [organizationId, studentId, input.examinedOn, input.result, input.validUntil, input.note, recordedBy],
  );
  const id = rows[0]!.id;
  // The result and dates are health data: named, never valued, in the log.
  await recordAudit(tx, {
    action: 'student.medical_exam_recorded',
    entityType: 'student',
    entityId: studentId,
    data: { examId: id },
  });
  return id;
}

export async function recordExam(
  organizationId: string,
  studentId: string,
  input: ExamInput,
  recordedBy: string | null,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const student = await tx.query('SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL', [studentId]);
    if (student.rowCount === 0) return null;
    return insertExamIn(tx, organizationId, studentId, input, recordedBy);
  });
}

class ExamGone extends Error {}

/** The certificate, sealed, registered and attached in one transaction, once. */
export async function attachExamCertificate(
  organizationId: string,
  studentId: string,
  examId: string,
  bytes: Buffer,
  contentType: string,
  originalName: string,
): Promise<{ fileId: string } | null> {
  try {
    const stored = await storeFile(organizationId, 'medical_certificate', bytes, contentType, originalName, async (tx, fileId) => {
      const { rowCount } = await tx.query(
        `UPDATE medical_exam SET file_id = $3
          WHERE id = $1 AND student_id = $2 AND archived_at IS NULL AND file_id IS NULL`,
        [examId, studentId, fileId],
      );
      if (rowCount === 0) throw new ExamGone();
      await recordAudit(tx, {
        action: 'student.medical_exam_certificate',
        entityType: 'student',
        entityId: studentId,
        data: { examId, fileId },
      });
    });
    return { fileId: stored.id };
  } catch (error) {
    if (error instanceof ExamGone) return null;
    throw error;
  }
}

export async function archiveExam(organizationId: string, studentId: string, examId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE medical_exam SET archived_at = now() WHERE id = $1 AND student_id = $2 AND archived_at IS NULL`,
      [examId, studentId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'student.medical_exam_archived',
      entityType: 'student',
      entityId: studentId,
      data: { examId },
    });
    return true;
  });
}
