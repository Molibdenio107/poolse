# POOLSE-58 · Staff salaries

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Payroll · **Priority:** High — the next slice. Sequenced ahead of 2.4 (Stripe) on 2026-09-13, see [BUILD-ORDER.md](./BUILD-ORDER.md) and `docs/roadmap.md`

### PO — why this exists

A club's largest recurring cost is the people who teach in it, and Poolse knows every hour they
work and nothing about what they are paid. The result is that the one figure an owner needs before
deciding whether to open a Saturday morning turma — what an hour in the water costs in wages —
lives in a spreadsheet nobody else may open.

This slice records it: monthly and hourly pay per staff member, effective-dated so a raise does not
destroy what came before, visible to the Owner and to Admins, and to nobody else.

**Not in scope, and deliberately:**

- **No IRS, no Segurança Social, no subsídio de alimentação, no net pay, no payslip.** Poolse
  records what somebody is paid gross. It does not compute what they receive and it does not pay
  them. A product that gets a retenção na fonte wrong is worse than one that never offered.
- **No Excel path.** Export and import are [POOLSE-59](./POOLSE-59-importing-and-exporting-salaries.md),
  built immediately after. The `staff_compensation` schema and the API are shared with it, so nothing
  here is thrown away.
- **No per-screen visual polish.** Existing components and tokens, existing page shell, existing
  field widths.

### BA — rules and data

**Staff is a `membership` holding a staff role** — `owner`, `admin`, `instructor`, `maintenance`.
A `student` or a `guardian` is a membership too and is not staff; a person who is both an instructor
and a guardian to their own child *is* staff, because the rule reads the staff role and not the
absence of the other one. There is no new person entity here and there must not be one:
`membership` is the person (`docs/data-model.md`).

**A rate is effective-dated, and one is live at a time.** Adding a rate closes the previous one on
the day before the new one starts. History is never rewritten — a correction is a `PATCH` of the
row that was wrong, and a raise is a new row. This is what makes "what did we pay in March" a
question with an answer.

**Two types, gross, EUR, tenant-scoped.** `monthly` or `hourly`; the amount is what the club pays
before any deduction; the rate belongs to the organization and not to a facility, because a person
who teaches at two sites is paid once.

**`pay_periods_per_year` defaults to 14** — the Portuguese year with subsídio de férias and
subsídio de Natal. 12 is valid and is what a club that pays duodécimos will choose. Nothing else is.

**Derivation is display-only and never stored:**

- monthly → hourly: `(amount × pay_periods_per_year / 12) / (weekly_hours × 52 / 12)`
- hourly → monthly: `amount × weekly_hours × 52 / 12`
- `weekly_hours` null → the derived figure is `—`. Never `0`, never a crash, never a blank cell that
  reads as nothing.

A derived figure renders muted and is marked as an estimate. The hours it was derived *from* are
visible text in the row, not only in the tooltip — a tooltip explains, it never informs, and a
number whose basis is available only to a mouse is a number half the users cannot check.

#### Who may see it — the core requirement

| Viewer | Sees |
|---|---|
| Owner | Every staff member, including their own rate |
| Admin | Every staff member **except the Owner** |
| Instructor, maintenance, student, guardian | Nothing. 403 on every endpoint |

Three consequences, all of them load-bearing:

1. **The Owner is absent from an Admin's list, not blanked.** A greyed row saying "hidden" tells an
   Admin what they were not meant to learn as surely as the figure would.
2. **The roll-up card says so, in words, whether or not the Owner has a rate set.** An Admin's total
   is a different number from the Owner's total for the same club, and an unexplained absence reads
   as a zero. The card carries one line: *o valor do proprietário não está incluído*. Same honesty as
   the chase list owing the truth about what Poolse has and has not delivered.
3. **An Admin may not write the Owner's rate either.** Reading and writing are one boundary — a
   `POST` an Admin cannot see the result of is a way to overwrite what they are not allowed to read.

There is exactly one Owner per tenant, enforced, so "the Owner" is never ambiguous. Ownership
transfer moves the exception with it, because the rule reads `membership_role` at request time.

#### The roll-up card — two figures, side by side

- **Este mês** — contracted monthly amounts plus hourly estimates. What leaves the bank in an
  ordinary month.
- **Média anual ÷ 12** — `amount × pay_periods_per_year ÷ 12`, plus the same hourly estimates. What
  employing these people actually costs once subsídios are spread.

Where every contract is 12-period the two are equal, and both are still shown: hiding one would make
the card change shape depending on the data. Beneath them: the split between monthly-contract and
hourly-contract staff, and the count of staff with no rate set. Every hourly contribution is labelled
an estimate, and a staff member with no `weekly_hours` is counted separately rather than folded in at
zero — "not measured" enforces nothing and contributes nothing, and must not read as free.

**Archived staff are out of the roll-up and still reachable in history.** Somebody who left in March
was paid in March.

### Dev — implementation notes

**Migration** `packages/db/migrations/<epoch-ms>_staff-compensation.sql`, both `-- Up Migration` and
`-- Down Migration` markers, never editing an applied one. Follow the `write-migration` skill.

```
staff_compensation
  id                     uuid PK
  organization_id        uuid NOT NULL → organization(id)
  staff_membership_id    uuid NOT NULL   -- composite FK to membership
  compensation_type      compensation_type NOT NULL   -- 'monthly' | 'hourly'
  amount_cents           integer NOT NULL
  currency               char(3) NOT NULL DEFAULT 'EUR'
  weekly_hours           numeric(5,2)
  pay_periods_per_year   smallint NOT NULL DEFAULT 14
  effective_from         date NOT NULL
  effective_to           date            -- null = live; the LAST DAY at this rate
  note                   text
  created_by_membership_id uuid NOT NULL
  created_at / updated_at  timestamptz NOT NULL DEFAULT now()
  archived_at            timestamptz
  UNIQUE (organization_id, id)
  FOREIGN KEY (organization_id, staff_membership_id)
    REFERENCES membership (organization_id, id)
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES membership (organization_id, id)
```

**`staff_membership_id`, not `staff_id`** — one deliberate deviation from the prompt. Every
membership reference in this schema is named `*_membership_id` (`instructor_membership_id`,
`guardian_membership_id`, `recorded_by_membership_id`), and `staff_id` would read as a foreign key
into a `staff` table that does not exist and must not be invented.

**The overlap constraint is the thing most likely to be got wrong.**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE staff_compensation
  ADD CONSTRAINT staff_compensation_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    staff_membership_id WITH =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) WHERE (archived_at IS NULL);
```

`effective_to` is **the last day at that rate**, inclusive, as an operator means it — so the range
is half-open over `effective_to + 1`, exactly as `student_medical_leave` does it. A bare
`daterange(effective_from, effective_to)` would treat the closing date as exclusive and let a rate
ending 31 October sit alongside one starting 31 October. `btree_gist` supplies uuid equality and is
already created by two earlier migrations; create it again anyway, because a migration that depends
on another migration's extension is a migration that fails on a fresh database if the order ever
changes.

Also: `CHECK (effective_to IS NULL OR effective_to >= effective_from)`, `CHECK (amount_cents > 0)`,
`CHECK (weekly_hours IS NULL OR weekly_hours > 0)`,
`CHECK (pay_periods_per_year BETWEEN 12 AND 14)`, `set_updated_at()` trigger.

**RLS with both `USING` and `WITH CHECK`** on `organization_id = current_organization_id()`, grants
to `poolse_app` if outside the default-privileges path, an isolation block in
`packages/db/test/tenant-isolation.sql`, and the table added to `TENANT_TABLES` in
`apps/api/src/test/harness.ts` **in the same commit as the migration** — a forgotten one fails every
integration test at teardown with a foreign-key violation that looks nothing like this change.

**The Owner exception is a repository answer, not `requireRole`.** `requireRole('owner', 'admin')`
is the coarse gate on every endpoint; *which rows* an Admin may see is resolved in SQL, once, so the
list, the history, the roll-up and (later) the export cannot disagree about it. The read endpoint
returns the same `canEdit` the guard enforces, as `lesson-plans.repository.ts` does. Reaching a row
the viewer may not see is a **403 on a named row and a 404 on a row in another tenant** — the second
is RLS doing its job and must not be turned into a 403, which would confirm the row exists.

**Derived once, on the server.** One definition of both formulas in `packages/rules`
(`compensation.ts`), called by the API for the per-row figures *and* for the roll-up; the web app
renders what it is given and never recomputes. Round to the nearest cent at the last step only. Two
implementations of one sum agree until the day they do not.

**The roll-up is over every staff member, not over the page.** The salaries list is the staff list
and paginates at 15 (`CONVENTIONS.md`); a card summed from the rows on screen is silently wrong on
page 2 and silently right on page 1, which is the worst way for it to be wrong. `GET
/staff/salaries/summary` is its own query.

**Audit records the act, not the figure.** `staff.compensation.created`, `.updated`, `.archived`,
each carrying actor and subject membership and no amounts. The table is itself the record of what
was paid — effective-dated, soft-deleted, nothing lost — so an audit entry repeating the number adds
one more place the figure lives and one more place it can leak. Never in a query string, never in a
log line, never in toast text: the toast says *Guardado*.

**API**

| Method | Route | Notes |
|---|---|---|
| GET | `/staff/salaries` | Paginated. Staff with no rate included, marked *sem valor definido* |
| GET | `/staff/salaries/summary` | The two figures, the split, the counts |
| GET | `/staff/:membershipId/compensation` | Full history, newest first |
| POST | `/staff/:membershipId/compensation` | New rate; closes the previous one in the same transaction |
| PATCH | `/staff/compensation/:id` | Correct a row that was wrong |
| DELETE | `/staff/compensation/:id` | Archive. Never a hard delete |

Archiving the live rate leaves that person with **no live rate** — the previous one stays closed and
does not reopen, because a closed rate reopening is a pay change nobody made. The person shows as
*sem valor definido* until a new row is added.

**UI** — `/dashboard/facilities/staff/salaries`, a third sub-item under Staff beside Férias and
Duplicados, `roles: ['owner', 'admin']` in `app-sidebar.tsx`. The nav flag is cosmetic; the route
guard is server-side and the endpoints are guarded independently. `PageShell` at its default width.
Row click opens the history side sheet — flex column, the growable thing gets `flex-1 min-h-0` —
and "Adicionar novo valor" lives in it. Controlled fields only (`TextField` / `SelectField` /
`TextAreaField`); `useSavedAction` for the toast; `components/ui/dialog.tsx` for the archive
confirmation. `formatCents` from `apps/web/src/lib/money.ts`, the named `short` date format from
`i18n.ts`, `staff.salaries.*` keys written in pt-PT and en as the code is written.

**One-line proposals, not to be inlined without a yes:** `currency` could carry
`CHECK (currency = 'EUR')` until a second currency is a decision rather than a column; and the enum
could be named `compensation_kind` with the column `kind`, matching `fee_kind`, at the cost of
diverging from the prompt's own names.

### QA — test scenarios

1. **Given** an instructor's token, **when** it calls each of the six endpoints, **then** every one
   answers 403 and no body carries an amount. Repeat for maintenance, student and guardian.
2. **Given** an Admin, **when** they open the list, **then** the Owner is absent from the rows, from
   the split and from the "no rate set" count, and the card states that the Owner is not included.
3. **Given** an Admin, **when** they request the Owner's history directly, **then** 403 — not an
   empty list, which would be a different lie.
4. **Given** an Admin, **when** they POST a rate for the Owner, **then** 403 and nothing is written.
5. **Given** the Owner, **when** they open the list, **then** their own rate is there.
6. **Given** a live rate from 1 September, **when** a second is added from 1 October with no end on
   the first, **then** the first closes on 30 September and both are in history.
7. **Given** a rate ending 31 October, **when** one is added starting 1 November, **then** it is
   accepted; starting 31 October, **then** it is refused by the exclusion constraint and surfaced as
   a 409 naming both date ranges in the operator's language.
8. **Given** a `membershipId` belonging to another tenant, **when** anything is attempted against
   it, **then** 404 and the composite FK refuses the write regardless.
9. **Given** the isolation suite, **when** the tenant predicate is removed from the repository
   query, **then** zero rows come back.
10. **Given** an hourly staff member with null `weekly_hours`, **when** the list and the card render,
    **then** the monthly column is `—`, the card renders, that person is counted in a named
    "hours not set" figure, and nothing anywhere is `NaN`, `0` or blank.
11. **Given** a staff member archived last season, **when** the card is computed, **then** they are
    out of it; **when** their record is opened, **then** their history is still there.
12. **Given** a live rate, **when** it is archived, **then** it leaves the live list, stays in
    history, and the previously closed rate does not reopen.
13. **Given** the migration, **when** the Down runs, **then** it reverses the Up and `pnpm db:migrate`
    re-applies cleanly.
14. **Given** pt-PT and en, light and dark, a 14-period and a 12-period contract, **when** every
    screen is walked, **then** no untranslated string, no contrast failure, and no colour carrying
    meaning alone.
15. **Given** a live rate starting 1 September, **when** a rate is added starting 1 August, **then**
    it is refused with the same readable 409 rather than silently reordering history.
16. **Given** `pt-PT`, **then** amounts read `1 166,67 €`; **given** `en`, `€1,166.67`.
17. **Given** any action on these screens, **when** the network log, the server log and the toast are
    read, **then** no amount appears in a URL, a log line or a toast.

### Acceptance criteria

1. `staff_compensation` exists with the columns above, RLS on with `USING` and `WITH CHECK`, the
   composite FK to `membership`, the gist exclusion on the live rows, and a Down that reverses it.
2. The table is in `TENANT_TABLES` and has an isolation block in `tenant-isolation.sql`, both in the
   migration's own commit.
3. Every endpoint enforces `owner`/`admin` server-side, and every other role gets 403 — proven by a
   test per endpoint.
4. An Admin cannot read or write the Owner's compensation, by a rule resolved in the repository; an
   Owner can do both.
5. An Admin's roll-up card states in visible text that the Owner is not included.
6. Overlapping effective ranges are refused by the database and surfaced as a readable 409 carrying
   the dates as fields, not as prose.
7. Adding a rate closes the previous one in the same transaction; no history row is edited or
   deleted to do it.
8. `DELETE` archives; nothing is hard-deleted anywhere in this slice.
9. Both derived figures come from one definition in `packages/rules`, used by the per-row values and
   the roll-up alike; the web app computes neither.
10. A null `weekly_hours` renders `—` everywhere and never contributes zero to a total.
11. The roll-up shows both **este mês** and **média anual ÷ 12**, the monthly/hourly split and the
    count with no rate set, computed over every staff member rather than over the page.
12. The list paginates at 15.
13. Archived staff are excluded from the roll-up and their history remains reachable.
14. Every string goes through i18n in pt-PT and en as it is written; `pnpm i18n:check` passes.
15. Light and dark, contrast-checked, currency and dates formatted by locale through the existing
    helpers.
16. No amount appears in a query string, an application log or a toast.
17. `docs/features/staff.md` and `docs/data-model.md` are updated in the same commit, and the
    decisions below are in `docs/decisions.md`.

### Decided 2026-09-13, not to be re-opened

- **This is built before slice 2.4.** 2.4 takes money from an operator; the first production tenant
  is a free pilot, and platform administration already extends a trial, changes a plan and suspends
  by hand — which is the manual substitute for Stripe. Salaries is something the pilot club uses.
  2.4 keeps its number and its place in phase 2.
- **The Excel path is its own ticket**, POOLSE-59, built next. A round-trip test against the real
  catalogue is the part that gets cut when a slice runs long, and it is the part that catches the
  bugs.
- **The roll-up shows both figures.** Payroll this month and the annualised average are different
  questions — budgeting wants the second, the bank account wants the first — and picking one makes
  the card wrong for whoever wanted the other.
- **An Admin does not see the Owner's rate.** The office manager who administers the club is not
  automatically entitled to know what its owner pays themselves. Enforced server-side, in the
  repository, with the absence stated on screen.
- **14 pay periods is the default**, 12 is the alternative, nothing else is accepted.
- **Derivation is display-only.** A derived hourly rate is never stored, because a stored one is a
  second definition that drifts from the first the day somebody changes their hours.

---

## Revised 13 September 2026 — the financial rules

A second version of this ticket arrived after the first was built, carrying
[`docs/financials.md`](../financials.md) with it. What it added, and where it landed:

| Asked for | State |
|---|---|
| `provenance`, `amount_low_cents`, `amount_high_cents` on `staff_compensation` | Built, in a **second** migration — the first was applied, and an applied migration is history |
| `money_provenance`, the shared enum | Built, created once and reused by every money table after this one |
| CHECK that a range contains the expected value | Built, and either bound may stand alone |
| Roll-up labelled *contracted*, with coverage | Built — the card says "com base em 11 de 14 pessoas" and names its weakest provenance |
| Test layers 1 and 2, adversarial | Built: 5 database assertions, 11 financial-rule integration tests, 18 on the importer, 14 on the arithmetic |
| Test layer 3, Playwright | **Wired in** — `apps/web/playwright.config.ts`, `apps/web/e2e/`, `pnpm e2e`. The signed-out specs run; the signed-in walk-through is written and skips until `E2E_EMAIL` / `E2E_PASSWORD` name a Clerk test user |
| Layer 4, the UAT checklist | Handed over in the session summary rather than committed — it is a script for one person on one afternoon |

**Three deviations, each deliberate and each recorded in `docs/decisions.md`:**

1. **`staff_membership_id`, not `staff_id`** — the original deviation, unchanged. `membership`
   is the person in this schema.
2. **`weekly_hours` is capped at 80, not 168.** The ticket says refuse above 168; 80 refuses
   that and more. No lawful Portuguese contract reaches it, and a figure above it is a typo.
3. **The sheet carries the provenance and not the range.** Without the column an export and
   re-import would turn an owner's estimate into a contracted wage; the range belongs to a
   figure nobody has pinned down and would be two columns of blanks on every export.

**Not built, and named rather than assumed:** `financial_entry` — the projection surface —
and provenance on every *other* money table. `financials.md` §10 says why the order matters.
