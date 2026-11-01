# POOLSE-144 · A student cannot be enrolled in two turmas that meet at the same time; a move that creates a clash warns

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Classes / Enrolment · **Priority:** High (pre go-live) · **Depends on** nothing new (`class_schedule`, `enrollment`, `enrollment_respects_capacity` exist) · **Unblocks** [POOLSE-143](./POOLSE-143-alunos-and-its-children-per-sport.md)

### PO — why this exists

Rui, 01-11-2026: *"One student being one entity, it cannot enrol in 2 classes of different sports at the same time and day."* Asked as a multi-sport rule, it turned out to be missing within swimming too: `enrollment` carries a capacity trigger and a quota trigger and **nothing about time**. A child in two pool turmas on Monday at 18:00 is accepted today. Multi-sport only makes it more likely. Rui, 01-11-2026: *"ticket 2 should be before go live."*

**Not in scope:** clashes between a student's lesson and a reposição, a free-swim pass or a parceria; a student attending two turmas on different weeks of one pattern; an instructor's own clash (`generate_sessions` already skips those).

### BA — rules

1. Two enrolments **clash** when both are `active`, their turmas are in the same season, and the turmas have patterns (`class_schedule`, live) on the same `weekday` whose `[start_time, start_time + duration_minutes)` windows overlap. Sport plays no part: the rule is about one person and one hour.
2. **Enrolling is blocked.** An `INSERT` of an active enrolment, or an `UPDATE` that makes one active (promotion from `waiting`), that clashes is refused by a constraint trigger with DETAIL `enrollment_clash|<other class_group_id>|<weekday>|<start_time>`. The API answers 409 `enrollment_clash` naming the other turma, its weekday and hour — a refusal carries its numbers as structure.
3. **Moving is warned, never blocked by a student.** A series move, a new slot or a timetable import that makes two of a student's turmas clash is written; the calendar then marks the block the way *sem professor* is marked, and the hover card names the students. The operator moves a class; a student does not pin the timetable.
4. The check reads the **pattern**, never `class_session`: a one-week move of a lesson does not invalidate an enrolment, and a student whose two turmas clash only on a hand-moved week is simply absent from one register. (Rui, 01-11-2026, default taken.)
5. **Existing data is kept.** The trigger judges new rows only. The migration counts existing clashes per tenant and the Turmas page shows *N alunos com aulas sobrepostas* (owner/admin) with a link to the list, so a club fixes them by hand. Nothing is ended, nothing is deleted.
6. A `waiting` enrolment never clashes and never blocks; the check runs when it becomes active, which is where the club finds out.
7. Every way in is covered by the one trigger: the student form, the lead conversion (`insertEnrollment`), the app's request (POOLSE-121 `placeLead`), the advancement queue (POOLSE-112) and the Excel import. Each surfaces the same 409 sentence through `enrollmentRefusal`.

**Open:** whether a clash with a turma in a *different* facility of the same club counts. Default: yes — one body, one hour, whatever the building. **Answered by the default when built (01-11-2026).**

### Dev notes

- `write-migration` applies. A `CONSTRAINT TRIGGER` on `enrollment` `AFTER INSERT OR UPDATE OF status`, `DEFERRABLE INITIALLY IMMEDIATE`, next to `enrollment_respects_capacity`; it reads the other active enrolments of the same `student_id` and joins both turmas' live `class_schedule` rows on `weekday` with a range overlap. Same-tenant by the composite keys already on `enrollment`.
- Pattern comparison is `start_time` + `make_interval(mins => duration_minutes)`; `class_schedule` has no `end_time` column, do not add one.
- One definition: `enrollment_clashes(student_id, class_group_id)` SQL function, used by the trigger, by the calendar's warning (`readGrid` adds `clashStudents` per booking, like `instructor_status`) and by the migration's count. Never a TypeScript copy.
- `enrollmentRefusal` in `classes.repository.ts` gains the `enrollment_clash` branch; `FormState.values` carries the figures to `t('enrollment.clash', values)`.
- The trap: `cs` means `class_schedule`; a turma can have several patterns, so the join is pattern × pattern, not turma × turma. And `LEFT JOIN class_group` is irrelevant here — only turmas enrol, parcerias never do.
- New `TENANT_TABLES` entry: none (no new table).

### QA

1. Given a student active in turma A (Mon 18:00–18:45), when enrolled in turma B (Mon 18:30–19:15), then 409 `enrollment_clash` naming A, Monday, 18:00; the form shows the sentence under the turma field.
2. Given the same, when B is Tue 18:00, then enrolled.
3. Given B is Mon 18:45–19:30, then enrolled (touching is not overlapping).
4. Given A is pool and B is tennis, same hour, then 409 — sport is irrelevant.
5. Given a `waiting` enrolment in B that clashes, when promoted to active, then 409 and the position is kept.
6. Given both enrolled before this ticket, then the migration's count is 1 and the Turmas page shows the warning for owner/admin and nothing for an instructor.
7. Given a series move of A onto B's hour, then the move is written, the block carries the clash mark and the card names the student.
8. Given a lead placed from the app into a clashing turma, then the office sees the same 409 at *Colocar*.
9. Given another tenant's turma at the same hour, then no clash (cross-tenant).
10. Both themes for the calendar mark; the role-probe stays green.

### Acceptance criteria

- [x] `enrollment_clashes()` function; constraint trigger on `enrollment`; DETAIL with its figures.
- [x] 409 `enrollment_clash` through every enrolment path (QA 1, 5, 8).
- [x] Calendar warning on a move that creates a clash; nothing blocked.
- [x] Existing clashes counted and shown, never changed.
- [x] `docs/data-model.md` and `docs/features/classes.md` updated; one line in `CLAUDE.md` beside *Capacity rules compose*.
