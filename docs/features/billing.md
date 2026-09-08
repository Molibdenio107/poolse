# Billing — the price list

What a site charges, and what one student pays. Schema in `docs/data-model.md`.

## Who can do what

| Action | Roles |
|---|---|
| Read the price list, periodicities, billing settings | owner, admin |
| Add, edit or archive a price or a periodicity | owner, admin |
| Read or change what one student pays | owner, admin |

An instructor, guardian or student is refused by the API, not merely shown a page without
the controls.

## Periodicities

A **fee period** is a name, a number of months and a discount: "Mês" (1 month, 0%),
"Trimestral" (3, 5%), "6 meses" (6, 5%). One per site may be the default.

## Prices

Four kinds, and the schema enforces the shape of each:

- **Mensalidade** — a level and a number of lessons a week. Unique per site on that pair.
- **Quota** — the membership fee, unique per site and age band (`any`, `under_18`, `adult`).
  A banded rate beats `any` for the members it names, so a club can add a child rate without
  editing the one it already has.
- **Inscrição** — what it costs to join for a season. One-off, one per student per season,
  and priced per season: a club in June holds this year's and next year's side by side.
- **Seguro** — what a family pays for the student's insurance in a season. Annual, one price
  per season, and normally isento.

A price stores a **monthly** amount for a mensalidade and the whole amount for the other
three, gross in both cases.

**Each price says how often it is charged** — by the club's own periodicity list, once a year,
or once only. Only a price charged by the periodicity list names one; the form stops asking
for a periodicity as soon as the answer is annual or one-off, because an annual price with a
three-month period beside it is a contradiction the table refuses.

**IVA is on a gross amount.** The rate says what the price already contains, never what to add
to it. **Isento is its own box**, not a rate of zero: on an invoice an exemption and a zero
rate are two different statements. Every price that existed before this became isento, which
is what the old price list meant by having no rate at all.

## Inscrição, and the renovação price beside it

A season may hold **two** joining prices: the ordinary one, and a cheaper **renovação** for a
family that paid in an earlier season. Both are optional and a club that charges everybody the
same writes one row. A third of either is refused.

Both are offered on the student's own page, under **Inscrição e seguro**. A student with a fee
line in any earlier season is *returning* and the renovação price is pre-selected; anybody else
gets the ordinary one. It is a default and not a rule — both rows are listed and an admin may
charge either. "Returning" is any earlier fee line rather than an earlier inscrição, because a
club that only started charging one this year would otherwise treat every long-standing family
as new.

A student may hold **one inscrição and one seguro per season**. A row already charged says so
instead of offering a button, and a second charge is refused with a 409 naming the plan rather
than a 500 quoting an index — which is what a double-click produces.

**A season charge names no periodicity.** It is paid once, so `amountCents` is the whole amount
and the line has exactly one occurrence, on the day it starts. A €30,00 joining fee filed
against an "Anual" periodicity would read as €360,00, which is why `student_fee.fee_period_id`
is nullable and only these two kinds may leave it out.

## Seguro, and the club's apólice

Two halves. The **apólice** is what the club bought: seguradora, número, the period it covers,
what it costs per insured person, and notes. It lives in its own section on the site's page,
beside the price list, and is readable and editable by owners and admins only — what the club
pays its insurer is a commercial fact.

An apólice says how long it has left in words: a date while there is time, "termina daqui a N
dias" inside sixty days, and "terminou há N dias" once it has lapsed. Those are two different
situations — a renewal conversation, and a club whose swimmers are uninsured today — so they
read differently rather than sharing an amber. The answer is computed on the server against
the database's own date; nothing in the browser recomputes it.

**An apólice that still covers students is not archived**, and the refusal says how many.

A student's own cover is a seguro fee line pointing at one apólice, and it carries **its own**
dates: correcting a typo in the policy must not silently rewrite what a family was told they
had. The cover defaults to the whole of the policy's period, which is what somebody joining in
September gets. **Pro-rata is a tick, not a rule** — plenty of clubs charge the whole premium
whenever somebody joins, because that is what the insurer charged them, and which applies is a
commercial decision. When it is asked for, the arithmetic runs in SQL against the policy's own
dates and is snapshotted onto the line like any other agreed amount.

## Who is not insured

The student's page says one of three things, and they are three different things to do:
insured until a date, insurance ended on a date, or no insurance recorded. A lapsed cover is a
renewal; no cover is a conversation with a family.

The register carries the same warning beside any swimmer without valid cover **on the day of
that class** — not today, because a register can be marked late and "was this child insured
when they swam" is the question that matters.

**It never blocks anything.** Enrolment, attendance and every mark work exactly as before. An
instructor at the poolside cannot fix a seguro, and a register that would not open over a piece
of paperwork is a register somebody keeps on paper instead. The warning is there because that
screen is where every swimmer is looked at every week.

**Adding or editing a price onto a combination that already exists is a 409**, not a crash,
carrying `fee_plan_exists`, `fee_plan_quota_exists`, `fee_plan_inscricao_exists` or
`fee_plan_seguro_exists` and a field the form can hang the sentence on — the level, the age
band or the season, whichever is actually taken.

## What the Amount column shows

The **total the periodicity actually charges**, with the monthly amount beneath it as
"34,00/mês × 6, −5%".

Amounts stay stored gross; the discount is applied on display only. The total comes from
`fee_total_cents` in SQL — the same function `student_fee` uses when a family agrees a
price — so the price list and an agreement cannot round differently. A price naming no
default periodicity has nothing to discount by and shows its monthly amount alone.

## What a student pays

Creating a fee line **snapshots** the plan's amount and the period's discount. Editing the
price list never rewrites an agreement somebody already made; the student's page marks a
line whose plan has since changed and offers to update it, one line at a time, by a person.


## A student's fees screen

Three sibling cards, in this order:

1. **Plans** — what the timetable puts them on, and the fee lines that follow from it.
2. **Membership** — whether they are a sócio, and since when.
3. **Period total** — the sum of the two, below them because a total above its parts is a
   figure nobody can check.

### Paid, per period

Each fee line carries a **Paid** checkbox for one billing period at a time, beside the
*How they pay* dropdown — the two are one question asked twice: what this family agreed to,
and whether this period of it has arrived.

It persists `paid_on`, `recorded_by`, `source` and the period it settles. Unticking clears
it.

**`source` says how it was settled** — `manual`, `mbway` or `sepa`. Every payment so far is
an office tick; the column exists so that a webhook settling a month in phase 2 is
distinguishable from a clerk settling it, which is what a club reconciling a bank statement
needs. `markFeePaid` takes the value and defaults to `manual`.

The current period is shown by default. Where a line has been settled before, a small
switcher steps back through the periods that actually exist — a club that started in March
is not offered a February. History is kept: settling one period never touches another.

An ended line has no current period and nothing to press.

The control is a checkbox that submits a form: it reads as a checkbox to assistive
technology, and it still works before any JavaScript has loaded, so what is on screen is
always what is on the server. There is no disabled state for other roles because there is
no other role here — `GET /students/:id/fees` is itself owner/admin, since what a family
pays is not something the instructor who teaches them may see.

### Period total

Three figures: the **total to pay** for the period, then **Total paid** and **Total
remaining to pay** beneath it. Whichever is the live question is bold — the remainder while
anything is outstanding, the paid total once everything is settled. Both are always present,
so nothing has to be inferred from what is missing, and weight rather than colour carries
the emphasis.

The late penalty sits on the remainder, never on what is paid. All three come from the same
`payableCents` the lines show, and all three change the moment a Paid box does.

### Medical leave dates

Read as `date` and sent as `YYYY-MM-DD`. Before round 5 the column was parsed into a JS Date
at local midnight, so it left the API as the **previous day** in UTC — an off-by-one rather
than a stray time.
