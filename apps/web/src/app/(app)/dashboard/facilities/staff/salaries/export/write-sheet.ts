import 'server-only';
import ExcelJS from 'exceljs';
import type { SalaryExportRow } from '@/lib/api';
import { SALARY_EXPORT_FIELDS, type SalaryField } from '@/lib/salary-sheet';
import { toCsv } from '@/lib/csv';

/**
 * The pay list as a workbook — POOLSE-59.
 *
 * The partnerships' `write-sheet.ts` with the vocabulary changed, `server-only`
 * for the same reason: a workbook writer has no business in a browser bundle,
 * and the import barrier makes that a build error rather than a megabyte nobody
 * notices.
 *
 * **What this writes, the importer reads.** The header row is not prose invented
 * for the file — it is `salaries.field.*` straight out of the catalogue, the
 * very labels the mapping step shows. `salary-sheet.test.ts` proves it against
 * the real catalogues in both locales.
 *
 * **Two values are written in a form that is the same in both languages.** The
 * type is the enum's own spelling — `monthly`, not "Mensal" — and the date is
 * ISO, because a file exported under `en` is re-imported under `pt-PT` and a
 * translated value would not survive the journey. The amount is a plain decimal
 * with no symbol and no thousands separator; `parseSheetCents` takes it either
 * way, and this is the shape every other system also takes.
 *
 * **No derived figures.** *Mensal* and *Por hora* are columns on the screen and
 * are absent here, because one of the two is always an estimate computed from
 * the other — re-importing an estimate as an amount would turn a rounding into a
 * pay rise.
 */
export function rowFor(row: SalaryExportRow): string[] {
  const values: Record<SalaryField, string> = {
    name: row.name,
    email: row.email,
    taxNumber: row.taxNumber,
    kind: row.kind,
    amount: row.amount,
    weeklyHours: row.weeklyHours,
    payPeriods: row.payPeriods,
    effectiveFrom: row.effectiveFrom,
    provenance: row.provenance,
    note: row.note,
  };

  // Read *through* the field list rather than written as a positional array kept
  // in the same order by hand: adding a column then cannot silently shift every
  // value one place to the left.
  return SALARY_EXPORT_FIELDS.map((field) => values[field]);
}

export async function salaryWorkbook(
  headers: string[],
  rows: SalaryExportRow[],
  sheetName: string,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poolse';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  const heading = worksheet.addRow(headers);
  heading.font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    worksheet.addRow(rowFor(row));
  }

  worksheet.columns.forEach((column) => {
    column.width = 22;
  });

  // An ArrayBuffer rather than a Node Buffer: this is handed straight to a web
  // `Response`, which takes the former and not the latter.
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * The same list as a CSV.
 *
 * **Semicolons, CRLF and a byte-order mark**, all three from `toCsv`, because
 * this file has to open correctly by double-click in a Portuguese Excel — which
 * is where it is going. Our own importer sniffs the delimiter and strips the
 * mark, so the round trip survives either way; Excel is the fussy one.
 */
export function salaryCsv(headers: string[], rows: SalaryExportRow[]): string {
  return toCsv([headers, ...rows.map(rowFor)]);
}
