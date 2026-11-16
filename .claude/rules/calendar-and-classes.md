---
paths:
  - "apps/api/src/{classes,facilities,vacations}/**"
  - "apps/web/src/app/**/{calendar,classes,recintos,aulas}/**"
  - "apps/web/src/components/turma-picker.tsx"
  - "packages/rules/src/{lane-placement,sports}*.ts"
  - "apps/web/src/lib/{lanes,calendar-*,grid-*,partner-days,slot-key,week-url,opening-hours}.ts"
  - "apps/web/src/components/{week-grid,turma-card,pool-closure-note,occupancy-panel}.tsx"
---

# Calendar, classes and recintos

Read [`docs/conventions/calendar-and-classes.md`](docs/conventions/calendar-and-classes.md) before touching the calendar, turmas, sessions, lanes, closures, seasons or partnerships.

- A series move re-times the weeks that still sit where the pattern put them.
- A guard that reads the pattern and a screen that draws the week will disagree, so a refusal must say which one it is defending.
- A partnership's contract comes before its terms and keeps its versions.
- The season is organization-scoped and already built; a screen picks from it, never keeps its own.
- A pool is a recinto of sport `pool`, and the pool's own trigger makes it.
- A closure is one site or some of its tanks, and what it reaches is `closure_reaches` / `session_reach`.
- A partnership group's days are written by one path, all or nothing
- A turma is chosen in `TurmaPicker` (`components/turma-picker.tsx`), never a `<select>` of joined strings.
- Turmas opens on *Lista
- Capacity rules compose, they do not override.
- A calendar block's state is words first
- One student, one hour: an enrolment that overlaps another of the student's turmas is refused; a move that creates one is warned
- A dated grid is drawn from minutes, not from rows.
- A week's class can differ from its pattern, lanes included.
- A parceria takes no register, ever — but it may take a plan.
- A draggable block carries no click.
- The calendar draws the pattern, overlaid with the week's own sessions.
- A week's occurrence is found by its booking's id, never by turma-weekday-hour.
- A turma's lessons follow its pattern on their own.
- A taught class is a record, not a plan.
- A class with no pista is drawn in a Sem pista column, which is a drop target both ways; it keeps its pool in `class_schedule.pool_id` (POOLSE-223).
- Both axes of a drag are travel, never pointer position.
- A drag costs a transform, never a reflow, and one droppable per column.
