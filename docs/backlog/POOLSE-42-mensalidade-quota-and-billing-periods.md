# POOLSE-42 · Mensalidade, quota de sócio and billing periods

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Billing / Enrolment · **Priority:** High
**Blocks:** POOLSE-24 (which renders what this ticket stores), phase 2.1
**Prerequisite inside this ticket:** `class_group.facility_id`

### PO — why this exists

The office cannot answer "what does this student pay?" without opening a spreadsheet. The
facility is the client agreement — it holds the price list, the periodicities the club
offers and the discount attached to each. The student page answers the question for one
person: which plans they are on, over what period, with what discount, and the resulting
total.

This is the *records* half of billing. Knowing who owes what is most of the value; charging
is an optimisation on top of it and lives in later slices.

**Not in scope:** invoice generation, series or numbering; VAT reporting or SAF-T; any
collection mechanism (Stripe, SEPA, MB WAY); pro-rata for a student who joins mid-period —
v1 charges the full period and the form says so; automatic sibling or family discount rules
— the manual discount with a reason covers those cases without a rules engine; bulk
re-pricing of existing students after a price-list edit.

### BA — rules and data

**The facility holds the agreement.**

- A facility has a **tabela de preços**: named plans, each with a gross amount. A plan is
  either a **mensalidade** or a **quota** (de sócio). "Hidroginástica Sénior · 30,00 €" and
  "Natação 2x/semana · 45,00 €" are two plans.
- A plan may optionally point at a `student_level`. That link only drives the *suggestion*
  when assigning a fee; it never constrains what the operator can assign. Price varies by
  frequency as well as by level, and a level alone cannot express "twice a week".
- A facility has **periodicidades**: a name, a number of months (1, 3, 6, 12 or any custom
  value up to 24) and a discount percentage. Exactly one is the facility default.
- The periodicity list is **shared by both kinds of plan**. A quota is not inherently annual
  and a mensalidade is not inherently monthly — each is charged over whichever periodicity
  the operator picks for that line.
- A plan may name its **own default periodicity**, falling back to the facility default when
  it does not. This is what lets the quota plan default to Anual while mensalidades default
  to Mensal, without a second list or a hardcoded rule.
- The period's discount applies to whichever line uses that period, quota lines included.
  One rule and one function beats a kind-specific exception, and a facility that does not
  want to discount its quota can price the quota accordingly or use the manual discount on
  the line. If this turns out wrong in practice, an `applies_to` column on `fee_period` is
  the additive fix.

**The student holds the fee lines.**

- A student has zero or more fee lines. A student in two turmas has two mensalidade lines;
  the student page shows the total, never a single hand-maintained number. This is the same
  requirement `docs/product.md` states for invoice line items.
- A mensalidade line points at a plan and, when it came from a turma, at the enrolment that
  produced it. A quota line points at a plan and never at an enrolment.
- Assigning a fee **snapshots** the plan amount and the period discount onto the line.
  Editing the price list afterwards must never rewrite an existing agreement. Where a line's
  snapshot differs from the plan's current amount, the line shows a marker and a per-line
  *"atualizar para o preço atual"* action. There is no bulk update in this ticket.
- Each line may carry one **manual discount** — percentage or fixed amount, not both — with
  a required reason. Siblings, negotiated cases and staff children all land here.

**Sócio.**

- A quota line carries its own periodicity, chosen per student and **independent of that
  student's mensalidade periodicity**. Paying the mensalidade monthly and the quota every
  six months is an ordinary case, not an edge one.
- The student record carries `is_socio`, `socio_number` and `socio_since`. Being a sócio and
  paying a quota are related but not identical: a waived quota is a real case (honorary
  members, staff children), and modelling the boolean as "has an active quota line" makes
  that case unrepresentable.
- Turning the toggle on **offers** to attach the facility's quota plan as a fee line. The
  operator can decline; the toggle still records the membership.

**One definition of the total.**

- `period_total = round(amount_cents × months × (1 − discount_percent / 100))`, rounded half
  up to the cent, applied **at the period**, never per month.
- €35,00 × 3 months at 5 % is **99,75 €**, not three months of 33,25 €. Rounding each month
  and summing produces a different figure and an argument with a parent.
- One immutable SQL function is the single definition; the API calls it rather than
  reimplementing the arithmetic.

**Money and VAT.**

- Amounts are gross — the price the family pays — in integer cents, per the standing rule.
- `vat_rate` is `numeric(5,2)`, null meaning isento (art. 9.º CIVA covers most sports
  tuition). It is stored and displayed; nothing in this ticket computes from it.
- Discount percentages are `numeric(5,2)`. They are rates, not amounts, and do not take the
  minor-units rule.
- pt-PT renders `35,00 €`; en renders `€35.00`. From the locale, never concatenation.

**Edges.**

- A student with enrolments at two facilities has lines from both price lists. The student
  page groups fee lines by facility.
- A line ends when its enrolment ends; ending an enrolment must not silently keep charging.
  Ended lines stay visible as history.
- **Open:** does a long closure suspend a mensalidade? POOLSE-24 raises the same question
  and it is still unanswered. Nothing in this ticket depends on it — record and move on.
  **Deferred, as the ticket directs** (CONVENTIONS, definition of done, item 4). Nothing built
  here suspends or prorates anything: a line runs from `starts_on` until it is ended, and a
  closure does not touch it. Whichever way the question is answered, the answer is additive —
  a suspension is a pair of dates on the line, not a change to how a total is computed.

### Dev — implementation notes

**Do the prerequisite first.** `class_group` reaches a facility only through a *nullable*
`pool_id`, so a turma created before a lane is chosen belongs to no facility. A
facility-scoped price list suggested from a turma needs that link to exist:

```sql
ALTER TABLE class_group ADD COLUMN facility_id uuid;
-- backfill from pool where present; from the org's single facility otherwise
ALTER TABLE class_group ALTER COLUMN facility_id SET NOT NULL;
ALTER TABLE class_group
  ADD FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id);
```

**Migration.** New enum `fee_plan_kind ('mensalidade', 'quota')`. Three tables, each with
`organization_id`, composite `(organization_id, parent_id)` foreign keys, RLS on the
per-request GUC, `set_updated_at()` trigger, and partial unique indexes filtered on
`archived_at IS NULL` — the standing rules, no exceptions:

- `fee_plan (id, organization_id, facility_id, kind, name, level_id null, amount_cents,
  vat_rate null, default_fee_period_id null, archived_at)` — the default period is a
  suggestion when creating a line and falls back to the facility default when null; it never
  restricts which period the operator picks
- `fee_period (id, organization_id, facility_id, name, months smallint, discount_percent,
  is_default, sort_order, archived_at)`
- `student_fee (id, organization_id, student_id, fee_plan_id, enrollment_id null,
  fee_period_id, amount_cents, discount_percent, manual_discount_percent null,
  manual_discount_cents null, discount_reason null, starts_on, ends_on null, archived_at)`

`student` gains `is_socio boolean NOT NULL DEFAULT false`, `socio_number text`,
`socio_since date`.

Constraints worth stating explicitly: `months` between 1 and 24; `discount_percent` between
0 and 100; at most one of `manual_discount_percent` / `manual_discount_cents`, and
`discount_reason` required when either is set; a `quota` line has `enrollment_id IS NULL`;
a mensalidade line's enrolment belongs to the same student (composite FK, not a check); and
`fee_plan.default_fee_period_id` references a period of the *same facility* — composite FK
`(organization_id, facility_id, default_fee_period_id)`, so a plan cannot default to another
site's periodicity.
Partial uniques: plan name per facility, period months per facility, one default period per
facility.

```sql
CREATE FUNCTION fee_total_cents(p_amount_cents integer, p_months smallint,
                                p_discount_percent numeric)
  RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT round(p_amount_cents::numeric * p_months
               * (1 - coalesce(p_discount_percent, 0) / 100))::integer;
$$;
```

**API.** `GET/POST/PATCH/DELETE /facilities/:id/fee-plans` and `/fee-periods`;
`GET/POST/PATCH /students/:id/fees`. Owner and Admin write. Instructor sees no amounts at
all — enforce on the endpoint, not by hiding the block. Student and guardian self-service is
phase 3; deny for now.

**UI.** Facility details gains a **Preços** tab beside Configuração — the price list and the
periodicities, both editable inline. Student details gains a **Mensalidade** block: one row
per fee line (plan, period selector, base amount, discount, period total), the total per
period and the monthly equivalent underneath, plus the sócio toggle with número and desde.

**Excel import parity** (CONVENTIONS): the student import mapping gains columns for
mensalidade plan name, periodicity and the sócio boolean. Mapping only — no new importer.

**Most likely to be got wrong**, in order: recomputing a line's amount from the current plan
instead of reading the snapshot (the same failure POOLSE-24 AC 5 exists to prevent);
rounding per month rather than per period; and letting `fee_plan.level_id` constrain
assignment instead of merely suggesting it.

**Conflict to record in CONFLICTS.md.** POOLSE-24 assumes a `payment_plan` hanging off
season/turma pricing. This ticket makes the *facility* the source of prices and
periodicities. Resolution: this ticket stores, POOLSE-24 renders. POOLSE-24's instalment
schedule is generated from a student's fee lines, not from a second price model.

### QA — test scenarios

42.1 Given a facility with plans and periodicities / When an Owner opens the Preços tab / Then both lists render and are editable in place.
42.2 Given a plan of 35,00 € and a 3-month period at 5 % / When a fee line is created / Then the period total is exactly 99,75 € and the monthly equivalent is shown alongside it.
42.3 Given the same inputs / When the total is computed in the API and in SQL / Then both call `fee_total_cents` and return the identical integer.
42.4 Given a student with a fee line / When the plan's amount is later changed in the Preços tab / Then the student's line keeps its snapshot amount and shows the out-of-date marker.
42.5 Given that marker / When the operator uses "atualizar para o preço atual" / Then only that line changes.
42.6 Given a student enrolled in two turmas / When the Mensalidade block renders / Then two lines appear and the total is their sum.
42.7 Given a student whose enrolment ends / When the enrolment is ended / Then the corresponding fee line ends on the same date and remains visible as history.
42.8 Given the sócio toggle is turned on / When the facility has a quota plan / Then attaching it is offered, defaulting to the plan's own periodicity, and declining still records the membership.
42.8b Given a student paying a mensalidade monthly and a quota every six months / When the Mensalidade block renders / Then each line shows its own periodicity and total, the two are independent, and changing one does not alter the other.
42.9 Given a manual discount with no reason / When the line is saved / Then it is rejected with a field-level error, in both locales.
42.10 Given an Instructor token / When it requests `/students/:id/fees` / Then `403`.
42.11 Given an Admin token for another organization / When it requests a facility's fee plans / Then `404`, and the tenant-isolation test covers all three new tables.
42.12 Given pt-PT / When amounts render / Then `35,00 €` and `99,75 €`; in en, `€35.00` and `€99.75`.
42.13 Given light and dark mode / When the out-of-date marker and the discount badge render / Then each is legible by text alone and contrast passes in both.
42.14 Given a period of 1 month and 0 % / When the total renders / Then it equals the plan amount exactly, with no rounding drift.

### Acceptance criteria

1. A facility holds a named price list of mensalidade and quota plans, each with a gross amount and an optional level link.
2. A facility holds its own periodicities — name, months, discount — with exactly one default. The list serves mensalidades and quotas alike, and a plan may name its own default within it.
3. A student has zero or more fee lines; the student page shows each line and the total, never a single typed number.
4. Assigning a fee snapshots the amount and the discount; editing the price list never changes an existing student's agreement.
5. A line whose snapshot differs from the current plan amount is marked, with a per-line update action.
6. The sócio boolean, número and desde live on the student; the quota is a separate fee line carrying its own periodicity, independent of the student's mensalidade periodicity, and a sócio with no quota line is representable.
7. Every total in the app comes from `fee_total_cents` — one definition, rounded at the period.
8. Amounts are gross integer cents with a `vat_rate` that may be null for isento.
9. Amounts and dates format from the locale in pt-PT and en.
10. Fee amounts are invisible to Instructors, enforced server-side.
11. `class_group.facility_id` exists, is not null, and is backfilled.

---

## Build note — what was delivered, and the two places it differs

Built 2026-08-31. All eleven acceptance criteria met; `pnpm db:test`, `pnpm api:test`,
`pnpm web:test`, both typechecks, `i18n:check`, `pt:check`, `layout:check` and a production
build all pass.

Two deliberate deviations, both narrower than the ticket's wording:

- **Preços is a section, not a tab.** The facility detail page has never had tabs — it is a
  stack of sections — so the price list is one more of them, in the same shape as Horários and
  Piscinas. Adding a tab strip for a single panel would have made this the only page in the app
  that navigates that way.
- **The import maps the sócio columns, not the plan and periodicity.** A plan belongs to a
  facility, and a student with no enrolment gives the import no way to know which one; guessing
  would assign a price from the wrong site, which is precisely what this ticket's composite keys
  exist to prevent. Fees are assigned on the student page, where the site is known. `isSocio`
  and `socioNumber` are mapped, imported and exported.

Two things future tickets should read rather than re-derive:

- `class_group.facility_id` is NOT NULL and derives itself from the turma's pool via a trigger.
  Where there is no pool the caller must say which site — deliberately not defaulted, because
  "the club's only facility" is the wrong answer the day a club opens its second.
- `fee_total_cents` and `fee_payable_cents` are the only definitions of a total. The API selects
  them; nothing in TypeScript multiplies an amount by a number of months.

### Changed after delivery, by decision

- **AC8 reversed: the quota is applied, not offered.** Marking a student sócio attaches the
  site's quota plan straight away. AC6 is what keeps that safe — the quota is an ordinary fee
  line, so a waived one is the operator removing it while the membership stays, and an honorary
  member is still representable. A club with no quota plan, or several sites and a student with
  no lines yet, is *told* nothing was attached rather than left with a toggle that appears to
  have worked.
- **`vat_rate` removed entirely.** All prices are IVA-included, so a rate column would be a
  second number nobody maintains, always null, and eventually trusted. If reporting ever needs
  the split it needs a rate *per period* — rates change — which is a different table.
- **`student_fee.is_paid` / `paid_on` added, marked by hand.** Its own endpoint, because marking
  a payment is the thing an office does every period while editing an agreement is rare. It says
  "settled", not "settled for March": a boolean on a recurring line cannot carry a period and
  nothing clears it. That limit is in the schema comment so the slice that replaces it knows
  what it is replacing.
- **A grand total** across every site sits under the per-site totals, with what is still
  outstanding.

