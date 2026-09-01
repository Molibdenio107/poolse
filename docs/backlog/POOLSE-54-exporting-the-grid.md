# POOLSE-54 · Exporting the grid — PDF and Excel

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Export · **Priority:** Medium

### PO — why this exists
The printed sheet **is** the product, as far as the club is concerned. It goes on the wall by the
office, it goes to the school, it goes home with the head coach. A scheduler that cannot produce it
has moved the club's work into a computer and left the artefact behind — so they keep the
spreadsheet, and Poolse becomes the second place the schedule lives.

The requirement is therefore not "a PDF export". It is: **this must be readable when printed and
pinned to a wall**, verified against a real render rather than asserted.

**Not in scope:** emailing it, and any scheduled or automatic generation.

### BA — rules and data

**PDF**
- Landscape, **A4 and A3**. A3 is not a luxury: fourteen slots × six lanes × five days at a legible
  size does not fit A4 for a large club, and the honest options are a second page size or a font
  nobody can read from a metre away.
- Contents: title (facility + época), the weekday grid, the weekend block, a colour legend, and
  headcounts.
- Reproduces the compact density. This is the one place where the dense layout is not a preference.
- Colour is printed, but the sheet must survive **greyscale** — the group name, instructor and
  headcount are text in every cell, and the legend is text. A club will photocopy this.
- Honours the active filters and is scoped to a season. Exporting a filtered grid produces a sheet
  that says what it was filtered by, in the header — otherwise somebody pins up half a timetable
  believing it is all of it.
- Uncovered slots print as `Sem professor` in the alert colour **and** with a mark that survives
  greyscale.

**Excel**
- Two sheets in one workbook:
  1. **`Horário`** — the grid as a grid, matching the PDF's shape, for somebody who wants to fiddle
     with it in Excel.
  2. **`Marcações`** — flat, one row per booking, so it can be **re-imported**. Its header row is the
     import's own field labels, the same contract the register and the inventory already keep.
- The flat sheet is what makes the export more than a picture: a club can plan next season in Excel
  and bring it back.

### Dev — implementation notes
- There is already a PDF path in the app — `facilities/pools/[poolId]/report` — so follow whatever it
  established rather than introducing a second PDF technology. Check it first; if it is
  browser-print-based, this is a print stylesheet and a dedicated route, which is also the cheapest
  thing that produces a genuinely faithful grid.
- **Most likely to be got wrong:** treating this as "the screen, printed". The screen has sticky
  rails, a scroll container, hover states and a density toggle; the sheet has a fixed page, repeating
  headers on page 2, and no interaction. Build a **separate render** that shares the data query and
  the cell component, not a `@media print` patch over the interactive grid.
- Second: page breaks. A slot's six lane rows must not split across pages. `break-inside: avoid` on
  the slot group, and the day header repeated at the top of each page.
- Third: the Excel grid sheet. Merged cells for a multi-lane booking are what make it look like the
  PDF, and merged cells are also what make a sheet hostile to re-import — which is exactly why the
  flat `Marcações` sheet exists beside it. Do not try to make one sheet do both.
- The workbook writer is `exceljs`, already in the project, `server-only`, with the conventions
  already settled in `students/export/write-sheet.ts` and the inventory's: BOM for CSV, semicolons,
  every cell a string, frozen header row.
- Both exports are route handlers returning a file, not server actions — the answer is a file, so the
  button is an ordinary link and works with no JavaScript.
- Filters travel in the query string, so an exported sheet is reproducible from its URL.

### QA — test scenarios
- **54.1** Given the reference season / When exported to A3 landscape PDF / Then all fourteen weekday slots, all six lanes and the weekend block are on the sheet.
- **54.2** Given that PDF / When printed and read from a metre away / Then group, instructor and headcount are legible. (A physical check; record the result.)
- **54.3** Given that PDF printed in greyscale / When read / Then every category is still identifiable from the legend and the cell text, and uncovered slots are still identifiable.
- **54.4** Given a grid filtered to one instructor / When exported / Then the header states the filter.
- **54.5** Given a slot whose six lane rows fall at a page boundary / When rendered / Then the whole slot moves to the next page rather than splitting.
- **54.6** Given page 2 of the PDF / When rendered / Then the day headers repeat.
- **54.7** Given a multi-lane booking / When exported to PDF / Then it spans its lane rows as one block.
- **54.8** Given the Excel export / When opened / Then it has a `Horário` sheet shaped like the grid and a `Marcações` sheet with one row per booking.
- **54.9** Given `Marcações` / When re-imported / Then every column maps itself with no dropdown touched, in both pt-PT and en.
- **54.10** Given a Portuguese Windows machine / When the CSV form is opened by double-click / Then accents render correctly and the columns split.
- **54.11** Given a draft season / When exported / Then the sheet says it is a draft.
- **54.12** Given an instructor / When they export / Then it is allowed for the grid and refused for anything carrying contracted value.
- **54.13** Given tenant A's season id / When tenant B requests its export / Then it is refused.
- **54.14** Given pt-PT and en / When both exports run / Then headers, day names, the legend and the filter statement are in the requested locale.
- **54.15** Given the export URL with its filter query / When opened again a day later / Then it reproduces the same sheet.

### Acceptance criteria

1. PDF export, landscape, in both A4 and A3, reproducing the compact grid with title, weekday grid, weekend block, colour legend and headcounts.
2. The PDF is verified against a real print, at both page sizes, and the result is recorded in the ticket rather than assumed.
3. The sheet survives greyscale: every cell's meaning is available as text, and uncovered slots carry a non-colour mark.
4. A slot's lane rows never split across a page break, and day headers repeat on every page.
5. Exports honour the active filters and are scoped to a season; a filtered export states its filter in the header, and a draft season is labelled as such.
6. Excel export contains a grid-shaped `Horário` sheet and a flat `Marcações` sheet with one row per booking.
7. `Marcações` uses the import's own field labels as its header row, and a round trip maps itself in both locales — proven by a test against the real catalogue.
8. The print render shares its data query and cell component with the screen but is a separate render, not a print stylesheet over the interactive grid.
9. Both exports are route handlers returning files, working without JavaScript, and reproducible from their URL.
10. Exports carrying contracted partnership value are owner/admin; the plain grid export is not restricted.
11. The existing PDF approach in the repo is reused rather than a second PDF technology being introduced.
