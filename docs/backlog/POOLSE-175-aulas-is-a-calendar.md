# POOLSE-175 · *Aulas* is a calendar — a month strip with the coming lessons and closures, then what has already happened; the tab never says it has nothing

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Family / Calendar · **Priority:** Medium (pilot) · **Depends on** [POOLSE-174](./POOLSE-174-inicio-is-the-next-lesson.md), [POOLSE-84](./POOLSE-84-closures-by-facility-and-tank.md), [POOLSE-116](./POOLSE-116-lesson-feedback-from-the-family-app.md)

### PO — why this exists

Rui, 05-11-2026: *"Then have a small calendar view to see the next classes for the next months, if the pool will close etc"* and, on the *Aulas* tab, *"'Aulas' should display something no? why it says 'nem aulas passadas nem atestados'?"*

*Aulas* today (POOLSE-136) is *Últimas aulas* — lessons marked present inside the 7-day feedback window — and the medical certificates. A new family, or any family in a week with no marked lesson, sees *Ainda não há aulas passadas nem atestados a mostrar.* That is the empty state doing its job on a screen that was given too little. The agenda is capped at two weeks (Rui, 21-10-2026), so nobody can see whether there is class in the Christmas week or when the pool shuts in August — information the office already recorded as closures (POOLSE-84). This ticket makes *Aulas* the family's calendar: coming months at the top, the past below.

**Not in scope:**
- A month grid on the backoffice — that is POOLSE-107's calendar and is unchanged.
- Booking, make-ups, *Vou / Não vou* from the calendar (the lesson page keeps them).
- Generating sessions further ahead than the club already does (`generate_sessions`' horizon is the club's; a day beyond it shows the pattern, rule 3).
- Merging the backoffice's *Turmas* and *Semana* tabs (the parked item in README).

### As built (05-11-2026) — wins over what follows

- **Rows off *Início*.** POOLSE-174 left them there until this ticket. *Início* is now the heroes alone.
- **A row opens the lesson's page only where that page answers** (`opens`, one SQL fragment with `/app/lessons/:id`): two weeks ahead, and back inside the feedback window. Further ahead a row is plain. Opening the page further out would change the lesson read, which is out of scope.
- **The pattern (`generated: false`) is bounded:** from today, up to the turma's or season's end and the child's enrolment, and never on a day `closure_day_shut` says is shut. Sessions are generated to the season's end, so *Previsto* mostly appears when a turma is new or a season is still open.
- **Order on the tab:** the strip, closures, the month's coming lessons, *Últimas aulas*, the month's earlier lessons newest first, certificates. Earlier months are the stepper's, three back, rather than a second list, which would have been three more reads for the same rows.
- **The stepper is links rendered on the server,** not a client component: it needs no state, and it carries `?child=` as the ticket asks. A strip stays inside its month.
- **Closures:** `readCalendarClosures` asks `closure_reaches` of each day at both halves, so a yearly holiday and a half day land correctly. A closure reaches a family through the sites and tanks of their turmas, so a family with no enrolment sees none.
- **`?child=` changes reset the month.** The chips do not carry `?month=`.

### BA — rules

1. **The tab opens on today.** A 7-day strip (POOLSE-96's `formatDayMonthShort` headers) with a dot under a day that has a lesson and a hatched mark on a closed day; the month name above it is a stepper (*‹ Novembro ›*) that reaches **six months ahead** and three months back. Tapping a month shows its lessons as the day-grouped rows *Início* used to carry (same `EntryCard`, `row`).
2. **Closures show as days, not only as cancelled lessons.** A closure covering the child's tank or site in the month renders a grey band across its days with the closure's reason, and a lesson under it says *Encerrado*, read from the session's own `closure_id` exactly as the agenda does (never re-derived by pool).
3. **Beyond generated sessions, the pattern.** When a month is past the last generated `class_session`, its days show the turma's weekly pattern in a lighter tone with *previsto*, and no row opens a lesson page. The API says which is which (`generated: false`).
4. **The past is below.** Under the strip: *Últimas aulas* with its moods (POOLSE-116, unchanged), then earlier lessons of the three months back as rows with that day's state — *presente / faltou / falta justificada / cancelada* — read-only, then the certificates. **The tab never shows the old empty sentence**; a brand-new family with no sessions sees the strip with no dots and *Ainda não há aulas marcadas — a secretaria ainda está a montar as turmas*.
5. **The child filter carries over** from *Início* (`?child=`) as today.
6. **Nothing on this tab is editable.** Feedback is still given on the lesson's page.

### Dev notes

- `GET /app/agenda` grows `?from=&to=` (both `YYYY-MM-DD`, at most 31 days apart, both optional; the old two-week default stays when absent so *Início* and push are untouched). The read is the same predicate (`familyMayReadPlan` by enrolment on the day). Add `closures: [{ id, reason, startsOn, endsOn, scope: site|tank }]` for the window, from `closure` by the child's tank's site, and `generated: boolean` per entry.
- Past entries in the window carry `attendance: present|absent|excused|null` from `attendance` for that student and session — a family already reads its own child's mark on the lesson page, so this exposes nothing new; **assert in the test that another child's mark is never in the payload**.
- The strip and the month stepper are one client component (`components/app/month-strip.tsx`) that only changes `?month=` (the POOLSE-107 rule: never rebuild the path, or `?child=` is lost). Dates through `formatDayMonthShort` / `formatDate`; no `Intl` with options.
- Rows reuse `EntryCard`; closure bands are a new small `ClosureBand`. Empty copy is a new key; the old `app.family.noPastLessons` is removed from both files (not left dangling — `i18n:check` will not catch an unused key, grep for it).
- Trap: POOLSE-108's previous-week bug came from parsing `YYYY-MM-DD` as a UTC instant. Use `asDate`.

### QA

1. Given a child with Monday/Wednesday/Friday lessons and a closure 23-12 to 02-01, when *Aulas* opens on December, then every lesson day has a dot, the closure days carry the band with its reason, and a lesson inside it says *Encerrado*.
2. Given sessions generated to the end of January, when the family steps to March, then its days show *previsto* rows that open nothing.
3. Given a lesson last Wednesday marked *falta justificada*, when the family opens *Aulas*, then that row says so and opens the lesson page only inside the feedback window (POOLSE-90 rule 9 unchanged).
4. Given a brand-new family with no enrolment, then the strip renders with no dots and the new sentence; the old sentence appears nowhere (grep).
5. Given `?from=` seven months ahead, then 400; given `?child=` of another family, then 404; given a guardian's token on another tenant's agenda, then 404.
6. Given the raw JSON for a window with two children of two families in one turma, then the payload carries only the reader's children's marks.
7. Both themes: the band, the dots and the *previsto* tone are in `check-contrast.mjs`.

### Acceptance criteria
- [x] *Aulas* opens on a month strip with lessons and closures six months ahead, three back.
- [x] Past lessons show their state; *Últimas aulas* and certificates stay.
- [x] The empty-state sentence from POOLSE-136 is gone; the new one appears only with no sessions at all.
- [x] `GET /app/agenda` accepts a window and still answers exactly as before without one.
- [x] QA 1–7 green; `i18n:check`, `contrast:check`.
