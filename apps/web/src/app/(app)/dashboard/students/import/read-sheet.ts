import 'server-only';
import ExcelJS from 'exceljs';
import { parseCsv, toSheet, type Sheet } from '@/lib/sheet';

/**
 * Slice 1.10 — reading the uploaded file, on the server only.
 *
 * `server-only` is not decoration. This pulls in a workbook reader that has no
 * business in a browser bundle, and the import barrier is what makes that a
 * build error instead of a megabyte of JavaScript nobody notices. The rules —
 * delimiters, headers, the mapping guess — live in `lib/sheet.ts`, which is pure
 * and runs in either half.
 *
 * `exceljs` rather than SheetJS: SheetJS's npm package has been frozen at 0.18.5
 * with open advisories since it moved distribution to its own CDN, and a
 * registry-hosted dependency is worth more here than a marginally nicer API.
 * The choice is one function deep, so swapping it is one file.
 */

/** What the file input accepts, and what this will actually attempt. */
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'] as const;

/** Matches `serverActions.bodySizeLimit` in next.config.mjs, minus room for the rest of the form. */
export const MAX_FILE_BYTES = 6 * 1024 * 1024;

export type ReadFailure =
  | 'fileMissing'
  | 'fileTooLarge'
  | 'fileType'
  | 'fileEmpty'
  | 'fileUnreadable';

/**
 * One cell, as text.
 *
 * A spreadsheet cell is not a string — it is a date, a formula with a cached
 * result, a hyperlink, a run of differently-formatted text, or a number that is
 * really a phone number with the leading zero eaten. Every one of those has to
 * come out as the characters a person would see in Excel, because that is what
 * the operator mapped the column by.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // A date-formatted cell. Rendered ISO so `parseImportDate` takes the
    // unambiguous branch rather than guessing at a day-month order that the
    // spreadsheet already resolved.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((run) => run.text).join('');
    if ('formula' in value || 'sharedFormula' in value) return cellText(value.result ?? null);
    if ('text' in value) return String(value.text);
    if ('error' in value) return '';
  }
  return String(value).trim();
}

async function readWorkbook(bytes: ArrayBuffer): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  // The first sheet, because a club's file has one and naming it "Folha1" is not
  // a decision anybody made. A file whose data is on the third tab is a case to
  // handle when somebody actually has one.
  const worksheet = workbook.worksheets[0];
  if (worksheet === undefined) return { headers: [], rows: [] };

  const grid: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // `values` is 1-based with a hole at index 0, which is the single most
    // common way to read an ExcelJS sheet one column out of true.
    const values = Array.isArray(row.values) ? row.values : [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      cells.push(cellText((values[column] ?? null) as ExcelJS.CellValue));
    }
    grid.push(cells);
  });

  return toSheet(grid);
}

/**
 * The uploaded file as a grid, or the reason it could not be read.
 *
 * Every refusal is a named cause rather than a thrown error, because each one is
 * something the person can act on — pick a different file, save it as .xlsx,
 * check it is not empty. A stack trace on the onboarding path is a lost
 * customer.
 */
export async function readSheet(
  file: File | null,
): Promise<{ sheet: Sheet } | { error: ReadFailure }> {
  if (file === null || file.size === 0) return { error: 'fileMissing' };
  if (file.size > MAX_FILE_BYTES) return { error: 'fileTooLarge' };

  const name = file.name.toLowerCase();
  const extension = ACCEPTED_EXTENSIONS.find((candidate) => name.endsWith(candidate));
  if (extension === undefined) return { error: 'fileType' };

  try {
    const sheet =
      extension === '.csv'
        ? // `text()` decodes as UTF-8. A file saved as Windows-1252 will show
          // mojibake in the preview, which is visible and fixable — silently
          // importing "Jo?o" would not be.
          parseCsv(await file.text())
        : await readWorkbook(await file.arrayBuffer());

    if (sheet.headers.length === 0 || sheet.rows.length === 0) return { error: 'fileEmpty' };
    return { sheet };
  } catch {
    // A renamed .xls, a corrupt zip, a password-protected workbook. The person
    // cannot fix any of those from a message about the internals, so they get
    // the one instruction that works: save it again as .xlsx or .csv.
    return { error: 'fileUnreadable' };
  }
}
