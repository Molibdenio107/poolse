# POOLSE-21 · Aula de reposição as a credit object

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Calendar / Attendance · **Priority:** Medium
**Borrowed from:** iClassPro makeup tokens (expiry, eligibility filtering, backfill-only rule).

### PO — why this exists

A reposição owed to a family is currently a note someone remembers, which means it is either forgotten or honoured twice. Making it a credit object gives the family something they can see and book, and gives the office a number it can close out at the end of the época. Families and front desk both benefit; the office stops arbitrating from memory. Medium priority because it depends on attendance being stable and on POOLSE-13's *falta justificada* state landing first.

**Not in scope:** compensating closures — a closure cancels the class and mints nothing (POOLSE-31 AC 8, and its Note); refunds or any monetary settlement of an unused credit; credits for unjustified faltas.

### BA — rules and data

- A credit is minted **only** by an absence marked *Falta justificada*. *Faltou* mints nothing. An occurrence cancelled by a closure mints nothing and is not an absence at all — deliberate, per POOLSE-31.
- Minting is configurable per tenant **and** per turma. The turma setting wins where both are set; the effective rule must be resolvable at mint time and stored on the credit, so changing the setting later does not retroactively rewrite history.
- Credit record: tenant, student, originating_absence (occurrence + attendance row), issue_date, expiry_date, status (available / booked / used / expired), booked_occurrence, redeemed_at, source_rule snapshot.
- Redemption candidates are filtered to: matching level, student's age inside the turma's range, a date strictly before expiry, not a closure date, not a feriado (POOLSE-31), and an open seat.
- The optional tenant rule **backfill-only** restricts candidates further to occurrences where another enrolled student has a recorded absence. **Conflict with AC 3:** a full turma with one absence has no "open seat" under a naive count, so backfill-only and open-seat are mutually exclusive unless a recorded absence is treated as temporarily freeing a seat for that occurrence. Decide it as: for the purposes of reposição eligibility on a given occurrence, capacity = enrolled minus recorded absences on that occurrence, so both filters can hold at once.
- Credits are always offered oldest-expiry-first. Where expiries tie, oldest issue date first.
- Redemption mode is per tenant: self-service (student/EE books from the mobile app) or request (staff approve). In request mode a booking sits in a pending state that holds the seat until approved or rejected, with a timeout so an abandoned request does not block the slot indefinitely.
- A student attending as a reposição is a **guest** on that roster: attendance is recorded, they do not appear in the turma's enrolled-student list (POOLSE-08), they do not count towards enrolled seats for POOLSE-19's proposals, and they are addressable as a separate audience in communications.
- Cap on credits per student per época is configurable. When the cap is reached, further justified absences mint nothing and the fact is recorded so staff can explain it.
- A scheduled job expires unused credits, writes the expiry and stops any pending notification. Expiry must be evaluated in the tenant's timezone against the credit's expiry date, not in UTC.
- Cancelling a booked reposição before the occurrence returns the credit to *available* with its original expiry unchanged; after the occurrence it is *used* whether or not the student turned up.
- **Decided 28 Aug: a configurable window from the absence, capped at the end of the época.** Default 60 days. Every family gets the same window, and no credit outlives the turma, the level or the enrolment that produced it — an absence in the last week of the season gets the days that remain, not sixty. The window and the cap-flag are **snapshotted onto the credit at mint time**, so a club shortening its window in March cannot shorten a credit issued in February: a family told "you have until 11 May" has been told something, and a settings change is not permission to un-tell them.

### Dev — implementation notes

- Migration: `reposicao_credit`, `reposicao_booking`, tenant-level and turma-level minting settings, per-época cap. Tenant key on all; index on (tenant_id, student_id, status, expiry_date) because oldest-expiry-first ordering is the hot query.
- Minting hooks into the attendance write path, transactionally with the attendance row, so an attendance state change and its credit cannot diverge. Changing *Faltou* → *Falta justificada* mints; the reverse revokes an unbooked credit and must refuse if the credit is already used.
- One shared eligibility helper computes occurrence capacity as enrolled minus recorded absences, and is reused by redemption filtering, POOLSE-19 seat counting and the roster view. This is the single most important piece of shared logic in the ticket.
- API: `GET /credits?studentId=` (oldest-expiry-first), `POST /credits/:id/book {occurrenceId}`, `POST /bookings/:id/approve|reject`, `POST /bookings/:id/cancel`. Booking takes a row lock on the occurrence and re-validates capacity inside the transaction.
- Permissions server-side: a Student or EE may book only for themselves or their own linked students (POOLSE-04 guardianship edges), and only when the tenant is in self-service mode. In request mode their booking endpoint creates a pending request, never a confirmed booking; approval is Owner/Admin/assigned Instructor.
- Expiry job is a per-tenant scheduled task, idempotent, safe to re-run, and must not re-notify on a second pass.
- i18n: *reposição*, *falta justificada* and credit status names are keys in pt-PT and en; expiry dates and any "expires in N days" copy use locale formatting and plural rules. The guest marker on the roster needs a text label, not a colour dot, and its token must be checked in light and dark and stay clear of the attendance palette.
- Most likely to be got wrong: counting the reposição guest as an enrolled student somewhere — the POOLSE-08 list, the seat count, an occupancy figure, or a communications audience — which is exactly what AC 8 exists to prevent.

### QA — test scenarios

21.1 Given a tenant with minting on / When an absence is marked *Falta justificada* / Then exactly one credit is minted with a status of available.
21.2 Given the same tenant / When an absence is marked *Faltou* / Then no credit is minted.
21.3 Given a closure covering a turma occurrence (POOLSE-31) / When the closure is saved / Then the occurrence is cancelled, no attendance is recorded, and no credit is minted for anybody.
21.4 Given a turma at full capacity with one recorded absence on an occurrence and backfill-only enabled / When a credit is redeemed / Then that occurrence is offered and the turma is not pushed over capacity.
21.5 Given a turma at full capacity with no absences / When a credit is redeemed with backfill-only enabled / Then the occurrence is not offered.
21.6 Given a student with three credits of differing expiry / When they open redemption / Then the earliest-expiring is offered first.
21.7 Given a credit expiring on the 30th / When the student tries to book an occurrence on the 31st / Then the occurrence is not listed, and a direct API booking of it returns a validation error.
21.8 Given an EE authenticated on the mobile app / When they call the booking endpoint for a student they are not linked to / Then `403`.
21.9 Given the tenant in request mode / When an EE books from the app / Then a pending request is created, the seat is held, and no attendance-bearing booking exists until staff approve.
21.10 Given a booked reposição / When the student is added to that roster / Then they appear as a guest, are absent from the POOLSE-08 enrolled list, and do not consume a seat in a POOLSE-19 proposal for that turma.
21.11 Given a student who has hit the per-época credit cap / When another justified absence is marked / Then no credit is minted and the reason is recorded and explainable to staff.
21.12 Given the pt-PT and then the en locale, in light and dark mode / When the credits list and the guest marker render / Then all copy and dates are localised and the guest marker is legible and readable without colour.

### Acceptance criteria

1. Marking an absence as *Falta justificada* (POOLSE-13) optionally mints one credit — configurable per tenant, and per turma.
2. A credit is a record with: student, originating absence, issue date, **expiry date**, status (available / booked / used / expired).
3. Redemption lists only eligible turmas — matching level, within the student's age range, with an open seat, on a date before the credit expires. Closed dates and holidays are excluded.
4. Optional tenant rule: **redeemable only into a slot where another student has a recorded absence**, so a reposição never pushes a turma over capacity.
5. Credits are presented oldest-expiry-first so the perishable ones are used first.
6. Two redemption modes per tenant: self-service (student/EE books directly from the mobile app) or request (staff approve).
7. A scheduled job expires unused credits and records the expiry.
8. A student attending as a reposição is visibly a **guest on that roster** — counted for attendance, excluded from the turma's enrolled-student list (POOLSE-08), and addressable separately in communications.
9. Configurable cap on credits per student per season.

---

## Built 28 Aug — slice 1 of 2

**Split at a real boundary.** A credit that exists, expires correctly and can be
seen is useful on its own: the office can already answer "what do we owe this
family?", which is the question the ticket opens with. A booking table with
nothing reliable to book against is not.

**Done — criteria 1, 2, 5, 7, 9:**

- `reposicao_credit`, the settings at club and turma level, and `reposicao_expiry()`.
- Minting and revocation as a **trigger on `attendance`**, not application code.
  The ticket asks for minting to be transactional with the mark; a repository
  method achieves that only for the write paths that remember to call it, and the
  register screen, an importer, a correction endpoint and a future mobile app are
  four chances to forget. Correcting *falta justificada* → *faltou* revokes an
  unspent credit and **refuses** when the family has already spent it.
- The per-época cap, with the refusal recorded in the audit log so the front desk
  can answer "why did we not get one for that?" — QA 21.11.
- `expire_reposicao_credits(org, date)`: idempotent, and evaluated against a date
  the caller passes, because expiry is a question about the club's calendar day.
- `GET /students/:id/credits`, oldest-expiry-first; a credits panel on the student
  record; `GET|PATCH /settings/reposicao` and a settings page under Turmas.

**Not done — criteria 3, 4, 6, 8**, the whole of redemption:

- `reposicao_booking`, the two approval modes and the pending-hold timeout.
- The shared eligibility helper — occurrence capacity as *enrolled minus recorded
  absences* — which the ticket calls the single most important piece of shared
  logic, and which POOLSE-19 and the roster view both need.
- The backfill-only filter, and the guest marker on the roster (AC 8), including
  the thing the ticket names as most likely to be got wrong: counting a reposição
  guest as enrolled somewhere.
- `POST /credits/:id/book` and the booking permission rules for a Student or EE.

The settings for redemption — `backfill_only` and `mode` — are already stored and
already editable, because a club turning the feature on wants to answer the whole
question in one sitting. Nothing reads them yet.

**No scheduled-job runner exists in the product**, so criterion 7 is a function
with a test rather than something that fires nightly. Wiring it to a scheduler is
a deployment concern and belongs with whatever runs the first cron.
