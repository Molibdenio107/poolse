# POOLSE-148 · A student holds a level in each sport they do, and advances on each sport's ladder on its own

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Slices A, B and C built 01-11-2026 (Atividade revert for another sport's level still open).** · **Type:** Feature · **Area:** Students / Levels · **Priority:** Medium · **Depends on** [POOLSE-126](./POOLSE-126-levels-and-seasons-per-sport.md), [POOLSE-143](./POOLSE-143-alunos-and-its-children-per-sport.md)

### PO — why this exists

Rui, 01-11-2026: *"Levels and advancement should be independent from sport to sport, a level of swimming can be different name despite having the same age group that tennis … a student can have 1 or more sports, and hold different levels for different sports."* POOLSE-126 put each level on one sport's ladder, and POOLSE-143 split Níveis and Avanços into each sport's group, but a student still holds **one** `level_id`. A child in swimming and tennis can be on only one of the two ladders.

**Not in scope:** competition for sports other than swimming (its own backlog item); pricing a mensalidade by a sport's level beyond what the turma's level already does; instructor scoping (POOLSE-145).

### BA — rules

1. A student holds **at most one live level per sport**. The swimming level stays on `student.level_id`, so every existing screen, price, FPN form and import keeps reading it unchanged. Every other sport's level is a row in `student_sport_level (student, sport, level)`. (Rui, 01-11-2026, over keeping one level.)
2. A level row's level must be on that sport's ladder (`student_level.sport_id = sport`), and `student.level_id` must be on the swimming ladder. Both are refused by the database, never just by the form.
3. **One write path.** `setStudentLevelIn` decides where a level goes from the level's own sport: swimming writes the column, and any other sport upserts its row. A person's edit, a confirmed advancement, the automatic mode and Atividade's revert all already call it. Clearing a sport's level names the sport.
4. The record shows **one level per sport the student does** (their active turmas' sports, plus any sport they hold a level in), each settable by owner and admin. A pool-only club's record is unchanged.
5. A sport's *Alunos* shows that sport's level in the row, and its *Nível* filter is that sport's ladder.
6. **Advancement is per sport.** A proposal is already on one ladder (its from/to levels share a sport). Skills proposals and age proposals (`propose_age_advancements`, `age_fit_level`) read the student's level **in that ladder's sport**. Confirming moves that sport's level only, and ends only the enrolments at the level being left.
7. Existing data: any `student.level_id` that names another sport's level moves to that sport's row and the column clears. Nothing is lost.

### Slices

- **A — schema, the one write path, the record.** Table, constraints, migration of stray rows, `setStudentLevelIn` per sport, `GET /students/:id` returns `sportLevels`, `PUT /students/:id/sport-level` sets one, the record shows a level per sport. The change is audited as `student.sport_level_set`, not yet revertible from Atividade.
- **B — lists.** A sport's *Alunos* row level and level filter read that sport's level.
- **C — advancement.** Skills and age proposals per sport; confirming and the automatic mode move only that sport's level; Atividade can revert a sport level.

### QA

1. Given a student in swimming and tennis, when the office sets *Ténis 2*, then their swimming level is unchanged and the record shows both.
2. Given *Natação 3* sent as a tennis level, then 400/refused; a tennis level written to `student.level_id` is refused by the database.
3. Given a pool-only club, then the record and every list are as before.
4. Given a tennis proposal confirmed, then the tennis level moves, the swimming level and swimming enrolments do not.
5. Given an instructor, then setting a level is refused (403), as today.
6. Another club's student or level: not found, never written (cross-tenant).

### Acceptance criteria

- [x] `student_sport_level` with tenant key, composite keys, RLS, a partial unique index on live rows, and the sport-match rule in the database.
- [x] `setStudentLevelIn` is the only writer, for every sport.
- [x] The record shows and sets a level per sport; pool-only unchanged.
- [x] A sport's Alunos reads that sport's level (slice B).
- [x] Advancement per sport, end to end (slice C). Atividade revert of another sport's level: open.
- [x] `docs/data-model.md`, `docs/features/students.md` updated.
