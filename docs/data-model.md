# Poolse — data model

Module 1 is specified in full because it gets built first. Modules 2–4 are specified to
the level of shape and key decisions, and will be filled in when they are built.

## The four decisions that shape everything

### 1. A personal user is their own organization

Individuals tracking their own pool could have been modelled as a separate case outside
the tenant system. They are not. Every account — a 400-student swim school or one person
with a pool in the garden — is an `organization`, distinguished only by
`organization.kind`.

This means **every query is scoped by `organization_id` with no exceptions and no special
cases**. One scoping rule, enforced once, applied everywhere. The alternative — nullable
tenant keys and "if personal then…" branches — is the shape that eventually leaks one
tenant's data into another's screen. The cost is a mostly-empty organization row per
personal user, which is nothing.

### 2. Tenant isolation is enforced by the database, not by the repository layer

Carrying `organization_id` on every table is not isolation — it is only the raw material
for it. Application-layer scoping fails the night one repository method is written tired
and omits the filter, and nothing in the schema notices.

So two mechanisms, both established in phase 0 before any tenant data exists:

- **Composite foreign keys.** Every reference to a tenant-scoped parent is
  `(organization_id, parent_id) → parent(organization_id, id)`, which requires a unique
  key on `(organization_id, id)` on every such parent. This makes it structurally
  impossible for org A's `class_group` to point at org B's `pool`.
- **Row-level security.** RLS enabled on every tenant table, with the policy reading
  `current_setting('app.organization_id')`. The API sets that GUC once per request from
  the verified Clerk session, in the same middleware that resolves the membership. A
  query that forgets its `where` clause returns nothing instead of everything.

Retrofitting either of these after there is customer data means rewriting every table's
constraints plus an audit of what already leaked. They are close to free now.

### 3. Identity lives in Clerk; profile lives here

Clerk owns credentials, sessions and the user identifier. The database holds an
`app_user` row keyed by `clerk_user_id`.

Clerk remains the **source of truth** for name and email, but `app_user` keeps a
**denormalised cache** of both, maintained by Clerk webhook. Without it, every staff list,
instructor picker and "recorded by" column becomes an API fan-out per row, and staff
cannot be searched or sorted in SQL at all. The cache is explicitly a cache: never written
by the app, only by the webhook, and `synced_at` records how stale it may be.

### 4. A student is not necessarily a user

Most students are children who will never log in. `student` is a record owned by the
organization, with an *optional* link to an `app_user`. The mobile app is used by whoever
holds that link — the student if old enough, otherwise a guardian. Modelling students as
users first would make guardian access an awkward retrofit, and guardian access is a
committed future feature.

## Conventions

- `id uuid primary key default gen_random_uuid()`
- `organization_id uuid not null references organization(id)` on every tenant-scoped table
- `unique (organization_id, id)` on every table that is referenced by another — this is
  what makes the composite FKs in decision 2 possible
- `created_at`, `updated_at` — `timestamptz not null default now()`, `updated_at`
  maintained by trigger. Present on **every** table; omitted from the listings below only
  to keep them readable.
- Soft delete via `archived_at timestamptz null`; never hard-delete anything an operator
  can see. Hard delete only for GDPR erasure, which is a deliberate separate path.
- **Every unique constraint on a soft-deletable table is partial**:
  `... where archived_at is null`. Otherwise archiving an instructor and re-adding them
  next season violates the constraint against a dead row.
- Money amounts: `amount_cents integer` + `currency char(3)`. Never float.
- **Unit prices are not money amounts.** A tariff of €0.1548/kWh rounds to 15 cents and
  puts a 3% error on every figure in the module whose purpose is cost accuracy. Unit
  prices are `numeric(12,6)`.
- Readings: `value numeric(10,3)` + `unit text`. pH, °C, ppm and kWh do not share a type.
- Times stored `timestamptz` in UTC; `facility.timezone` decides display.
- Enumerations as Postgres enums where the set is genuinely closed (payment status),
  as lookup tables where an operator might add to it (student level, task type).

## Core

```
organization
  id, kind ('business'|'personal'), name, locale ('pt-PT'|'en'), country,
  vat_number, invoice_series_prefix,
  stripe_customer_id, subscription_status, archived_at

app_user
  id, clerk_user_id (unique),
  cached_email, cached_first_name, cached_last_name, cached_avatar_url, synced_at,
  locale, theme_preference

membership                      -- a person's presence in an organization
  id, organization_id, app_user_id (nullable until accepted),
  status ('invited'|'active'|'suspended'), archived_at
  unique (organization_id, app_user_id) where archived_at is null

membership_role                 -- a membership can hold several roles at once
  id, organization_id, membership_id, role
  role: 'owner'|'admin'|'instructor'|'maintenance'|'student'|'guardian'
  unique (membership_id, role) where archived_at is null

invitation
  id, organization_id, email, roles text[], token (unique), expires_at,
  accepted_at, accepted_membership_id, invited_by_membership_id

facility                        -- a site; a personal org has exactly one
  id, organization_id, name, address, timezone, archived_at

pool
  id, organization_id, facility_id, name, kind ('indoor'|'outdoor'),
  volume_litres, lane_count, archived_at
```

**Roles are a child table, not a column on `membership`.** In a small club the owner also
teaches, and a parent is sometimes the instructor. A scalar `role` forces that person to
choose between the admin view and the instructor view, and unpicking it from every
authorisation check later costs a weekend. Authorisation reads `membership_role`, always.

`membership.app_user_id` is nullable because an invited person has a membership before
they have an account — that is what `status = 'invited'` means. The Clerk webhook binds
the two on acceptance.

## Module 1 — students and classes

```
student
  id, organization_id, first_name, last_name, birth_date, level_id,
  app_user_id (nullable), notes, contact_email, contact_phone, archived_at

student_sensitive               -- separated deliberately; see "minors and consent"
  student_id (pk), organization_id, medical_notes_encrypted,
  recorded_by_membership_id, recorded_at

consent
  id, organization_id, student_id, kind ('photo'|'medical_data'|'parent_sharing'),
  granted boolean, granted_by_membership_id, granted_at, evidence_note, withdrawn_at

guardian_link                   -- table exists now; parent-facing features are deferred
  id, organization_id, student_id, app_user_id, relationship,
  can_view_progress boolean default false, archived_at

student_level                   -- lookup; operators define their own progression
  id, organization_id, name, sort_order, archived_at

class_group                     -- a turma
  id, organization_id, pool_id, name, level_id, instructor_membership_id,
  capacity, lane, starts_on, ends_on, archived_at

class_schedule                  -- the recurring weekly pattern
  id, organization_id, class_group_id, weekday smallint, start_time time,
  duration_minutes int, archived_at

closure                         -- holidays, maintenance shutdowns, August
  id, organization_id, facility_id, pool_id (nullable), starts_on, ends_on,
  reason, blocks_generation boolean default true

class_session                   -- a materialised occurrence
  id, organization_id, class_group_id, starts_at timestamptz,
  duration_minutes int, status ('scheduled'|'cancelled'|'completed'),
  substitute_instructor_membership_id (nullable), cancellation_reason,
  closure_id (nullable)
  unique (class_group_id, starts_at)
  exclude using gist (pool_id with =, lane with =, tstzrange(starts_at, ends_at) with &&)
      where (status <> 'cancelled' and lane is not null)

enrollment
  id, organization_id, class_group_id, student_id,
  status ('active'|'waiting'|'ended'), waiting_position int, joined_on, ended_on
  unique (class_group_id, student_id) where status <> 'ended'

attendance
  id, organization_id, class_session_id, student_id,
  status ('present'|'absent'|'excused'|'late'), recorded_by_membership_id, recorded_at
  unique (class_session_id, student_id)
```

### Why sessions are materialised

`class_session` rows are generated ahead (a rolling 90-day window) rather than computed on
the fly from `class_schedule`. Attendance, cancellations and substitutions all need
something to attach to, and a computed-on-read schedule makes "the 14th was cancelled"
impossible to express.

The generator is idempotent and safe to re-run. It skips dates covered by a `closure`,
which is what stops August and every bank holiday from being cancelled by hand one session
at a time — and, because the window rolls forward, from being re-cancelled every time it
extends. Changing a schedule regenerates only future unmodified sessions and never touches
one with attendance recorded against it.

The exclusion constraint is what stops two turmas being booked into lane 3 at 18:00. This
is a week-one operator complaint if the database does not prevent it.

### Minors and consent

Students are children, and `medical_notes` is special-category health data under GDPR. For
a product sold to schools and municipal pools in the EU, a customer's DPO will ask about
this, and an audit trail retrofitted over existing rows has no history for the period that
matters.

So: sensitive fields live in `student_sensitive`, separated so access can be restricted and
logged independently of ordinary student data; consent is a **record with a grantor and a
timestamp**, not a boolean; and reads and writes of `student_sensitive` append to
`audit_log` from the first slice that touches them.

```
audit_log
  id, organization_id, actor_membership_id, action, entity_type, entity_id,
  before jsonb, after jsonb, at timestamptz
```

Retention rules per entity are an open question, but the audit trail has to exist from the
start — it is the part that cannot be reconstructed.

### Billing

```
fee_plan
  id, organization_id, name, amount_cents, currency, billing_period,
  vat_rate numeric(5,4), archived_at

student_subscription
  id, organization_id, student_id, fee_plan_id, status, started_on, ended_on,
  payment_method ('sepa_dd'|'mbway'|'card'|'manual'),
  mandate_id (nullable), stripe_subscription_id (nullable)

invoice
  id, organization_id, series, number int, issued_on,
  bill_to_kind ('student'|'guardian'), bill_to_student_id, bill_to_app_user_id,
  period_start, period_end,
  net_cents, vat_cents, total_cents, currency,
  status ('draft'|'issued'|'paid'|'overdue'|'void'), due_on, paid_at,
  stripe_invoice_id (nullable), voided_reason
  unique (organization_id, series, number)

invoice_line
  id, organization_id, invoice_id, student_id, student_subscription_id (nullable),
  description, quantity, unit_price numeric(12,6), net_cents, vat_rate, vat_cents
```

**An invoice needs line items and a number.** Without lines you cannot bill a student
enrolled in two turmas, or put two siblings on one document — both are day-one realities
for a swim school. Without a series and sequential number it is not a *fatura*: Portugal
requires sequential numbering, SAF-T PT export, and above the revenue threshold certified
invoicing software. Product scope says Poolse is not an accounting system, and that is
true — but a system that issues invoices to students still carries these obligations, and
adding numbering and tax to a table that already holds issued rows is the worst kind of
migration.

Two payment paths coexist and must not be conflated: the **operator pays Poolse** (Stripe
subscription on `organization`) and the **student pays the operator** (`invoice` +
mandate). Separate services from the start.

> **Open question, needs an answer before phase 2.4:** whether student→operator collection
> goes through Stripe Connect or direct SEPA/MB WAY. Connect is far less work and handles
> compliance; it takes a cut and constrains MB WAY support in Portugal. This also decides
> whether certified-invoicing obligations fall on Poolse or stay with the operator.

### Notifications

The stated reason the student app exists is that it stops operators answering "is there
class today?" — which only holds if a cancellation actually reaches people. Overdue
invoices need a channel to chase through, and an out-of-range reading needs somewhere to
raise. This is a real subsystem, not a detail.

```
notification
  id, organization_id, recipient_membership_id, kind, payload jsonb,
  channels text[], created_at, read_at

notification_delivery
  id, organization_id, notification_id, channel ('push'|'email'|'sms'|'in_app'),
  status ('queued'|'sent'|'failed'|'skipped'), provider_message_id, error, attempted_at

notification_preference
  id, organization_id, membership_id, kind, channel, enabled boolean
```

Provider choice (push, transactional email, and whether SMS is worth its cost) is a phase-0
decision so it is not discovered mid-slice.

### Import

```
import_batch
  id, organization_id, target ('student'|'class_group'|'enrollment'|'reading'),
  source_filename, column_mapping jsonb, status, row_count, error_count,
  created_by_membership_id

import_row_error
  id, organization_id, import_batch_id, row_number, column_name, message
```

`column_mapping` is stored so a repeat import from the same source reuses the mapping the
operator already corrected — that is most of the value of the feature.

## Module 2 — maintenance (shape)

```
reading            organization_id, pool_id, kind, value numeric, unit,
                   taken_at, recorded_by_membership_id, source ('manual'|'sensor')
                   primary key (organization_id, pool_id, kind, taken_at)
                   -- no surrogate id: candidate hypertable once sensor feeds exist,
                   -- and Timescale requires the partitioning column in every unique index
reading_range      id, organization_id, pool_id, kind, min_value, max_value  -- drives alerts
maintenance_task   id, organization_id, pool_id, title, task_type_id, recurrence,
                   assigned_to_membership_id
task_completion    id, organization_id, maintenance_task_id, completed_at,
                   completed_by_membership_id, notes
```

`reading` is shared with the personal app unchanged — a personal organization has one
facility, one pool, and one member who records readings. No separate table, no branching.

## Module 3 — energy (shape)

```
energy_meter    id, organization_id, facility_id, pool_id (nullable),
                kind ('pump'|'heating'|'lighting'|'total'), unit,
                reads ('cumulative_index'|'interval_consumption'),
                initial_index numeric, replaced_meter_id (nullable), archived_at
energy_reading  organization_id, meter_id, taken_at, value numeric, source
                primary key (organization_id, meter_id, taken_at)
                -- TimescaleDB hypertable on taken_at; no surrogate id
tariff          id, organization_id, name, valid_from, valid_to,
                price_per_unit numeric(12,6), currency, standing_charge_cents
```

**`energy_meter.reads` settles what `value` means.** A cumulative meter index and an
interval consumption figure are computed into cost in completely different ways, and
getting it wrong is silently wrong rather than loudly wrong. `replaced_meter_id` and
`initial_index` make meter swaps and rollover representable, which they otherwise are not.

`energy_reading`, and high-frequency `reading` rows once sensors exist, are the only
hypertables. Everything else stays ordinary Postgres.

> **Phase 0 provisioning decision:** confirm the chosen Railway or Fly Postgres can enable
> the TimescaleDB extension. Discovering in phase 5 that it cannot means migrating the
> production database.

## Module 4 — AI dashboards

Owns no tables. Reads through the same tenant-scoped, RLS-protected path as everything
else, so a dashboard can never see across organizations. If materialised views or rollup
tables become necessary for performance, they carry `organization_id` and their own
policies like anything else.

## Open questions

1. **Stripe Connect or direct SEPA/MB WAY** for student→operator payments. Blocks 2.4,
   and decides where invoicing obligations land. Not needed before module 1.
2. **Does a student belong to one facility or to the organization?** Modelled as
   organization-wide, which is right for a single-site school and slightly wrong for a
   multi-site operator. Cheap to add `facility_id` later; noted rather than guessed.
3. **Waiting-list ordering** — `waiting_position` supports manual reordering, defaulting
   to enrollment order. Confirm operators actually want to reorder before building UI for it.
4. **Retention periods** per entity for GDPR, especially `student_sensitive` and
   `audit_log`. The audit trail must exist from day one; how long it is kept can be decided
   later.
