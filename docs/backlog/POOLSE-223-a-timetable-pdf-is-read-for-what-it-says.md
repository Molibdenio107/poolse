# POOLSE-223 · A timetable PDF is read for what it says: blocks, pools and activities, not a grid of cells

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Import / AI readers · **Priority:** High (pre go-live) · **Depends on** [POOLSE-57](./POOLSE-57-importing-the-wall-timetable.md), [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md), [POOLSE-137](./POOLSE-137-ai-readers-per-club.md)

### PO — why this exists

> "It seems to be very difficult for the AI to read a pdf document such as the one uploaded. We need
> to have this really well prepared because we dont know of what types of 'horarios's can be out
> there." (Rui, 11-11-2026) — "yes we need this before the pilot please."

*Importar horário* reads a PDF by asking the model to **copy the table as a grid of cells**
(`lib/pdf-table-agent.ts`), then `readTimetableGrid` (`lib/timetable-grid.ts`) looks for a row of
weekdays, a column of times and one booking per cell. A real municipal timetable
(`horario_piscinas_vale_serrado.pdf`, the first entry of the test corpus below) breaks every one of
those assumptions:

- **Blocks span hours.** *Natação Livre (6 pistas)* is one merged cell from 10:00 to 13:00. As a
  grid it becomes one hour, or three, or lands in the wrong row.
- **Two activities share a cell, by lane count.** *Hidroginástica (3 pistas) / Natação Livre (3
  pistas)* is two bookings splitting six lanes, and it is read as one booking with a strange name.
- **"Encerrado" is not a class**, and it was read as one.
- **One file, two pools.** Page 1 is the 25 m pool and page 2 the learner pool. Both were imported
  into the one pool chosen in the dialog, and two full timetables in one tank clash everywhere,
  which is most of the conflicts Rui saw.
- **Noise.** A colour legend, a footer and a whole page of prices.

The fix is to ask the model for **the answer, not the table**. It sees the rendered page (merged
cells, colours, headings) and returns rows of meaning: which pool, which day, from when to when,
what activity, how many lanes, or closed. Then a short confirmation step, like the column mapping
every other importer has, says which Poolse pool each source pool is and what each activity
becomes. Then the existing preview and conflict dialog, unchanged. Because nobody knows what
timetables clubs will bring, a **test corpus** of varied fictional timetables, each with its
expected reading, is part of the ticket and gates every later change to the reader.

**Not in scope:**

- **Creating turmas.** Moved to [POOLSE-224](./POOLSE-224-an-imported-timetable-is-previewed-on-the-calendar-and-creates-turmas.md)
  (Rui, 11-11-2026), which reverses POOLSE-57's call and adds *Turma* to this ticket's activity
  select. This ticket keeps *Evento* as the default until 224 lands.
- **Partnership groups.** *Clube – Treino* or *Escolas (curricular)* become eventos too. A parceria
  needs its contract first (POOLSE-105), which a timetable does not carry.
- **Prices, opening hours and notes** on a tariff page (page 3 of the example) are ignored, not
  imported anywhere.
- **The drop-anywhere tickets** (POOLSE-219 to 222). This reader is reached from *Importar horário*
  only.
- **Spreadsheets.** `.xlsx` and `.csv` keep today's grid reader. A spreadsheet's cells are already
  cells, and there is no model call to make (cost rule).

### BA — rules

1. **One model call per file, returning rows of meaning.** Structured output (`output_config.format`,
   JSON schema), never a forced tool call (the current Opus refuses it). Each row is
   `{ sourcePool, weekday, start, end, activity, lanes, closed }`:
   - `sourcePool`: the pool or tank as the document names it (a page title, a column group, a
     heading such as "Piscina de 25 m"). Empty when the document names none.
   - `weekday` 1–7, ISO (Monday 1).
   - `start` / `end`: HH:MM as printed. **A block spanning several printed hours is one row from its
     first start to its last end.**
   - `activity`: the activity's name as printed, without the lane count ("Hidroginástica", not
     "Hidroginástica (3 pistas)").
   - `lanes`: the lane **count** when the document gives one, else null. Lane **names** ("Pista 2",
     "1-3") go in `laneNames` instead, as today.
   - `closed`: true for *Encerrado* / *Fechado* / closed blocks, which have no activity.
2. **A cell with two activities is two rows** with the same day and times, each with its own lane
   count.
3. **The model transcribes; it never decides.** It does not match activities to turmas, pick lanes,
   or drop rows it finds odd. Ignoring legends, footers, prices and opening-hour tables is part of
   reading. Everything else is the person's call in the next step.
4. **Mapping step, after reading and before the preview** (in the existing dialog):
   - **Pools.** Each distinct `sourcePool` gets a select with the site's pools plus *Não importar*,
     preselected when its name matches one pool (same matcher as lane names). A file with no
     `sourcePool` uses the pool chosen in step zero, as today.
   - **Activities.** Each distinct `activity` gets a select: *Evento* (default, as today), *Natação
     livre* (a `free_swim` booking, POOLSE-68) or *Não importar*. The list shows how many rows each
     activity has.
   - **Closed blocks** are listed as one line, *N blocos encerrados não são importados*, and never
     become bookings (Decided 2, Rui 11-11-2026).
5. **Lane counts become lanes, placed and editable.** For each pool, day and hour, rows with a count
   are placed on the pool's lanes in document order, first N lanes to the first activity, the next N
   to the next. A count larger than the pool's lanes is a warning on the row ("6 pistas, a piscina
   tem 4"), and the row takes all lanes. A row with neither a count nor names is laneless, as today
   (POOLSE-56: a laneless class may go into a full hour). The preview shows the placed lane names,
   and changing them is the existing row edit.
6. **Then POOLSE-57 unchanged:** preview, the conflict dialog (decisions 1 and 2), nothing written
   while a conflict is unresolved, one transaction. A row's conflicts are checked against its
   mapped pool.
7. **Natação livre rows are `free_swim` bookings** (`class_schedule.kind = 'free_swim'`, POOLSE-68)
   with the activity name as the title, published season only, the same rules as creating one by
   hand (Decided 1, Rui 11-11-2026).
8. **The season is the published one.** Validity dates printed in the document ("em vigor de 14 de
   setembro a 30 de junho") are shown in the preview header as read, never applied (Decided 3,
   Rui 11-11-2026).
9. **Cost and switches unchanged.** The same `pdf_table` reader, the same platform switch and club
   tick, one claim per file through `metered`. Images (JPEG/PNG, a photographed wall sheet) are
   accepted by the same reader. A failure says why, through `classifyAiError` (11-11-2026).

**Decided 1 (Rui, 11-11-2026):** *Natação Livre* blocks become `free_swim` bookings that hold their
lanes (POOLSE-68's block), preselected for activities named *Natação livre* / *Nado livre* / *Livre*.

**Decided 2 (Rui, 11-11-2026):** *Encerrado* blocks are ignored, with the count shown. A weekly
closed hour is not a dated closure (POOLSE-84), and the facility's hours already say when the pool
is shut.

**Decided 3 (Rui, 11-11-2026):** the document's validity dates are only shown. The bookings go into
the published season, which is organization-scoped and already built, so a screen picks from it
and never keeps its own.

### Dev notes

- **New reader module** `apps/web/src/lib/timetable-reader-agent.ts` beside `pdf-table-agent.ts`,
  with the same shape: `metered('pdf_table', …)`, streamed `finalMessage()`, `claude-opus-5-5` (env
  `POOLSE_PDF_TABLE_MODEL` overrides), server-side `fallbacks: 'default'`, `stopFailure` /
  `classifyAiError` from `lib/ai-failure.ts`. Load the `claude-api` skill before writing it. The
  system prompt carries rules 1–3 with two short examples (a spanning block, a two-activity cell).
  No new `ai_reader` enum value. It is the same switch the club already ticked for PDF lists.
- **Where it plugs in:** `readTimetableAction` (`calendar/import/import.actions.ts`) branches by file
  type. A PDF or image goes to the new reader and returns `TimetableReading` rows. A spreadsheet
  keeps `readSheet` + `readTimetableGrid`, converted into the same row shape (`sourcePool` empty,
  `lanes` null), so the mapping step and everything after it is one path.
- **Rows to the API.** `RawTimetableRow` (`apps/api/src/facilities/timetable-import.ts`) gains an
  optional `poolId` per row (the mapped pool), `kind: 'evento' | 'free_swim'` and the placed
  `laneNames`. `runTimetableImport` checks each row against its own pool. A row's pool must be the
  site's (404 otherwise, as today for the request-level `poolId`), and the request-level `poolId`
  stays the default for rows without one. `MAX_TIMETABLE_ROWS` still applies.
- **Free swim** goes through the same insert as `createFreeSwim` in `bookings.repository.ts` (its
  rules: published season, this site's lanes), not a second path.
- **Lane placement already exists** (built 11-11-2026 for the grid reader): `readLaneCount` and the
  placement inside `previewTimetable` (`apps/api/src/facilities/timetable-import.ts`) take "3 pistas"
  to side-by-side free lanes, and a row with none goes to *Sem pista*. Feed it the reader's `lanes`
  count and reuse it; do not write a second placement.
- **Test corpus:** `apps/web/test-fixtures/timetables/`, one folder per case with the file and
  `expected.json` (the rows of rule 1). Ship at least these: Vale Serrado (two pools, spans,
  two-activity cells, Encerrado, tariff page), a one-pool grid with lane names ("Pista 1-3"), a
  list layout (day, time, activity per line), a week as columns of time ranges, a photographed wall
  sheet (JPEG), and a Word-exported PDF with a legend above the grid. All fictional, generated for
  the corpus.
  - A script `pnpm timetable:eval` (`apps/web/scripts/eval-timetables.mjs`) reads each file with the
    real reader, compares with `expected.json` (row-level precision and recall, spans exact, lane
    counts exact) and prints a table.
  - **It calls the model and costs money:** never in CI, run by hand before a reader change ships,
    and the result is recorded in the PR. The pass bar is every expected row found, and no
    *Encerrado* or legend row imported.
- **Traps:**
  - POOLSE-57 matched lanes across the site until 02-11-2026. Every new path takes the row's pool,
    never the site's.
  - A two-activity cell placed lane-by-lane must not clash with itself in the conflict check (same
    day and time, disjoint lanes).
  - The structured-output schema must allow `lanes: null` and `laneNames: []` together, or the
    model invents counts.
- **Messages:** pt-PT and en for the mapping step, the closed-blocks line, the lane-count warning and
  the read validity dates. No new failure messages (`ai.failure.*` covers them).
- **Docs:** `docs/features/calendar.md` (the import section), `docs/conventions/importers-and-exports.md`
  (a document importer that reads meaning, not cells), `docs/data-model.md` only if `class_schedule`
  changes. It should not change.

### QA

1. **Given** the Vale Serrado PDF and a site with two pools named *Piscina principal* and *Piscina
   de aprendizagem*, **when** it is read, **then** the mapping step lists two source pools,
   preselected to those two, and the tariff page produces no row.
2. **Given** that reading, **then** Monday's *Natação Livre (6 pistas)* is one row 10:00–13:00 on
   the 25 m pool, not three rows and not one hour.
3. **Given** Monday 07:00–08:00 *Hidroginástica (3 pistas) / Natação Livre (3 pistas)* on a 6-lane
   pool, **then** the preview shows two rows, Hidroginástica on lanes 1–3 and Natação Livre on
   lanes 4–6, and the conflict check reports no clash between them.
4. **Given** the *Encerrado* blocks, **then** none appears as a row, and the step says how many were
   left out.
5. **Given** *Natação Livre* mapped to *Natação livre*, **when** imported, **then** those bookings
   are `kind = 'free_swim'` with their lanes held, and *Hidroginástica* mapped to *Evento* is an
   evento with that title.
6. **Given** a source pool mapped to *Não importar*, **then** none of its rows is previewed or
   written.
7. **Given** a 4-lane pool and a row saying 6 pistas, **then** the row warns and takes lanes 1–4.
8. **Given** an `.xlsx` timetable, **then** no model call is made (no `ai_read` row) and the
   mapping step still appears with one pool and its activities.
9. **Given** the PDF reader switched off for the club, **then** a PDF is refused with
   `import.pdfDisabled` and a spreadsheet still imports.
10. **Given** an API key the API rejects, **then** the dialog says `ai.failure.keyRejected` and the
    server log names the cause.
11. **Permission:** an instructor calling the import endpoint with mapped rows is refused (403), as
    today. A role-probe line exists for any new route.
12. **Cross-tenant:** a row whose `poolId` is another club's pool is refused (404) and nothing is
    written.
13. **Conflicts unchanged:** with an existing booking on lane 2 at Monday 07:00, the import stops in
    the conflict dialog until that row is dropped. Nothing is written before.
14. **Both themes:** the mapping step in light and dark mode, contrast-checked. Keyboard only: every
    select reachable and labelled.
15. **Corpus:** `pnpm timetable:eval` reports every expected row found for each case, with no
    *Encerrado* or legend row read as an activity.

### Acceptance criteria

- [x] A PDF or image timetable is read into rows of meaning (rule 1) by one metered call, through
      `classifyAiError` on failure.
- [x] Spanning blocks are one row, two-activity cells are two rows, *Encerrado* is never a booking,
      and legends, footers and price pages produce nothing.
- [x] The dialog maps each source pool to a Poolse pool or *Não importar*, and each activity to
      *Evento*, *Natação livre* or *Não importar*, before the preview.
- [x] Lane counts are placed on the mapped pool's lanes by a tested `@poolse/rules` function, and
      the preview shows them.
- [x] The import writes per-row pools and kinds in one transaction, with POOLSE-57's conflict rules
      intact.
- [x] Spreadsheets take the same mapping path with no model call.
- [x] The test corpus (at least six cases, Vale Serrado first) and `pnpm timetable:eval` exist, and a
      recorded run passes before the ticket closes.
- [x] pt-PT and en strings, both themes, keyboard reachable. Docs updated in the same commit.
- [x] Decisions 1–3 applied as written.
