import 'server-only';
import ExcelJS from 'exceljs';
import { parseCsv, toSheet, type NamedSheet } from '@/lib/sheet';

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
 *
 * **Every sheet is read, not the first one.** A club's workbook is very often a
 * tab per turma, or a tab of instructions in front of the register, or last
 * year's list kept beside this year's. Taking `worksheets[0]` silently meant
 * that a file whose data sits on the second tab came back as "no rows with
 * data" — an accusation about a file that is perfectly fine, aimed at somebody
 * who has no way to tell what was actually wrong. So all of them are parsed and
 * the operator is shown which they are importing.
 */

/** What the file input accepts, and what this will actually attempt. */
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'] as const;

/**
 * Matches `serverActions.bodySizeLimit` in next.config.mjs, with room to spare.
 *
 * Far larger than it needs to be, deliberately. A 10 000-student `.xlsx` is
 * 566 KB and the same register as `.csv` is 2.2 MB, so this is not the limit
 * anybody meets — `MAX_IMPORT_ROWS` on the API is. Being generous here means
 * the refusal an operator does hit is the one that can explain itself in terms
 * of students rather than megabytes.
 */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * How many sheets one workbook may contribute.
 *
 * A generated workbook can carry hundreds of tabs, and parsing every one of them
 * to offer a dropdown nobody will read is work done for nothing. Twenty is far
 * past any club's file and keeps the picker a list rather than a search problem.
 */
export const MAX_SHEETS = 20;

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

function gridOf(worksheet: ExcelJS.Worksheet): string[][] {
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

  return grid;
}

/**
 * Every sheet in the workbook that has anything on it.
 *
 * Hidden sheets are skipped. A sheet somebody hid is a sheet they did not want
 * looked at — usually a lookup table feeding a dropdown — and offering it as a
 * candidate register is offering a wrong answer with equal confidence.
 *
 * Sheets that are empty once blank rows are dropped are left out too, so a
 * workbook with a title tab and a data tab presents one choice rather than two,
 * and the common case stays a file with no question attached to it.
 */
async function readWorkbook(bytes: ArrayBuffer): Promise<NamedSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  const sheets: NamedSheet[] = [];

  for (const worksheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') continue;

    const sheet = toSheet(gridOf(worksheet));
    if (sheet.headers.length === 0 || sheet.rows.length === 0) continue;

    sheets.push({ name: worksheet.name, ...sheet });
  }

  return sheets;
}

/**
 * The uploaded file as one or more grids, or the reason it could not be read.
 *
 * Every refusal is a named cause rather than a thrown error, because each one is
 * something the person can act on — pick a different file, save it as .xlsx,
 * check it is not empty. A stack trace on the onboarding path is a lost
 * customer.
 */
export async function readSheet(
  file: File | null,
): Promise<{ sheets: NamedSheet[] } | { error: ReadFailure }> {
  if (file === null || file.size === 0) return { error: 'fileMissing' };
  if (file.size > MAX_FILE_BYTES) return { error: 'fileTooLarge' };

  const name = file.name.toLowerCase();
  const extension = ACCEPTED_EXTENSIONS.find((candidate) => name.endsWith(candidate));
  if (extension === undefined) return { error: 'fileType' };

  try {
    let sheets: NamedSheet[];

    if (extension === '.csv') {
      // A CSV is one sheet by definition, and it is named after the file so the
      // picker reads the same way whichever format arrived.
      //
      // `text()` decodes as UTF-8. A file saved as Windows-1252 will show
      // mojibake in the preview, which is visible and fixable — silently
      // importing "Jo?o" would not be.
      const sheet = parseCsv(await file.text());
      sheets =
        sheet.headers.length === 0 || sheet.rows.length === 0
          ? []
          : [{ name: file.name, ...sheet }];
    } else {
      sheets = await readWorkbook(await file.arrayBuffer());
    }

    if (sheets.length === 0) return { error: 'fileEmpty' };
    return { sheets };
  } catch {
    // A renamed .xls, a corrupt zip, a password-protected workbook. The person
    // cannot fix any of those from a message about the internals, so they get
    // the one instruction that works: save it again as .xlsx or .csv.
    return { error: 'fileUnreadable' };
  }
}
