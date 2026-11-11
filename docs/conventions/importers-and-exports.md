# Importers and exports

The full text of the conventions for an importer, an export or a file a club uploads. `CLAUDE.md` holds one line each; read this file before changing that area.

**A column-mapping importer uses `useImportWizard`.** The four-step machine —
upload, map, preview, commit — lives in `lib/use-import-wizard.ts`, generic over the field
type. A new importer supplies its own preview rendering and nothing else. The calendar's
(a grid layout, no columns) and the water log's (matches in the browser, no model call) are
deliberately not callers.

**A document importer is an `AnalysisReportParser`.** A file with no columns — a
laboratory's PDF, a photograph of a log — cannot have a mapping step, so it is read by a
parser that answers in the *same field names* the mapping step produces and joins the
ordinary validate–preview–commit path. Two ways in, one pipeline. Every such parser is
optional and off unless its own flag and `ANTHROPIC_API_KEY` are both set, sends the
document and nothing else about the tenant, and has everything it extracts confirmed by a
person on the preview. `lib/analysis-report.ts` is the contract; `-agent.ts` is the model. A water report's row is filed by what it holds (`reportDestination`, POOLSE-101): an organism count makes it a lab result through `/lab-results/import`, chemistry alone a reading. Since 29-10-2026 a lab result's chemistry is also a reading (`pool_analysis.lab_result_id`, written in `createLabResultIn`, archived with it by trigger), so a good report clears the warning; a file dropped on any water section is held in `lib/pending-file.ts` and read in Laboratório.

**A list importer takes a PDF by `readSheet(file, { pdf: true })`, and the PDF becomes a
spreadsheet.** 12 October 2026. `lib/pdf-table-agent.ts` transcribes the document's tables into
the same header and rows `readSheet` returns for a workbook, and the importer then maps and
previews them as it does any file. It transcribes and never interprets. It is behind
its reader's switch and tick on /admin (POOLSE-137) plus `ANTHROPIC_API_KEY`, and with it off the importer says so
(`pdfDisabled`). It is opt-in per importer: alunos, horário, parcerias, salários, inventário and mínimos
take PDFs, while the water log keeps its own lab-report parser. It uses structured output, not a
forced tool call, because the current Opus refuses `tool_choice` `tool`.

**An importer is a `MatchSpec`, never a new pipeline.** There are seven — the register, the
store room, the wall timetable, the water log, parcerias, the pay list and mínimos (whose fields are
built at read time, one per FPN age group: `lib/qualifying-sheet.ts`). A new one is a field list, a
synonym list and `matchFields` in `lib/<thing>-sheet.ts`, plus a preview/commit pair on one
API route with a `commit` flag. Never two routes: what the operator was shown and what gets
written have to come from one code path. The file is read on the Next server and never
leaves it.

**What an export writes, its importer reads back — and a test proves it against the real
catalogue.** The header row is `<thing>.field.*` from the translation catalogue, not prose
invented for the file, so a club exports, corrects and re-imports with no column mapped by
hand. Two rules fall out of it. **Any value that has to survive the journey is written in a
form that is the same in both languages** — the inventory's `all`, a partner type's own enum
spelling — because a file exported under `en` re-imports under `pt-PT`. And **a label chosen
for the export is a label the matcher must not hand to another field**: `partners.field.contactName`
is "Contacto" rather than the partner screens' "Nome", because a bare "Nome" is what claims
the entity's column. `tsc` has no opinion about either, so the guard is a round-trip test
reading `messages/*.json` from disk — `partner-sheet.test.ts` is the shape.

**A round trip changes nothing.** Exporting a list and importing it back must produce a
preview of stocktakes with nothing to update, and a commit that writes no rows. It is the
cheapest end-to-end assertion an importer has, and it fails on a dropped field, on a value
written in a shape the reader parses differently, and on the two sides disagreeing about
what one row is. `partner-export.integration.test.ts` caught one of those.

**A file of money is the one importer that commits whole or not at all, and its export
carries the contract rather than the derived figures.** Salaries — POOLSE-59. The other five
commit what they can and report the rest; a pay run's half-applied import is somebody's wage
and nothing on screen says which half, so every included row goes in one transaction and a
line the constraint refuses at the last moment rolls the lot back and names the line. The
export writes what somebody *agreed* — type, gross amount, contracted hours, pay periods,
start date — and never the monthly/hourly pair the screen shows, because one of those is
always an estimate and re-importing an estimate as an amount turns a rounding into a pay
rise. **One person twice refuses the whole file**; which row is their pay is not a guess.
**Matching is by e-mail or checksum-valid NIF and a NIF column is claimed by its heading,
never by its shape** — nine digits is also a Portuguese phone number, and a phone read as a
NIF attaches a rate to the wrong person rather than to nobody. **`parseSheetCents` normalises
a cell (symbol, thousands separator, either decimal mark; the *last* separator is the decimal
one) and hands it to `parseCents`**, which is what the typed form uses — widening `parseCents`
itself would make every price field accept "35 €", a refusal pinned by a test. The write goes
through `applyNewRate`, the same function the form calls.

**One mapping rule, one file** (Rui, 11-11-2026). A column feeds at most one field and a field takes at most one column. `lib/column-mapping.ts` is that rule: `chooseFieldForColumn` for a column view (the questions, the salary list), `chooseColumnForField` for a field view (the full grid, the water importer), and `fieldAtColumn` to read it. The trap it closes: four wizards each had their own `assign`, and their column views said *Não importar* by passing no field **and no column**, which changed nothing, so the dropdown snapped back to the matcher's guess. A new importer calls these and keeps no copy. `e2e/import-mapping.spec.ts` drives the student import in a browser and needs the seeded E2E club.

**A failed read says why, the same in every importer** (11-11-2026). `readFailureKey(failure)` in `lib/read-sheet.ts` is the one map from a read failure to its message, and a PDF the model could not read arrives as `ai.<code>` with its own sentence (`ai.failure.*`). A new importer calls it and keeps no `READ_ERRORS` of its own.
