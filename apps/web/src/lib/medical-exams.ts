export type ExamResult = 'fit' | 'fit_with_conditions' | 'unfit';

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
