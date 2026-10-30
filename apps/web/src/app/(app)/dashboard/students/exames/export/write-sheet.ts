import 'server-only';
import ExcelJS from 'exceljs';
import { EXAM_EXPORT_FIELDS, RESULT_EXPORT_WORD, type ExamField } from '@/lib/exam-sheet';
import type { ExamExportRow } from '@/lib/medical-exams';

/**
 * The club's exames médicos as a workbook — POOLSE-133.
 *
 * **What this writes, the importer reads.** The header row is `exams.field.*`
 * from the catalogue; the result is the Portuguese word in either locale and
 * the dates are ISO, so a file exported under `en` re-imports under `pt-PT`.
 * A validity the API estimated (a year from the exam) is left blank, as the
 * API exports it — it was never somebody's fact, and re-importing it as one
 * would make it so.
 */
export function rowFor(row: ExamExportRow): string[] {
  const values: Record<ExamField, string> = {
    studentName: row.studentName,
    taxNumber: row.taxNumber ?? '',
    birthDate: row.birthDate ?? '',
    examinedOn: row.examinedOn ?? '',
    result: row.result === null ? '' : RESULT_EXPORT_WORD[row.result],
    validUntil: row.validUntil ?? '',
  };
  return EXAM_EXPORT_FIELDS.map((field) => values[field]);
}

export async function examWorkbook(
  headers: string[],
  rows: ExamExportRow[],
  sheetName: string,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poolse';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);
  const heading = worksheet.addRow(headers);
  heading.font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) worksheet.addRow(rowFor(row));
  worksheet.columns.forEach((column) => {
    column.width = 22;
  });

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
