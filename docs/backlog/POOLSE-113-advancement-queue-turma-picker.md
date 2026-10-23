# POOLSE-113 · The advancement queue picks a turma in `TurmaPicker`

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX · **Area:** Levels / Turmas · **Priority:** Medium · **Depends on** [POOLSE-19](./POOLSE-19-automatic-level-advancement.md) (the queue and its ranking), [POOLSE-110](./POOLSE-110-registration-requests-clearer-class-picker.md) (`TurmaPicker`), [POOLSE-112](./POOLSE-112-advancement-by-age-at-season-end.md) (age proposals)

### PO — why this exists

`TurmaPicker` (POOLSE-110) is the one way staff choose a turma: grouped, searchable, a row per turma with its slots, instructor and a fill bar with its figure. The advancement queue (`students/advancement/proposal-card.tsx`) still draws its own list: the candidates `transfer_candidates()` ranks — *mesmo dia e hora*, *mesmo instrutor*, *com vaga* — each with its own Confirmar button and one shared *A partir de* date. Since POOLSE-112 the queue also holds age proposals, often a whole level at once in September. A card with twelve candidate rows, each carrying a button, stops working at that size.

**What to build.**

1. The proposal card picks its turma in `TurmaPicker`: one picker and one *Confirmar* per card, with the effective date beside it. The rows are the proposal's **candidates**, not every turma in the club. A turma at the wrong level is not an answer here, and the API refuses it anyway (`no_such_turma`).
2. The ranking is kept and shown. The rows are grouped by rank reason, in rank order: *Mesmo dia e hora*, *Mesmo instrutor*, *Com vaga*. They are not grouped by level, since every candidate is at the level being advanced to. The reason is the group heading, in words.
3. A full turma is not offered (`allowFull` false). The seat is re-checked in the transaction, and `seatGone` already says so if two admins race.
4. *Ready, no seat* is unchanged. An empty candidate list keeps today's warning sentence and shows no picker: POOLSE-19 criterion 6 is a demand signal, not a to-do.

**Out of scope.** The enrolment form on a turma's page, which picks a *student*, not a turma. The family's enrolment in the app stays a later slice.

### BA — rules

- `TurmaOption` gains an optional `group?: { key: string; label: string; order: number }`. When every row carries it, it replaces the level grouping. That makes it one component with one more input, and no second picker. `requestedLevelName` is then null for this caller.
- Each candidate row reads the same as everywhere else: name, level, slots (weekday and start time of the turma's live schedules), the instructor's short name, and the fill (capacity and active enrolments, with a bar).
- `transfer_candidates()` keeps its ordering and reasons exactly; `advancement.sql` pins them.
- Confirming posts the same `{ classGroupId, effectiveOn }` to `POST /transfer-proposals/:id/confirm`. There is no API contract change beyond read-only fields on a candidate.
- An *applied* proposal (POOLSE-112, `appliedAt` set) uses the same picker, under its *nível já alterado* line. Confirming it moves only the enrolment.

### Dev notes

- `proposal-card.tsx`: replace the `<ul>` of candidate rows with `TurmaPicker` and one submit. The `useTransition` confirm path and the `failure` sentence stay. The chosen id is read from the form, as Pedidos does.
- `TransferCandidate` gains `slots`, `instructorName`, `capacity` and `active`, read in the repository's `jsonb_agg` per candidate. They are not added to the function, whose return type would need a migration, and nothing about its ranking changes.
- `advancement.reason.*` already exist in both languages and become the group labels.
- **Most likely to go wrong:** grouping by level out of habit, which shows one group and drops the ranking.

### QA — scenarios

1. **Given** a proposal with a same-slot, a same-instructor and a merely-available candidate, **then** the picker shows three groups in that order, each labelled in words. Picking the first and confirming enrols into it (existing integration test extended, not a new path).
2. **Given** a candidate turma that fills between the page load and the click, **then** the card says `seatGone` and the proposal stays pending.
3. **Given** a proposal with no candidates, **then** no picker renders and the *sem vaga* sentence does.
4. **Given** an applied (age) proposal, **then** the picker renders under the *nível já alterado* line, and confirming moves only the enrolment.
5. On a phone (`phone-tier2.spec.ts`), the card's picker is usable one-handed, and the Confirmar button is not pushed below the fold by the list.

### Acceptance criteria

1. One component picks a turma everywhere staff pick one: Pedidos and the queue.
2. The ranking's reason is visible on the queue, in words, in rank order.
3. Both languages; `advancement.sql` and the queue's integration tests green; a phone spec line added; `docs/features/students.md` updated; one decisions line.
