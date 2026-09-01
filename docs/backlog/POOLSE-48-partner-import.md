# POOLSE-48 · Importing partners and their groups

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Partnerships / Import · **Priority:** Medium

### PO — why this exists
The same argument as the register: a club that cannot get its list in does not become a customer.
A school partnership arrives as a spreadsheet of class names and headcounts — `6A, 24`, `10G 11B,
31`, `11H/I, 28` — and typing forty of them into a web form is a reason to keep using the
spreadsheet. The club already has the file; the school sent it in August.

**Not in scope:** importing the schedule itself. This brings in partners and groups; where they sit
in the week is done on the grid (POOLSE-49) or comes back through the bookings sheet in the export
(POOLSE-54).

### BA — rules and data
- Full-page dropzone on the partners list, consistent with the register and the inventory: dragging
  a file anywhere on the screen imports it, and a drop asks before it reads anything.
- The same staged pipeline: **upload → parse → mapping → validate → commit**. Not a second one-off
  importer. The mapping step stays a separate stage precisely so the AI mapper can be swapped in
  later without touching the rest.
- Fields a column can be pointed at: `partnerName`, `partnerType`, `groupName`, `participantCount`,
  `levelName`, `tag`, `ownInstructorName`, `contactName`, `contactEmail`, `contactPhone`, `notes`.
- **One row is one group, not one partner.** A school's sheet has a row per class, and the partner
  name repeats down the column — so the importer groups by partner and creates each partner once.
  That is the opposite of the register, where a repeated name is a duplicate to be warned about, and
  it is the thing most likely to be got wrong here.
- A partner already at this facility is matched by name, accent- and case-insensitively, and its
  groups are added to it rather than a second partner being created.
- A group already on that partner is a **stocktake**, exactly as the inventory import treats a
  repeated item: the row shows `24 → 31` for the participant count and is unticked by default.
- `partnerType` is read the way a person writes it — "escola", "agrupamento", "IPSS", "Misericórdia",
  "jardim de infância", "JI", "clube", "câmara", "empresa" — and anything unrecognised imports as
  `outro` with a warning rather than refusing the row.
- Only `partnerName` and `groupName` are required. A sheet with no headcount column is a list of
  which classes come, which is worth having.
- Every refusal is a named cause the operator can act on, never a stack trace.
- Export: the partner list leaves as `.xlsx` and `.csv`, with the header row being the import's own
  field labels, so a club can export, edit and re-import without mapping a column.
- **Open:** should the importer also read a `weekday`/`time` column and create bookings? The reference
  file has one. *Recommendation:* no, not in this ticket — placing on the grid is where conflicts are
  visible, and an importer that silently created forty conflicting bookings would be worse than
  forty drags. Revisit once POOLSE-51 exists.

### Dev — implementation notes
- The generic half of the matcher already exists: `matchFields` in `apps/web/src/lib/sheet.ts` takes
  a `MatchSpec` and does the scoring, the abbreviation rule and the shape check. This ticket adds a
  `partner-sheet.ts` beside `inventory-sheet.ts` with the vocabulary and nothing else.
- The reader is shared too: `apps/web/src/lib/read-sheet.ts`, `server-only`, already handles every
  sheet in a workbook, hidden sheets, BOMs and date cells.
- **Most likely to be got wrong:** the grouping. The register's importer treats a repeated name as a
  duplicate; here it is the normal case. Write the validate step so a partner appearing on twelve
  rows produces **one** partner in the preview with twelve groups under it, and make the preview show
  that shape — a flat list of twelve rows saying "partner already exists" would be technically true
  and completely misleading.
- Second: `participantCount` read the way a spreadsheet writes one — "24", "24 alunos", " 24 ",
  "1,0" — the same reader the inventory import already has. Lift it rather than writing a second.
- Third: the preview must show what a commit will *create*, including partners that do not exist yet,
  so the count on the button matches what lands.
- The commit is one transaction. A half-imported partnership is worse than none.
- `MAX_IMPORT_ROWS` for this is small — a few hundred groups is an implausible club. Reuse the
  inventory's 2 000 rather than the register's 10 000.

### QA — test scenarios
- **48.1** Given a sheet with `Escola;Turma;Alunos` and twelve rows across three schools / When previewed / Then three partners appear, each with its groups nested, and the button says it will create three partners and twelve groups.
- **48.2** Given the same file imported twice / When the second is previewed / Then every row is a stocktake, unticked by default, and committing with nothing ticked changes nothing.
- **48.3** Given a group whose headcount changed from 24 to 31 / When previewed / Then the row reads `24 → 31`.
- **48.4** Given a `Tipo` column reading "Misericórdia" / When mapped / Then the partner type is `ipss_misericordia`.
- **48.5** Given a `Tipo` column reading "qualquer coisa" / When previewed / Then the row imports as `outro` with a warning, and is not refused.
- **48.6** Given a row with no group name / When previewed / Then it is refused with a named cause.
- **48.7** Given a sheet with no headcount column / When committed / Then every group is created with a participant count of zero.
- **48.8** Given a workbook whose data is on the third tab / When read / Then all sheets with data are offered and the operator picks.
- **48.9** Given a file dragged onto the partners list / When dropped / Then a dialog asks before anything is read, and Escape cancels it.
- **48.10** Given a `.pdf` dropped / When the dialog opens / Then it says the file type is not accepted and offers only a way out.
- **48.11** Given a preview / When the operator unticks half the rows / Then the button's count follows the ticks, not the file.
- **48.12** Given a commit that fails part way / When it rolls back / Then no partner and no group were created.
- **48.13** Given the exported partner list / When it is imported back / Then every column maps itself with no dropdown touched, in both pt-PT and en.
- **48.14** Given an instructor / When they POST to the import endpoint / Then it is refused — bulk creation takes the same role as single creation.
- **48.15** Given tenant A's file committed under tenant B / When checked / Then everything created belongs to B and nothing references A.

### Acceptance criteria

1. The partners list is a full-page dropzone; a dropped file asks for confirmation before it is read, and Escape cancels.
2. The import runs the existing staged pipeline — upload, parse, mapping, validate, commit — with the mapping step separable.
3. One row is one group; a partner repeated down the column produces one partner with many groups, and the preview shows that shape.
4. An existing partner is matched by name accent- and case-insensitively and gains the groups rather than being duplicated.
5. An existing group is presented as a stocktake showing the old and new participant counts, unticked by default.
6. An unrecognised partner type imports as `outro` with a warning rather than refusing the row.
7. Only partner name and group name are required.
8. The commit is a single transaction; a failure leaves nothing behind.
9. The preview's counts follow the ticks, not the file.
10. The partner list exports as `.xlsx` and `.csv` whose header row is the import's own field labels, and a round trip maps itself in both locales — proven by a test that reads the real catalogue.
11. Import and export are owner/admin, enforced in the API.
12. The column matcher reuses `matchFields`; the file reader reuses `lib/read-sheet.ts`. No second copy of either.
