import 'server-only';
import ExcelJS from 'exceljs';
import type { Student } from '@/lib/api';
import { EXPORT_FIELDS, type ImportField } from '@/lib/sheet';

/**
 * Slice 1.11 — the register as a workbook.
 *
 * The sibling of `@/lib/read-sheet`, and `server-only` for the same
 * reason: a workbook writer has no business in a browser bundle, and the import
 * barrier makes that a build error rather than a megabyte nobody notices.
 *
 * **The whole design is one sentence: what this writes, the importer reads.**
 * The header row is not prose invented for the file — it is the import's own
 * field labels, straight out of the catalogue, so a club can export, edit in
 * Excel, and import the result without mapping a single column by hand. That is
 * also the cheapest possible test: run the exported headers through
 * `guessMapping` and every field must find its own column.
 */

/**
 * One student, as the cells of one row.
 *
 * Built as a record keyed by field and then read *through* `EXPORT_FIELDS`,
 * rather than as a positional array that has to be kept in the same order by
 * hand. Adding a column then cannot silently shift every value one place to the
 * left — a bug that would put telephone numbers under "Email" in a file already
 * sent to somebody.
 */
export function rowFor(student: Student): string[] {
  /*
   * The primary guardian, which `toStudent` has already sorted to the front.
   *
   * One per row, because the sheet is a grid and a second guardian would need
   * either five more columns that are empty for most families or a second row
   * that re-imports as a second child. The import reads one guardian per row
   * too, so the two halves agree about what a row is — and the detail page
   * remains the place where a student's other guardians live.
   */
  const guardian = student.guardians[0];

  const values: Record<ImportField, string> = {
    // Never written: the parts are exported instead, so nothing is guessed on
    // the way back in. Present because the record must cover every field.
    fullName: '',
    firstName: student.firstName,
    lastName: student.lastName,
    birthDate: student.birthDate ?? '',
    levelName: student.levelName ?? '',
    contactEmail: student.contactEmail ?? '',
    contactPhone: student.contactPhone ?? '',
    taxNumber: student.taxNumber ?? '',
    notes: student.notes ?? '',
    guardianName: guardian?.name ?? '',
    guardianRelationship: guardian?.relationship ?? '',
    guardianPhone: guardian?.phone ?? '',
    guardianEmail: guardian?.email ?? '',
    guardianTaxNumber: guardian?.taxNumber ?? '',
    isSocio: student.isSocio ? 'Sim' : '',
    socioNumber: student.socioNumber ?? '',
    /*
     * Género and payment — round 5.
     *
     * Written the way a club writes them, because this file goes back into the
     * importer: "Masculino" and "Sim" are read by the same readers that parse a
     * club's own spreadsheet, so an export is a valid import.
     *
     * A student with nothing to pay exports an empty cell rather than "Não" —
     * "not applicable" and "owes money" are different answers and a blank is the
     * honest one.
     */
    gender:
      student.gender === null ? '' : student.gender === 'male' ? 'Masculino' : 'Feminino',
    isPaid:
      student.paymentState === 'paid' ? 'Sim' : student.paymentState === 'none' ? '' : 'Não',
  };

  return EXPORT_FIELDS.map((field) => values[field]);
}

/**
 * The workbook itself.
 *
 * Every cell is written as text, including the birth date. A date-typed cell
 * would be rendered by Excel in whatever the reader's locale says, which means
 * the same file shows 03/04/2015 in Lisbon and 04/03/2015 in Chicago — and the
 * importer would then read back a different day from the one exported. An ISO
 * string is the same date everywhere, and `parseImportDate` takes its
 * unambiguous branch on it.
 */
export async function studentsWorkbook(
  headers: string[],
  students: Student[],
  sheetName: string,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poolse';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  const heading = worksheet.addRow(headers);
  heading.font = { bold: true };
  // So a register of four hundred is still readable after scrolling past the
  // header — the one piece of formatting that earns its place.
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Plain strings, so every cell is a string cell. Nothing here should be a
  // number or a date as far as the file is concerned.
  for (const student of students) {
    worksheet.addRow(rowFor(student));
  }

  // Wide enough for a Portuguese name without being wide enough to need
  // scrolling to reach the guardian.
  worksheet.columns.forEach((column) => {
    column.width = 22;
  });

  // An ArrayBuffer rather than a Node Buffer: this is handed straight to a web
  // `Response`, which takes the former and not the latter.
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** One CSV field, quoted only where it has to be. */
function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The same register as a CSV.
 *
 * **Semicolons, CRLF, and a byte-order mark** — all three because this file
 * has to open correctly by double-click in a Portuguese Excel, which is where
 * it is going. Commas would put the whole row in column A on a machine whose
 * decimal separator is a comma, and without the BOM every accent in it renders
 * as mojibake. Our own importer sniffs the delimiter and strips the mark, so
 * the round trip survives either way; Excel is the fussy one.
 */
export function studentsCsv(headers: string[], students: Student[]): string {
  const lines = [headers, ...students.map(rowFor)].map((row) =>
    row.map(csvCell).join(';'),
  );
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
