# POOLSE-146 · A message can be sent to everyone in one sport, and a qualification type says which sport it is for

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Messages / Staff · **Priority:** Low (post go-live) · **Depends on** [POOLSE-145](./POOLSE-145-instructor-scoped-to-sports.md), [POOLSE-67](./POOLSE-67-messages-to-families.md), [POOLSE-27](./POOLSE-27-certification-expiry-with-amber-window.md)

### PO — why this exists

Two small things the 01-11-2026 brainstorm pulled in once an instructor belongs to sports. A club with swimming and tennis will want to tell *every tennis family* the courts are closed without picking six turmas, and a TPTD for swimming is not a tennis coaching licence, so a qualification *em falta* must be judged per sport or every tennis coach reads red for a swimming title.

**Not in scope:** per-sport message quotas (the 20 / 2,000 daily ceiling stays per club); a qualification type for a sport with no legal requirement known — the club types its own.

### BA — rules

1. `message_audience` gains `sport`; `message.sport_id` names it; the CHECK "exactly the one audience names" extends to it. `message_recipients_all()` gains the branch: active enrolment in a live turma whose recinto has that sport. Preview and send keep sharing the one function.
2. The audience control offers *Modalidade* only when `isMultiSport`; a pool-only club's composer is unchanged.
3. An instructor may choose a sport audience only for their sports (POOLSE-145); `myTurmaIds` still bounds the turma audience.
4. `qualification_type.sport_id` (nullable: every sport). `qualification_status()`'s *em falta* counts a required type only for instructors whose `membership.sports` contains the type's sport. The seeded TPTD / ISN / SBV types are `pool`… **Open:** SBV is first aid, not swimming — default: seeded with `sport_id` null.
5. The qualification alert (daily job) applies the same predicate, so no tennis coach is emailed about a swimming title.
6. Nothing a pool-only club sees changes: every type's `sport_id` is null after the migration except TPTD and ISN, and every instructor is `{pool}`, so the status of every existing record is identical — asserted by test.

### Dev notes

- `write-migration`: enum value, `message.sport_id` composite FK to `sport` (platform catalogue — a plain FK, the one non-tenant reference, as `playing_area.sport_id`), `qualification_type.sport_id`. Backfill TPTD and ISN by their seeded keys, not by name.
- `message_recipients_all()` is `SECURITY DEFINER`? Check — if so, the new branch stays under `current_organization_id()` like the others.
- The trap: `qualification_current` is read by the chip, the roster warning (POOLSE-27 `blocks_assignment`) and the alert; the sport predicate goes into `qualification_status()` once, not into each reader.

### QA

1. Given `{pool, tennis}`, when a message is sent to *Ténis*, then the preview and the send count the tennis families and only them; a student in both sports is counted once.
2. Given a tennis-only instructor, when they choose *Piscina*, then 403.
3. Given `{pool}`, then the composer has no *Modalidade* and `message_recipients_all()` answers as before for every existing audience.
4. Given a required type with `sport_id = tennis` and a pool-only instructor, then no *em falta* and no alert.
5. Given the migration on a club with existing qualifications, then every status is unchanged (rule 6).
6. Cross-tenant: a sport audience never reaches another club's families.
7. Both themes for the audience control.

### Acceptance criteria

- [x] `sport` audience through the one recipients function; composer offers it only when multi-sport. (Slice a, 02-11-2026; owner and admin only — Rui.)
- [x] `qualification_type.sport_id`; predicate in one place — `qualification_applies()`, since `qualification_status()` judges an expiry and knows no person (slice b, 02-11-2026).
- [x] Rule 6 proved by test (`qualifications-per-sport.integration.test.ts`).
- [x] `docs/features/messages.md`, `docs/features/staff.md`, `docs/data-model.md`.
