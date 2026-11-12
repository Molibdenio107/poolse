# POOLSE-224 · An imported timetable is previewed on the calendar before it is kept, and its classes become turmas

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Import / Calendar / Turmas · **Priority:** High (pre go-live) · **Depends on** [POOLSE-57](./POOLSE-57-importing-the-wall-timetable.md), [POOLSE-223](./POOLSE-223-a-timetable-pdf-is-read-for-what-it-says.md) (shares its mapping step; build together or 223 first)

### PO — why this exists

> "When calendar is imported, wouldn't the turmas be created too? Then after the import, a user can
> analyze the calendar and if it does not confirm the calendar is removed. If the user imports, check
> and if he/she does not save the imported calendar, it's undone. Also, if the user navigates to
> another page other than turmas (if those are also imported) the user loses all the imported
> information and it's reversed." (Rui, 11-11-2026)

Today an import writes *eventos* straight away (`class_schedule` with a `title`, no turma), and the
only check is the preview inside the dialog. A club cannot see the result as a week on its
calendar before it is real, and a timetable of eventos still has to be turned into turmas by hand,
one block at a time.

**The import becomes a preview on the calendar itself**, written only on *Confirmar*, and **its
classes become turmas**. Nothing is saved until confirmation, so there is nothing to undo: leaving
the calendar and Turmas, closing the tab or pressing *Descartar* throws the preview away. Rui
chose this over saving provisionally and undoing (11-11-2026). A provisional save cannot be undone
reliably when the tab closes, and its turmas would generate lessons that instructors and families
could see in the meantime.

**This reverses POOLSE-57's call** that a name on a wall sheet never becomes a turma (Rui,
2026-09-04 → 11-11-2026), and POOLSE-223's *not in scope: creating turmas*. The reversal is logged
in `docs/decisions.md`.

**Not in scope:**

- Students and enrolments. A created turma has no students. Enrolment stays the turma's own screen.
- Levels, capacity and price. They stay empty for the club to set. The import does not guess a
  level from "Escola de Natação" or a capacity from "3 pistas".
- Partnership groups (*Clube – Treino*, *Escolas*). They can be mapped to *Evento* or *Não
  importar*, as in POOLSE-223. A parceria needs its contract first (POOLSE-105).
- A provisional state in the database. Nothing about this ticket is stored before *Confirmar*.

### BA — rules

1. **After the conflict step, *Ver no calendário* replaces the immediate import.** The dialog
   closes, and the calendar shows the importable rows as a **preview layer**: blocks drawn
   distinctly (hatched or outlined, with words, never colour alone) over the existing week, on
   their lanes or in *Sem pista*. A fixed bar across the top reads *Importação por confirmar · N
   aulas, M turmas novas* with **Confirmar** and **Descartar**.
2. **Nothing is written until *Confirmar*.** The preview lives in the browser (session storage,
   keyed by facility and pool), never in the database. *Confirmar* sends the rows to the existing
   import endpoint with `commit: true`, which re-checks everything server-side (POOLSE-57, decision
   1) and writes in one transaction. A conflict that appeared since the preview (someone else
   booked the lane) stops the commit and reopens the conflict step.
3. **Leaving discards it.** While a preview is pending:
   - Moving between the calendar and Turmas (any week or sport filter) keeps it.
   - Navigating anywhere else first asks *Sair sem confirmar? A importação é descartada.*
     (shared `Dialog`), then discards it.
   - Closing or reloading the tab triggers the browser's own "leave page?" warning, and the preview
     is gone afterwards.
   - **Descartar** asks first.
4. **Turmas page.** During a preview it lists the turmas the import would create, marked *nova (por
   confirmar)*, with their days and times, beside the club's real turmas. They cannot be opened or
   edited until confirmed.
5. **Rows become turmas by name and start time** (Decided 2, Rui 11-11-2026). Rows with the same
   activity name and the same start time, on any days, are **one turma** with one weekly slot per
   day: *Hidroginástica* at 18:00 on Monday and Wednesday is one turma. The same name at another hour
   is another turma.
   - When a name occurs at more than one hour, the turma is named *Hidroginástica · 18:00*.
   - A turma is created in the published season, at the site and pool of the import, with no level,
     capacity, teacher or price unless the row names a teacher Poolse knows.
6. **What becomes a turma** (Decided 3, Rui 11-11-2026). Every class does, except:
   - *Natação Livre*, which becomes a free-swim lane hold (POOLSE-223, decided 1);
   - *Encerrado*, which is not imported.

   In the mapping step each activity can be switched to **Turma** (the default), **Evento** (as
   today), **Natação livre** or **Não importar**.
7. **A turma that already exists is not duplicated.** If the club already has a turma with the same
   name in the season, the row's slot is offered as *adicionar a «Hidroginástica · 18:00»* instead of
   a new turma. It still goes through the conflict check, and it is never overwritten.
8. **Lessons are generated only after *Confirmar*.** They come from the turmas' own pattern, as for
   a turma made by hand ("a turma's lessons follow its pattern on their own").
9. **Confirmed is ordinary.** After *Confirmar* the bar says *Importado: N aulas, M turmas*. The
   turmas are normal turmas: editable, archivable, in the activity log (one `audit_log` entry per
   created turma and one for the import).

### Dev notes

- **No migration.** Turmas are `class_group` (`name`, `season_id`, `facility_id`, `pool_id`;
  `level_id`, `capacity` and `instructor_membership_id` stay null). Their slots are `class_schedule`
  rows with `class_group_id`, plus `booking_lane`.
  - The commit path (`runTimetableImport` in `apps/api/src/facilities/bookings.repository.ts`)
    gains a `kind` per row (`turma | evento | free_swim`, as POOLSE-223 adds).
  - For `turma`, it groups the rows (rule 5), inserts the `class_group`, then its schedules, in the
    same transaction. Reuse the turma creation insert from `classes.repository.ts` (it audits);
    do not write a second one.
- **Grouping is a pure function** (`groupIntoTurmas(rows, existingTurmas)`) beside
  `previewTimetable`, unit-tested. The preview returns the planned turmas, so the calendar and the
  Turmas page draw from the server's answer, never a client-side guess.
- **The preview layer.**
  - The calendar grid already draws the pattern overlaid with the week's own sessions ("the
    calendar draws the pattern, overlaid with the week's own sessions"), so the preview is a third
    overlay. Give it a distinct block state, words first ("a calendar block's state is words first").
  - Store the preview in `sessionStorage` (`poolse.importPreview.<facilityId>`), with the server's
    preview payload and the dropped rows.
  - A client component in the dashboard shell owns the bar and the leave guard.
  - Intercept in-app navigation through the existing `FromLink` / router: there is no global
    "route change" event in the App Router, so guard the link components and `router.push` wrappers.
    `beforeunload` covers the tab.
- **Do not block `KeepFresh`.** A refresh re-reads the server's part of the page, and the preview
  layer is client state that survives it.
- **POOLSE-223 shares the mapping step.** The activity select gains *Turma*. Build 223's mapping
  first, or both together. Build the turma and preview parts in their own session either way.
- **Traps:**
  - The leave guard must not fire on the commit's own navigation or on moves between calendar and
    Turmas.
  - A turma per name and hour must not merge the same name across different pools.
  - The commit's re-check must use the same grouping as the preview, or a confirmed import differs
    from what was shown.
- **Docs:** `docs/features/calendar.md`, `docs/features/classes.md` (turmas created by import),
  `docs/decisions.md` (the reversal).

### QA

1. **Given** a clean preview, **when** *Ver no calendário* is pressed, **then** the calendar shows
   the rows as preview blocks with words, the bar shows counts, and the database has no new
   `class_group` or `class_schedule` rows.
2. **Given** the preview, **when** the user moves to Turmas and back, **then** the preview is still
   there, and Turmas lists the turmas to be created as *nova (por confirmar)*.
3. **Given** the preview, **when** the user opens Alunos, **then** a dialog asks first, and after
   confirming, the preview is gone and nothing was written.
4. **Given** the preview, **when** the tab is reloaded, **then** the browser warns, and afterwards
   no preview and no data remain.
5. **Given** rows *Hidroginástica* Mon 18:00, Wed 18:00 and Fri 10:00, **when** confirmed, **then**
   two turmas exist: *Hidroginástica · 18:00* (Mon, Wed) and *Hidroginástica · 10:00* (Fri), with
   no level or capacity.
6. **Given** *Natação Livre* rows, **then** they become free-swim lane holds, not turmas. *Encerrado*
   rows are not imported.
7. **Given** an existing turma *Hidroginástica · 18:00*, **then** the matching rows are offered as
   additions to it, not as a new turma.
8. **Given** a lane booked by someone else between preview and *Confirmar*, **then** the commit
   stops, the conflict step reopens, and nothing is written.
9. **Given** *Confirmar*, **then** lessons appear for the created turmas only from then on, and the
   activity log shows the import and each turma.
10. **Permission:** an instructor cannot reach the import or confirm a preview (403 on the endpoint).
11. **Cross-tenant:** a commit naming another club's pool or turma is refused (404) and nothing is
    written.
12. **Both themes:** preview blocks and the bar are legible in light and dark mode, and say
    "por confirmar" in words.

### Acceptance criteria

- [x] The import ends in a calendar preview with *Confirmar* / *Descartar*. Nothing is written
      before *Confirmar*.
- [x] Leaving the calendar and Turmas asks first and discards. Closing the tab warns, and nothing
      remains.
- [x] Turmas are created per name and start time, in the published season, with no level or
      capacity, and existing same-name turmas are offered instead of duplicates.
- [x] *Natação Livre* becomes free-swim lane holds, *Encerrado* is not imported, and the mapping step
      can switch any activity.
- [x] The confirm re-checks server-side with the same grouping, in one transaction.
- [x] `groupIntoTurmas` is unit-tested, and integration tests cover rules 2, 5, 7 and 8.
- [x] pt-PT and en, both themes, keyboard reachable. Docs and the decision reversal are updated in
      the same commit.
