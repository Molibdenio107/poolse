# POOLSE-187 · An older unpaid period stays owed, so *Em dívida* says everything a family owes

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Finance / Students / Mobile app · **Priority:** High (pre go-live) · **Depends on** POOLSE-42, [POOLSE-178](./POOLSE-178-pagamentos-says-what-is-due-and-what-is-coming.md), [POOLSE-183](./POOLSE-183-custos-per-year-and-per-season.md) (built after it, by order only)

### PO — why this exists

Filed while building POOLSE-178 (05-11-2026): *"An older period left unpaid is in no total anywhere in Poolse."* Rui, 06-11-2026: ticket it, fix before go-live, build it after POOLSE-183.

`feeBalance` reads each line's **current** occurrence. When October goes unpaid and November starts, October leaves every total, so the office's fee block, the family's *Pagamentos* and the dashboard card all read lower than what is owed, and nothing on screen says so. The pilot is unpaid to Poolse, but the club will trust this figure when it chases a family.

**Not in scope:**
- Changing how a late penalty is charged: still one per kind of charge.
- Faturação's document-based *Em dívida*, whose state is `total − paid` on an invoice.
- A payment that covers part of a period. `student_fee_payment` settles a whole occurrence.
- Interest, payment plans, automatic reminders.

### BA — rules

1. **Every unpaid occurrence of a line, from its first owed period up to the current one, counts as owed.** One definition, on the server: `feeBalance` stays the only sum, and every screen reads `balance`.
2. **An occurrence is settled** by a live `student_fee_payment` for its `period_start`, as today.
3. **A line charged once** (no `fee_period_id`) is one occurrence, `starts_on`, and behaves as today.
4. **An ended line** owes every unpaid occurrence up to its `ends_on`. This extends the 19-10-2026 rule, which kept only the period it ended in.
5. **A future occurrence is never owed.** *Pagamentos*' next three stay as they are.
6. *Pagamentos* lists each older unpaid period under *Em dívida* by its own month, and the sentence says how many (*3 períodos em atraso*).
7. **An occurrence's amount is the line's `payableCents`**, because a line's amount does not change once agreed.
8. **A line owes from the month it was entered** (Rui, 06-11-2026). A line starting 01-09 entered in November has no payments for September and October, which may have been paid before Poolse, so an occurrence that began before the month of the line's `created_at` is not owed. The first owed period is the one holding `created_at`, or `starts_on` if later.

### Dev notes

- `current_period_start(starts_on, ends_on, months)` gives one period. A new STABLE function (or a `generate_series` lateral in `fees.repository.ts`, one query) gives them all. Use the `write-migration` skill if it becomes SQL. Dates come from `fee_due_on` and `club_today()`, never `current_date`.
- `BalanceLine` (`billing/fee-balance.ts`) gains the owed occurrences. `totalCents`, `paidCents` and `outstandingCents` must still add up. Write the older-unpaid case in `fee-balance.test.ts` first.
- Readers to check: `fees.repository.ts`, `family-fees.repository.ts`, `app/app.controller.ts`, `dashboard/resolvers.ts`, the attention count, and the monthly invoice run. `invoice_charged_on` stays the one definition of "already billed": an older unpaid period on a live document is one debt, never two.
- **Trap:** every join to `fee_period` from `student_fee` is a LEFT JOIN. An inner one drops a line charged once, which is how the register's *pago* tick nearly left a joining fee outstanding.
- **Trap:** the seed and the importers leave lines with no payments behind them, so a demo may suddenly show large debts. Rule 8 decides that; look at the seeded club before calling it done.

### QA

1. Given a monthly line from 01-09 created 01-09, with September paid and October and November unpaid, on 15-11, then `outstandingCents` counts two months and *Pagamentos* lists October and November.
2. Given the same line with October then paid, then it counts one month, and the figure falls on every screen together.
3. Given a line ended 20-10 with September and October unpaid, then both stay owed after October.
4. Given a joining fee charged once and unpaid, then it counts once, as before.
5. Given a line starting 01-09 but created 10-11, on 15-11, then only November is owed (rule 8).
6. Given a line with two unpaid periods, then the penalty is still one per kind of charge.
7. Given an older unpaid period on a live invoice, then the monthly run does not offer it again.
8. Given a student of another club, then the fee read answers 404; given a guardian with no link to the student, then 404.
9. Both themes, desk and phone, on *Pagamentos* with three older periods.

### Acceptance criteria
- [ ] Every unpaid occurrence up to the current one counts, through `feeBalance` alone.
- [ ] The office's fee block, *Pagamentos* and the dashboard card read one figure.
- [ ] Rule 8 holds, including for a line entered mid-way.
- [ ] `docs/features/students.md` and `docs/features/invoicing.md` updated.
- [ ] QA 1–9 green.
