# POOLSE-53 · "Sem professor" alerts

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Staff · **Priority:** High — the club's stated pain point

### PO — why this exists
The club named this as its main problem, and the printed sheet shows why: `???` and `Sem professor`
appear all over it, in red. A season is built optimistically in July and the staffing catches up in
September, so at any moment there is a set of slots with nobody assigned — and the club's own way of
tracking that set is to squint at a printout.

The whole feature is one number and one filter: **how many, and which ones.**

**Not in scope:** assigning instructors (that is a drag on the grid, POOLSE-50), and staff
availability or contracted hours — a real feature, and a different one.

### BA — rules and data
- The four states from POOLSE-46 render distinctly and are never distinguished by colour alone:
  - `assigned` — the instructor's name;
  - `to_define` — `???` in a neutral tone, meaning the club knows and has not decided;
  - `uncovered` — `Sem professor` in the alert colour, with an icon, meaning this is a problem;
  - `external` — the partner's own instructor name, or the partner's name with the own-teacher
    marker where no name was given.
- **`to_define` and `uncovered` are different and the system never converts one into the other.**
  A blank is not evidence of which. The operator sets it; a booking created with no instructor
  defaults to `to_define`, because "we have not decided yet" is the honest reading of a brand-new
  row and "this is uncovered" is an accusation.
- Assigning an instructor sets `assigned` automatically. Removing one does **not** automatically set
  `uncovered` — it returns to `to_define`, and the operator escalates it.
- **Counter on the schedule header**: "N aulas sem professor nesta época". It counts `uncovered`
  only. Clicking it filters the grid to those bookings.
- The count is over the **published season's bookings**, not its dated sessions: the question is
  "how many slots in my timetable have nobody", which is a property of the pattern. A session-level
  count would multiply by 40 weeks and be a number nobody can act on.
- The same counter surfaces on the facility page when the dashboard lands — expose it in the same
  endpoint now so that is a render and not a second query.
- A `to_define` count is shown too, quieter, beside it. Hiding it would make the two states feel like
  one, which is the distinction this ticket exists to preserve.
- Parceria bookings with `external` never count toward either. The partner brings their own teacher;
  that is not the club's gap.
- **Open:** should an uncovered booking within N days generate a notification (push/email)? The
  notification layer exists. *Recommendation:* not in this ticket — an alert that fires forty times
  in July teaches people to ignore it. Revisit once a club has used the counter for a season.

### Dev — implementation notes
- No new table. `instructor_status` is already on the booking after POOLSE-46; this is a projection,
  a filter and three renderers.
- **Most likely to be got wrong:** deriving the status instead of reading it. It is tempting to
  compute "uncovered = no instructor resolved", and that quietly erases `to_define`. Read the column.
  The only automatic transition is *to* `assigned` when an instructor is set.
- Second: the count must be one aggregate on the endpoint that already loads the grid, not a second
  request. It is a number in the header of a screen that is already fetching everything it needs.
- Third: the alert colour is a token and must be contrast-checked against the category colours the
  cells already carry (POOLSE-49). A red `Sem professor` on a red partner block is the failure mode.
  Render it as a chip with its own background rather than as coloured text on the cell.
- The filter reuses the grid's existing filter mechanism (POOLSE-49) and its persistence — clicking
  the counter sets the filter, and the URL carries it so the state is shareable.
- Strings: `???` is not a translated string, it is a symbol. `Sem professor` and `A definir` are.

### QA — test scenarios
- **53.1** Given a season with 7 uncovered bookings / When the grid header renders / Then it reads "7 aulas sem professor nesta época".
- **53.2** Given that counter / When clicked / Then the grid filters to those 7 and the URL carries the filter.
- **53.3** Given 12 `to_define` bookings alongside / When the header renders / Then they are counted separately and shown more quietly.
- **53.4** Given a booking with no instructor, newly created / When read / Then it is `to_define`, not `uncovered`.
- **53.5** Given an `uncovered` booking / When an instructor is assigned / Then it becomes `assigned` automatically.
- **53.6** Given an `assigned` booking / When the instructor is removed / Then it becomes `to_define`, not `uncovered`.
- **53.7** Given an operator setting a booking to `uncovered` / When saved / Then it stays `uncovered` and is not recomputed on the next read.
- **53.8** Given a parceria booking with `external` and an own-instructor name / When rendered / Then the name shows with the own-teacher marker and it counts toward neither total.
- **53.9** Given a parceria with `external` and no name / When rendered / Then the partner's name shows with the marker.
- **53.10** Given a season with no uncovered bookings / When the header renders / Then the counter is absent rather than showing zero.
- **53.11** Given an uncovered booking on a partner-coloured cell / When rendered in light and dark / Then the alert chip is contrast-checked against that background in both.
- **53.12** Given a screen reader / When it reaches an uncovered cell / Then it announces the state as words, not as a colour.
- **53.13** Given a draft season / When the counter renders / Then it counts the season being viewed, and says which.
- **53.14** Given pt-PT and en / When all four states render / Then each has a string in both, and `???` is not translated.
- **53.15** Given tenant A's uncovered count / When tenant B loads its grid / Then it sees only its own.

### Acceptance criteria

1. All four instructor states render distinctly, each with text or an icon, never colour alone.
2. `to_define` and `uncovered` are never converted into one another by the system; a new booking with no instructor is `to_define`.
3. Assigning an instructor sets `assigned` automatically; removing one returns to `to_define`.
4. The schedule header counts uncovered bookings for the season being viewed and names the season.
5. Clicking the counter filters the grid, and the filter is carried in the URL.
6. `to_define` is counted and shown separately, more quietly.
7. `external` bookings count toward neither total.
8. The counter is absent, not zero, when there is nothing to report.
9. The count comes from the same request that loads the grid, and is exposed on the API for the facility page to reuse.
10. The alert chip is contrast-checked in light and dark against every category and partner colour it can sit on.
11. `Sem professor` and `A definir` exist in pt-PT and en; `???` is a symbol and is not translated.

---

## Correction — 2026-09-04, criterion 11

Criterion 11 says `???` is a symbol rather than a translated string, and the
first build put it on the screen: on the header counter, in the cell chip and in
the instructor picker.

**Rui reported the counter button as a fault** — `??? 2 por definir` reads as
broken software, not as notation: an unresolved variable, a missing glyph, a
placeholder somebody forgot to replace. He was right, and the mistake was mine
rather than the ticket's. The argument for `???` is that it is what the club
writes on its own printed sheet — which is true, *on paper*, where the reader is
holding the same document the club has always used and where the key underneath
says what the mark means.

So the line is: **`???` stays on the printed sheet and comes off the screen.**
The print render still marks a to-be-decided slot with it and still keys it, so
criterion 11 holds where it was actually about. On screen every state says what
it is in words, which is what criterion 1 asked for and what was already true —
the symbol was never carrying meaning there, only noise.
