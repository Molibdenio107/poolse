# POOLSE-84 · Encerramentos por instalação ou por tanque

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug + feature · **Area:** Scheduling / Closures · **Priority:** High · **Depends on** POOLSE-31 · **Decided** 16-10-2026 (Rui)

> Written as POOLSE-81 in Rui's prompt; renumbered because 81 was already the competition ticket.

### Where things stand

Per-tank closures half exist already:

- `closure` has `facility_id` and `pool_id` (migration `1787835600000_closures-and-sessions.sql`).
- The Encerramentos form (`dashboard/calendar/closures/closure-calendar.tsx`) has an "Abrange"
  select: *Toda a instalação* or **one** tank.
- `apply_closure` / `generate_sessions` match `c.pool_id IS NULL OR c.pool_id = cs.pool_id`, and
  removing a closure restores what it cancelled (`class_session.closure_id`).

**The bug:** `facility_id` is never written and never read. "Toda a instalação" saves a closure
with both columns null, which means **every facility in the organization**. A club with two sites
that shuts one for works cancels classes at both.

### PO — what Rui decided (16-10-2026)

1. **No organization-wide manual closure any more.** A closure is always **one facility** or
   **one or more tanks** of one facility. **Exception: national holidays stay organization-wide**
   (`source = 'national_holiday'`), as they are today.
2. **Several tanks at once.** The operator can tick more than one tank in the same form. Each tank
   gets **its own closure row**, so each one can later be edited, shortened or removed on its
   own (one tank may reopen before the other).
3. **No new entry point.** The existing Encerramentos form is where this happens, including the
   pre-filled arrival from a pool's water warning.
4. **Meio dia.** A tick box "Só meio dia" with *Manhã* / *Tarde*. The cut is **13:00 in the
   facility's timezone**, judged on the session's **start** time: a class starting before 13:00
   is morning. No hour ranges for now.
5. **Everyone affected is cancelled and may be warned.** Every session on the closed tank(s) in
   the period is cancelled: turmas, parcerias (bookings), free-swim blocks and aulas experimentais.
   The existing opt-in "warn the families" (Mensagens, `closure` audience) is extended to:
   - families of affected turmas (as today),
   - **partners of affected parcerias, by e-mail to the partner's contact** (add a contact e-mail
     to the partner if there is none; same tick box and the same confirmed count),
   - leads whose aula experimental was cancelled.
6. **Visible everywhere the tank appears.** While a tank is closed:
   - its card (Instalações / site page) shows **"Encerrado até dd-MM-yyyy"** (or "Encerrado de
     manhã/à tarde" for a half day), with the reason;
   - **reception** shows it as closed and **refuses a free-swim check-in** on it (server-side,
     refusal with a sentence, not a disabled button);
   - the **calendar** shows the closure on that tank's lanes only, not across the whole site;
   - registers cannot be taken for the cancelled sessions (already true for `cancelled`: check it).

**Out of scope:** hour ranges, closing a single lane, closing an Espaço, an org-wide manual option.

### BA — rules and data

- A facility closure covers every tank of that facility. A tank closure covers that tank only.
- A tank closure inside a facility closure for the same days is redundant, not a conflict (same
  rule as POOLSE-31 used for org-wide). Two closures on the same tank and the same days still
  conflict, **except** a morning and an afternoon half-day on the same date, which do not.
- Half day is allowed **only when start date = end date** (assumption: say so in decisions.md).
  `repeats_annually` and half day may combine.
- Removing or shortening a closure restores exactly the sessions it cancelled, as today. A
  half-day closure restores only the half it took.
- Existing data: every **manual** closure with `facility_id IS NULL AND pool_id IS NULL` becomes
  **one closure per facility** of that organization (same dates, reason, flags), and sessions it
  cancelled are repointed to the new row of their own facility. A closure with a `pool_id` gets
  its `facility_id` filled from the pool.
- Who can do it: unchanged from POOLSE-31.

### Dev — schema, API, and what is most likely to go wrong

- **Every place that matches a closure to a session** must add the facility test:
  `(c.facility_id IS NULL OR c.facility_id = <session's pool's facility>) AND (c.pool_id IS NULL OR c.pool_id = cs.pool_id)`,
  plus the half-day test on the session's local start time. Grep `closure` across
  `packages/db/migrations` (latest definitions of `generate_sessions`, `apply_closure`,
  the restore step, the impact-count function) **and** `apps/api/src` (occupancy, bookings,
  timetable import, dashboard resolvers, vacations, cost report, messages, safety periods).
  `vacations` must keep reading **only** `national_holiday` closures as free days. Make
  `closure_covers` the one definition of the day *and* the half, so no reader re-derives 13:00.
- **CHECK:** `source = 'national_holiday' OR facility_id IS NOT NULL`. A pool closure's
  `facility_id` must equal the pool's facility: enforce it (composite FK or trigger), don't trust
  the API.
- **The overlap exclusion constraint** (from `1787889600000_closure-ranges.sql`) must now key on
  facility + pool and treat morning/afternoon on the same day as non-overlapping. This is the
  piece most likely to be written wrong: test it with two half days, a full day over a half day,
  and two different tanks.
- `part_of_day`: nullable enum `morning | afternoon` (English values, pt-PT via i18n). Null = whole day.
- Multi-tank create is **one transaction** inserting N rows; if one row hits the overlap
  constraint the whole create is refused and the 409 names the tank and the closure already there.
- Free-swim check-in refusal belongs in the check-in trigger / `pool_occupancy` path, under the
  pool lock, with the closure's end date in DETAIL.
- Partner contact e-mail: if `partner` has none, add the column (nullable); a partner without an
  address is counted as "not reachable" on the confirmation, never silently skipped.
- New/changed endpoints go into `security/role-probe.integration.test.ts`.

### QA — scenarios

1. Club with two sites: closing site A for a day cancels A's sessions and none of B's.
2. Site with 3 tanks: tick tanks 1 and 2 → two closure rows; tank 3's classes run.
3. Remove tank 1's closure only → tank 1's sessions come back, tank 2's stay cancelled.
4. Shorten tank 2's closure by two days → only those two days come back.
5. Morning half day on tank 1: a 10:00 class is cancelled, a 13:00 and a 15:00 class are not.
6. Morning and afternoon half-days on the same tank and date both save; a second full day on
   that date is refused with a 409 naming the closure already there.
7. Half day with start ≠ end is refused (422).
8. A parceria and a free-swim block on the closed tank are cancelled; with "avisar" ticked the
   partner contact gets a message recorded in Mensagens; a partner with no e-mail is counted as
   not reachable.
9. Free-swim check-in on a closed tank is refused with a sentence; on an open tank of the same
   site it works.
10. Tank card and reception show "Encerrado até dd-MM-yyyy" during the closure and nothing after.
11. Migration: an existing org-wide manual closure becomes one per facility; national holidays
    are untouched and still free days in the vacation calendar.
12. API refuses a manual closure with no facility; refuses a pool from another facility; an
    instructor / guardian / student cannot create one (role probe).

### Acceptance criteria

1. No manual closure can be org-wide; national holidays stay org-wide.
2. A closure applies only to its facility, or only to its tank(s). Bug fixed and covered by test 1.
3. Several tanks can be closed in one form, stored as independent closures.
4. Half day (manhã/tarde, cut at 13:00 facility time, single-day only) works end to end.
5. Every session type on the closed tank(s) and period is cancelled and restored correctly.
6. Families, partners and trial leads can be warned through the existing opt-in, with a count.
7. Closed tanks are visible on the tank card, reception (check-in refused) and the calendar.
8. pt-PT + en strings, light/dark, all QA scenarios green, `pnpm api:test` green.

### Housekeeping

Update `docs/data-model.md` and `docs/features/` (closures / calendar / reception) in the same
commit. Add to `docs/decisions.md`: org-wide manual closures removed (holidays kept org-wide),
multi-tank = one row per tank, half day cut at 13:00 on session start and single-day only,
partners warned by contact e-mail. One line in `CLAUDE.md` for the closure scope rule.
Refactors: propose in one line, don't do them. Close with: what works now + the next slice.
