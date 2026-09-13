# Salários

What the club pays the people who work in it. Gross amounts, effective-dated, Owner and
Admin only — and an Admin does not see the Owner's.

Schema in [../data-model.md](../data-model.md), "Staff compensation". The arguments are in
[../decisions.md](../decisions.md), 13 September 2026. The ticket is
[POOLSE-58](../backlog/POOLSE-58-staff-salaries.md).

## What it is not

No IRS, no Segurança Social, no subsídio de alimentação, no net pay, no payslip, and no
payment of any kind. Poolse records what somebody is paid before deductions. It does not
compute what they receive and it does not pay them.

## Where it lives

**Instalações → Staff → Salários**, `/dashboard/facilities/staff/salaries`, beside Férias
and Duplicados. The menu item is shown to the Owner and to Admins; that is a shape, not a
permission — every endpoint refuses anybody else whether or not a link was offered.

## Who sees what

| Viewer | Sees |
|---|---|
| Owner | Every staff member, including their own rate |
| Admin | Every staff member **except the Owner** |
| Instructor, maintenance, student, guardian | Nothing. 403 on every endpoint |

Three consequences:

- **The Owner is absent from an Admin's list, not blanked.** A greyed row saying "hidden"
  tells an Admin what they were not meant to learn as surely as the figure would.
- **The roll-up card says so, in words**, whether or not the Owner has a rate set: *o valor
  do proprietário não está incluído*. An Admin's total is a different number from the
  Owner's for the same club, and an unexplained absence reads as a zero.
- **An Admin may not write the Owner's rate either.** Reading and writing are one boundary:
  a POST whose result you cannot read is a way to overwrite what you may not see.

Reaching a rate you may not see is a **403**. Reaching another tenant's person is a **404** —
RLS hid it, and the caller learns nothing either way.

There is exactly one Owner per tenant, so "the Owner" is never ambiguous, and ownership
transfer moves the exception with it: the rule reads `membership_role` at request time.

## Who appears on the list

A membership holding a staff role now — `owner`, `admin`, `instructor`, `maintenance`.
Students and guardians are not staff. Somebody holding **no** role is an unaccepted
invitation and is left out: a person with no job yet has no wage, and listing them as "sem
valor definido" would put a to-do on the screen that nobody can act on.

Staff with nothing recorded **are** listed, marked *sem valor definido* — the gap is the
useful part.

## A rate

| | |
|---|---|
| Type | **Mensal** or **À hora** |
| Amount | Gross, in euros. Monthly salary, or the rate for one hour |
| Horas semanais | Contracted hours. Optional — see below |
| Meses de vencimento | 14 (with subsídios de férias and de Natal) or 12 (duodécimos). Nothing else |
| Em vigor desde | The first day at this rate |
| Último dia | The last day at this rate, inclusive. Blank while it is the current one |
| Nota | Free text, optional |

**One rate is live at a time**, enforced by the database. Adding a rate closes the one
before it on the day before — so a rate from 1 October closes its predecessor on
30 September.

**Only an open-ended rate closes itself.** "Until further notice" is what an open end means,
so a new rate starting after it is the notice. A rate whose last day somebody *typed* is
different: a new one starting inside it contradicts a date a person chose, and is refused
rather than rewritten. So is a rate starting before an existing one — history is not
reordered on anybody's behalf. Both refusals name the dates of the rate that is in the way.

## The two derived figures

Monthly and hourly are each shown for every contract; one of the two is always derived, and
a derived figure is **muted, marked *estimativa*, and explains itself on hover and on
keyboard focus**. The contracted hours are a visible column, never tooltip-only.

- monthly → hourly: `(amount × pay periods ÷ 12) ÷ (weekly hours × 52 ÷ 12)`
- hourly → monthly: `amount × weekly hours × 52 ÷ 12`

Nothing derived is ever stored. The arithmetic lives once, in `packages/rules`
(`compensation.ts`), and is run by the API for the rows and the roll-up alike; the web app
renders and never recomputes.

**No contracted hours means no derived figure.** It renders as an em dash and contributes
nothing to any total — never zero, which would make somebody look free.

## The roll-up card

Two figures, side by side, because they answer different questions:

- **Este mês** — contracted monthly amounts plus hourly estimates. What leaves the bank in
  an ordinary month.
- **Média anual ÷ 12** — `amount × pay periods ÷ 12`. What employing these people costs once
  subsídios are spread. A 14-period salary of €1,000 costs €1,166.67 a month.

Where every contract is 12-period the two are equal and both are still shown, so the card
does not change shape with the data. Beneath them: the monthly/hourly split, the count of
people whose hours are not recorded, the count with no rate set, and the Owner line for an
Admin.

**Computed over every staff member, not over the page.** The list paginates; a card summed
from the rows on screen would be right on page 1 and wrong on page 2.

Archived staff are out of the roll-up and their history stays readable. Somebody who left in
March was paid in March.

## History

The row opens a side sheet with every rate that person has had, newest first, each carrying
who recorded it and when. *Em vigor* marks the one covering today.

**Removing a rate archives it.** Nothing on this table is ever deleted. Archiving the live
rate leaves that person with **no** live rate — the one before it stays closed and does not
reopen, because a closed rate coming back to life is a pay change nobody made. The list then
shows *sem valor definido*, which is visibly nothing rather than quietly something.

## What is recorded

Every create, correction and removal writes an `audit_log` entry carrying the actor, the
person and the date — and **no amount**. The table itself is the effective-dated,
soft-deleted record of what was paid, so repeating the figure in the trail would only add
another place it lives and another place it can leak.

For the same reason no amount appears in a URL, in a query string, in an application log or
in a toast. The toast says *Guardado*.

## Not built yet

The Excel export and import — [POOLSE-59](../backlog/POOLSE-59-importing-and-exporting-salaries.md),
next. Until then a rate is typed.
