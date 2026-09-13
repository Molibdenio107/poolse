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

## The file — export and import

[POOLSE-59](../backlog/POOLSE-59-importing-and-exporting-salaries.md). Both live at the
bottom of the Salários page, below the list: what a club does here every week is read the
figures, and importing a file is what it does in December.

**Exportar (Excel)** and **Exportar (CSV)** hand over the pay list. The file holds the
*contract* — name, e-mail, NIF, type, gross amount, contracted hours, pay periods, the date
it started and the note — and **not** the derived monthly and hourly figures, because one of
those is always an estimate and re-importing an estimate as an amount would turn a rounding
into a pay rise. An Admin's file omits the Owner, by the same rule as the screen. Nothing is
cached: a pay list is the most sensitive file this product hands out.

**Everybody visible is in the file, including people with no rate**, whose line carries their
name and keys and nothing else. That makes the export a template as well as a record: fill in
the empty line and import it back.

**Importing** is the same four steps as every other importer — upload, map, preview, commit —
driven by `useImportWizard`. Dropping a file anywhere on the screen opens it with the upload
step already done. The file is read on the Next server and never leaves it; no model is
called.

### What the header row is

`salaries.field.*` from the translation catalogue — the very labels the mapping step shows —
so a club exports, edits one column and imports again with nothing mapped by hand. Two values
are written in a form that is the same in both languages: the type as its enum spelling
(`monthly`, not "Mensal") and the date as ISO, because a file exported under `en` is
re-imported under `pt-PT`. `salary-sheet.test.ts` proves the round trip against the real
catalogues in both locales.

### Who a row is about

**E-mail or checksum-valid NIF, never the name.** Two people called Ana Silva is not an edge
case in a club with forty staff. A NIF column is claimed by its heading and never by its
shape, because nine digits is also a Portuguese telephone number.

### What a row can be

| State | What it means | Ticked by default |
|---|---|---|
| A change | The file says something different from the live rate | Yes |
| Sem alterações | The file agrees with what is recorded | No — nothing to write |
| Sem valor | The line has no amount at all | No |
| Recusada | Something is wrong with the row, and it says what | Cannot be ticked |

A refusal names itself: no key, an invalid NIF, matched nobody, *not staff* (different from
*not found*, and a different thing to do about it), the Owner's row in an Admin's file, a
missing or unreadable date, an amount that is not one, hours or pay periods out of range, or
dates that collide with a rate already recorded.

**One person twice refuses the whole file.** Which of the two rows is their pay is not
something to guess, so the commit button shuts and says so.

### What an import does, and does not

It adds a **new effective-dated rate** through the same function the form uses — closing the
open-ended rate it succeeds, exactly as typing one would. It never edits, never archives and
never creates a person: an unknown e-mail is a rejected row, because a payroll file is the
wrong place to learn who works here.

**A payroll file commits whole or not at all.** Every included row is written in one
transaction; a line the database refuses at the last moment rolls the whole import back and
names the line. The other importers commit what they can and report the rest — a pay run is
the one place where half-applied is worse than not applied, because the half that went
through is somebody's wage.

**A round trip changes nothing.** Exporting and importing straight back previews as nothing
to do and writes no rows. It is the cheapest end-to-end assertion this importer has, and it
is `salary-import.integration.test.ts`'s first test.

### Amounts in a cell

`parseSheetCents` normalises what a workbook actually carries — a currency symbol, a
thousands separator, either decimal mark — and then hands the result to `parseCents`, the
conversion the typed form uses. Where both a dot and a comma appear the *last* one is the
decimal mark, which is what makes `1.234,56` and `1,234.56` the same amount. The form itself
stays strict: a price field still refuses "35 €", and that refusal is pinned by a test.
