import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName } from '../people/names.js';
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

// ---------------------------------------------------------------------------
// The spreadsheet — export and import on one shape.
// ---------------------------------------------------------------------------

export interface ExamSheetRow {
  studentName: string;
  taxNumber: string | null;
  birthDate: string | null;
  examinedOn: string | null;
  result: ExamResult | null;
  validUntil: string | null;
}

/** One row per live student, with their latest exam (or blanks). */
export async function exportExams(organizationId: string): Promise<ExamSheetRow[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      name: string;
      tax_number: string | null;
      birth_date: string | null;
      examined_on: string | null;
      result: ExamResult | null;
      valid_until: string | null;
    }>(
      `SELECT ${displayName('s')} AS name, s.tax_number, s.birth_date::text,
              e.examined_on::text, e.result, CASE WHEN e.valid_until_assumed THEN NULL ELSE e.valid_until::text END AS valid_until
         FROM student s
         LEFT JOIN LATERAL (
           SELECT * FROM medical_exam e
            WHERE e.student_id = s.id AND e.organization_id = s.organization_id AND e.archived_at IS NULL
            ORDER BY e.examined_on DESC, e.created_at DESC LIMIT 1
         ) e ON true
        WHERE s.archived_at IS NULL AND s.anonymised_at IS NULL
        ORDER BY s.last_name, s.first_name`,
    );
    return rows.map((r) => ({
      studentName: r.name,
      taxNumber: r.tax_number,
      birthDate: r.birth_date,
      examinedOn: r.examined_on,
      result: r.result,
      validUntil: r.valid_until,
    }));
  });
}

export type ImportRowStatus = 'new' | 'unchanged' | 'needs_confirmation' | 'no_match' | 'invalid';

export interface ImportRowResult {
  index: number;
  status: ImportRowStatus;
  studentId: string | null;
  studentName: string | null;
  /** Why a row was refused, as a key the screen translates. */
  reason: string | null;
}

/**
 * Matches each row to a student — by NIF, else by name and birth date (which
 * must be confirmed: the row's index in `confirmed`) — never by name alone and
 * never creating a student. Preview and commit are this one function; the
 * commit writes the `new` rows and the confirmed ones, all in one transaction.
 */
export async function importExams(
  organizationId: string,
  rows: ExamSheetRow[],
  confirmed: ReadonlySet<number>,
  commit: boolean,
  recordedBy: string | null,
): Promise<{ rows: ImportRowResult[]; written: number }> {
  return withOrg(organizationId, async (tx) => {
    const students = await tx.query<{ id: string; name: string; tax_number: string | null; birth_date: string | null; key: string }>(
      `SELECT s.id, ${displayName('s')} AS name, s.tax_number, s.birth_date::text,
              lower(strip_accents(s.first_name || ' ' || s.last_name)) AS key
         FROM student s WHERE s.archived_at IS NULL AND s.anonymised_at IS NULL`,
    );
    const latest = await tx.query<{ student_id: string; examined_on: string }>(
      `SELECT DISTINCT ON (student_id) student_id, examined_on::text
         FROM medical_exam WHERE archived_at IS NULL
        ORDER BY student_id, examined_on DESC, created_at DESC`,
    );
    const latestOf = new Map(latest.rows.map((r) => [r.student_id, r.examined_on]));
    const byNif = new Map(students.rows.filter((s) => s.tax_number !== null).map((s) => [s.tax_number!, s]));
    const fold = (text: string): string =>
      text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

    const results: ImportRowResult[] = [];
    let written = 0;
    for (const [index, row] of rows.entries()) {
      if (row.examinedOn === null || row.result === null) {
        results.push({ index, status: 'invalid', studentId: null, studentName: null, reason: 'exams.import.reason.incomplete' });
        continue;
      }
      if (row.validUntil !== null && row.validUntil < row.examinedOn) {
        results.push({ index, status: 'invalid', studentId: null, studentName: null, reason: 'exams.import.reason.order' });
        continue;
      }
      let match = row.taxNumber === null ? undefined : byNif.get(row.taxNumber);
      let byName = false;
      if (match === undefined && row.birthDate !== null) {
        const candidates = students.rows.filter((s) => s.birth_date === row.birthDate && fold(s.name) === fold(row.studentName));
        if (candidates.length === 1) {
          match = candidates[0];
          byName = true;
        }
      }
      if (match === undefined) {
        results.push({ index, status: 'no_match', studentId: null, studentName: null, reason: 'exams.import.reason.noMatch' });
        continue;
      }
      if (latestOf.get(match.id) === row.examinedOn) {
        results.push({ index, status: 'unchanged', studentId: match.id, studentName: match.name, reason: null });
        continue;
      }
      if (byName && !confirmed.has(index)) {
        results.push({ index, status: 'needs_confirmation', studentId: match.id, studentName: match.name, reason: null });
        continue;
      }
      results.push({ index, status: 'new', studentId: match.id, studentName: match.name, reason: null });
      if (commit) {
        await insertExamIn(tx, organizationId, match.id, {
          examinedOn: row.examinedOn,
          result: row.result,
          validUntil: row.validUntil,
          note: null,
        }, recordedBy);
        latestOf.set(match.id, row.examinedOn);
        written += 1;
      }
    }
    return { rows: results, written };
  });
}
