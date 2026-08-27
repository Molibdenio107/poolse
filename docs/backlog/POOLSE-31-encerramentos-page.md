# POOLSE-31 · Encerramentos page

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Settings / Calendar · **Priority:** High
**Depends on:** POOLSE-13 (attendance states, for what a cancelled occurrence is *not*), POOLSE-14 (removal history must stay distinguishable), POOLSE-21 (credit minting — closures explicitly mint none)

### PO — why this exists

Encerramentos is where a school records that the pool is shut — Christmas, annual maintenance, a municipal feriado — and today it does not resemble the Férias page staff already know, so closures get entered wrongly or not at all. When a closure is missing, classes stay on the calendar, instructors are marked absent-by-omission and families are charged for a lesson that never happened. Owners and Admins do this work a handful of times a year, but each mistake costs a round of phone calls. High priority: it is the correctness backbone for the whole calendar.

**Not in scope:** compensating families for a long closure (an explicit action, never a side effect of a closure), partial-day or per-basin closures, and recurring closures that repeat automatically year on year.

### BA — rules and data

- The page renders a 4×3 grid of the twelve months of a selected year, using the Férias page's layout and visual language. The year is switchable and defaults to the current year.
- Two distinct day markers exist and must never be conflated: **feriado** (greyed day, name on hover and on focus) and **encerramento** (a named band spanning its days, visually distinct from a feriado). A day may carry both.
- The feriado set = Portuguese national holidays, plus tenant-configurable municipal holidays layered on top. Municipal holidays are tenant data and carry the same name-on-hover treatment.
- A closure is a record with: tenant key, start date, end date (inclusive), name/reason, created-by, timestamps. A single-day closure is start = end, produced by clicking the same day twice.
- Range selection is Booking.com style: first click sets the anchor, hover previews the range, second click confirms. A reversed selection (second click before the anchor) is normalised, not rejected.
- Closures may not overlap. On an attempted overlap the save is refused with a message naming the existing closure. Adjacency (one ends the day before the next begins) is allowed and stays two records.
- **Effect on classes:** every class occurrence inside a closure is cancelled — removed from the calendar, no attendance taken, **no charge, and no reposição credit minted** (POOLSE-21). This is a deliberate decision, not an oversight.
- Cancelled-by-closure occurrences must be distinguishable in history from POOLSE-14 removals and from *faltas* — three separate reasons, stored as a reason code, not inferred.
- Creating a closure over dates that already carry recorded attendance warns before saving and lists the affected turmas and dates. **Open:** what happens to that already-recorded attendance on confirm — is it deleted, retained-but-flagged, or does the closure refuse to cover those days? The doc mandates the warning and stops there.
- **Open:** what happens to a closure when it is shortened or deleted — do previously cancelled occurrences reappear on the calendar, and with what attendance state? Extend/shorten/rename are all required (AC 6) but the reversal semantics are undecided.
- Create, edit and delete of a closure are restricted to Owner and Admin, and every one is audit-logged (actor, closure, dates, timestamp).
- Conflict to watch: POOLSE-21 AC 3 already excludes "closed dates and holidays" from reposição redemption targets — that rule and this ticket's AC 8 must read from the same closure/feriado source, or a credit will be bookable into a closed day.

### Dev — implementation notes

- Schema: a `closure` table (tenant key, start_date, end_date, name, created_by) with an exclusion constraint on the tenant + daterange to enforce non-overlap in the database rather than in application code — an application-level check races two concurrent admins. Plus a `municipal_holiday` table (tenant key, date, name) and a national-holiday source.
- Class occurrences need a cancellation reason column with distinct values for closure, POOLSE-14 removal and any future reason; do not overload a boolean `cancelled` flag, or AC 9 becomes unimplementable after the fact.
- Portuguese national holidays include movable feasts (Sexta-Feira Santa, Páscoa, Corpo de Deus, Carnaval where observed) computed from Easter. Compute them, do not hardcode a table per year — a full-year calendar that is switchable by year will be opened for 2031.
- **Dates are dates, not instants.** Store and compare closure bounds as `date` in Europe/Lisbon civil terms. Serialising a closure boundary through a UTC timestamp is how 1 January becomes 31 December for a client an hour behind; Portugal's DST transitions (late March, late October) will surface this in exactly the weeks a school schedules maintenance.
- API surface: `GET /closures?year=`, `POST /closures`, `PATCH /closures/:id`, `DELETE /closures/:id`, plus `GET /holidays?year=` returning the merged national + municipal set. Cancellation of occurrences is a server-side effect of the closure write, inside the same transaction, not a client loop.
- Permission enforcement: Owner/Admin checked at the endpoint for all four mutations, reusing the shared permission helper rather than a local `if`. The calendar read is available to anyone who can see the calendar.
- i18n: month and weekday names, holiday names (national names are Portuguese proper nouns — decide per name whether they are translated or kept), the range-preview and overlap messages, and the warning listing affected turmas. Date formatting via the locale, never concatenated.
- Theming: feriado grey, closure band and range-preview highlight all need tokens that work in both modes and stay clear of the attendance palette (POOLSE-13) and role palette (POOLSE-18). None of the three may be identified by colour alone — the closure band carries its name as text, the feriado exposes its name on hover **and focus**.
- Performance: rendering twelve months means ~365 day cells plus overlays. Compute the day → {feriado, closure} map once per year load, not per cell; do not issue a request per month.
- Most likely to be got wrong: the inclusive end date. Off-by-one at the closing boundary silently leaves the last day of the Christmas closure open, with classes still scheduled on it.

### QA — test scenarios

- **31.1** Given the Encerramentos page for 2026 / When it loads / Then twelve months render in a 4×3 grid matching the Férias page, with the year switcher on the current year.
- **31.2** Given 10 June 2026 / When the day is hovered and separately keyboard-focused / Then it renders greyed and reveals "Dia de Portugal" in both cases.
- **31.3** Given a tenant with a municipal feriado configured / When the calendar loads / Then that day is greyed with its own name, alongside the national set, and a second tenant without it does not see it.
- **31.4** Given an Owner selects 21 December then 3 January of the next year / When confirmed / Then the closure spans the year boundary, renders on both years' calendars, and the band is unbroken across 31 Dec–1 Jan.
- **31.5** Given a closure exists for 10–14 August / When a new closure is attempted for 12–20 August / Then the save is refused with a message naming the existing closure by name.
- **31.6** Given a closure covering a Tuesday with three scheduled turmas / When it is saved / Then those occurrences vanish from the calendar, no attendance can be recorded, no charge is raised, and **no** reposição credit is minted for any enrolled student.
- **31.7** Given a class cancelled by a closure and a class removed via POOLSE-14 on adjacent days / When history is inspected / Then the two carry different reason codes and are distinguishable in the UI, and neither reads as a *falta*.
- **31.8** Given dates that already have recorded attendance / When a closure is drawn over them / Then a warning lists the affected turmas and dates before saving is possible.
- **31.9** Given an Instructor calling `POST /closures` directly with a valid payload / When the request is made / Then it returns 403 and no closure is created — verified at the API, not by the hidden button.
- **31.10** Given a range selected by clicking the later day first / When the second click lands on the earlier day / Then the range is normalised rather than rejected, and saves with the correct start and end.
- **31.11** Given the last DST change of the year (late October) falls inside a closure / When the closure is saved and reloaded / Then the start and end dates are unchanged, and no day shifts by one in either direction.
- **31.12** Given 2028 (a leap year) / When February is rendered and a closure covering 28 Feb – 1 Mar is created / Then 29 February exists, is included, and the band spans three days.
- **31.13** Given locale pt-PT and then en / When the calendar, a closure band and the overlap message render / Then month names, holiday names and messages are localised with no concatenated date strings.
- **31.14** Given light and dark mode / When a day is both a feriado and inside a closure / Then both markers remain distinguishable from each other and from attendance colours, and each is identifiable without relying on colour.
- **31.15** Given two Admins saving overlapping closures at the same instant / When both requests land / Then exactly one succeeds and the other is refused by the database constraint, not by a partially applied write.

### Acceptance criteria

1. **4×3 grid of the twelve months** of the selected year, same layout and visual language as the Férias page. Year is switchable.
2. **Feriados** are greyed out on their days, with the holiday's name shown on hover (and on focus, for keyboard users) — e.g. "Dia de Portugal".
3. The holiday set is Portuguese national holidays, with tenant-configurable **municipal holidays** added on top.
4. **Closure periods are selected as a range**, Booking.com style: click the first day, hover previews the range, click the last day to confirm. Single-day closures are a click and a second click on the same day.
5. Each closure carries a name/reason (e.g. "Manutenção anual", "Encerramento de Natal") and is shown as a distinct band across the days it covers, visually different from feriados.
6. Existing closures can be edited (extend, shorten, rename) and removed.
7. Overlapping closures are prevented, with a clear message naming the closure already there.
8. **Effect on classes:** all classes falling inside a closure are **cancelled** — removed from the calendar, no attendance taken, **no charge, and no reposição credit minted**. The pool was closed; nobody was absent.
9. Cancelled-by-closure occurrences are distinguishable in history from classes removed by POOLSE-14, and from *faltas*.
10. Creating a closure over dates that already have recorded attendance warns before saving and lists what would be affected.
11. Create/edit/delete of a closure is restricted to Owner and Admin, and is audit-logged.

**Note:** point 8 is a deliberate decision — closures do not generate credits. If a school ever wants to compensate a long closure, that should be an explicit action, not a side effect.
