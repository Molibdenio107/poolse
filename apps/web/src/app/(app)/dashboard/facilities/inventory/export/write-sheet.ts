import 'server-only';
import ExcelJS from 'exceljs';
import type { InventoryItem } from '@/lib/api';
import { INVENTORY_EXPORT_FIELDS, type InventoryField } from '@/lib/inventory-sheet';

/**
 * The store room as a workbook — round 6.
 *
 * The sibling of `@/lib/read-sheet`, and `server-only` for the same reason: a
 * workbook writer has no business in a browser bundle, and the import barrier
 * makes that a build error rather than a megabyte nobody notices.
 *
 * **The whole design is one sentence: what this writes, the importer reads.**
 * The header row is not prose invented for the file — it is the import's own
 * field labels, straight out of the catalogue, so a club can export the list,
 * walk round the store room correcting counts in Excel, and import the result
 * without mapping a single column by hand. That round trip is the reason the
 * inventory export exists at all, and it is why it replaced the CSV the pool
 * page used to build in the browser.
 */

/**
 * How a scope is written so the importer reads it back as the same scope.
 *
 * `all` rather than a translated "todas as piscinas", because the importer's
 * list of words meaning "all" is fixed and short, and a file exported in English
 * has to re-import in Portuguese. An empty cell is the building, which is also
 * the importer's default — so the commonest item exports as a blank and comes
 * back correct.
 */
function scopeCell(item: InventoryItem): string {
  if (item.scope === 'facility') return '';
  if (item.scope === 'all_pools') return 'all';
  return item.poolNames.join(', ');
}

/**
 * One item, as the cells of one row.
 *
 * Built as a record keyed by field and then read *through* `INVENTORY_EXPORT_FIELDS`
 * rather than as a positional array kept in the same order by hand. Adding a
 * column then cannot silently shift every value one place to the left.
 */
export function rowFor(item: InventoryItem): string[] {
  const values: Record<InventoryField, string> = {
    name: item.name,
    quantity: String(item.quantity),
    unit: item.unit ?? '',
    notes: item.notes ?? '',
    pools: scopeCell(item),
  };

  return INVENTORY_EXPORT_FIELDS.map((field) => values[field]);
}

/**
 * The workbook itself.
 *
 * Every cell is written as text, the count included. A number-typed count is
 * harmless in Excel and is read back correctly either way, but keeping one rule
 * for the whole file means there is no cell type to reason about when somebody
 * adds a column later.
 */
export async function inventoryWorkbook(
  headers: string[],
  items: InventoryItem[],
  sheetName: string,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Poolse';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  const heading = worksheet.addRow(headers);
  heading.font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const item of items) {
    worksheet.addRow(rowFor(item));
  }

  worksheet.columns.forEach((column) => {
    column.width = 24;
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
 * The same list as a CSV.
 *
 * **Semicolons, CRLF, and a byte-order mark** — all three because this file has
 * to open correctly by double-click in a Portuguese Excel, which is where it is
 * going. Commas would put the whole row in column A on a machine whose decimal
 * separator is a comma, and without the BOM every accent renders as mojibake.
 * Our own importer sniffs the delimiter and strips the mark, so the round trip
 * survives either way; Excel is the fussy one.
 */
export function inventoryCsv(headers: string[], items: InventoryItem[]): string {
  const lines = [headers, ...items.map(rowFor)].map((row) => row.map(csvCell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
