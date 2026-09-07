import 'server-only';
import ExcelJS from 'exceljs';
import type { PartnerExportRow } from '@/lib/api';
import { PARTNER_EXPORT_FIELDS, type PartnerField } from '@/lib/partner-sheet';
import { toCsv } from '@/lib/csv';

/**
 * The partner list as a workbook — POOLSE-48, criterion 10.
 *
 * The inventory's `write-sheet.ts` with the vocabulary changed, `server-only`
 * for the same reason: a workbook writer has no business in a browser bundle,
 * and the import barrier makes that a build error rather than a megabyte nobody
 * notices.
 *
 * **The whole design is one sentence: what this writes, the importer reads.**
 * The header row is not prose invented for the file — it is `partners.field.*`
 * straight out of the catalogue, the very labels the mapping step shows. So a
 * club exports the list in August, corrects the headcounts the schools sent
 * late, and imports the file back without mapping a single column by hand.
 * `partner-sheet.test.ts` proves it against the real catalogues in both locales.
 *
 * **The type is written as the enum value, not as a translated word.** `escola`
 * rather than "Escola", because `readPartnerType` on the API side reads the enum
 * spelling in either language and a file exported in English has to re-import
 * under a Portuguese locale. The importer also reads the human words, so a club
 * typing "Misericórdia" into the column by hand still works — this is only about
 * what *we* write.
 */

/**
 * One group, as the cells of one row.
 *
 * Built as a record keyed by field and then read *through*
 * `PARTNER_EXPORT_FIELDS` rather than as a positional array kept in the same
 * order by hand. Adding a column then cannot silently shift every value one
 * place to the left.
 */
export function rowFor(row: PartnerExportRow): string[] {
  const values: Record<PartnerField, string> = {
    partnerName: row.partnerName,
    partnerType: row.partnerType,
    groupName: row.groupName,
    // A partnership with no groups exports with this cell empty rather than as
    // a zero: zero participants is a real answer the club gave, and "no group
    // on this line" is not the same fact.
    participantCount: row.groupName === '' ? '' : String(row.participantCount),
    levelName: row.levelName ?? '',
    tag: row.tag ?? '',
    ownInstructorName: row.ownInstructorName ?? '',
    contactName: row.contactName ?? '',
    contactEmail: row.contactEmail ?? '',
    contactPhone: row.contactPhone ?? '',
    notes: row.notes ?? '',
  };

  return PARTNER_EXPORT_FIELDS.map((field) => values[field]);
}

/**
 * The workbook itself.
 *
 * Every cell is written as text, the headcount included. A number-typed count is
 * harmless in Excel and is read back correctly either way, but keeping one rule
 * for the whole file means there is no cell type to reason about when somebody
 * adds a column later.
 */
export async function partnerWorkbook(
  headers: string[],
  rows: PartnerExportRow[],
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
    column.width = 24;
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
export function partnerCsv(headers: string[], rows: PartnerExportRow[]): string {
  return toCsv([headers, ...rows.map(rowFor)]);
}
