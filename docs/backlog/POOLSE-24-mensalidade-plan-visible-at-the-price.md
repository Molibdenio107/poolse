# POOLSE-24 · Mensalidade plan visible at the price

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Billing / Enrolment · **Priority:** Medium
**Borrowed from:** Amilia — the instalment schedule is shown three times: under the price, at checkout, and in the account.

### PO — why this exists

A family looking at a turma sees one number and has to guess whether it is the term, the month or the year. Showing the mensalidade schedule at the price, again at checkout and again in the account removes the single most common phone call to the office. Guardians and adult students benefit; the office stops explaining arithmetic. Medium priority, and it ships with POOLSE-25 — the plan and the failure path are one story from the family's side.

**Not in scope:** editing or renegotiating a schedule after enrolment; proration for mid-season joins; the collection mechanics themselves (POOLSE-25).

### BA — rules and data

- A **payment plan** belongs to a season/turma price: an upfront amount (inscrição), an instalment amount, a count of instalments, and a day-of-month for collection. The total is derived, never stored twice.
- The schedule shown before payment is the schedule that is charged. At enrolment the plan is **materialised** into concrete dated charges attached to the enrolment; from that moment the family's view reads the materialised charges, not a recomputed preview.
- Charge states: upcoming, due, paid, failed (POOLSE-25 owns failed). The billing section groups by state and shows dates.
- The plain-sentence rendering is composed from the plan's parts, not a stored sentence: upfront, instalment amount, instalment count, total.
- Day-of-month edge case: a collection day of 29, 30 or 31 must resolve to the last day of shorter months. Decide it once, in the materialiser.
- Where the enrolment starts mid-plan, the schedule shown must be the schedule actually generated. If proration is out of scope, then the plan starts at the next instalment date and the sentence must say so rather than showing a total the family will not be charged.
- Closures do not alter the schedule. POOLSE-31 AC 8 says a closure means no charge for the cancelled occurrence; a mensalidade is a monthly instalment, not a per-occurrence charge, so a closure inside a month does not reduce that month's instalment. **Open:** does a long closure reduce or suspend the mensalidade? The source doc says closures produce no charge for the class and no credit, without saying what a monthly plan does. Treat "no charge" as applying to per-occurrence billing only until decided.
- Currency is euro; amounts are stored in cents as integers. Dates and currency format by locale (pt-PT: `50,00 €`; en: `€50.00`).
- The control reads **"Ver mensalidades"** in pt-PT and its en equivalent, and expands in place — not a modal, not a separate page.

### Dev — implementation notes

- Migration: `payment_plan` on season/turma pricing, `enrolment_charge` (tenant, enrolment, due_date, amount_cents, state, plan_ref). Tenant key on both; index on (tenant_id, enrolment_id, due_date).
- One materialiser function generates the charge rows and is the same code path used to render the pre-payment preview, called with the same inputs. Two implementations is how the preview and the charges drift apart, which AC 5 exists to prevent.
- API: `GET /pricing/:id/plan` returns plan parts and a rendered breakdown; `GET /enrolments/:id/charges` returns the materialised list. The plain sentence is composed client-side from parts via i18n interpolation so pt-PT and en can order the clauses differently.
- The expander under the price is one shared component reused on the turma card, the enrolment step, the checkout summary and the billing section — four copies is exactly the drift risk.
- Permissions server-side: a guardian sees charges for their linked students only; an adult student sees their own; Owner/Admin see all. Instructor sees none — enforce on the charges endpoint, not by hiding the section.
- Money never touches floating point. Cents as integers end to end, including the total in the sentence.
- i18n and theming: currency and date formatting from the locale (never string concatenation, per POOLSE-02's precedent); the paid/due/upcoming state indicators need text labels and tokens checked in light and dark, kept clear of the attendance palette.
- Most likely to be got wrong: recomputing the schedule at render time from the plan instead of reading the materialised charges, so a price change in Settings retroactively changes what an already-enrolled family thinks they owe.

### QA — test scenarios

24.1 Given a turma priced with a plan / When the price is displayed anywhere / Then a "Ver mensalidades" control sits directly beneath it and expands the schedule in place.
24.2 Given a plan of €50 upfront plus €50 × 9 / When the sentence renders / Then it reads with a total of €500 and the total matches the sum of the materialised charges exactly.
24.3 Given checkout / When the page renders / Then the amount charged now is shown beside the full list of upcoming charges with their dates.
24.4 Given the plan's collection day is 31 / When charges are materialised across February / Then that instalment falls on the last day of February, and no charge is skipped.
24.5 Given an enrolment completes / When the pricing is later changed in Settings / Then the family's billing section still shows the originally materialised schedule.
24.6 Given an Instructor token / When it requests the charges endpoint for a student / Then `403`.
24.7 Given a guardian token / When it requests charges for a student they are not linked to / Then `403`.
24.8 Given a guardian of two students / When they open the billing section / Then each student's schedule is separately identifiable and totals are not merged into one ambiguous figure.
24.9 Given the pt-PT locale / When amounts and dates render / Then they read `50,00 €` and `31 de janeiro de 2027`; in en, `€50.00` and `31 January 2027`.
24.10 Given a plan with one instalment / When the sentence renders in en and pt-PT / Then the singular form is used, not "1 months".
24.11 Given light and dark mode / When paid, due and upcoming charges appear in one list / Then each state is distinguishable by text alone and contrast passes in both.
24.12 Given a mid-season enrolment / When the schedule is previewed and then materialised / Then the previewed dates and amounts are identical to the charges created, with no extra or missing instalment.

### Acceptance criteria

1. Wherever a season/turma price is shown, a **"Ver mensalidades"** control sits directly beneath it and expands the schedule in place.
2. Terms read as a plain sentence: *"€50 na inscrição, depois €50 por mês durante 9 meses — total €500."*
3. At checkout, the amount charged now is shown **beside** the full list of upcoming charges with their dates.
4. After enrolment, the same schedule lives in the guardian's (or adult student's) billing section, showing paid, due and upcoming.
5. Amounts and dates come from one source — the schedule shown before payment is the schedule that is charged.
6. Currency and date formatting follow the locale.
