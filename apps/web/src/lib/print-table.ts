import { formatDate } from '@/lib/date-format';

/**
 * A list, as a page to print or save as PDF — Rui, 12 October 2026.
 *
 * **The PDF is the browser's.** Every list export already builds its header and
 * rows for Excel and CSV; `format=pdf` hands the same rows to this, which
 * returns one self-contained HTML page laid out for A4, and opens the print
 * dialog — where "Guardar como PDF" is the default destination on most
 * machines. No PDF library, so there is one layout per list and it cannot
 * drift from a second one (decided with Rui the same day; the calendar's own
 * print sheet is the same idea).
 *
 * **The rows are the export's rows.** What is on paper is what the spreadsheet
 * holds, filtered the same way. The one change is for a person rather than a
 * re-import: a cell that is exactly an ISO day (`2026-10-13`) is printed in the
 * product's one date shape, `13-10-2026`.
 *
 * Every value is escaped; nothing in a cell is ever markup.
 */
export interface PrintableTable {
  /** `<html lang>`. */
  locale: string;
  /** The heading on the page and the suggested file name. */
  title: string;
  /** A line under the heading — the filter, the site, how many rows. */
  subtitle?: string | undefined;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  /** "Impresso a 13-10-2026", already translated. */
  printedOn: string;
  /** The label of the on-screen button, already translated. */
  printLabel: string;
  /** Said where there are no rows, already translated. */
  emptyLabel: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cell(value: string): string {
  return escape(ISO_DAY.test(value) ? formatDate(value) : value);
}

export function printableTable(table: PrintableTable): string {
  // Wide lists turn the sheet sideways rather than shrinking the type to dust.
  const landscape = table.headers.length > 6;
  const head = table.headers.map((header) => `<th>${escape(header)}</th>`).join('');
  const body =
    table.rows.length === 0
      ? `<tr><td colspan="${table.headers.length}" class="empty">${escape(table.emptyLabel)}</td></tr>`
      : table.rows
          .map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`)
          .join('\n');

  return `<!doctype html>
<html lang="${escape(table.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(table.title)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 11px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; background: #fff; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
  h1 { margin: 0; font-size: 16px; }
  .meta { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  /* Repeated at the top of every printed page. */
  thead { display: table-header-group; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  tr { break-inside: avoid; }
  .empty { color: #555; text-align: center; padding: 16px; }
  .print { margin-bottom: 12px; padding: 8px 16px; font: inherit; font-size: 13px; cursor: pointer; }
  @media print { .print { display: none; } body { padding: 0; } }
</style>
</head>
<body>
<button type="button" class="print" onclick="window.print()">${escape(table.printLabel)}</button>
<header>
  <div>
    <h1>${escape(table.title)}</h1>
    ${table.subtitle === undefined || table.subtitle === '' ? '' : `<div class="meta">${escape(table.subtitle)}</div>`}
  </div>
  <div class="meta">${escape(table.printedOn)}</div>
</header>
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
<script>window.addEventListener('load', function () { window.print(); });</script>
</body>
</html>
`;
}

/** The response every list export returns for `format=pdf`. */
export function printableResponse(table: PrintableTable): Response {
  return new Response(printableTable(table), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
