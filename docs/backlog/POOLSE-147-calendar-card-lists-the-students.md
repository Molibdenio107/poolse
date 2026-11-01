# POOLSE-147 · The calendar's class card lists the turma's students instead of always saying nobody is enrolled

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Calendar · **Priority:** High (pre go-live) · **Depends on** nothing

### PO — why this exists

Rui, 01-11-2026: *"A class that has students does not display on calendar class card time slots — it says no students, when it's clear on other screens that it has (ex: Deficientes 06:45 – Instructor Bruno Carvalho)."* And: *"it's by hovering, right? Because it should be informative only on the Calendar."*

It is not a data problem. `calendar-week.tsx` builds every card's detail with `people: []` and the sentence *Ainda não há alunos inscritos nesta turma*, since round 6 gave the calendar its own grid; the Turmas page builds the same `TurmaCard` with the real list and the calendar was never wired. The coach opens this card on day one.

**Not in scope:** any action on the names (no link to the student from the calendar, no register from the card — *Marcar presenças* stays where it is); the week's per-lesson attendance (that is the register); a second fetch when the card is pinned.

### BA — rules

1. The hover card (pinned by click, as today) lists the turma's **active** enrolments by name, as the Turmas page does — the whole list, uncut. Informative only: no control is added. (Rui, 01-11-2026.)
2. A turma with no active enrolment keeps today's sentence. A `waiting` enrolment is not listed.
3. A parceria, a free-swim block and an evento show no list and no sentence about students: a partner group carries a headcount and no people.
4. The names come with the calendar's own read, in one grouped query over the week's turmas — never one query per booking.
5. Who may read the names is who may read the calendar today (staff); nothing on the family side changes. When POOLSE-145 lands, the list follows the reader's sports like every other list.
6. The occupancy line (*n / capacidade*) stays as it is and is the same number as the list's length.

### Dev notes

- `grid.repository.ts` (`readGrid`): one extra statement — active enrolments joined to `student` for the week's `class_group_id`s, `json_agg` ordered by `nameOrder`, keyed by turma; attached to each turma booking as `people: { id, name }[]`. Parcerias get none (`class_group_id` null; `LEFT JOIN`, the three-times trap).
- `calendar-week.tsx`: replace `people: []` with the booking's list; keep `peopleEmpty` for an empty turma; omit the block entirely for a non-turma subject.
- The name is a snapshot of the read, not withheld: it is the same list the Turmas page and the register already show to the same roles.
- No migration; no new endpoint.

### QA

1. Given a turma with three active and one waiting enrolment, when its card is opened on the calendar, then the three names, and the occupancy says 3.
2. Given a turma with none, then today's sentence.
3. Given a parceria block, then no student section at all.
4. Given a week with 60 bookings, then `readGrid` runs one statement for the names (`countStatements`, as `management.repository.ts` proves).
5. Given a guardian, then `GET /calendar` answers as before (the role-probe stays green; a family never reaches this card).
6. Given another tenant's turma at the same hour, then none of its names (cross-tenant).
7. Both themes; the card still opens by keyboard through `TurmaCardButton`.

### Acceptance criteria

- [x] Names on the calendar card from the grid read, one grouped statement.
- [x] Parcerias and free swim show no student section.
- [x] Nothing actionable added to the card.
- [x] `docs/features/calendar.md` updated.
