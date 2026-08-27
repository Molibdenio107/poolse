# POOLSE-08 · Turmas: list student names

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Classes (Turmas) · **Priority:** Low

### PO — why this exists
A turma card shows a count but not who is in it, so identifying the right turma means opening several. Instructors scanning for their group and admins moving a student are the beneficiaries. Low because it is a convenience over an existing count, and because POOLSE-15 carries the fuller version.
**Not in scope:** the hover card with the untruncated list (POOLSE-15), editing enrolments from the card, and showing anything beyond names.

### BA — rules and data
- Names come from enrolments in the **currently selected season** only; an archived season's enrolments never leak into the active view.
- Names render as a bulleted list inside the turma card or row, one step smaller than body text, in the muted style, still contrast-compliant.
- The list collapses after N names (N = 8 suggested) with a "+X more" affordance rather than stretching the card.
- Empty state: `Sem alunos inscritos` / `No students enrolled`.
- AC5 says names are "ordered alphabetically", while POOLSE-32 AC5 says sorting is by **surname** and AC2 says the displayed name in rosters is first name + last surname. Conflict: alphabetical-by-displayed-name and alphabetical-by-surname give different lists. **Open:** which wins here?
- Forward constraint from POOLSE-21 AC8: a student attending as a reposição is a guest on that roster and is **excluded** from this enrolled-student list, though they count for attendance.
- Occupancy figures elsewhere on the card count enrolments, never the truncated list length.
- **Open:** does "+X more" expand in place or open the turma detail? POOLSE-15 puts the remainder in a hover card, and POOLSE-15 AC7 removes hover on touch — so a touch user needs a non-hover route to the rest of the names.

### Dev — implementation notes
- The turma list endpoint returns the first N + 1 names and the total per turma from one query — a lateral join with `LIMIT` — never a follow-up request per card. With POOLSE-29's 15 rows per page, per-card fetching is 15 extra round trips.
- Display names come from the shared display-name helper (POOLSE-32), so the abbreviated form is derived, never assembled in the component and never stored.
- Sorting happens in SQL on the name part the decision above selects, so the truncated set is the first 8 of the true order rather than the first 8 of an arbitrary order sorted client-side.
- i18n: the empty-state key and a pluralised "+X more" key; both locales.
- Use the muted-foreground token and an existing type step rather than a hardcoded grey and font size, so the list stays legible in dark mode.
- Cap the rendered list height so cards in a grid keep a stable row height when one turma has eight names and its neighbour has one.
- Most likely to be got wrong: forgetting the season scope, so a card lists last year's enrolments alongside this year's.

### QA — test scenarios
08.1 Given a turma with three enrolled students in the active season, When its card renders, Then the three names appear as a bulleted list.
08.2 Given a turma with no enrolments, When its card renders, Then it reads `Sem alunos inscritos` in pt-PT and `No students enrolled` in en.
08.3 Given a turma with 12 enrolled students, When its card renders, Then 8 names are listed with a "+4 more" affordance and the card does not stretch.
08.4 Given a turma with exactly 8 students, When its card renders, Then all 8 appear and no "+X more" affordance is shown.
08.5 Given a student enrolled only in an archived season, When the active season is selected, Then that name does not appear on the turma card.
08.6 Given the season selector switched, When the list re-renders, Then the names change to that season's enrolments.
08.7 Given a page of 15 turmas, When the network is inspected, Then no per-card request for names is fired.
08.8 Given a student attending as a reposição guest, When the turma card renders, Then that student is not in the enrolled list although they appear in attendance.
08.9 Given a student named "Maria Isabel Costa Silva", When the card renders, Then the abbreviated display form is used and the row does not wrap or overflow.
08.10 Given the same turma, When the list order is inspected, Then it matches the decided sort rule and is identical after a reload.
08.11 Given light and dark mode, When the name list renders, Then the muted text passes contrast in both.
08.12 Given a student unenrolled from a turma, When the list is refreshed, Then the name disappears and the count and "+X more" figure both update.

### Acceptance criteria

1. Student names render as a bulleted list inside the turma card/row.
2. Font size one step smaller than the card's body text (secondary/muted style), still contrast-compliant.
3. Long lists collapse after N names with a "+X more" affordance (suggest N = 8) instead of stretching the card.
4. Empty state reads "Sem alunos inscritos" / "No students enrolled".
5. Names are ordered alphabetically and reflect enrolments for the currently selected season.
