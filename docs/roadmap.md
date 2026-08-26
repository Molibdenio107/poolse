# Poolse — roadmap

Sequenced as vertical slices. Each one ends with something that works end to end, because
a slice that ends working is worth more than three layers half-built — and because on an
evening schedule, "done" is the only reliable stopping point.

Slices are sized to roughly one or two evenings. If one is running long, it was too big:
split it rather than leaving it open across a week.

## Phase 0 — foundations

The only horizontal phase. Everything after this is vertical.

| # | Slice | Done when |
|---|---|---|
| 0.1 | Monorepo, both apps booting, shared TS config and lint | `pnpm dev` runs web and API locally |
| 0.2 | Postgres + migrations toolchain, `organization` / `app_user` / `membership` / `membership_role` | Migration runs clean on an empty DB |
| 0.3 | **Tenant isolation in the database** — composite FKs, RLS on every tenant table, request middleware setting the org GUC from the Clerk session | A repository method with its `where` clause deleted returns zero rows, proven by test |
| 0.4 | Clerk wired both sides; webhook provisions `app_user` and maintains the name/email cache | A new Clerk signup appears as an `app_user` with cached fields populated |
| 0.5 | Invitations — invite by email, roles, acceptance binds membership to `app_user` | A second person joins an organization as an instructor |
| 0.6 | i18n scaffolding, `pt-PT` + `en`, locale switch | No user-facing literal strings exist anywhere |
| 0.7 | Theme tokens, light and dark, palette applied | Toggle works; no hex literals in components |
| 0.8 | `audit_log` table and the write helper | Any mutation can record who and what in one call |
| 0.9 | Staging + production deploys, both environments green | A push deploys to staging without manual steps |

**0.3 is the slice to get right, and it is not the same slice as 0.4.** Auth answers "who
are you"; isolation answers "and what can this query possibly see". Write the cross-tenant
test here and keep it running forever.

**0.5 exists because nothing else works without it.** Class groups need an instructor,
attendance needs a recorder, the student app needs student accounts, guardian links need
guardian accounts. Without invitations the only user in the system is whoever signed up,
and slice 1.3 is not startable except by hand-inserting rows.

Two decisions to settle during this phase so they are not discovered mid-slice later:
confirm the chosen Railway or Fly Postgres can enable **TimescaleDB** (needed in phase 5,
and migrating production to find out is not an option), and pick the **notification
providers** — push and transactional email at minimum.

## Phase 1 — module 1, usable

The goal of this phase is an operator running real classes on Poolse instead of a
spreadsheet. That is the milestone that makes everything after it worth doing.

| # | Slice | Done when |
|---|---|---|
| 1.1 | Facility + pool CRUD | An operator can set up their site |
| 1.2 | Student CRUD, levels, search and list | 50 students manageable without pain |
| 1.3 | Consent records and separated sensitive fields, with audit | Medical notes and photo consent are recorded with who and when |
| 1.4 | Class groups + weekly schedule | A turma exists with a recurring pattern |
| 1.5 | Closure calendar (holidays, August, shutdowns) | A closure exists before the generator runs |
| 1.6 | Session generation honouring closures; cancel; substitute instructor | A month of sessions appears, August is empty, cancelling one holds |
| 1.7 | Enrollment + waiting list | Students join a turma; capacity is enforced |
| 1.8 | Attendance marking, per session | An instructor marks a class in under a minute |
| 1.9 | Weekly / monthly schedule view | The operator's main daily screen |
| 1.10 | Excel import — mapping step, validation preview, commit | A real messy spreadsheet imports cleanly |
| 1.11 | Excel export | Data can leave; nobody trusts a system it can't |
| 1.12 | Role restrictions across module 1 | An instructor sees only their own turmas; an owner who also teaches sees both views |

**1.5 comes before 1.6 deliberately.** Generating sessions first and adding closures later
means cancelling August by hand, then doing it again every time the rolling window extends.

**1.10 deserves more time than it looks like it needs.** It is the onboarding path — a
customer who cannot get their spreadsheet in never becomes a customer. Build the mapping
correction UI properly the first time.

## Phase 2 — money

Split deliberately, because the two flows are different problems and merging them is the
expensive mistake.

| # | Slice | Done when |
|---|---|---|
| 2.1 | Fee plans + student subscriptions (records only, no charging) | Who owes what is visible and correct |
| 2.2 | Invoice generation with series, sequential numbering, lines and VAT | A sibling pair on one document, numbered correctly |
| 2.3 | Invoice statuses, overdue view, chase action | The operator can chase payments |
| 2.4 | Operator pays Poolse — Stripe subscription on the organization | Poolse can take money |

Do 2.1–2.3 before touching Stripe. Most of the value of billing is knowing who owes what;
automated collection is an optimisation on top of that, and it is where the regulatory and
integration cost lives.

**Student→operator automated collection is not in this phase.** A SEPA mandate and an
MB WAY authorisation both require the payer to act, and the payer has no account and no
app until phase 3. It is slice 3.5, below. Chasing in 2.3 needs notifications (phase 3.0)
or falls back to exporting a list — decide which when you get there.

## Phase 3 — student app and notifications

| # | Slice | Done when |
|---|---|---|
| 3.0 | Notification subsystem — records, preferences, push + email delivery | A cancellation reaches a phone |
| 3.1 | Mobile shell, auth, sportier theme | Login works on a real device |
| 3.2 | Student and guardian accounts via invitation | A parent logs in and sees their child |
| 3.3 | My classes, schedule, cancellations | A student sees whether there is class today |
| 3.4 | Payment status and invoice view | A student sees what they owe |
| 3.5 | Student pays operator — mandate capture, SEPA DD / MB WAY | Automated collection works for one real turma |
| 3.6 | Water temperature for their pool | Requires module 2 readings — see note |

**3.5 is where open question 1 gets answered** — Stripe Connect or direct. Answer it before
starting the slice, not during.

**3.6 depends on phase 4.** Either ship 3.0–3.5 and add it after phase 4, or accept the
reorder. Flagged so it is a choice, not a surprise.

## Phase 4 — maintenance

| # | Slice | Done when |
|---|---|---|
| 4.1 | Readings: record, list, chart per pool | A technician logs pH and temperature |
| 4.2 | Safe ranges + alerts through the notification subsystem | Out-of-range reading reaches someone |
| 4.3 | Maintenance tasks, recurrence, assignment | A task appears for the right person |
| 4.4 | Completion log and history | Who did what, when |
| 4.5 | Personal app on the same reading model | An individual tracks their own pool |

4.5 should be small. If it is not small, the "personal user is their own organization"
decision was not honoured somewhere upstream — that is the signal to go and fix it.

## Phase 5 — energy

| # | Slice | Done when |
|---|---|---|
| 5.1 | TimescaleDB hypertable, meters with explicit `reads` semantics | Schema in place and migrating cleanly |
| 5.2 | Manual reading entry, consumption charts | A month of data is visible |
| 5.3 | Tariffs and cost per period | Cost, not just kWh |
| 5.4 | Period comparison, correlation with temperature | The insight the module exists for |

## Phase 6 — AI dashboards

Deliberately last. Every part of it needs real data in the other modules to be anything
other than a demo — an anomaly detector with three weeks of synthetic readings tells you
nothing, and a dropout-risk model with no dropouts is a straight line.

| # | Slice |
|---|---|
| 6.1 | Occupancy and attendance trends |
| 6.2 | Reading anomaly detection — drift before breach |
| 6.3 | Energy forecasting and "what changed" |
| 6.4 | Natural-language questions over the operator's own data |

## Deferred, with their trigger

| Item | Build it when |
|---|---|
| Parent communication and swim stats | An operator asks for it, or phase 1 is in real use |
| Apple Health / Fitbit / Garmin | Parent communication exists — the stats have to come from somewhere first |
| AI-assisted column mapping | The manual mapping step has been used enough to know where it is wrong |
| Automated meter feeds | Manual energy entry is in real use and is the bottleneck |
| SMS as a notification channel | Push and email have proven insufficient — it costs real money per message |
| n8n automations | There is a repeated operational task worth automating — not before |

## The honest risk

Phases 4–6 are where solo side projects die: module 1 gets to "good enough", the novelty
runs out, and the remaining modules stay perpetually next. The mitigation is that
**phase 1 is designed to be independently valuable** — if Poolse never gets past phase 2,
an operator running their classes on it is still a real product. Build in that order and
the project survives losing momentum, which over a long enough evening schedule it will.
