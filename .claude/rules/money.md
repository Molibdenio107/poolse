---
paths:
  - "apps/api/src/{billing,costs,reception,staff}/**"
  - "apps/web/src/app/**/{faturacao,rececao,salaries,extratos,natacao-livre}/**"
  - "packages/rules/src/{payment,compensation}*.ts"
  - "docs/financials.md"
  - "apps/web/src/app/**/{fees-block,family-fees,pass-prices,prices-panel}.tsx"
  - "apps/web/src/app/**/fees.actions.ts"
  - "apps/web/src/lib/{money,fee-category,fee-totals,person-categories.actions}.ts"
  - "apps/web/src/components/{payment-destinations,person-categories-card}.tsx"
  - "apps/api/src/app/app-passes.repository.ts"
---

# Money

Read [`docs/conventions/money.md`](docs/conventions/money.md) before touching anything that stores, sums or shows a monetary value: fees, invoices, costs, salaries, passes.

- Every module that touches money obeys `docs/financials.md`, and `staff_compensation` is its reference implementation.
- A fee line's discount is `line_discount_percent` / `line_discount_cents`, whoever authored it.
- A fee category authors the discount, and the line snapshots the figure.
- One price list, four `fee_kind`s — never a table per fee type.
- Amounts are gross and `vat_rate` says what is already inside them; `vat_exempt` is its own flag.
- An invoice is written once, and its number comes from the database.
- "Already billed" means "on a document not since credited", so it is a constraint trigger and not a partial index.
- An invoice is addressed to a payer — the guardian, or the student on the adult path — so siblings land on one document.
- A document line stores the club's own words, never a translated enum.
- A document's state is `total − paid` and never a column.
- Where families pay is one account per club, and an IBAN change is told to every owner.
- A fee line with no `fee_period_id` is charged once
- A fee line owes every unpaid period from the month it was entered, not only the current one (`olderUnpaid`, POOLSE-187).
- An Admin sees every staff member's pay except the Owner's, and the card says so.
- A free-swim sale is an invoice line, and who is in the water is `pool_occupancy()`.
- A cost is an amount with a period, and a window is a sum of `cost_month`.
- Who may use a pass is `pass_family()`; each check-in names its swimmer, and a pack bought in the app opens the door only once `pass_current.paid` (POOLSE-204).
- A pass's price is `pass_price_for()`, resolved again at the sale and snapshotted on the line; the only override is the base price (POOLSE-203).
- A person's category is `person_category`; its validity is `person_category_status()` and what applies is `person_categories()` by `fee_category.rank`, never TypeScript (POOLSE-202).
