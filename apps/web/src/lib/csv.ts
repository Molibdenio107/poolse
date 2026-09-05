/**
 * The one place a CSV cell is written.
 *
 * There were four copies of this function — the register's export, the
 * calendar's, the inventory's, and a fourth inline in `water-actions.tsx`. All
 * four escaped the delimiter correctly and none of them escaped a formula, which
 * is the whole reason this file exists rather than a fifth copy.
 *
 * **A CSV cell is not inert.** A value beginning `=`, `+`, `-` or `@` is a
 * *formula* to Excel, LibreOffice and Google Sheets — not text that happens to
 * start with a symbol. `=cmd|'/c calc'!A0` in a student's name field is a DDE
 * payload that runs when an admin double-clicks the export, and the operator who
 * opens it is the one person in the club with every permission. The club never
 * typed it: it arrives through the import wizard, in the spreadsheet a new
 * customer brings from whatever system they used before, and rides through to
 * the next export untouched.
 *
 * The fix is the boring one, and deliberately: prefix a leading formula
 * character with an apostrophe, which every spreadsheet reads as "the rest of
 * this cell is text". No parsing, no cleverness about which formulas look
 * dangerous, no list of payload shapes to keep up with.
 *
 * **What it costs.** A cell that legitimately begins with one of those four
 * characters gains a visible apostrophe when a *non*-spreadsheet reads the file.
 * In this data that is close to never: Portuguese telephone numbers are stored
 * as nine bare digits, taxpayer numbers as nine more, and names, dates and
 * emails cannot start with any of them. `readCsvCell` below undoes it, so a file
 * exported from Poolse and imported back into Poolse round-trips exactly — which
 * is the trip `sheet.test.ts` asserts and the one that actually happens.
 *
 * The `.xlsx` half needs none of this. ExcelJS writes a string as a string cell;
 * only an explicit `{ formula }` becomes a formula, and nothing here passes one.
 */

/**
 * The characters a spreadsheet treats as "a formula starts here".
 *
 * `=` and `@` are the obvious two. `+` and `-` are the ones people leave out and
 * should not: `+cmd|'/c calc'!A0` is the same attack as the `=` version, and
 * Excel accepts it. Tab and carriage return are here because Excel strips
 * leading whitespace before deciding, so `\t=cmd...` is `=cmd...` by the time it
 * matters.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A value that needs the apostrophe: a formula, **or** something already
 * starting with an apostrophe.
 *
 * The second half is not fussiness, it is what makes the escape reversible. The
 * apostrophe is both our escape character and legal data — `'89` for a school
 * year, and any name a club types with one in front — so an escape that ignored
 * a leading apostrophe would make `'=1+1` and `=1+1` export identically, and the
 * reader could not know which one to hand back. Escaping it too keeps exactly
 * one apostrophe of difference between them, which is enough to undo.
 */
const NEEDS_ESCAPING = /^['=+\-@\t\r]/;

/** The delimiter, the quote and the line breaks — the characters that need quoting. */
const NEEDS_QUOTING = /[";\r\n]/;

/**
 * One CSV field: never a formula, quoted only where it has to be.
 *
 * Order matters. Neutralise first, quote second — a value quoted first would
 * still be `"=cmd|..."` inside the quotes, and quotes are not what stops a
 * formula. Excel strips the quotes and evaluates what is left.
 */
export function csvCell(value: string): string {
  const safe = NEEDS_ESCAPING.test(value) ? `'${value}` : value;
  return NEEDS_QUOTING.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The inverse, for the import side.
 *
 * Strips **one** leading apostrophe, and only when what follows is something
 * `csvCell` would have escaped — a formula character, or another apostrophe. So
 * `'=1+1` comes back as `=1+1`, `''89` comes back as `'89`, and both `O'Brien`
 * (not leading) and a foreign file's bare `'89` (nothing escaped behind it) are
 * left exactly as they are. Anything looser would corrupt a name to undo an
 * escape that was never applied.
 */
export function readCsvCell(value: string): string {
  return value.startsWith("'") && NEEDS_ESCAPING.test(value.slice(1))
    ? value.slice(1)
    : value;
}

/**
 * A whole CSV file: header row, data rows, ready to hand to a `Response`.
 *
 * **Semicolons, CRLF, and a byte-order mark** — the convention all three exports
 * had already settled on separately, now settled in one place. This file has to
 * open correctly by double-click in a Portuguese Excel, which is where it is
 * going: commas would put the whole row in column A on a machine whose decimal
 * separator is a comma, and without the BOM every accent renders as mojibake.
 * Our own readers sniff the delimiter and strip the mark, so the round trip
 * survives either way; Excel is the fussy one.
 */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
