# Money

The full text of the conventions for anything that stores, sums or shows a monetary value: fees, invoices, costs, salaries, passes. `CLAUDE.md` holds one line each; read this file before changing that area.

**Every module that touches money obeys `docs/financials.md`, and `staff_compensation` is its
reference implementation.** Read it before a migration, an endpoint or a screen that stores,
sums or shows a monetary value; if a ticket conflicts with it, stop and ask rather than picking
one. Four rules bite immediately. **Every stored amount carries a `money_provenance`** — one
shared enum, `actual | contracted | estimated | assumed`, created once and reused — and a typed
or imported figure is `contracted`, because `assumed` would cast doubt on every rate a club has
entered and `actual` would claim it had been paid. **Never sum across provenances into one
unlabelled figure**: a total is broken down or labelled with its weakest component, which is
what `rollup()` returns as `provenance` and `byProvenance`. **Every aggregate reports its
coverage** — "com base em 11 de 14 pessoas" — because an unqualified total over partial data is
the same shape as a complete one and nothing on it says which. **An `estimated` or `assumed`
figure may carry `amount_low_cents` / `amount_high_cents`**, either bound standing alone,
stored from day one though nothing reads them yet: they are the input any later scenario needs
and adding them afterwards means touching every money table. `financial_entry`, the projection
surface, is **not built** — §10 says what exists and what does not, and the next money slice
builds it rather than retrofitting provenance module by module with no reader.

**A fee line's discount is `line_discount_percent` / `line_discount_cents`, whoever authored
it.** Renamed from `manual_discount_*` on 14 September 2026: the word was true when only a
person could type one and stopped being true when a fee category gained a value, and the
obvious reading — "a person decided this" — is wrong for every concession in the product.
`fee_category_id` beside them says which author it was; null with a figure present means a
person, and `discount_reason` then says why. The API fields, the form fields and the
`fees.typedDiscount` message key match, and the refusal code is `one_line_discount`.

**A fee category authors the discount, and the line snapshots the figure.** This
**reverses** POOLSE-23's "a reference, never a percentage", stated twice in that migration:
nothing consulted the reference, so a club giving seniors 20 % off typed it into
`discount_reason` once per family — one decision, forty authors, which is the failure that
rule existed to prevent. `fee_category` now carries `discount_percent` **or** `discount_cents`
(or **neither** — a label is still legitimate, and null is never 0 %), and the *figure* is
copied onto `student_fee` when a line is agreed while `fee_category_id` records who authored
it. Correcting a category reaches lines agreed afterwards and none agreed before, exactly as
`amount_cents` does; renaming still reaches everything, because the line holds the id. **One
author, never two**: a category or a person, refused rather than resolved by precedence, which
the form makes a shape — one control, three answers. **The client never sends the figure**, the
way it never sends the plan's amount. All four kinds. The list is **organization-scoped and
shown as a panel under Preços on each site's page** — an instructor reads the names and not the
values (`canSeeValues`), because the price list refuses them outright and a concession must not
be the way round it. `docs/features/students.md`.

**One price list, four `fee_kind`s — never a table per fee type.** `mensalidade`,
`inscricao`, `seguro`, `quota`, all on `fee_plan`, each with its shape held by a CHECK: only
a mensalidade is priced by a level and a frequency, only a quota is banded by age, and
inscrição and seguro belong to a season. The **recurrence is the plan's, not the kind's** —
the default per kind is an API opinion, and the schema enforces only that a `fee_period` may
be named by a plan that recurs by the facility's periodicity list. A new kind is a value and
a row in that table; if it seems to want its own table, that is four read paths and four
copies of every bug. `docs/decisions.md`, 2026-09-08.

**Amounts are gross and `vat_rate` says what is already inside them; `vat_exempt` is its own
flag.** Never a rate of zero standing in for isento — on a Portuguese invoice an exemption and
a zero rate are two different statements, and a schema that cannot tell them apart discovers
it while invoicing. This reverses the "no VAT rate anywhere" comment that `fee_plan.amount_cents`
used to carry; the exemption *reason* is invoicing's to add.

**An invoice is written once, and its number comes from the database.** `poolse_app` holds
SELECT and INSERT on `invoice` and `invoice_line` and nothing else — a revoke rather than a
trigger, because a missing privilege cannot be forgotten by application code. So there is no
`updated_at`, no `archived_at`, and no edit: a correction is a credit note in its own book,
and settlement in 2.3 arrives as a child table the way `student_fee_payment` did. `number` is
allocated by a BEFORE INSERT trigger from `invoice_series.next_number` — **a column and not a
Postgres sequence**, because a sequence is not transactional and a rolled-back document would
leave a gap the series may not have. An INSERT that supplies a number is refused. The row lock
that allocation takes also serialises every insert into one series, which is what makes the
double-billing trigger sound; a refactor to a sequence passes most tests and breaks both
properties. These are **internal records, not legal faturas** — `atcud` and
`at_validation_code` are reserved and null until certification, and the screens say so.

**"Already billed" means "on a document not since credited", so it is a constraint trigger
and not a partial index.** After a credit note the occurrence is chargeable again — that is
how a club fixes a document it got wrong — and "live" needs a join an index cannot do.
`invoice_charged_on` is the one definition, read by that trigger *and* by the monthly run, so
a preview cannot offer a line the commit then refuses. The run itself is `runInvoices(…,
commit)`: preview and write are one path with a flag, like every importer here, and the
per-student action is the same call with `studentIds` set.

**An invoice is addressed to a payer — the guardian, or the student on the adult path — so
siblings land on one document.** `invoice_payer_membership_id` says it once; null means the
student is their own payer. Everything the document says about a person is a **snapshot**,
including each line's `student_tax_number`, which is not the payer's: a parent deducting
lessons on their IRS does it against the child's number.

**A document line stores the club's own words, never a translated enum.** `fee_plan` has no
`name` in this schema — a plan's label is its kind, its level and its frequency — so
`invoice_line.description` holds the level's or season's name, `lessons_per_week` the
frequency, and the sentence is composed by `LineLabel` where the catalogue is. Storing
"Mensalidade" would freeze a document at the language of whoever pressed the button.

**A document's state is `total − paid` and never a column.** `invoice_status` is the one
definition — credited beats paid beats overdue, and a partly paid document past its due date
is still overdue. A payment is a **child row** (`invoice_payment`), soft-deleted, summed on
every read, so recording one moves a badge without writing to the invoice; an overpayment
settles and `outstandingCents` floors at zero. A credit note is never paid, refused by a
trigger because a bank feed will be a second way in. **`due_on` may precede `issued_on`** — a
club billing October in December is ordinary, and 2.2's CHECK to the contrary was dropped
rather than replaced. **Chasing records what a person did, and what Poolse emailed.** A person's chase names its
channel; a reminder sent from Em dívida (POOLSE-86) is an `invoice_reminder` — the overdue
documents snapshotted, retried like every email — plus a chase per document with channel
`poolse_email`, which a person cannot record by hand. The history says whether the email left.

**Where families pay is one account per club, and an IBAN change is told to every owner.** POOLSE-94. `organization.payment_iban` / `payment_account_holder` / `payment_mbway_phone`, judged by `normalizeIban` + `ibanChecksumOk` and `normalizeMbwayPhone` in `@poolse/rules`, written only through `savePaymentDetails` (`billing/payment-destinations.ts`), which audits the before and after and, when the IBAN moved, writes a `payment_change_notice` emailed to the owners by its last four digits. A family reads `payTo` — destinations plus the reference, its open document numbers else the child's name — on its fee read and `/app`; `PaymentDestinations` (`components/payment-destinations.tsx`) is the one web rendering and `paymentMethodLines` the email's, in the same order. `docs/features/invoicing.md`.

**A fee line with no `fee_period_id` is charged once**, and only an inscrição or a seguro may
be one. The period is how a recurring line knows what an occurrence is worth and when the next
falls due; a fee paid once has neither, and forcing it to name one makes the arithmetic wrong
rather than redundant — the total is `amount × months`. Null means `amount_cents` is the whole
amount, months coalesce to 1, and the occurrence is `starts_on` itself. Every join to
`fee_period` from `student_fee` is therefore a LEFT JOIN: an inner one silently drops those
lines, which is how the register's "pago" tick nearly left a joining fee outstanding.

**An Admin sees every staff member's pay except the Owner's, and the card says so.** Salaries
are the first table whose visibility differs *between* two management roles, and the rule is a
question about a row, so it lives in `compensation.repository.ts` — one predicate feeding the
list, the history, the roll-up and every write, never an RLS policy: RLS answers "which tenant"
and a role test hidden in one would leave the API unable to tell 403 from 404. The Owner is
**absent** from an Admin's list rather than blanked, and an Admin may not *write* that rate
either — a POST whose result you cannot read is a way to overwrite what you may not see. An
Admin's total is therefore a different number from the Owner's for the same club, which the
roll-up states in visible text whether or not a rate is set: an unexplained absence reads as a
zero. **Amounts stay out of paths, query strings, logs and the audit trail** — `audit_log`
records who changed whose rate, and the effective-dated table is the record of the figure.
**`effective_to` is the last day at that rate**, so the exclusion constraint ranges over
`effective_to + 1`; a bare `daterange(from, to)` admits two live rates on the closing day.
**Monthly ↔ hourly is derived at read time in `@poolse/rules`, never stored**, and unknown
`weekly_hours` is a dash that contributes nothing — a total that reads unknown hours as free is
one an owner would act on. `docs/features/salaries.md`.

**A free-swim sale is an invoice line, and who is in the water is `pool_occupancy()`.** POOLSE-68
slice 1. `invoice_line.pass_id` sits beside `student_fee_id` (exactly one is set, by CHECK); a
credit on the sale line voids the pass, and `pass_current` derives entries left, expiry and void,
so there is no counter. An anonymous single entry is a document with **no payer**: `payer_name` is
null and the screen says *Consumidor final*. Anything that reads `invoice.payer_name` or a line's
`student_*`/`kind` must handle null. The payment is recorded with the sale. `pool_occupancy` counts
check-ins inside the site's `free_swim_stay_minutes`, plus classes running now by enrolment (never
by ceiling), with `class_group` LEFT joined. The check-in trigger reads it under the pool lock, and
it is the number reception, the refusal and the `mgmt.freeswim` card share. Owner and admin only.
**A free-swim block (`free_swim` subject) is water held for the public, not a class**: it has a
stored, editable title, no register or instructor, counts zero in occupancy and is left out of
the dashboard's classes and *sem professor*. A new reader of sessions or bookings must leave it
out the same way. Pass revenue is its own figure (sales not since credited) and is never summed
with mensalidades. `docs/features/reception.md`.

**A cost is an amount with a period, and a window is a sum of `cost_month`.** POOLSE-182. `allocate_cost` splits by day; triggers on the sources keep `cost_month`, so a bill is projected and never copied. Salaries are read on demand by `salary_months()`, never stored. A sub-meter's tariff never enters the ledger, because the supply's bill already holds those euros. Invoices and estimates are never summed without naming both. **The page is *Custos* (`GET /costs/overview`, one read for the screen and its CSV)**: eight groups, a window stopping at today, rounding carried across months so the table equals the tiles (`costs/cost-overview.ts`). A new chart of up to eight series takes `--chart-1…8` in `StackedMonthBars`' order, never a ninth colour. `docs/features/costs.md`.

## A person's category is `person_category`, and SQL says whether it holds — POOLSE-202

A category on a person (for passes; monthly fees keep the enrolment/turma rule) is a `person_category` row on a student or a membership, with proof seen on, by whom, and valid until. **Validity is `person_category_status(valid_until)`**: live, expiring (30 days or fewer) or expired against `club_today()`. **What applies is `person_categories(org, membership, student)`**, ordered by `fee_category.rank`, which is not `sort_order`. A membership and the student whose login it is are one person there.

The trap: comparing `validUntil` to today in TypeScript, or sorting by `sortOrder`. Both look right until a club reorders its list or the server's clock is a day off Lisbon's. Read the status and the order from SQL. Monthly fees never read `person_category`: `enrolment_fee_category_all` stays the only precedence for a fee line.
