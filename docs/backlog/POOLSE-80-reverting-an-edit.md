# POOLSE-80 · Reverting an edit

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Global / Data integrity · **Priority:** Medium · **Depends on** POOLSE-78 · **Brainstormed** 11-10-2026

### PO — why this exists

Delete is already Owner/Admin only, so an instructor's mistakes are almost never deletions.
They are **edits**:

- a register marked on the wrong day;
- a student moved to the wrong level;
- a turma's capacity or instructor changed by accident.

POOLSE-78 puts back what was archived; this ticket puts back what was changed. It does so
for a small set of entities first, the ones where staff other than the Owner write most
often.

**Not in scope:** money (fee lines, payments, salaries, invoices); their history is the
effective-dated table or a credit note, never a field revert. Also out: anything already
sent (messages, alerts); derived values; lesson-plan text; and undoing a revert's
consequences elsewhere ("put the student back in the level" does not re-enrol them in last
week's turma).

### BA — rules and data

**Where:** an *Atividade* tab on the record's page (`DetailPage`), Owner/Admin only. It
lists the record's audit entries newest first: who, when, which fields, from what to what.
A field change carries *Reverter*.

**Reverting** writes the `before` value back, field by field, as a new change. It goes
through the ordinary update path with its validation and triggers, and records its own
audit entry naming the one it reverts. **A revert is itself revertible.** Nothing in the
history is ever edited or removed.

**A field changed again since** is a conflict, not an overwrite. The screen shows the
three values (before, what that edit set, current) and asks which to keep. The API
refuses a blind revert with 409 `revert_conflict`, carrying the values as structure.

**Attendance** is a row, not a field: reverting "marked present" removes that mark through
the existing register path. It is refused once the occurrence has been invoiced, with that
sentence.

**Open — 1: the v1 entities.** *Recommend:* **student** (personal fields, level),
**attendance** and **turma** (`class_group`: capacity, level, instructor, name). These are
where instructors and admins write most, and none of them touch money.
**Answered 16-10-2026 (Rui):** those three, and only their non-personal fields — see
`docs/features/archive.md`.

### Dev — schema, API, where it goes

**No schema change** if the audit entries are already complete.
`audit_log.data = {"before": {...}, "after": {...}}` is the documented convention
(`docs/data-model.md`, audit), but **step one is an audit of the write paths for the v1
entities**: every update must record before/after for the fields it moved. A path that
records only `after` cannot be reverted, and its button must not render. A test per entity
asserts that an update produces a complete entry.

**API:** `GET /:entity/:id/activity` (paginated) and
`POST /activity/:auditEntryId/revert` with optional `{ resolve: { field: 'before' |
'current' } }` for conflicts. Owner/Admin. The revert calls the entity's own update
function, never an UPDATE of its own, so triggers, capacity rules and `recordAudit` all
run.

**What will be got wrong:**

- A generic `UPDATE <table> SET <field> = before` that bypasses validation and the capacity
  and licence triggers.
- Reverting a field whose `before` references a row since archived (a level that no longer
  exists). That is a 409 naming it, not an FK error.
- Rendering *Reverter* on an entry with no `before`.

### QA — test scenarios

1. **Given** an Admin changed a student's level, **when** the Owner reverts it, **then** the old level is back and both entries are in the activity list.
2. **Given** the field was changed again after, **when** reverted blindly, **then** 409 `revert_conflict` with the three values.
3. **Given** a revert, **when** it is reverted, **then** the field returns to the value before the first revert.
4. **Given** a turma's capacity reverted below its current enrolment, **then** the existing capacity refusal fires with its numbers.
5. **Given** an invoiced occurrence, **when** its attendance is reverted, **then** it is refused with a sentence.
6. **Given** an Instructor, **then** no *Atividade* tab and 403 on the endpoints.
7. **Given** an entry with only `after`, **then** no *Reverter* button and the API refuses.

### Acceptance criteria

1. Student, attendance and turma have an *Atividade* tab listing their changes with who, when, and before/after.
2. A field change can be reverted through the entity's own update path, recorded as a new revertible entry.
3. A conflicting revert is refused with the three values and resolved by an explicit choice.
4. Every v1 write path records complete before/after, asserted by test.
5. Money, sent messages and derived values have no revert.
6. pt-PT and en; `docs/features/archive.md` extended.
