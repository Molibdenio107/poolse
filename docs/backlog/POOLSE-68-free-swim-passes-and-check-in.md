# POOLSE-68 · Free swim, entry passes and reception check-in

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Reception / Billing · **Priority:** High — a revenue stream Poolse does not touch today · **Depends on** 2.2 invoicing (built), POOLSE-46 bookings (built) · **Roadmap** 7.2

### PO — why this exists

Turmas are the whole product so far. Many municipal pools earn as much from *natação livre* —
somebody walks in, pays for one entry or a pack of ten, and swims. Today that is a paper ticket
book at reception and nobody knows how many people were in the water at 19:00. It is also the
attendance data 6.1 will want that is not a register.

**Not in scope:** turnstile or door hardware, printing QR cards, selling passes online, a till or
cash-desk reconciliation (that is a POS, which waits on 7b.7's certified invoicing), and
discounts beyond the fee categories that already exist.

### BA — rules and data

**A pass product lives on the facility**, priced like everything else in `docs/financials.md`:
gross `amount_cents`, `vat_rate`, `vat_exempt`, `money_provenance` (`contracted` when typed).
Three shapes, held by CHECK on one table — never a table per shape:

- **single entry** — one use, valid on the day of sale;
- **pack of N** — N uses, optionally expiring a number of days after sale;
- **time-boxed pass** — unlimited uses between two dates (a month, a season).

**A pass belongs to a person.** Reuse `membership` — a walk-in who comes back is a person the club
knows; a one-off single entry may be sold to nobody in particular. No new person table.

**A sale is a document line through 2.2's invoicing**, never a parallel money table. The pass
holds a reference to the line that sold it; a credit note on that line voids the pass.

**Check-in** records one entry: who (or an anonymous single entry), which tank, when. A pack
decrements by derivation — uses remaining is `N − count(check-ins)`, computed in SQL and never a
stored counter. A time-boxed pass validates its dates. Expiry is derived, never a flag.

**Live occupancy per tank** is check-ins still in the water (no check-out → a configurable
default stay) plus the turmas running now, against `pool.max_capacity`. Capacity rules compose:
free swim and concurrent turmas share the tank. A check-in that would exceed it is refused as a
409 carrying `{ capacity, occupied, requested }`. A null ceiling enforces nothing.

**Open:** may a free-swim period be defined as a booking on the lane grid, or is it whole-tank
only in v1? *Recommend:* a booking with subject type `free_swim`, so the grid stays the one
picture of the pool and the lane exclusion already prevents a turma landing on a public lane.

**Open:** check-out — record it, or derive "in the water" from a default stay? *Recommend:* derive
from a per-facility default stay (90 min) in v1, and let reception check somebody out early.

### Dev — schema, API, where it goes

New: `pass_product` (facility-scoped, the three shapes by CHECK), `pass` (one sold pass,
`membership_id` nullable only for a single entry, `invoice_line_id` composite FK),
`pass_check_in` (insert-only, `pool_id`, `checked_in_at`, `checked_out_at` nullable). All
tenant tables with composite FKs, RLS, and an entry in `TENANT_TABLES`.

`invoice_line` gains a nullable reference so a pass is a kind of line — check how `student_fee`
attaches before adding a second way in.

**Occupancy is one SQL definition** read by the check-in refusal, the reception screen and the
dashboard card, and it LEFT JOINs `class_group` when counting turmas in the water — a parceria
fills the tank too.

**What will be got wrong:** a `uses_remaining` column; counting turma students from `capacity`
instead of from enrolments; a check-in race at capacity (lock as `pool_capacity_respected` does);
summing pass revenue with mensalidades into one unlabelled figure.

### QA — test scenarios

1. **Given** a pack of 10 with 3 check-ins, **then** 7 remain; **given** the 10th, **then** the 11th
   is refused with words, not a disabled button.
2. **Given** a monthly pass, **when** checked in the day after it ends, **then** refused as expired.
3. **Given** a tank at capacity 40 with a turma of 12 in the water and 28 free swimmers, **when** one
   more checks in, **then** 409 with the three numbers.
4. **Given** a null `max_capacity`, **then** check-in is never refused for capacity.
5. **Given** a sold pack, **when** its invoice line is credited, **then** the pass is void.
6. **Given** an Instructor or a student, **when** they POST a check-in or a sale, **then** 403.
7. **Given** Club B's pass id, **when** Club A checks it in, **then** refused — cross-tenant.
8. **Given** two check-ins racing for the last place, **then** exactly one succeeds.

### Acceptance criteria

1. Single entries, packs and time-boxed passes can be defined per facility and priced per
   `docs/financials.md`.
2. A sale is an invoice line; a credit note voids the pass.
3. Reception checks somebody in by name or sells and checks in an anonymous single entry in one
   action.
4. Uses remaining and expiry are derived in SQL.
5. Live occupancy per tank is shown and enforced against `pool.max_capacity`, composed with
   turmas, refused with its numbers.
6. Pass revenue is reported separately from fees.
7. The two Open items are answered and logged before the build starts.
