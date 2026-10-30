import type { ExamImportRow, ExamResult } from './exam-sheet';

/**
 * The exame médico as the API answers it — POOLSE-133.
 *
 * `note` and `fileId` are null for anybody but owner and admin; an instructor
 * reads the state and the dates only.
 */
export interface MedicalExam {
  id: string;
  examinedOn: string;
  result: ExamResult;
  validUntil: string | null;
  /** No valid-until was given, so the API counted a year from the exam. */
  validUntilAssumed: boolean;
  note: string | null;
  fileId: string | null;
  hasCertificate: boolean;
}

export interface StudentMedicalExams {
  state: 'valid' | 'expired' | 'none';
  current: MedicalExam | null;
  history: MedicalExam[];
}

export const EXAM_RESULTS: readonly ExamResult[] = ['fit', 'fit_with_conditions', 'unfit'];

/** `GET /medical-exams/export` — one row per live student, blanks when no exam. */
export type ExamExportRow = ExamImportRow;

export type ExamImportStatus = 'new' | 'unchanged' | 'needs_confirmation' | 'no_match' | 'invalid';

/** One row of `POST /medical-exams/import`'s answer. */
export interface ExamImportRowResult {
  index: number;
  status: ExamImportStatus;
  studentId: string | null;
  studentName: string | null;
  /** An `exams.import.reason.*` key, or null. */
  reason: string | null;
}
