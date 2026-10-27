# Poolse — the advancement queue picks a turma in `TurmaPicker` (POOLSE-113)

Paste this into Claude Code in VS Code (repo: Poolse):

---

Read `CLAUDE.md`, `docs/backlog/CONVENTIONS.md`, the **POOLSE-110 and POOLSE-112 entries** of
`docs/decisions.md`, and `docs/features/students.md` → *Advancement by age*. Do not read the whole
backlog folder. No migration is expected; if one turns out to be needed, use the `write-migration`
skill and say why before writing it.

First create `docs/backlog/POOLSE-113-advancement-queue-turma-picker.md` from this prompt (PO / BA /
Dev / QA / AC) and add it to `docs/backlog/README.md`. Then build it as one vertical slice.

## Housekeeping before any code (five minutes)

POOLSE-112 was built on 23-10-2026 by a cloud session and applied to the working tree, not
committed. Check `git status`: if it still shows ~25 modified files and 8 new ones, run

```
git add -A
git commit -F .poolse-112-commit-msg.txt
```

then delete `.poolse-109.patch`, `.poolse-112.patch` and `.poolse-112-commit-msg.txt` from the
repo root (they are not the product's). Run `pnpm db:migrate` (one new migration,
`1792317600000_advancement-by-age`) and `pnpm db:test`. Fourteen `api:test` cases in `files`,
`partner-contract` and `medical-certificate` need S3Mock on `:9090` (`pnpm db:up` starts it) —
confirm they pass here; the cloud session had no S3Mock and could not.

## Where things stand

- `TurmaPicker` (`components/turma-picker.tsx`, POOLSE-110) is the one way to choose a turma:
  grouped by level with the requested level first, searchable, a row per turma with slots,
  instructor and a fill bar with its figure, a full turma pickable only where `allowFull`. Its rows
  are `TurmaOption[]`, built today in one place — `pedidos/page.tsx` from `GET /class-groups`.
  POOLSE-110's own note says *the enrolment form and the app swap to it next*.
- The advancement queue (`students/advancement/proposal-card.tsx`) still draws its own list: the
  candidates `transfer_candidates()` ranks — *mesmo dia e hora*, *mesmo instrutor*, *com vaga* —
  each with a Confirmar button and one shared *A partir de* date. POOLSE-19 criterion 3 is that
  ranking, and its reason in words is what makes an admin trust the suggestion. That must survive.
- Since POOLSE-112 the queue also holds *age* proposals, often a whole level at once in September,
  and a card with twelve candidate rows each carrying a button is the shape that stops working at
  that size. The card already says why the child is there and whether the level was applied.

## PO — what to build

1. **The proposal card picks its turma in `TurmaPicker`**, one picker and one *Confirmar* per
   card, with the effective date beside it. The rows are the proposal's **candidates** (the
   ranked list), not every turma in the club: a turma at the wrong level is not an answer here,
   and the API refuses it anyway (`no_such_turma`).
2. **The ranking is kept and shown.** Group by the rank reason, in rank order — *Mesmo dia e hora*,
   *Mesmo instrutor*, *Com vaga* — rather than by level (every candidate is at the same level, the
   level being advanced to). The reason stays the group heading, in words, so nothing a colour or a
   position alone carried is lost.
3. **A full turma is not offered** (`allowFull` false): a seat is re-checked in the transaction and
   `seatGone` already says so if two admins race; the picker simply should not invite it.
4. **"Ready, no seat" is unchanged** — an empty candidate list keeps today's warning sentence and no
   picker, because criterion 6 says that state is a demand signal, not a to-do.
5. **The enrolment form on a turma's page is out of scope** — it picks a *student*, not a turma;
   POOLSE-110's note was about the family's enrolment in the app, which stays a later slice.

## BA — rules

- `TurmaOption` needs a way to carry the rank reason as the grouping key. Prefer adding an optional
  `group?: { key: string; label: string; order: number }` to `TurmaOption` that, when present on
  every row, replaces the level grouping — one component, one more input, no second picker.
  `requestedLevelName` is then irrelevant for this caller and may be null.
- The candidate's `freeSeats` is the figure the fill bar shows; `className`, `levelName` map
  straight across. Slots and instructor are **not** on `TransferCandidate` today — add them to
  `transfer_candidates()`'s return (weekday + start time of the turma's live schedules, and the
  instructor's short name) and to the repository's `jsonb_agg`, so the picker's rows read the
  same as everywhere else. Keep the function's ordering and reasons exactly as they are; the SQL
  test `advancement.sql` pins them.
- Confirming posts the same `{ classGroupId, effectiveOn }` to `POST /transfer-proposals/:id/confirm`.
  No API contract change beyond the two new read-only fields on a candidate.
- An *applied* proposal (POOLSE-112, `appliedAt` set) uses the same picker; the card's line
  *Nível já alterado a … — falta escolher a turma* stays above it.

## Dev notes

- `proposal-card.tsx`: replace the `<ul>` of candidate rows with `TurmaPicker` + one submit; the
  `useTransition` confirm path and `failure` sentence stay. The picker posts the id as a named
  field; read it from the form rather than a click handler, as Pedidos does.
- `advancement.repository.ts` → `TransferCandidate` gains `slots` and `instructorName`;
  `transfer_candidates()` gains two columns. Both languages for any new string
  (`advancement.reason.*` already exist and become the group labels).
- The thing most likely to be got wrong: grouping by level out of habit and dropping the reason.
  Every candidate here is at one level; a picker grouped by level would show one group with the
  ranking gone.

## QA — scenarios

1. **Given** a proposal with a same-slot, a same-instructor and a merely-available candidate,
   **then** the picker shows three groups in that order, each labelled in words, and picking the
   first and confirming enrols into it (existing integration test extended, not a new path).
2. **Given** a candidate turma that fills between the page load and the click, **then** the card
   says `seatGone` and the proposal stays pending.
3. **Given** a proposal with no candidates, **then** no picker renders and the *sem vaga* sentence
   does.
4. **Given** an applied (age) proposal, **then** the picker renders under the *nível já alterado*
   line and confirming moves only the enrolment.
5. On a phone (`phone-tier2.spec.ts`), the card's picker is usable one-handed and the Confirmar
   button is not pushed below the fold by the list.

## Acceptance criteria

1. One component picks a turma everywhere a turma is picked by staff: Pedidos and the queue.
2. The ranking's reason is visible on the queue in words, in rank order.
3. Both languages, `advancement.sql` and the queue's integration tests green, phone spec line added,
   `docs/features/students.md` updated, one decisions line.

## Standing rules

- Docs updated in the same commit as the behaviour change; `CLAUDE.md` gets one line only if a
  convention changed (the `group` input on `TurmaPicker` probably earns it).
- Refactors proposed in one line and gated on my OK — never inlined.
- Ask questions directly, when they come up, rather than collecting them into the closing summary.
- Close with two lines: what now works, and the single obvious next slice.
