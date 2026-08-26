# Poolse — product spec

What Poolse does, for whom, and what is deliberately not in it yet.

## Who it is for

| Audience | Uses | Pays |
|---|---|---|
| Pool operator (school, municipal pool, hotel, condo) | Backoffice | Yes — subscription |
| Instructor / maintenance staff | Backoffice, restricted role | No |
| Student (or their guardian) | Student mobile app | Monthly fee to the operator |
| Individual pool owner | Personal mobile app | Small subscription or free tier |

The operator is the customer. The student app exists because it removes work from the
operator (chasing payments, answering "is there class today?"), not as a product of its own.

## Surfaces

**Backoffice** — web, role-restricted. The main product. Everything an operator does.

**Student app** — mobile. Pay the monthly fee (débito direto / MB WAY), see class schedule
and status, see water temperature.

**Personal app** — mobile. An individual logs and tracks their own pool's readings:
temperature, pH, chlorine and similar. No classes, no staff, no billing beyond its own
subscription.

The two mobile apps share a codebase and most components. They differ in navigation and
in which modules they can see.

## Module 1 — Students and classes

The core, and the first thing built.

- Staff, guardian and student accounts by email invitation, with roles
- Student records: identity, contact, guardian, level, medical notes, photo consent
- Class groups (turmas): level, weekly schedule, instructor, capacity, pool/lane
- Enrollment of students into class groups, with waiting list when at capacity
- Session generation from a class group's schedule, plus one-off cancellations and
  substitutions (holidays, instructor absence, pool closure)
- Attendance per session
- Monthly fee, invoicing and payment status per student
- **Excel import/export** — the primary way data enters the system

### On invoices

Poolse is not an accounting system, but it issues documents that students and their
parents will treat as *faturas* — and Portuguese law treats them that way too: sequential
numbering within a series, VAT, SAF-T PT export, and above the revenue threshold certified
invoicing software. Two practical consequences that shape the schema rather than the
roadmap: invoices need **line items** (a student in two turmas, or two siblings on one
document, are both day-one realities), and numbering has to exist before the first invoice
is issued, because it cannot be added afterwards.

Whether these obligations fall on Poolse or stay with the operator depends on how
student→operator payment is routed. That is an open decision, not a settled one.

### On students being children

Most students are minors, and medical notes about them are special-category data under
GDPR. Consent is recorded as an event with a grantor and a timestamp, not as a checkbox;
sensitive fields are stored separately from ordinary student data; and every read or change
of them is logged. Customers are schools and municipal pools, which means a DPO will ask —
and an audit trail added later has no history for the period that matters.

### On Excel import

Operators arrive with spreadsheets, not with an empty database. Import is not a
convenience feature, it is the onboarding path, and it decides whether a customer ever
gets started. Real spreadsheets have inconsistent headers that will not match Poolse
field names — `Nome`, `Aluno`, `Nome do aluno`, `NOME COMPLETO` all mean the same column.

So the importer is built around a **mapping step**, never fixed column positions:
upload → propose a column mapping → the operator corrects it → validate rows and show
what will fail before anything is written → import.

The mapping proposal starts as ordinary heuristics (normalised header matching, sample-value
type sniffing). Making it AI-assisted comes later — the mapping *step* has to exist first,
and it has to work when the suggestion is wrong.

## Cross-cutting — notifications

Not a module, but a subsystem every module depends on, so it is built once in phase 3.0
and used everywhere after.

The reason the student app exists is that it stops operators fielding "is there class
today?" — which only holds if a cancellation actually reaches people. Overdue invoices need
a channel to chase through. An out-of-range chlorine reading needs somewhere to raise.
Push and transactional email at launch; SMS costs real money per message and is deferred
until push and email have proven insufficient. Per-user, per-kind channel preferences from
the start — an instructor and a parent do not want the same alerts.

## Module 2 — Maintenance

- Water readings: pH, chlorine, temperature, turbidity, with the unit recorded
- Scheduled maintenance tasks per pool, recurring, assigned to staff
- Completion log with who and when
- Alerts when a reading falls outside the configured safe range
- Consumables and dosing records

Shares its reading model with the personal app — an individual logging pH is doing the
same thing as a technician, at a different scale.

## Module 3 — Energy

- Meters per pool or per facility (pump, heating, lighting, total)
- Consumption readings as time-series, manual entry first, automated feed later
- Cost per period against a configurable tariff
- Consumption compared across periods and against water temperature

This is the module that justifies TimescaleDB. Everything else is ordinary relational data.

## Module 4 — AI dashboards

Reads from the other three; owns no data of its own. Built last, because it needs real
data in the other modules to be worth anything.

- Occupancy and attendance trends, dropout risk
- Maintenance anomalies — a reading drifting before it breaches
- Energy cost forecasting and "what changed" explanations
- Natural-language questions over the operator's own data

## Deferred — decided, not forgotten

These are real commitments with no date. Do not build them early, and do not design them
out of existence either.

- **Parent communication.** Sharing swim records and stats with each student's parents —
  swimming speed, underwater time, progression against level.
- **Wearable integrations.** Apple Health, Fitbit, Garmin, so students can feed their own
  stats in.
- **AI-assisted Excel column mapping.** The mapping step ships first with heuristics.
- **Automated meter feeds.** Manual energy entry first.

The data model should leave room for these (see `docs/data-model.md`) without building
tables nothing writes to yet.

## Explicitly out of scope

- Generic facility management. Considered and rejected.
- Anything that makes Poolse a general-purpose CRM or accounting package. It integrates
  with billing; it is not an accounting system.
- Competition and race timing. Adjacent, tempting, and a different product.
