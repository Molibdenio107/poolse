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

Two kinds, and the schema enforces one of each combination:

- **Mensalidade** — a level and a number of lessons a week. Unique per site on that pair.
- **Quota** — the membership fee, unique per site and age band (`any`, `under_18`, `adult`).
  A banded rate beats `any` for the members it names, so a club can add a child rate without
  editing the one it already has.

A price stores a **monthly** amount, gross.

**Adding or editing a price onto a combination that already exists is a 409**, not a crash,
carrying `fee_plan_exists` or `fee_plan_quota_exists` and a field the form can hang the
sentence on. The database has enforced this since the price list was built; what was missing
was the translation from a constraint violation into something a form can say.

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
