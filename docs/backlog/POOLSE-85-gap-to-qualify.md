# POOLSE-85 · Gap to qualify — FPN age groups and entry times

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Competition · **Priority:** High — POOLSE-81's named next slice · **Depends on** POOLSE-81 (course on every time, official bests, meets)

### PO — why this exists

POOLSE-81 gave every time a pool length and every swimmer an official best. The coach's question
is the next one: *how far is this swimmer from the championship time?* Today that is a PDF from the
FPN open beside a spreadsheet.

A championship publishes **entry times** (*tempos de admissão*) per **FPN age group**, gender,
stroke, distance and course. The age group is fixed by birth year and season, with girls a year
earlier. Neither exists in Poolse yet.

**Not in scope:**
- Entering swimmers into a meet, or exporting entries to Splash. Entries stay in Splash.
- Rankings across clubs, or anything read from swimrankings.
- Converting a 25 m time to 50 m or back. The FPN never converts, and neither do we.
- Relays.
- Turning `fastestStroke` into a "best stroke" judgement. Its note says reference times would make
  that possible; that is a separate decision, not a side effect of this ticket.

### BA — rules and data

**An FPN age group is its own table, never a `student_level` row.** "Escalão" means the club's level
in Poolse and the FPN's age band here; the two must not meet (POOLSE-81, *What will be got wrong*).

- An age group belongs to a **season** (the organization-scoped `season`), and has a name (Cadetes,
  Infantis, Juvenis, Juniores, Seniores…), a gender, and a birth-year range (`born_from`, `born_to`,
  either may be open).
- A swimmer's age group is **derived** — birth year, gender and the season — once, in SQL. Never
  stored on the student. A student with no birth date or no gender has none, and the screen says so.

**A qualifying standard is a named set of entry times.** "Campeonato Nacional de Juvenis 2026/27",
for one season.
- Each entry time names: age group, stroke, distance, course, and a time in integer ms.
- One time per (standard, age group, stroke, distance, course).
- A standard is soft-deleted, and a correction is an edit of the row (it is the club's copy of a
  published table, not a ledger).

**The gap is the swimmer's best valid time minus the entry time.**
- **Valid** means: the same course, swum at an **official** meet, inside the standard's
  qualifying window when it has one (`window_from`, `window_to`), else at any time in its season.
- No conversion between courses, ever. A swimmer with a 25 m best and a 50 m standard has *no
  valid time*, said in words — not a gap.
- Negative or zero gap is **qualified**. Positive is the seconds still to find.
- Derived on the server, once, and shipped; the client never subtracts.

**Where it shows:**
- On the student's **Progressão**: for each standard of the current season whose age group fits
  them, a table — event, best valid time, entry time, gap. Families see it for their own child.
- On **Provas**, a *Mínimos* view: one standard, the competitive-level swimmers, who has qualified
  for what and who is within a chosen margin (e.g. 2 s). This is the coach's screen.

**Who may write:** Owner, Admin and Instructor, matching who records a time (POOLSE-81).

**Answered (Rui, 19-10-2026):** the club enters both. Poolse ships no FPN data and nothing is
platform-scoped; the coach types each season's age groups and each championship's entry times, or
imports the entry times from a sheet or the FPN's PDF through the ordinary importer.

### Dev — schema, API, where it goes

**Migration:**
- `federation_age_group` — tenant-scoped, RLS, `archived_at`; `season_id` (composite FK), `name`,
  `gender`, `born_from`, `born_to` (smallint years, nullable), a CHECK that `born_from <= born_to`.
  Partial unique on `(organization_id, season_id, lower(name), gender)`.
- `qualifying_standard` — `season_id`, `name`, `window_from`, `window_to` (date, nullable),
  `archived_at`.
- `qualifying_time` — `standard_id`, `age_group_id` (composite FKs), `stroke`, `distance_m`,
  `course swim_course NOT NULL`, `time_ms integer > 0`. Unique per the five-tuple.
- A SQL function `federation_age_group_of(student_id, season_id)` — the one definition.
- All three into `TENANT_TABLES`, child-first.

**API:**
- CRUD for age groups and standards (with their times), `requireRole('owner','admin','instructor')`
  first line; every route into `role-probe.integration.test.ts`.
- `GET /students/:id/qualifying` (family-readable via `requireActsForStudent`).
- `GET /qualifying-standards/:id/board?marginMs=` for the Mínimos view — one grouped query, never a
  loop over swimmers.
- The gap and "valid best" are SQL beside the bests query in `records.repository.ts`.

**Web:**
- Age groups and standards as sections of Provas (`SectionPills`).
- Entry-times editor: a grid of stroke × distance per age group, times typed as `m:ss.hh`, parsed by
  the same time parser the record form uses.
- Entry-times importer (slice 2): a `MatchSpec` in `lib/qualifying-sheet.ts` taking
  `readSheet(file, { pdf: true })`, preview and commit on one route; export and re-import round-trip.
- Gap table on Progressão; Mínimos board on Provas.

**What will be got wrong:**
- **Comparing across courses**, or "helpfully" converting.
- **Reading a training or non-official time as qualifying.**
- **Age from today instead of birth year and season.** The FPN fixes the band for the whole season.
- **Girls a year earlier** being modelled as a rule in code rather than as rows with a gender.
- **Storing the age group on the student**, which drifts the first season it turns over.
- **A null birth date read as the youngest band.**

### QA — test scenarios

1. **Given** a girl born 2012 and a season whose Juvenis girls are 2011–2012, **then** her age group
   is Juvenis; a boy born 2012 in a season whose Juvenis boys are 2010–2011 is not.
2. **Given** a 100 free entry time of 1:05.00 lcm and an official lcm best of 1:04.20, **then**
   qualified, gap −0.80 s.
3. **Given** the same swimmer's only time is 1:03.00 scm, **then** *no valid time* — no gap.
4. **Given** a faster time at a non-official meet or typed with no meet, **then** it is ignored and
   the official best is used.
5. **Given** a qualifying window, **then** a time swum before it is ignored.
6. **Given** a student with no birth date, **then** no age group, said in words, and no row on the
   board.
7. **Given** a guardian, **then** they read their own child's gap table and get 404 for another
   child's; a guardian calling the board or a standard write is refused.
8. **Given** two standards in one season, **then** each is its own table on Progressão.

### Acceptance criteria

1. FPN age groups are their own season-scoped table; nothing writes them to `student_level`.
2. A swimmer's age group is derived in one SQL function from birth year, gender and season.
3. A qualifying standard holds one entry time per age group, stroke, distance and course.
4. The gap uses only same-course official times inside the window, and never converts courses.
5. The gap table appears on Progressão (staff and family) and the Mínimos board on Provas.
6. Every new route refuses by role in its first line and is in the role probe.
7. pt-PT and en strings, light and dark, docs updated (`students.md`, `data-model.md`).

---

## Slice 2 — importing entry times (built 19-10-2026)

Slice 1 is on main (9fecdce). Typing a championship by hand is up to 36 boxes per age group; the
coach already holds the FPN's table as a PDF or a sheet.

**Answered (Rui, 19-10-2026): the file is read in the FPN's own wide shape** — one row per event,
one column per age group and gender ("Juvenis F", "Juvenis M"). Nobody reshapes it first.

### Rules

- **Where:** *Importar tempos* on a standard's **Tempos** tab. The age groups the columns may match
  are that standard's season's, and nothing else.
- **One pool length per import.** The operator says 25 m or 50 m once, at upload; the FPN publishes
  the two as separate tables. A file with both is imported twice.
- **Columns:** an *event* column ("100 Livres", "100 m Livre", "100L", "200 Estilos", "100 Free") —
  or a *distance* column plus a *stroke* column — and one column per age group. Age-group columns are
  matched by name and gender words (F/Fem./Femininos/Raparigas, M/Masc./Masculinos/Rapazes); a
  heading that names the group but not the gender is *unsure* and asked, never guessed. A column the
  operator leaves unmapped is ignored.
- **Cells:** read by `parseSwimTime`, the same function as the grid and the API. An empty cell is
  "no time in the file", which **leaves the existing time alone** — an import adds and corrects, and
  clearing stays the grid's job. An unreadable cell or an event that is not a known stroke and
  distance is listed on the preview and not written.
- **Preview** per cell: *new*, *changed* (old → new), *unchanged*, *refused*. The commit writes
  exactly the preview, **in one transaction**: a half-imported table is a set of entry times
  nobody can trust.
- **A PDF** goes through `readSheet(file, { pdf: true })`, behind `PDF_TABLE_AI_ENABLED` and
  `ANTHROPIC_API_KEY` as every PDF importer is; off, the importer says so (`pdfDisabled`).
- **Export** writes the same wide shape for one pool length (event column + one column per age
  group, headers from the catalogue), so a round trip changes nothing.

### Dev

- `lib/qualifying-sheet.ts`: a `MatchSpec` whose fields are `event`, `distance`, `stroke` and
  `group:<ageGroupId>` — the empty mapping and the synonyms built from the season's groups at
  read time. `parseEvent()` turns "100 Livres" into `{ stroke, distanceM }`, with the catalogue's
  stroke names in both languages among its synonyms.
- `useImportWizard` for the four steps; the preview rendering is this importer's own.
- `POST /qualifying/standards/:id/times/import` — `{ course, cells, commit }`, preview and commit on
  one path, cells parsed by `parseSwimTime` on the server again. Owner, admin, instructor; a line in
  the role probe.
- `GET` export through a Next route, as the other exports are.

### QA

1. **Given** a sheet "Prova | Juvenis F | Juvenis M" and two Juvenis bands, **then** both columns map
   *certain*; "Juvenis" alone maps *unsure* and is asked.
2. **Given** "100 Livres", "100L" and "100 m Freestyle", **then** each reads as 100 m freestyle;
   "100 Livres Estafeta" is refused and listed.
3. **Given** an existing 1:05.00 and a file saying 1:04.50, **then** the preview shows *changed
   1:05.00 → 1:04.50*; a file with that cell empty leaves 1:05.00 alone.
4. **Given** one unreadable cell, **then** it is listed and the rest commit; **given** a commit that
   fails at the last moment, **then** nothing is written.
5. **Given** a PDF with the flag off, **then** the importer says PDFs are not enabled.
6. **Round trip:** export a standard's 50 m table, import it back — the preview is all *unchanged*
   and the commit writes no rows.
7. **Given** a guardian, **then** the import route is refused (403).

### Acceptance criteria

1. The FPN's wide table imports with each column matched to one of the season's age groups.
2. One pool length per import, chosen by the operator; empty cells leave existing times alone.
3. Preview per cell (new / changed / unchanged / refused), and a commit that is all or nothing.
4. PDFs through the existing flag-gated reader; spreadsheets with no flag.
5. Export in the same shape, and a round-trip test against the real catalogue.
6. pt-PT and en, light and dark, the role probe, `docs/features/students.md`.
