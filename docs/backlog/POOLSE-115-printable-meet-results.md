# POOLSE-115 · Competição: a printable PDF of a meet's results

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Competition · **Priority:** Medium (pilot) · **Depends on** [POOLSE-81](./POOLSE-81-competition-pathway-and-meet-results.md) · **Related** [POOLSE-114](./POOLSE-114-results-by-email-and-how-to-get-the-file.md), [POOLSE-54](./POOLSE-54-exporting-the-grid.md)

### PO — why this exists

Rui, 23-10-2026: the FPN file *"is converted by Poolse to be read and exported via PDF"*, and then: *"yes, it should be a printable PDF."*

The import (POOLSE-81) turns a LENEX file into times on each student's record and a meet page listing them. What the club pins on the wall, hands to a parent, or sends to the direção is a sheet: **this meet, our swimmers, their times, who set a personal best, who qualified**. That sheet does not exist yet; people screenshot the page.

**What exists.** `provas/[id]/page.tsx`: meet header (name, date, course, official/friendly, imported from which file when), one results table (swimmer, event, time, notes — personal best, no licence), the unmatched-athletes box. The app's PDF path is **browser print on a dedicated route**: `facilities/pools/[poolId]/report` + `print-button.tsx`, also `incidents/[id]/print`, `calendar/print`. POOLSE-54 says follow it and never introduce a second PDF technology.

**Not in scope:** a server-rendered PDF; relays; a season-wide report across meets (later, with the pathway work); the organiser's full results (other clubs) — the sheet is *our* swimmers.

### BA — rules

1. **One button on the meet page:** *Imprimir / Guardar PDF*, in the page actions next to *Arquivar*. Opens `provas/[id]/print` in a new tab and triggers the print dialog, like the pool report. Any management login may print; nothing is written.
2. **The sheet, A4 portrait:**
   - Header: club name and logo (when set), meet name, date(s), city/pool when the file carries them, course (25 m / 50 m), *Oficial* / *Amigável*, number of swimmers and of results. Footer: *Gerado pelo Poolse em {data hora}* and page `n / N`.
   - Body grouped **by swimmer** (surname, first name — POOLSE-32), swimmers in alphabetical order; within a swimmer, events in FPN order (stroke × distance). Columns: *Prova*, *Tempo*, *Escalão* (when the file has it), *Obs.*
   - *Obs.* holds, as text, what the screen shows with colour: **RP** for a personal best, **Mín.** when the time meets a qualifying standard the season has (POOLSE-85), the status for skipped-but-listed results if any (DSQ, DNS). Colour may be printed, but the mark must survive greyscale — same rule as POOLSE-54.
   - A swimmer's block never splits across pages when it fits on one; a group header repeats on a continued page.
   - The unmatched-athletes box is **not** on the sheet; a one-line note at the bottom says *N resultados do ficheiro não foram associados a alunos* when N > 0, so the reader knows the sheet is not the whole file.
3. **Options before printing** (small bar at the top of the print route, hidden when printing): *Todos os nadadores* / *Só com recorde pessoal* / *Só com mínimos*; and *Agrupar por nadador* / *Agrupar por prova*. Default: all, by swimmer. The choice lives in the URL so the tab can be reloaded and shared.
4. **Empty states:** a meet with no matched results prints the header and *Sem resultados associados*; with the filter leaving nothing, the sheet says which filter emptied it.
5. **The screen table is not the sheet.** The print route renders its own components (tokens for print: black text, no surface tints, hairline borders), not the interactive page with a `@media print` patch — POOLSE-54's warning, repeated because it is the thing most likely to be got wrong.

### Dev notes

- Route `provas/[id]/print/page.tsx` + reuse `print-button.tsx` from the pool report (move it to `components/` if it is still local to that route). Server component; reads the same meet query as the detail page.
- Personal best and qualifying marks: the detail page already computes PB; the *Mín.* mark reuses the gap-to-qualify lookup from POOLSE-85 (one call per meet, not per row).
- Club logo: tenant logo already exists (fatura settings, POOLSE-104); print it from the same source.
- Page breaks: `break-inside: avoid` on the swimmer block, `thead { display: table-header-group }` for repeated headers. Footer page numbers via `@page` counters; if the browser ignores them (Safari), print without — not a blocker.
- No migration. No new endpoint.
- Both languages (the sheet prints in the user's locale), light theme only on paper — the route forces light.

### QA — scenarios

1. **Given** a meet with 12 swimmers, **when** I press *Imprimir / Guardar PDF*, **then** a new tab opens with the sheet and the print dialog; saving as PDF gives A4 pages with header, grouped swimmers, footer with page numbers.
2. **Given** a swimmer with a personal best, **then** the row shows **RP** as text, visible in a greyscale print.
3. **Given** *Só com mínimos*, **then** only swimmers with at least one qualifying time appear, and the URL carries the option.
4. **Given** *Agrupar por prova*, **then** events are the groups and swimmers the rows, ordered by time within each event.
5. **Given** a meet whose file had 3 unmatched athletes, **then** the sheet ends with the one-line note; the unmatched box itself is absent.
6. **Given** a meet with no matched results, **then** the empty-state sheet.
7. Cross-tenant: `provas/<other tenant's id>/print` returns 404.
8. pt-PT and en; the sheet reads correctly on paper with colour and in greyscale.

### Acceptance criteria

1. One button, one print route, A4 sheet with header, grouped results, marks as text, footer.
2. The three filters and two groupings, in the URL.
3. Follows the existing print pattern; nothing new added to the stack.

### Open questions

1. Should the sheet also carry the club's **qualifying times reached per swimmer across the season** (a "mínimos" summary)? Default: no — that belongs to a season report, later.
