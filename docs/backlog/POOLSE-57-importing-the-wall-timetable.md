# POOLSE-57 · Importing the wall timetable

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Import · **Priority:** High — it is the onboarding path for the whole scheduling module

### PO — why this exists

A club arriving at Poolse already has its timetable. It is the sheet on the wall, and it is not a
list — it is a **grid**: days across the top, times down the side, class names in the cells, one
block spanning three lanes where the squad swims. Fourteen slots by five days is seventy cells, and
typing them into a web form is the reason a club keeps using the spreadsheet.

POOLSE-48 deferred this with a condition — *"revisit once POOLSE-51 exists"* — because an importer
that silently created forty conflicting bookings would be worse than forty drags. POOLSE-51 exists,
and `packages/rules` now evaluates a placement against the grid for both apps. The condition is met.

**Not in scope:** importing students, partners or the inventory — three importers already do those.
This one brings in *bookings*.

### BA — rules and data

**The file is a grid, not a table, and that is the whole difficulty.** There are no columns to map:
`Segunda` is a heading, `06:30` is a heading, and `Masters (1-3)` in the cell between them is a
booking. A club's own sheet also carries merged cells, blank rows, a title above the grid, a legend
below it, and lanes written as `1-3`, `1,2,3` or `Pista 1 a 3`.

**Two decisions, taken by Rui on 2026-09-04 and not to be re-opened:**

1. **Nothing is written while a conflict is unresolved.** The commit is refused — not partially
   applied, not applied with warnings — until every clash has a decision. A half-imported timetable
   is worse than none, because the operator cannot tell which half.
2. **A clash is resolved in a dialog, never by overwriting.** When two lessons want the same time,
   the import stops and shows a popup **listing each conflict specifically** — what is coming in,
   what is already there, and why they collide — and the operator decides what happens to each. It
   is never "last one wins", and the operator is never sent back to Excel to fix it.

Those two together mean: the commit button stays blocked while conflicts remain, and the dialog is
the tool for clearing them. The file is refused; the operator is not.

**What a conflict is** — `packages/rules` already names them, and the import uses the same list so
the preview and the grid can never disagree: `laneTaken`, `instructorElsewhere`, `dayClosed`,
`outsideHours`, `lanesNotContiguous`, `overCapacity`, `overConcurrency`, `weekdayDisabled`.

**Rows collide with each other, not only with the grid.** Two rows of the same file wanting lane 2
at 19:15 is the commonest clash of all, and evaluating each row against the database alone would
miss every one of them.

**Names, not ids.** The file says `Pista 2` and `Sandra`; the club's database has uuids. Everything
resolves by name, accent- and case-insensitively, against that facility — an unmatched name is a
row the operator has to answer for, never a silent null.

### Dev — implementation notes

- **Three layers, and only the middle one is new.** The file reader is `lib/read-sheet.ts`. The
  conflict engine is `packages/rules`. What this adds is the part that turns a *grid* into flat
  booking rows and evaluates them as a set.
- **The agent reads the layout, not the columns.** `matchFields` is the wrong tool here — there are
  no column headings to match. A model is given the sheet's shape and returns candidate bookings.
  It follows the three rules `students/import/match-agent.ts` already establishes: **optional** (no
  key, no call, the importer still works from the deterministic reader), **it never sees personal
  data** it does not need, and **it cannot say "certain"** — every row it proposes is previewed
  before anything is written.
- **Most likely to be got wrong:** evaluating rows against the database and forgetting they also
  collide with each other. Build the context as *existing bookings + rows already accepted*, and
  evaluate each row against that growing set.
- Second: the deterministic reader must be good enough alone. A club whose sheet is tidy should
  never need the model, and the model's absence must degrade to "map these columns yourself"
  rather than to "import unavailable".
- The commit is one transaction, as every other importer's is.
- **POOLSE-56 is unbuilt and relevant.** An import is precisely how a club would blow past lane
  capacity, and `overCapacity` is a warning rather than a block today.

### QA — test scenarios

- **57.1** Given a wall grid with days across and times down / When read / Then every cell becomes a booking with its day, time and lanes.
- **57.2** Given a cell reading `Masters (1-3)` / When read / Then the lanes resolve to Pista 1, 2 and 3.
- **57.3** Given two rows of one file wanting lane 2 at 19:15 / When previewed / Then both are reported as colliding **with each other**, not only with the grid.
- **57.4** Given a row colliding with a booking already on the grid / When previewed / Then it names the booking it collides with.
- **57.5** Given any unresolved conflict / When commit is attempted / Then nothing is written and the count of unresolved conflicts is stated.
- **57.6** Given the conflict dialog / When the operator decides every clash / Then the commit proceeds and writes exactly what the preview showed.
- **57.7** Given a lane name matching nothing at the site / When previewed / Then the row is refused with a named cause, never imported with no lane.
- **57.8** Given an instructor name matching nothing / When previewed / Then the booking imports with no instructor and a warning — a name Poolse does not know is not a reason to lose the class.
- **57.9** Given a commit that fails part way / When it rolls back / Then no booking and no lane row survives.
- **57.10** Given no `ANTHROPIC_API_KEY` / When a grid file is imported / Then the deterministic reader still offers what it can and says the layout reader is unavailable.
- **57.11** Given an instructor / When they POST to the import endpoint / Then it is refused.
- **57.12** Given tenant A's file committed under tenant B / When checked / Then everything created belongs to B.

### Acceptance criteria

1. A wall-grid spreadsheet — days across, times down — is read into candidate bookings with their day, time, duration and lanes.
2. Every candidate is evaluated against **both** the existing grid and the other candidates, using `packages/rules` rather than a second copy of the conflict logic.
3. Nothing is written while any conflict is unresolved; the commit states how many remain.
4. Conflicts are resolved in a dialog that lists each one specifically — what is arriving, what is already there, and why they collide — and never by overwriting.
5. The commit is one transaction, and writes exactly what the preview showed.
6. Names resolve accent- and case-insensitively; an unmatched *lane* refuses its row, an unmatched *instructor* is a warning.
7. The layout reader is optional: without a model the importer still works and says so.
8. Import is owner/admin, enforced in the API.

---

## Raised 2026-09-04

Rui asked whether a Calendar import made sense given every tenant's format differs, and whether an
agent would help. The answers, recorded because they shape everything below:

- **Format variance is the reason the staged pipeline exists**, not an objection to it. Three
  importers already read real messy files.
- **An agent is not worth it for columns.** A timetable's headings are `Dia`, `Hora`, `Turma`,
  `Pista` — the heuristic in `lib/sheet.ts` places them, and `lib/booking-sheet.ts` already carries
  the vocabulary, built by POOLSE-54 so the exported `Marcações` sheet round-trips.
- **An agent is worth it for the layout**, which is the actual shape of a club's file and which no
  column matcher can touch.

---

## Where this stopped — 2026-09-04

**The conflict core is built and tested. The layout reader, the dialog and the
commit are not.** Split at a layer boundary: the model is where both of Rui's
decisions live, and everything above it is worthless if this is wrong.

### Done

`apps/api/src/facilities/timetable-import.ts` — pure, no database, 16 tests:

- Rows judged against **the existing grid plus every earlier row of the same
  file**, which is the thing the ticket names as most likely to be got wrong.
- Every clash names **both sides** and says whether the other party is on the
  grid or is line N of this file — decision 2's raw material.
- `committable` as a single boolean the commit will read, so decision 1 cannot
  be half-implemented by a caller that forgot a case.
- Lane cells read the way clubs write them: `1-3`, `1 a 3`, `1,2,3`, `Pista 2`.
- An unmatched **lane** refuses its row; an unmatched **instructor** is a
  warning and the class still lands.

### The finding worth keeping

**`packages/rules` marks `weekdayDisabled` a warning, and the import escalates
it.** That is right for the grid — a person is watching one drag, and a soft
edge lets them place a block on a day they are about to open. It is wrong for an
import: the facility-hours trigger raises `facility_closed_on_weekday` as a
check violation, so a preview calling that row committable would promise a
commit the transaction then refuses. The half-imported timetable, arrived at
from the other side.

`REFUSED_BY_DATABASE` in the module is that list, with the reason written above
it. Anything added to `packages/rules` as a warning that the schema actually
refuses belongs in it.

### Still to do

- The **layout reader** — the grid-shaped sheet into `RawTimetableRow[]`. The
  deterministic pass first, then the agent for the sheets it cannot read.
- The **conflict dialog** — decision 2's interface. The data it needs is already
  on every clash.
- **Commit**, one transaction, refusing on `committable === false`.
- The endpoint, owner/admin, and its integration tests.
