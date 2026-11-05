# POOLSE-182 · One cost ledger: every euro the club spends is an amount with a period, spread by day into months — energy and salaries read through, maintenance, insurance and fixed costs recorded

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture · **Area:** Finance / Energy / Maintenance / Data model · **Priority:** Medium (pilot) · **Depends on** [POOLSE-28](./POOLSE-28-heating-cost-per-lesson-hour.md), [POOLSE-106](./POOLSE-106-energy-page-dashboard-collapsible-import-bill-reading.md), [POOLSE-128](./POOLSE-128-energy-roll-up-and-allocation-per-recinto.md), [POOLSE-58](./README.md) (salaries), [POOLSE-154](./POOLSE-154-inventory-fixes-location-link-roles.md) · **Unblocks** [POOLSE-183](./POOLSE-183-custos-per-year-and-per-season.md), [POOLSE-184](./POOLSE-184-cost-suggestions-as-rules.md)

### PO — why this exists

Rui, 05-11-2026: *"We also need to show the electricity/gas/maintenance/energy costs per year and per season. We need to find a formula to tell the owner the average costs of everything together but separated at the same time per civil year and per season."*

Energy has euros (bills are facts, tariffs are estimates), salaries have euros, and nothing else does: a task completion carries no amount, an inventory item no price, an avaria no repair invoice, the apólice no premium, and rent or the Poolse subscription live nowhere. "Everything together" needs one place every euro can be read from, in one shape, so that a year and an época are two windows over the same rows and can never disagree. Decided the same day: maintenance cost means **external invoices and materials** (not maintenance salaries — those are salaries); scope includes **water, the insurance premium and fixed costs**; allocation is **pro-rata by day**.

**Not in scope:**
- The screen (POOLSE-183) and the suggestions (POOLSE-184).
- Attributing a cost to a tank or recinto beyond what already names one (POOLSE-128's rule stands: the "Geral" dial is never split by guess).
- Purchase orders, supplier accounts, accounts payable. A cost is recorded when the club has the invoice; nothing is "pending".
- Revenue. This is spend only; margin is a later ticket once invoicing is certified.

### BA — rules

1. **A cost is an amount with a period.** `period_from ≤ period_to`, both inclusive dates; a one-off has `period_from = period_to`. The amount is the document's total **without VAT** and VAT beside it (`amount_cents`, `vat_cents`), because a club that recovers VAT and one that does not read different numbers; the screen shows the one the club's tax setting says.
2. **The month allocation**: `share(month) = amount × overlap_days(period, month) / days(period)`, rounded to cents with the remainder on the last month so the shares sum exactly to the amount. Written to `cost_month` when the cost is recorded, re-written when it is edited, never on read.
3. **A window is a sum of its months**; a window boundary inside a month (an época starting 15-09) splits that month by days with the same rule. Civil year and época are both windows; nothing is stored per window.
4. **Facts and estimates are distinct kinds of row.** `basis` is `invoice` (a document exists) or `estimate` (a tariff × readings, a salary accrual). Nothing ever sums the two without naming both.
5. **Read-through, not copy.** Energy bills, sub-meter tariff costs and salary accruals are **projected** into the ledger shape by a view, from their own tables; they are not inserted into `cost_entry`. Editing a bill edits the bill. The things recorded directly are: maintenance service (on a `maintenance_request` of type fault or on a `task_completion`), materials (an inventory purchase), insurance premium, fixed costs.
6. **Insurance**: `insurance_policy` gains `premium_cents` and `premium_vat_cents`; its period is `valid_from … valid_to`. `cost_per_person_cents` is untouched (a different fact, as its comment says).
7. **Materials**: `inventory_purchase (item, quantity, amount_cents, vat_cents, bought_on, supplier, file_id)`; it increments `inventory_item.quantity` in the same transaction. The item's `unit_cost_cents` is the last purchase's, shown as information, never used to price consumption (consumption stays a quantity).
8. **Fixed costs** are a `cost_entry` with a recurrence (`monthly | yearly | none`) and effective dates, generated into periods like a maintenance task into completions-due; a generated occurrence that the club marks *não pago* is archived, not deleted.
9. **A tariff edit re-allocates only the sub-meter months it covers**, with one audit row naming old and new totals (the `energy.md` rule, carried).
10. **Who**: owner and admin read and write; maintenance may record a service invoice or a purchase on a request they handle, and sees **no totals** (the energy rule, carried); instructors see nothing.

### Dev notes

- Migration (`write-migration`): `cost_entry (id, organization_id, facility_id, kind cost_kind, basis, amount_cents, vat_cents, period_from, period_to, supplier, document_number, file_id, source_kind, source_id, recurrence, effective_from, effective_to, note, recorded_by, archived_at)`, `cost_month (organization_id, cost_entry_id | energy_invoice_id | …, month date, share_cents)` — simplest is `cost_month (organization_id, source_kind, source_id, month, share_cents, basis, kind, facility_id)` fed by one function `allocate_cost(period_from, period_to, amount) returns setof (month, cents)` and triggers on each source table. `cost_kind`: `electricity | gas | water | maintenance_service | materials | insurance | salary | fixed | other`.
- The projection view `cost_ledger` unions: `energy_invoice` (kind by `energy_meter.carrier`, basis invoice, period the bill's), sub-meter tariff cost per month (basis estimate, from `cost-report.repository.ts`'s existing arithmetic — reuse, do not reimplement), `staff_compensation` accrued per month (monthly: amount × 14 / 12 per month; hourly × `weekly_hours` × 52 / 12; null hours → excluded and said so), and `cost_entry`.
- `allocate_cost` is pure SQL and gets a `packages/db/test/cost-allocation.sql` with the Dec–Jan split, a one-day cost, a leap February, a period of 1 day, and the rounding remainder.
- Trap (energy 5.3): a bill's `period` lines may differ from the header period; allocate on the **header** period, always.
- Trap (POOLSE-28): the per-lesson-hour report uses meters whose `pool_id` names a tank; keep that predicate for per-tank, and use `facility_id` for the site totals.

### QA

1. Given a 930 € bill for 12-12 to 11-01, when allocated, then December 600,00 € and January 330,00 €, sum exact.
2. Given an época 15-09-2026 → 31-07-2027 and a civil year 2026, then September's shares split 14/30 to before the época and 16/30 to it; the two windows read the same `cost_month` rows.
3. Given a tariff on sub-meter X changed for March, then only March's estimate rows for X change and one audit row names both totals; the billed meter's rows are untouched.
4. Given a premium of 1 200 € on a policy 01-01 → 31-12, then 100 € ± rounding per month, remainder in December.
5. Given a purchase of 10 × cloro at 180 €, then `inventory_item.quantity` rises by 10 in the same transaction and `unit_cost_cents` is 1 800.
6. Given a maintenance login, `GET /costs/*` → 403, `POST /maintenance-requests/:id/cost` → 201.
7. Cross-tenant: a `cost_entry` naming another tenant's `facility_id` is refused by the composite FK; `cost_month` rows never cross `organization_id`.

### Acceptance criteria
- [ ] `cost_entry`, `cost_month`, `inventory_purchase`, premium columns; `allocate_cost` tested.
- [ ] `cost_ledger` reads energy, tariffs and salaries through; nothing copied.
- [ ] Facts and estimates distinguishable on every row.
- [ ] QA 1–7 green; isolation test green.
