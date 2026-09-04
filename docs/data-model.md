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

**The one escape hatch, added in slice 0.4.** Some questions have to be answered before a
tenant is known — "which organizations does this Clerk user belong to?" is asked by the
middleware that sets the GUC, so it cannot already have it set. Under RLS that query
correctly returns nothing, which means the honest answer is not "connect without the GUC"
but "this read is a deliberate exception". The exceptions are `SECURITY DEFINER` functions
owned by the migration role: `resolve_memberships`, `find_app_user`, `provision_app_user`,
`deactivate_app_user`. They bypass RLS because their bodies are fixed and reviewed and
their only input is a Clerk user id.

The alternative — granting the app role `BYPASSRLS`, or adding permissive policies — would
re-open exactly the hole this decision closes, since a forgotten `where` clause would see
everything again. If a new cross-tenant read is needed, it gets its own function. There is
no general escape hatch, and `withoutTenantScope` in the db package is not one: it skips
the GUC, it does not lift RLS.

### 3. Identity lives in Clerk; profile lives here

Clerk owns credentials, sessions and the user identifier. The database holds an
`app_user` row keyed by `clerk_user_id`.

Clerk remains the **source of truth** for name and email, but `app_user` keeps a
**denormalised cache** of both, maintained by Clerk webhook. Without it, every staff list,
instructor picker and "recorded by" column becomes an API fan-out per row, and staff
cannot be searched or sorted in SQL at all. The cache is explicitly a cache: never written
by the app, only by the webhook, and `synced_at` records how stale it may be.

"Never written by the app" is enforced, not just documented: RLS gives the app role no
insert path into `app_user`, so the only writer is `provision_app_user`. `synced_at` doubles
as the ordering guard — webhooks retry and arrive out of order, and an event older than
what is already stored is discarded rather than reverting the cache.

`GET /me` will provision from the Clerk API if the webhook has not landed yet. Both paths
call the same function, so they cannot disagree. It exists because the redirect after
sign-up can outrun the webhook, and because local development has no public URL for Clerk
to call — requiring a tunnel before anything works at all is a poor trade on an evening
schedule.

Clerk's `user.deleted` marks `app_user.deleted_at` and clears the cached personal fields
rather than deleting the row: memberships reference it, and attendance, invoices and audit
entries will. The tombstone keeps referential integrity; clearing the cache is also the
right answer to an erasure request.

**The profile screen writes across both halves, and the split is the whole design.** A
person editing "O meu perfil" changes their name, which is Clerk's, alongside their birth
date, phone, language and theme, which are ours. The name goes to Clerk and the cache
catches up; `set_app_user_profile` has no name parameter at all, so there is no argument
order that writes one. `packages/db/test/profile.sql` test 6 asserts that against `pg_proc`
rather than by trying it, because "it does not exist" is a stronger claim than "it did not
work".

Because Clerk cannot reach `localhost`, the API re-reads from the Clerk API immediately
after writing rather than waiting for `user.updated`. Same upsert, same `synced_at`
ordering guard, so the pull and the webhook cannot disagree — and the feature is not one
that only works on a machine with a tunnel.

`set_app_user_profile` is the ninth `SECURITY DEFINER` function and exists for the same
reason as `set_app_user_preferences`: `app_user` carries no `organization_id`, so its policy
scopes it *through membership*, and an account belonging to no organization cannot see its
own row. Every parameter is the new value including NULL, which is the opposite of
`set_app_user_preferences` — that one backs two independent switches that must not clobber
each other, this one backs a form that submits every field at once, and somebody clearing
their phone number means it.

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
  id, kind ('business'|'personal'), name, slug, locale ('pt-PT'|'en'), country,
  vat_number, invoice_series_prefix,
  stripe_customer_id,
  subscription_status ('trialing'|'active'|'past_due'|'canceled'),
  trial_ends_at, archived_at
  unique (slug) where archived_at is null

app_user
  id, clerk_user_id (unique),
  cached_email, cached_first_name, cached_last_name, cached_avatar_url, synced_at,
  locale, theme_preference,
  birth_date, contact_phone          -- ours, not Clerk's. See decision 3
  check birth_date >= '1900-01-01'
  check contact_phone is null or btrim(contact_phone) <> ''

membership                      -- a person's presence in an organization; see "one person, many roles"
  id, organization_id, app_user_id (nullable — no login, or not yet),
  status ('invited'|'active'|'suspended'), archived_at,
  first_name, last_name, email, phone, tax_number, address, birth_date
                                -- the club's own record, only where app_user_id is null
  unique (organization_id, app_user_id) where archived_at is null
  unique (organization_id, tax_number) where archived_at is null
  unique (organization_id, email) where archived_at is null
  check (app_user_id is null or (first_name, last_name, email are all null))
  merged_into                   -- set by merge_memberships; see "duplicates"
  check (merged_into is null or archived_at is not null)

membership_role                 -- a membership can hold several roles at once
  id, organization_id, membership_id, role, granted_at, granted_by_membership_id
  role: 'owner'|'admin'|'instructor'|'maintenance'|'guardian'|'student'
  unique (membership_id, role) where archived_at is null

invitation
  id, organization_id, email, roles member_role[], token_hash (unique), expires_at,
  membership_id, accepted_at, accepted_membership_id, revoked_at,
  invited_by_membership_id
  unique (organization_id, email) where accepted_at is null and revoked_at is null

facility                        -- a site; a personal org has exactly one
  id, organization_id, name, address, timezone, archived_at,
  city, country_code, latitude numeric(9,6), longitude numeric(9,6)
  unique (organization_id, lower(name)) where archived_at is null
  check (latitude is null) = (longitude is null)   -- half a coordinate is not a location
  check country_code ~ '^[A-Z]{2}$'

pool
  id, organization_id, facility_id, name, kind ('indoor'|'outdoor'),
  volume_litres, lanes_enabled boolean, archived_at
  unique (organization_id, facility_id, lower(name)) where archived_at is null
  check volume_litres > 0

lane                            -- POOLSE-43
  id, organization_id, pool_id, name, position smallint,
  length_m, default_capacity, archived_at
  unique (organization_id, id)
  foreign key (organization_id, pool_id) references pool (organization_id, id)
  unique (organization_id, pool_id, position) where archived_at is null
  unique (organization_id, pool_id, lower(strip_accents(name))) where archived_at is null
  check position > 0
```

**Signup is the one write that row-level security cannot allow.** The policy on
`organization` is `WITH CHECK (id = current_organization_id())`, and a brand-new
organization has no current organization — `current_organization_id()` is NULL, the check
fails, the INSERT is refused. That is correct behaviour, not a bug, and the two obvious
ways to "fix" it are both disasters: weakening the policy re-opens cross-tenant writes for
every table, and connecting as the owner role disables RLS everywhere at once.

So `provision_organization` is a `SECURITY DEFINER` function with `SET search_path = public,
pg_temp`, revoked from `PUBLIC` and granted to `poolse_app` alone. In one transaction it
creates the organization (trialing, 14-day trial, unique slug), the membership, the owner
role, a first facility, and the audit entries. A narrow, reviewable door instead of an open
gate — the same pattern as the other cross-tenant functions, which are listed in the
README.

**A facility knows where it is, in two different senses, and both are needed.** `address`
stays free text — it is what goes on an invoice and what a parent pastes into a maps app,
and neither wants a structured breakdown of a Portuguese street name. Beside it sits a
*place*: a city chosen from Open-Meteo's geocoder with the coordinates it returned.

Storing the coordinates at selection time rather than geocoding on read is the point.
Geocoding per render is slow, spends quota on a question already answered, and breaks the
screen whenever somebody else's geocoder is down. Resolved once, by a person who can see
from the region label whether it is the right Aveiro.

This also unblocks the municipal holiday that `holidays.ts` documents itself as unable to
compute, because "Poolse does not know which town a pool is in". After this it does — and
those holidays join `closure` as another `source`, not a second table. See "National
holidays are rows, not rules".

**`subscription_status` is an enum, and `trial_ends_at` sits beside it.** As free text it
accepted 'trialing', 'Trialing' and 'trialling' equally, and that bug would have surfaced in
phase 2 as a paywall letting the wrong people through. Nothing enforces either column yet;
the dashboard reads them to say how long is left.

**The slug is derived at signup and made unique by suffix.** `slugify()` strips Portuguese
accents with `translate()` rather than the `unaccent` extension, so it stays IMMUTABLE with
nothing to enable on whichever managed Postgres this lands on.

**Facility and pool names are unique per site, case-insensitively, and only per site.**
All of module 1 hangs off picking a facility from a list, and a list with two identical
entries is one somebody picks wrong from. Scoped to the facility rather than the
organization for pools, because a club with two sites may well have a "Piscina Grande" at
each and that is not a mistake. `lower(name)` rather than `citext`: the column is display
text that should keep the capitalisation it was typed with, and only the comparison should
ignore it.

**`facility.timezone` is the field with the longest-lived consequence.** Class times are
stored UTC and displayed in the facility's timezone, so a site in Ponta Delgada left on
`Europe/Lisbon` shows every lesson an hour wrong, silently, forever. The column takes any
IANA zone; the form offers the three that cover Portugal, which is a one-line change rather
than a migration when a fourth is needed.

**Roles are a child table, not a column on `membership`.** In a small club the owner also
teaches, and a parent is sometimes the instructor. A scalar `role` forces that person to
choose between the admin view and the instructor view, and unpicking it from every
authorisation check later costs a weekend. Authorisation reads `membership_role`, always.

`membership.app_user_id` is nullable because an invited person has a membership before
they have an account — that is what `status = 'invited'` means. Acceptance binds the two.

**The invitation stores a hash, not the token.** The column holds a SHA-256 of a
256-bit random value; the value itself lives only in the link. A database dump or a
restored backup is then a list of useless hashes rather than a set of working keys into
customer organizations. Unsalted is correct here and would be wrong for a password — the
input is entropy we generated, so there is no dictionary to defeat.

**`membership_id` and `accepted_membership_id` are different columns on purpose.** The
first is the placeholder created *with* the invitation, the second is what acceptance
actually bound to. They are the same row in the normal case. They differ in exactly one:
the invitee already had a live membership, so the offered roles merge into it and the
placeholder is retired — binding it instead would collide with
`membership_org_user_uq`, which is that constraint doing its job.

**`revoked_at` exists so a typo is recoverable.** The one-live-invite-per-address rule is
a partial unique index; without a revoked state, a mistyped address is blocked until the
invitation expires.

## Module 1 — students and classes

```
student
  id, organization_id, first_name, last_name, birth_date, level_id,
  app_user_id (nullable), membership_id (nullable), notes,
  contact_email, contact_phone, tax_number, archived_at,
  is_socio boolean not null default false, socio_number, socio_since
  unique (organization_id, socio_number) where archived_at is null
                                           and socio_number is not null
  -- Sócio is a fact about the person, not "has an active quota line". A waived
  -- quota is a real case — honorary members, staff children — and deriving the
  -- boolean would make it unrepresentable. POOLSE-42 AC6.
  unique (organization_id, tax_number) where archived_at is null
                                         and tax_number is not null
  -- tax_number is the student's own NIF, for somebody invoiced in their own
  -- name: an adult class, or a child whose parent deducts the lessons against
  -- the child's number. Deliberately no age rule — minors have NIFs in
  -- Portugal, and a CHECK against the club's maioridade would both refuse a
  -- real number and age badly, since a row valid when written must not become
  -- invalid because time passed. Never validated as a real NIF, same as
  -- membership.tax_number.

fee_period                      -- POOLSE-42; a facility's periodicities
  id, organization_id, facility_id, name, months smallint, discount_percent numeric(5,2),
  is_default, sort_order, archived_at
  unique (organization_id, facility_id, months)      where archived_at is null
  unique (organization_id, facility_id, lower(name)) where archived_at is null
  unique (organization_id, facility_id)              where archived_at is null and is_default
  -- One list, shared by mensalidades and quotas alike. A quota is not inherently
  -- annual and a mensalidade is not inherently monthly; a plan may name its own
  -- default within this one list, which is what lets them differ without a
  -- second table or a rule in code.

fee_plan                        -- POOLSE-42; a facility's price list
  id, organization_id, facility_id, kind fee_plan_kind, level_id, lessons_per_week,
  amount_cents integer, default_fee_period_id (nullable), age_band fee_age_band,
  archived_at
  unique (organization_id, facility_id, level_id, lessons_per_week)
    where archived_at is null and kind = 'mensalidade'
  unique (organization_id, facility_id, age_band)
    where archived_at is null and kind = 'quota'
  check: a mensalidade has a level AND a frequency; a quota has neither
  check: only a quota may be banded
  -- age_band is 'any' | 'under_18' | 'adult'. A club with one membership rate
  -- writes one 'any' row; one that charges children less adds a banded row, and
  -- a banded row BEATS 'any' for the members it names — so nothing existing has
  -- to be edited or migrated. Which band a member is in is read from their age
  -- TODAY (quota_band_for), re-read every period. A line already agreed keeps
  -- its price: a birthday flags the record, it does not re-bill anybody.
  -- There is no name and no VAT rate. A price is identified by what it is for —
  -- the ladder already names the level — and prices are IVA-included, so a rate
  -- column would be a second number nobody maintains.
  foreign key (organization_id, facility_id, default_fee_period_id)
    -> fee_period (organization_id, facility_id, id)
  -- Three columns on that key, so a plan cannot default to another site's
  -- periodicity. level_id *suggests* the plan and never restricts it: price
  -- varies by frequency as much as by level, and "2x/semana" is not a level.
  -- vat_rate null is isento (art. 9.º CIVA); stored and shown, nothing computes.

student_fee                     -- POOLSE-42; what one student pays
  id, organization_id, student_id, fee_plan_id, enrollment_id (nullable), fee_period_id,
  amount_cents, discount_percent, manual_discount_percent, manual_discount_cents,
  discount_reason, starts_on, ends_on, archived_at
  foreign key (organization_id, student_id, enrollment_id)
    -> enrollment (organization_id, student_id, id)
  check: at most one manual discount, and a reason whenever there is one
  -- amount_cents and discount_percent are a SNAPSHOT of the plan and the period
  -- at the moment the fee was agreed. Editing the price list never rewrites an
  -- existing agreement — that is a bill changing retroactively. The line shows a
  -- marker when it differs and is updated one at a time, by a person.
  -- A trigger ends live lines when their enrolment ends; a constraint trigger
  -- refuses an enrolment on a quota line.

student_fee_payment             -- POOLSE-42; one settled occurrence
  id, organization_id, student_fee_id, period_start date, paid_on date, recorded_by
  unique (student_fee_id, period_start)
  -- Absence means unpaid. Nothing writes rows in advance, so nothing has to
  -- generate them or tidy them up when a line ends. `period_start` is an
  -- OCCURRENCE, not a calendar month: a trimestral line has four a year.

facility gains payment_due_day smallint (1-31), and a penalty per kind of charge:
  late_penalty_kind fee_penalty_kind, late_penalty_cents, late_penalty_percent
  quota_penalty_kind fee_penalty_kind, quota_penalty_cents, quota_penalty_percent
  -- 29-31 mean the last day of a short month, clamped by fee_due_on. A penalty
  -- is shown and added to what is outstanding; nothing writes it as a charge.
  -- fee_penalty_kind is 'none' | 'amount' | 'percent', and 'none' is the default
  -- because most clubs charge nothing. A mensalidade and a quota are asked
  -- SEPARATELY, with their own amounts: a club that fines a late monthly payment
  -- often forgives a late subscription. A percentage is always of the student's
  -- MONTHLY MENSALIDADE — the figure a family recognises — so a member who pays
  -- only a quota has a base of zero and a percentage penalty of nothing.

quota_band_for(birth_date) -> fee_age_band                STABLE (reads current_date)
  -- Adult when no birth date is recorded: the ordinary rate, never the cheaper
  -- one, because guessing in the member's favour is what has to be explained.
fee_penalty_cents(kind, cents, percent, monthly_base) -> integer   IMMUTABLE
fee_due_on(period_start, due_day) -> date                 IMMUTABLE
current_period_start(starts_on, ends_on, months) -> date  STABLE (reads current_date)
fee_total_cents(amount_cents, months, discount_percent) -> integer
fee_payable_cents(..., manual_discount_percent, manual_discount_cents) -> integer
  -- The single definition of a total, IMMUTABLE, rounded ONCE at the period.
  -- 35,00 x 3 at 5% is 99,75 — rounding each month and summing gives a different
  -- figure and an argument with a parent. The API calls these; it does not
  -- reimplement them.

student_sensitive               -- separated deliberately; see "minors and consent"
  student_id (pk), organization_id, medical_notes_encrypted,
  recorded_by_membership_id, recorded_at

consent
  id, organization_id, student_id, kind ('photo'|'medical_data'|'parent_sharing'),
  granted boolean, granted_by_membership_id, granted_at, evidence_note, withdrawn_at

guardian_link                   -- the relation between two people
  id, organization_id, student_id, guardian_membership_id, relationship,
  is_primary boolean default false, can_view_progress boolean default false,
  archived_at
  unique (student_id, guardian_membership_id) where archived_at is null
  unique (student_id) where archived_at is null and is_primary

student_level                   -- lookup; operators define their own progression
  id, organization_id, name, sort_order, min_age_months, max_age_months,
  admits_male boolean, admits_female boolean, archived_at
  check (admits_male OR admits_female)
  unique (organization_id, lower(strip_accents(name)), admits_male, admits_female)
    where archived_at is null
  unique (organization_id, coalesce(min_age_months,-1), coalesce(max_age_months,-1))
    where archived_at is null and admits_male  and a range is declared
  unique (organization_id, coalesce(min_age_months,-1), coalesce(max_age_months,-1))
    where archived_at is null and admits_female and a range is declared
  -- Both flags true is misto, the default and most clubs. Two flags rather than
  -- an enum because "both" is a real answer and the commonest one. This is also
  -- what lets two escalões share a NAME: "Cadetes femininos dos 8 aos 11" and
  -- "Cadetes masculinos dos 8 aos 12" are two rows a club reads as one word.
  -- The range rule refuses DUPLICATES, not overlaps: a ladder genuinely has
  -- programmes running alongside it (natação adaptada from ten upwards, masters
  -- from twenty-five), and refusing every overlap would refuse a real timetable.
  -- The interface warns about overlaps instead. `coalesce` because a unique
  -- index treats NULLs as distinct, and two escalões both written "dos 25 anos"
  -- would otherwise slip through.

skill                           -- what a level consists of; see "skills"
  id, organization_id, level_id, name, sort_order,
  min_days, min_lessons, video_url, archived_at
  unique (organization_id, level_id, lower(name)) where archived_at is null

skill_progress                  -- where one student stands on one skill
  id, organization_id, student_id, skill_id,
  state ('not_started'|'started'|'tested'|'attained'),
  started_on, attained_at, recorded_by_membership_id, recorded_at,
  override_by_membership_id, override_reason
  unique (student_id, skill_id)

season                          -- the year the club runs; see "seasons"
  id, organization_id, name, starts_on, ends_on, archived_at,
  status season_status ('draft'|'published'|'archived')     -- POOLSE-45
  unique (organization_id) where status = 'published'
  check (archived_at is null or status <> 'published')

facility_time_slot              -- the rows a schedule is written on; POOLSE-44
  id, organization_id, facility_id, season_id,
  day_group ('weekday'|'saturday'|'sunday'),
  start_time time, end_time time, archived_at
  foreign key (organization_id, facility_id) references facility (organization_id, id)
  foreign key (organization_id, season_id)   references season (organization_id, id)
  check (end_time > start_time)
  exclude using gist (organization_id =, facility_id =, season_id =, day_group =,
                      int4range(minutes(start_time), minutes(end_time)) &&)
      where (archived_at is null)

class_group                     -- a turma
  id, organization_id, season_id, pool_id, name, level_id,
  instructor_membership_id, capacity, lane_id, starts_on, ends_on, archived_at

class_schedule                  -- a booking: the recurring weekly pattern
  id, organization_id, facility_id, class_group_id (nullable), weekday smallint,
  start_time time, duration_minutes int, archived_at,
  subject_type ('turma'|'parceria'|'evento'|'manutencao'),               -- POOLSE-46
  partner_group_id (nullable, FK arrives with POOLSE-47), slot_id (nullable),
  instructor_membership_id, instructor_status ('assigned'|'to_define'|
                                               'external'|'uncovered'),
  headcount_override, category_id, title, notes
  unique (organization_id, id)
  check (subject_type names exactly the one subject column it should)
  unique (organization_id, coalesce(class_group_id, partner_group_id),
          weekday, start_time) where archived_at is null
  -- instructor_status is a state machine kept by trigger, not a derived value
  -- POOLSE-53. Default 'to_define'. On every insert and update:
  --   an instructor resolves (the booking's override, else the turma's) -> 'assigned'
  --   partner_group.brings_own_instructor                               -> 'external'
  --   was 'assigned'/'external' and neither now holds                   -> 'to_define'
  --   'to_define' and 'uncovered' are otherwise left exactly as set
  -- The system never converts 'to_define' and 'uncovered' into one another:
  -- they are the same missing instructor and opposite claims about the club,
  -- and deriving either from a null column erases the distinction. Only a
  -- person sets 'uncovered' (POST /bookings/:id/instructor-status, owner/admin).
  -- Changing class_group.instructor_membership_id or
  -- partner_group.brings_own_instructor re-runs the rule over the bookings
  -- affected, so the state cannot be reached from one path and missed by another.

booking_lane                    -- the lanes a booking occupies; POOLSE-46
  organization_id, schedule_id, lane_id
  primary key (schedule_id, lane_id)

class_session_lane              -- the lanes one occurrence occupies
  organization_id, session_id, lane_id, starts_at, ends_at, cancelled
  primary key (session_id, lane_id)
  exclude using gist (lane_id =, tstzrange(starts_at, ends_at) &&)
      where (not cancelled)

closure                         -- holidays, maintenance shutdowns, August
  id, organization_id, facility_id, pool_id (nullable), starts_on, ends_on,
  reason, blocks_generation boolean default true,
  source ('national_holiday'|'municipal_holiday'|'manual'), repeats_annually
  exclude using gist (organization_id with =,
                      coalesce(pool_id, uuid_nil) with =,
                      daterange(starts_on, ends_on, '[]') with &&)
      where (archived_at is null and source = 'manual' and not repeats_annually)

class_session                   -- a materialised occurrence
  id, organization_id, class_group_id, starts_at timestamptz,
  duration_minutes int, status ('scheduled'|'cancelled'|'completed'),
  substitute_instructor_membership_id (nullable), cancellation_reason,
  closure_id (nullable)
  unique (class_group_id, starts_at)
  schedule_id (nullable) — which booking produced it; POOLSE-46
  occurs_on date — the day the pattern implied; moved_at — set by a one-week move
  unique (schedule_id, occurs_on) where schedule_id is not null

enrollment
  id, organization_id, class_group_id, student_id,
  status ('active'|'waiting'|'ended'), waiting_position int, joined_on, ended_on
  unique (class_group_id, student_id) where status <> 'ended'

attendance
  id, organization_id, class_session_id, student_id,
  status ('present'|'absent'|'excused'|'late'), recorded_by_membership_id, recorded_at
  unique (class_session_id, student_id)
```

### Duplicates and merging

The dedup key is **NIF, else email**. Two records sharing an email but holding
different NIFs are *not* the same person — a household address is not an
identity — so the email arm only answers for records with no NIF to contradict
it.

**A guardian must carry one of the two; a student need not.** Most seven-year-olds
have neither, and requiring one would block ordinary enrolment. A guardian is an
adult who has one, and guardians are where duplicates actually come from.
Enforced by `guardian_needs_a_key`, a deferred constraint trigger rather than a
CHECK: the key is on `membership`, the role is on `membership_role`, so the rule
spans two tables and has to be checked from both directions. Deferred because
creating a guardian is two statements and they arrive in either order.

Merging is **phased**, because it is the one operation here that rewrites live
tenant data:

1. `merge_candidates(organization)` is read-only and reports every pair it would
   join, with every field the two disagree about and both values. Nothing is
   merged without that being read — no discarded contact detail vanishes
   unreported.
2. `merge_memberships(organization, keep, absorb)` performs one pair. It
   **discovers the foreign keys to repoint from `pg_constraint`** rather than
   from a list: twenty-one columns reference a membership today, and a hardcoded
   list would repoint everything except the next table somebody adds, which is
   the worst of the three outcomes. `membership_role` and `guardian_link` are
   handled first and by hand, because repointing a role the survivor already
   holds would violate its unique index instead of merging anything.
3. The indexes that prevent new duplicates already exist.

Field rules: non-null wins over null; on a genuine conflict the more recently
updated record wins. The oldest record survives, ordered by `(created_at, id)` so
two rows made in the same millisecond still order the same way twice.

Nothing is deleted. The absorbed row is archived with `merged_into` pointing at
the survivor, which is what makes an incorrect merge recoverable and keeps old
audit rows resolvable to a human. Running a merge again is a no-op.

### One person, many roles

A senior student can also be the *encarregado de educação* of a grandchild. Modelled as
two records that would be two phone numbers to keep in sync, two addresses to update, and
a People list showing the same human twice.

**`membership` is the person.** Not a separate `person` table, and not `app_user`.

`app_user` is Clerk's: global, no `organization_id`, no row-level security, and every row
in it is somebody who authenticated. Filling it with operator-typed guardians would put
tenant-authored data in the one table the isolation rules do not cover — exactly what
decision 2 exists to prevent.

`membership` already was most of what was needed: tenant-scoped with a policy, one row per
human per organization, `app_user_id` nullable so somebody can exist before or without ever
having a login, and `membership_role` attached so one person holds several roles at once.
What it lacked was a name.

**Who owns which field.** Where `app_user_id` is set, Clerk owns the name and the email and
`app_user`'s cache holds them — a check constraint refuses a membership that tries to hold
its own, so the two can never disagree. The columns on `membership` are the club's record
of somebody with no login. `person_name(membership_id)` and `person_email(membership_id)`
resolve the two, so no query has to remember the rule.

**Guardianship is a relation between two people**, and the relationship type lives on the
link: the same woman is *avó* to one child and *tutora legal* to another. One primary
contact per student, enforced by a partial unique index — "who do we ring first" has one
answer.

**`student.membership_id` is nullable and stays nullable.** Most children in a swimming
school are a register entry and nothing else; requiring a membership for each would create
thousands of role-less people to no purpose. The column exists for the case the ticket is
about: the adult student who is also somebody's encarregado.

**Recognising somebody already known.** Partial unique indexes on `(organization_id,
tax_number)` and `(organization_id, email)` are what make "this person already exists, add
the role instead" both cheap to check and safe under two operators doing it at once. NIF is
matched before email: two people can share a household address, and only one can have a
given tax number.

### How a name is written, shortened and filed

Three questions, decided independently, and conflating any two of them is the bug —
POOLSE-32. All three are answered by functions in the database, and by nothing else.

| | Function | Answer |
|---|---|---|
| Display order | `display_name(given, surnames)` | First name first, every part. `Maria Joana Ferreira Silva Santos` |
| Abbreviation | `short_name(given, surnames)` | First given name + **last** surname. `Maria Santos` |
| Sort order | `name_sort_key(given, surnames)` | **First** surname, particles stripped. Files under `Ferreira` |

`person_name`, `person_short_name` and `person_sort_key` are the same three for a
`membership`, resolving Clerk's cache the way decision 3 requires.

**Why in SQL rather than in the API.** The sort key has to be indexable, because lists
paginate server-side and a sort in JavaScript would only order the rows already on the
page. Once one form lives in the database, a second implementation of the other two is a
guarantee that somebody fixes a particle bug in one copy only. So every query selects the
composed form; nothing is composed in TypeScript, and nothing is stored — correcting a name
corrects every form of it in the same write.

**Display and filing use different surnames on purpose.** The short form keeps the last
surname because that is what identifies somebody at a glance; filing uses the first because
that is where a person looks. Particles follow the same split: `Maria da Silva` *displays*
with the "da" and *files* under Silva, because filing under D would bury every da/de/dos
name in one block at the top of every list.

**A surname is not "the tokens after the first space".** `surname_units()` splits it into
units, because a particle attaches forward (`da Silva` is one unit) and `e` joins in both
directions (`de Sousa e Melo` is one surname, not two). Assuming the last whitespace token
is the surname abbreviates `Maria da Silva` to `Maria da`, which is not a name and which
fails silently on a printed roster.

**Ordering uses the `pt_pt` ICU collation, not `strip_accents`.** Folding accents away
files `Álvares` as `alvares`, which is right, but makes it indistinguishable from `Alvares`
and leaves their order to insertion chance. ICU treats the accent as a tiebreak: the two
file together and both come well before `Zé`. `strip_accents` stays where it belongs — in
*search*, which must match any part of the name, including the surnames the abbreviation
drops.

### Aulas de reposição are credits, minted by a trigger

A reposição owed to a family used to be a note somebody remembered, so it was
either forgotten or honoured twice. `reposicao_credit` makes it a row — POOLSE-21.

**Only `attendance.status = 'excused'` mints.** A plain `absent` mints nothing, and
an occurrence cancelled by a closure is not an absence at all, so nothing fires
(POOLSE-31 decided that a closure cancels the class and mints nothing).

**Minting is a trigger on `attendance`, not application code.** The requirement is
that a mark and its credit cannot diverge, and a repository method delivers that
only for the write paths that remember to call it — the register screen, an
importer, a correction endpoint and a future mobile app are four chances to
forget. `attendance_reposicao` also revokes: correcting a mark back to *faltou*
archives an unspent credit and **refuses** when it has already been spent, because
an office correcting a typo must not silently retract a class a family already
attended.

**The rule is snapshotted onto the credit.** `source_window_days` and
`source_capped_at_season_end` are copied at mint time and never re-read from
settings. A club shortening its window in March must not shorten a credit issued
in February — a family told "you have until 11 May" has been told something.

**Expiry is a window from the absence, capped at the end of the época**, and it is
a *date in the club's calendar*, never an instant. `expire_reposicao_credits(org,
date)` takes the day rather than reading a clock: `now()` in UTC would kill a
credit an hour early for half the year in Lisbon. It is idempotent, so a second
run finds nothing and notifies nobody.

`class_group.reposicao_enabled` is nullable and **null means inherit, not off** —
a two-state column could not tell "this turma is an exception" apart from "nobody
has said".

### Seasons

A swimming school's year runs September to August: it starts when school does and
stops for the August holidays. The turmas of one year are not the turmas of the
next, and before `season` existed there was no way to say so — every turma ever
created sat in one list, so a club's second September showed it beside the first
September's classes with nothing to tell them apart.

**`season_id` is on `class_group` and nowhere else.** `class_session` and
`enrollment` hang off a turma, so a turma belonging to a season takes them with
it. Putting `season_id` on all three would be three chances for them to disagree
about which season a class is in, and no way to settle it.

That is also what makes the reset cheap. Archiving a season and opening the next
is two rows: nothing is deleted, nothing cascades. The old turmas keep pointing
at the old season with every session, enrolment and register intact, and simply
stop appearing in the lists that filter on the current one. The new season is
empty because no turma points at it yet — not because anything was emptied.

**One current season per organization**, enforced by a partial unique index
rather than by the code that resets. That is what forces the reset's ordering —
archive, then insert, inside one transaction — and what stops a half-finished one
leaving a club with two current seasons.

Students, levels, pools and staff are not seasonal. They belong to the club
rather than to a year of it, and a reset does not touch them.

`generate_sessions` joins `season` and bounds its window by it, so a retired
season's turmas can never gain new occurrences. Without that join the next press
of "Gerar a época" would refill last year and undo the reset.

`provision_organization` opens the first season, for the same reason it creates
the first facility and a stronger one: `class_group.season_id` is NOT NULL, so
without it the very first turma of every new customer would fail.

### Why sessions are materialised

`class_session` rows are generated ahead — **a full year**, not the 90-day window this
document originally specified. The operator asked for a calendar that works by seasons, and
a season is a year: a 90-day horizon cannot answer "when does the autumn term end" in June.
The cost is arithmetic — a turma twice a week is about 104 rows a year, so twenty turmas is
two thousand — and that is nothing.

They are generated rather than computed on
the fly from `class_schedule`. Attendance, cancellations and substitutions all need
something to attach to, and a computed-on-read schedule makes "the 14th was cancelled"
impossible to express.

The generator is idempotent and safe to re-run. It skips dates covered by a `closure`,
which is what stops August and every bank holiday from being cancelled by hand one session
at a time — and, because the window rolls forward, from being re-cancelled every time it
extends. Changing a schedule regenerates only future unmodified sessions and never touches
one with attendance recorded against it.

### A booking is not only a turma — POOLSE-46

**`class_schedule` was extended, not replaced.** It is already the weekly pattern, and
`class_session`, attendance, reposições, closures and the fees engine all hang off it. A new
`booking` table would have meant rewriting every one of those before anything new became
visible.

**A booking carries its own `facility_id`.** It used to reach its site through its turma,
which stops working the moment a booking has no turma — and the opening-hours trigger reads
that site, so every parceria and evento would have sailed past the check rather than being
tested by it. `class_schedule_default_site` fills it in from the turma when it is omitted, so
a NOT NULL column did not become forty edited call sites and one that gets it wrong.

**Trigger names are load-bearing here.** Postgres fires BEFORE triggers in alphabetical
order, so the site default has to sort ahead of `class_schedule_hours`. Named
`class_schedule_site` it sorted *after*, the hours check saw a null facility, found no hours
for it, and waved through a class on a day the site is shut. `d < h` is why it is
`class_schedule_default_site`.

**The subject invariant is a CHECK.** Without it a parceria row carrying a stale
`class_group_id` would be counted twice by occupancy and once by the register, and nothing
would object. `class_schedule_slot_uq` had to be rebuilt on `coalesce(class_group_id,
partner_group_id)` for the same reason: a unique index over a nullable column stops
constraining anything the moment the column is null.

**`partner_group_id` has no foreign key yet**, and that is a gap with a date on it —
POOLSE-47 adds `partner_group` and the composite key. Nothing can write a non-null value
before then, because the CHECK requires `subject_type = 'parceria'` and no writer sets it.

### Where the lane guarantee lives now

**`class_session_lane_free` moved off `class_session`.** It is the one thing standing between
two groups and the same lane, and it worked while a session had exactly one lane. A session
across three needs three rows, so the constraint moved to the table that holds them.

**An exclusion constraint cannot reach into another table**, so those rows carry their own
copy of the session's window and its cancelled flag — the same reason `class_session` already
copies `pool_id`. A copy is a thing that can go stale, which is what
`class_session_lane_sync` is for: shorten a class by ten minutes and every lane row follows,
or the lane looks busy when it is free.

**That trigger fires on every update, not on a named column list.** `AFTER UPDATE OF ends_at`
names the columns the *statement* sets, and `ends_at` is written by a BEFORE trigger from
`duration_minutes` — so shortening a class never listed it, the sync never ran, and the lane
rows kept claiming the old window. `bookings.sql` test 4 exists for exactly that, and is what
caught it.

**`class_group.lane_id` is the turma's default, not a second truth.** One lane, chosen on the
turma's own form, the way `capacity` is. `booking_lane` is where a booking actually sits.
`syncBookingLanes` pushes the default down onto the turma's bookings, and is the one place
that will have to learn otherwise when the grid can place a booking on lanes of its own.

**The generator walks bookings, not turmas.** It joined the pattern to `class_group`, which
cannot reach a booking that has no turma. It now walks `class_schedule` and looks the turma up
only for what a turma supplies — the pool, the instructor, and the dates a class runs between
— and writes the lane rows from `booking_lane`. Sessions dedupe on `(schedule_id, starts_at)`,
partial, because the old `(class_group_id, starts_at)` key stops constraining anything once
that column is null.

### The grid, and drafts — POOLSE-44 and 45

**A slot grid is a property of the building, not a lattice.** The reference club runs 06:30,
08:45, 09:30 … with a hole at lunchtime and a different set at the weekend. The calendar used
to draw a uniform 15-minute lattice, which is fine for reading one week and useless for
planning a season: it offers 96 rows where the club has fourteen.

**Gaps are the absence of a row**, not a row of type "closed". Nothing needs to know why the
pool is quiet between 12:30 and 14:45.

**Abutting is not overlapping**, and `int4range` is what makes that free. Postgres has no
range type over `time`, so the exclusion works in minutes from midnight — the same arithmetic
`class_schedule_within_facility_hours()` already uses, and for the same reason: `time '23:30'
+ interval '60 minutes'` wraps to `00:30` and compares as earlier than every closing time.
`int4range` is half-open, so 09:30–10:15 and 10:15–11:00 sit side by side.

**`24:00` is a real end time and `00:00` is not.** Midnight-at-the-end arithmetics to 1440;
midnight-at-the-start arithmetics to 0, which makes an empty range that overlaps nothing —
a slot that would conflict with nothing and sit under everything. The CHECK refuses it
structurally, and the API refuses it first so the operator reads "write 24:00" rather than a
constraint name.

**A season is `draft`, `published` or `archived`.** One published at a time, enforced by a
partial unique index where `season_one_active` used to be — drafts are unarchived too, so the
old index would have refused the second one, which is precisely the feature. Slots and
bookings hang off a season, so a club can plan next year without touching the one it is
running, and `generate_sessions` refuses a season that is not published: without that guard, a
turma parked in next year's plan would put two hundred phantom sessions on today's calendar.

**`status` is the state and `archived_at` is when.** They are not redundant, and one
combination means nothing — retired while still published — so a CHECK refuses it. Before this
ticket, archiving *was* setting `archived_at`, and any writer still doing only that would leave
a season looking current to the index and retired to a reader. Three places in the product had
to learn the difference: the reset, its preview, and where a new turma finds its season.

**Publishing is `publish_season`, in the database.** The incumbent must be archived before the
draft takes the slot or the partial index refuses the second update, and that ordering is the
correctness — it should not be re-derived by the next caller. Plain `SECURITY INVOKER`: the
caller is already tenant-scoped and RLS applies, which is exactly what should happen.

### A lane is a row — POOLSE-43

**A pool without lanes still has exactly one lane row**, named after the pool. The
alternative — a nullable `lane_id` meaning "the whole pool" — puts a null branch in every
join, every conflict check and every grid cell, and the branch is the bug. The invariant is
held by `pool_create_default_lanes`, an `AFTER INSERT` trigger, rather than by whichever
writer remembers it: a pool created by a seed, a test, or an endpoint written next year must
not be able to exist with no lanes.

**`pool.lane_count` is gone.** It was a second answer to "how many lanes has this pool", and
two answers drift — the count says six while five rows exist, and nothing can say which is
right. The rows are the count. The API still exposes `laneCount`, because a form asks for a
number and that is how somebody describes a tank; `setLaneCount` in the facilities repository
is the translation between the two.

Raising it appends lanes and renumbers nothing — a class is on Pista 3, and Pista 3 has to
stay Pista 3. Lowering it archives from the top down and is **refused** while a turma sits on
one of the lanes being removed, naming both the lanes and the turmas so the operator knows
what to move. The refusal shares the transaction with the rest of the pool edit, so a rejected
lane change cannot leave a renamed pool behind.

**The lane exclusion moved from `(pool_id, lane)` to `lane_id`.** A lane belongs to exactly
one pool, so equality on the reference already implies the pool. `btree_gist` supplies uuid
equality inside a GiST index — worth writing down, because recreating that constraint is where
a typo produces one that matches nothing, and it fails open. `packages/db/test/lanes.sql`
test 5 is what would catch it.

The exclusion constraint is what stops two turmas being booked into lane 3 at 18:00. This
is a week-one operator complaint if the database does not prevent it.

### Closures cover a range, and bite immediately

Two closures over the same days is not a richer truth — it is a question nobody
can answer, because a cancelled class carries one reason. `closure_no_overlap`
refuses it in the database rather than in the controller, because two operators
creating "Natal" at the same moment would both pass an application check and both
insert. Annually-repeating closures are excluded from it: their range is a
pattern rather than dates, `daterange` cannot express "every year", and the
honest options were to leave them out or to pretend.

`apply_closure(organization, closure)` performs the cancellation
`generate_sessions` performs, for one closure and without generating anything.
Without it a closure created today leaves this afternoon's class standing until
somebody presses "Gerar a época", and an operator who has just said the pool is
shut is entitled to see it shut.

`closure_impact(organization, from, to, pool)` answers what a range would take
down *before* it is saved. The number that matters is `marked`: cancelling a
class nobody registered is routine, cancelling one whose register was already
taken means somebody stood at the poolside and wrote it down.

**A closure cancels with no charge and no reposição credit.** The pool was
closed; nobody was absent. Compensating a long closure should be an explicit
decision, never a side effect of one.

`closure_id` on a cancelled session is what tells "the pool was shut" apart from
a class somebody removed by hand (POOLSE-14), and it is what lets removing a
closure give the classes back — `generate_sessions` only revives what a closure
put down.

### Which day a session is on

Every one of the generator's three passes — create, cancel, restore — has to answer the
same question the same way: which calendar day is this session on? The answer is always the
**facility's** day, via `session_local_date`, never UTC's.

They are the same day almost always, which is what made getting it wrong easy. They are not
the same day for a class at 23:30 in the Azores in winter: the islands run at UTC−1, so that
Tuesday class is 00:30 UTC on the Wednesday. A cancel pass asking UTC would step over a
closure on the Tuesday and cancel a class on a Wednesday nobody closed — silently, with
nothing on screen to suggest anything had gone wrong.

The function exists so there is one call site to get right rather than three, which is
exactly how the passes came apart the first time. `packages/db/test/sessions.sql` test 10
pins it, and asserts up front that the two dates genuinely differ so the test cannot pass
by coincidence.

### Moving one week without moving every week

A drag on the calendar edits the weekly pattern, so it changes the class for the rest of
the season. That is what somebody means about half the time. The other half is "the pool
is booked this Tuesday, put *this week's* class on Wednesday", and two columns on
`class_session` are what make the difference expressible.

**`occurs_on`** is the calendar day the *pattern* implied, stamped when the session was
generated and never changed by a one-week move. It is what the generator dedupes on, and
that is the whole reason it exists: dedupe on `starts_at` and the moment a session moves,
its instant no longer matches what the pattern would produce, so the next regeneration
produces it again — the class twice in one week, one of them on a day it is not happening.
A trigger fills it in from `starts_at` when a caller does not pass it, so the generator is
not the only thing allowed to insert a session.

**`moved_at`** records that a human moved that one occurrence. A pattern move realigns the
weeks that have not happened yet and **skips these**, because somebody has already said
what should happen that week and a later "every week" must not silently undo it.

"Every week" means *this week forward*. Weeks already taught keep the time they were
actually taught at — a register is a record of what happened, and moving it would make the
record wrong. When the pattern's weekday moves, `occurs_on` moves with it for exactly the
sessions being realigned; leaving it behind would recreate the bug it was added to prevent.

`apps/api/src/classes/move-scope.integration.test.ts` pins all four halves.

### National holidays are rows, not rules

The thirteen Portuguese national holidays are computed in TypeScript (`apps/api/src/classes/
holidays.ts`, Easter by the anonymous Gregorian computus) and **seeded as ordinary closures**
when a season is generated. Four of them move with Easter, which is why they cannot be
`repeats_annually` rows matching on month and day.

Seeding them as visible, deletable rows rather than applying them as an invisible rule is
the whole design. The operator asked for holidays to close the pool automatically — but
plenty of municipal pools open on the 5th of October, and when a class vanishes from the
calendar someone has to be able to find what removed it and delete that. A rule buried in
the generator cannot be found or deleted.

Carnaval is deliberately absent: it is a *tolerância de ponto* granted year by year, not a
national holiday, and deciding it for an operator would be inventing policy.

**Municipal holidays join the same table**, as `source = 'municipal_holiday'`. They were
absent because Poolse did not know which town a pool was in; `facility.city` and its
coordinates now answer that. A `public_holiday` table was proposed and rejected: it would
hold the same dates a second time, seeded by a second path, and the two would drift.

The distinction that has to survive is `source`. A closure for *obras* is not a public
holiday and must not hand every member of staff a free day — so everything reading holidays
filters on `source IN ('national_holiday', 'municipal_holiday')`, never on "is there a
closure". `packages/db/test/vacations.sql` test 8 is what keeps that true.

### Attendance

```
attendance
  id, organization_id, class_session_id, student_id,
  status ('present'|'absent'|'excused'|'late'),
  note, recorded_by_membership_id, recorded_at
  unique (organization_id, class_session_id, student_id)
```

**Absent is a recorded fact, not a missing row.** "Nobody has marked this class"
and "João did not come" are different answers to different questions — the first
is work outstanding, the second is a conversation with a parent. A session with no
rows is a session nobody has marked.

**It attaches to the session, not to the enrollment.** A student can attend a
class they are not enrolled in: a trial, a make-up for one they missed, a sibling
brought along. An operator who cannot record what happened will record nothing,
so enrollment supplies the list to mark and does not gate what may be marked.

**`recorded_by_membership_id` is NOT NULL.** Attendance is a claim about a child
made by a person, and it is the evidence when a parent says their daughter was
there. A row nobody signed is worth much less than no row at all.

**This is the one table with no `archived_at`.** Attendance is not withdrawn, it
is corrected — a second row saying something different would make "was Ana here?"
unanswerable, so the unique index is total rather than partial and a change is an
UPDATE.

**A marked class cannot be cancelled**, enforced by a trigger on `class_session`
rather than in a repository method. There are two ways a session gets cancelled —
a person on the calendar, and `generate_sessions` when a closure covers the day —
and the generator is the dangerous one: adding an August closure after a term has
been taught would otherwise silently cancel classes people attended. Only the
transition *into* cancelled is refused, so removing a closure can still restore a
class. `packages/db/test/attendance.sql` test 4 covers both paths.

`class_session` gained `UNIQUE (organization_id, id)` in the same migration. It
was the first table to become a parent since it was written, and that key is what
makes a composite foreign key — and therefore cross-tenant safety — possible at
all.

### Nobody is in two places at once

`class_session` carries two exclusion constraints, and the second one needed a
column before it could exist.

```
class_session_lane_free       EXCLUDE USING gist (lane_id =, tstzrange(starts_at, ends_at) &&)
                              WHERE status <> 'cancelled' AND lane_id IS NOT NULL

class_session_instructor_free EXCLUDE USING gist (
                                coalesce(substitute_instructor_membership_id,
                                         instructor_membership_id) =,
                                tstzrange(starts_at, ends_at) &&)
                              WHERE status <> 'cancelled' AND that coalesce IS NOT NULL
```

**Overlap is judged on real duration, not on a grid.** A 45-minute class at 10:00
blocks 10:30. `ends_at` is a stored column maintained by a BEFORE trigger from
`duration_minutes` — a `GENERATED ALWAYS` column is impossible because
`timestamptz + interval` is STABLE rather than IMMUTABLE, and a trigger is
stricter than writing it by hand because it recomputes on UPDATE too.

**`tstzrange` is half-open, so back-to-back is free.** 10:00–10:45 and
10:45–11:30 do not overlap, with no special case. Every query that reports a
clash uses the same half-open comparison, so the message can never name a
collision the database allowed.

**The instructor is denormalised onto the session**, because the turma holds it
and a constraint cannot join. Kept honest by a composite foreign key. Changing a
turma's instructor rewrites its sessions from now forward; a past session keeps
whoever actually taught it, which is the record attendance and payroll will read.

**Generation checks the weekly patterns first.** A year of sessions is written in
one statement, so one double-booked instructor would abort the whole run and
leave the operator holding a constraint name. `findScheduleClashes` asks the
question of `class_schedule` before anything is written, and the answer names the
two turmas.

### Skills

**Four states, not a checkbox.** Assessment poolside is not binary: an instructor
introduces a skill, watches it a few times, tests it, and only then signs it off.
A boolean collapses those into "done or not", losing the two states an instructor
spends the term in.

**Absence means `not_started`.** Six levels × ten skills × three hundred students
is eighteen thousand rows to say nothing has happened yet. A row appears the
first time somebody marks the skill. The enum still names all four, because
putting somebody *back* to Não iniciado is a real correction and should be a
value rather than a delete that loses who did it.

**Skills hang off the class level, and there is only one kind of level.** This is
what makes automatic advancement possible: "finished this level" and "ready for
the next turma" become the same question. Every competitor keeps skill levels and
class levels as separate systems and asks staff to map them by hand.

`started_on` and `attained_at` are stamped by a trigger rather than by the
repository, because every write path — the grid, a single correction, an import —
must produce the same ones. Re-saving an attained skill must not move the date it
was signed off, and moving it back must clear it; a level's completion date
quietly becoming "the day somebody edited a note" is the kind of wrong nobody
notices until a certificate is printed.

`skill_thresholds_met` answers whether *dias mínimos* and *aulas mínimas* are
satisfied. It counts attendance marked `present`, not sessions that existed — a
child absent for six weeks has not had six lessons, and counting sessions would
pass the threshold for exactly the students it exists to protect. A skill with
neither threshold is always ready, so a club that does not work this way never
configures anything.

The override is what makes thresholds safe to have, and it records who used it —
which is what stops it becoming the normal path. Thresholds bite only on the way
to Adquirido: Iniciado and Avaliado are observations about what is happening in
the water, and nothing should slow those down.

### Level age ranges

```
student_level
  + min_age_years smallint, max_age_years smallint
  check max_age_years >= min_age_years when both are present
  check both between 0 and 120

student
  + sex student_sex ('male'|'female'), nullable
  -- Optional on purpose: imports arrive with the column half empty, and "nobody
  -- has recorded it" has to be representable or the first spreadsheet will
  -- invent an answer. Matched against an escalão's admits_male/admits_female for
  -- display and warnings only — nothing refuses an enrolment on it, exactly as
  -- nothing refuses one on the age range.
```

Both bounds optional and independent: "Adultos" has a minimum and no maximum, and
a level with neither behaves exactly as every level did before they existed.

**Nothing in the schema stops a student joining a level they are outside.** That
is the whole design. Real clubs have the four-year-old who swims with the
six-year-olds because that is where their sibling is; a rule that cannot be
overridden gets worked around by typing a fake birth date, and then the data is
worse than if the check had never existed. The interface warns and asks for one
confirmation.

**A missing birth date is never a warning**, because it is the normal case — the
spreadsheets waiting to be imported have a half-empty column, and treating absent
as "does not fit" would flag most of a register.

**Age drifts and nothing moves anybody.** A child correctly enrolled in "3–5 anos"
turns six mid-season and gets a flag on the register. When they move up is the
club's decision.

### Staff leave

```
vacation_request
  id, organization_id, membership_id,
  status ('pending'|'approved'|'rejected'|'withdrawn'),
  requested_at, decided_at, decided_by_membership_id, decision_note, archived_at
  unique (organization_id, id)
  unique (organization_id, id, membership_id)   -- lets vacation_day carry a safe copy
  check pending implies no decision, decided implies decided_at
  check approved/rejected implies decided_by_membership_id
  check rejected implies a non-blank decision_note

vacation_day
  id, organization_id, vacation_request_id, membership_id, day, archived_at
  foreign key (organization_id, vacation_request_id, membership_id)
    references vacation_request (organization_id, id, membership_id)
  unique (organization_id, membership_id, day) where archived_at is null
  check extract(isodow from day) <> 7          -- Sundays are not working days

membership
  + vacation_days_per_year integer not null default 22
```

**Days are rows, not a range.** Staff take odd single days. A start/end pair forces awkward
splitting the first time somebody books the Monday and the Friday of one week, and every
balance calculation then has to reason about ranges with holes in them.

**`vacation_day.membership_id` is denormalised, and the composite foreign key is what keeps
it honest.** It exists so "one person cannot hold one day twice" can be a plain partial
unique index rather than a trigger that joins.

**A refused or withdrawn request archives its days, by trigger.** Without it, being refused
the 3rd of August would block that person from ever asking for the 3rd of August again — and
the manager who refused would have created that trap without knowing. A trigger rather than
two lines in a repository method because there are already three callers, and the one that
forgets is the one that ships. `vacations.sql` test 4 holds it.

**A rejection must carry a reason, in the schema.** "No" without one generates the
conversation anyway. The API checks it too, so the person gets a sentence rather than a
constraint name, but the database is the only place a second caller written later cannot
skip it.

**The balance does not fall until approval**, which is the whole reason approval exists.
Pending days are reported separately and do not reduce `remaining`; showing a balance that
already spends them would have people planning around days they may not get.

**Carry-over to the 30th of April is not modelled.** Portuguese practice allows unused days
to be carried into the following year until then. v1 does not track it and the balance
summary says so on screen — deliberate and visible beats quietly wrong for two months of
every year.

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
  id, organization_id, actor_membership_id, actor_app_user_id,
  action, entity_type, entity_id, data jsonb, created_at
  no updated_at, no archived_at
```

Retention rules per entity are an open question, but the audit trail has to exist from the
start — it is the part that cannot be reconstructed.

**Built with one `data` column rather than `before`/`after`.** Most entries are not edits:
"invitation created with these roles" has no before, and two mostly-null columns is a poor
trade for the one case that does. The convention for a field change is
`data = {"before": {...}, "after": {...}}`, which keeps that case expressible without
imposing its shape on everything else. `created_at` rather than `at`, because every other
table in the schema says `created_at` and one exception is one thing to remember.

**`actor_membership_id` is nullable and `actor_app_user_id` sits beside it.** Null actor is
the honest record of something the system did on nobody's behalf — a Clerk webhook, a
scheduled job — and inventing a membership to satisfy a NOT NULL would be a lie kept
permanently. The `app_user` reference is there because memberships get archived and the
question "who did this" outlives them.

**The application may append and read, never update or delete.** `ALTER DEFAULT
PRIVILEGES` from decision 2 grants all four verbs on every new table, so `audit_log` gives
two back. An audit log the application can rewrite is not an audit log, and "nobody has
written that UPDATE yet" is not a guarantee.

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

### A site's opening hours

```
facility_hours
  organization_id, facility_id, weekday smallint,       -- ISO: Monday 1 … Sunday 7
  available boolean not null default true,
  opens_at time not null default '00:00',
  closes_at time not null default '24:00',
  created_at, updated_at
  primary key (organization_id, facility_id, weekday)
  foreign key (organization_id, facility_id) references facility (organization_id, id)
    on delete cascade
  check (closes_at > opens_at)
```

**Seven rows per site, always.** A trigger on `facility` seeds them at creation and the
migration back-filled every existing site, so every reader of this table is a plain
`SELECT`. The alternative — create rows on first edit and treat "no row" as "open" — puts
the same defaulting rule in the API, the interface and the scheduling check, and the day
one of the three forgets it is the day a disabled Sunday quietly accepts a class.

**The default is open, all day.** Not 08:00–22:00: a default that is a real restriction
invalidates data that already exists, and an operator cannot tell a default from a decision
somebody made. `24:00` is a real `time` in Postgres and is how "to the end of the day" is
written.

**Hours bound both ends of a class, since round 4.** `class_schedule_within_facility_hours()`
fires on insert and on any update of `weekday`, `start_time`, `duration_minutes` or
`class_group_id`, and refuses a class that starts before opening, starts at or after
closing, or *finishes* after closing. The end check works in minutes-from-midnight, because
`time '23:30' + interval '60 minutes'` is `00:30`, which compares as earlier than every
closing time and would pass exactly the row it must refuse.

**Nothing is enforced retroactively.** The trigger never fires when somebody edits the
hours, so narrowing Tuesday tells the operator which classes no longer fit rather than
deleting them.

### What the club owns

```
inventory_scope  enum ('facility','pools','all_pools')

inventory_item
  id, organization_id, facility_id,
  name text not null, quantity integer not null default 0, unit text, notes text,
  scope inventory_scope not null default 'facility',
  created_at, updated_at, archived_at
  unique (organization_id, id)
  unique (organization_id, facility_id, id)
  foreign key (organization_id, facility_id) references facility (organization_id, id)
  unique (organization_id, facility_id, lower(strip_accents(name))) where archived_at is null
  check (quantity >= 0)

inventory_item_pool
  organization_id, facility_id, item_id, pool_id
  primary key (item_id, pool_id)
  foreign key (organization_id, facility_id, item_id)
    references inventory_item (organization_id, facility_id, id) on delete cascade
  foreign key (organization_id, facility_id, pool_id)
    references pool (organization_id, facility_id, id)
```

**A count, not a stock ledger.** One row per kind of thing, corrected in place after a
stock check. Movements, reservations and minimum levels were considered and left out: a
ledger nobody posts to drifts from the shelf within a month, and is then wrong with more
decimal places than the count was. This is also why the inventory has no trend chart —
there is no history to draw.

**The name is free text**, because every club calls this kit something slightly different,
so the partial unique index is the only thing standing between a club and two rows for the
same pile of floats.

**It belongs to a facility, not to a pool** — round 6, replacing `pool_material`. Almost
nothing a club owns belongs to one tank: the pranchas live in a store room and are carried
to whichever pool needs them, the desfibrilhador belongs to the building, and the lane ropes
belong to two competition tanks and not the learner pool. Forcing each into one pool meant
duplicating a row per tank, after which no count meant anything, or picking a pool
arbitrarily and writing the truth into `notes`.

**`all_pools` is a scope, not a snapshot.** A club that buys a third tank next season should
not discover that its "todas as piscinas" items quietly stopped covering it, which is what a
list of pool ids frozen at save time would do.

**The junction routes both keys through `facility_id`**, so an item at one site cannot name
a tank at another. `pool` gained `unique (organization_id, facility_id, id)` for exactly
that: `(organization_id, id)` proves the tenant, not the building. `packages/db/test/inventory.sql`,
test 4.

### Water quality

```
pool_metric  enum ('ph','temperature','free_chlorine','combined_chlorine',
                   'total_alkalinity','calcium_hardness','cyanuric_acid',
                   'turbidity','salt')

pool_analysis
  id, organization_id, pool_id,
  taken_at timestamptz not null,                        -- UTC; shown in the facility's zone
  recorded_by uuid, notes text,
  created_at, updated_at, archived_at
  unique (organization_id, id)
  foreign key (organization_id, pool_id) references pool (organization_id, id)
  foreign key (organization_id, recorded_by) references membership (organization_id, id)
  unique (organization_id, pool_id, taken_at) where archived_at is null

pool_analysis_value
  id, organization_id, analysis_id,
  metric pool_metric not null, value numeric(10,3) not null, unit text not null,
  created_at, updated_at
  unique (organization_id, id)
  foreign key (organization_id, analysis_id) references pool_analysis (organization_id, id)
    on delete cascade
  unique (analysis_id, metric)
  check (value >= 0) and (metric <> 'ph' or value <= 14)
```

**Two tables, because an analysis is a visit.** Somebody dipped a probe or a lab sent a
sheet back: one date, one author, one set of notes, and the measurements hang off it. One
flat row per measurement with the date repeated makes "the analysis" a group-by rather than
a thing, and the report the product exports is per analysis. The notes would also have
nowhere honest to live — "sample taken before backwash" describes the visit, not the pH.

**Not a hypertable, deliberately.** TimescaleDB is in the stack for the energy and sensor
time-series in phases 4 and 5, and a hypertable cannot carry a surrogate `id`. This is
neither: a handful of operator-entered rows per pool per month, edited and archived like any
other record. When automated probes land they get their own `reading` table with a natural
composite key, and this stays the manual record.

**The unit is stored per row, never derived.** pH, °C and ppm do not share a type, and a
row read in five years still has to say what it meant even if the app's idea of the
canonical unit has moved. Every row Poolse writes takes its unit from `METRIC_UNITS` in the
API, so the application never produces two spellings of "ppm".

**`pool_analysis_value` has no `archived_at` on purpose.** A half-archived analysis, three
of whose five measurements are visible, is a worse record than none; the cascade is what
makes that safe.

### A pool's dimensions

```
pool
  + length_m numeric(5,2), width_m numeric(5,2),
    min_depth_m numeric(5,2), max_depth_m numeric(5,2)
  + volume_litres numeric(12,2)                          -- was integer until round 4
  check each dimension is null or > 0
  check (max_depth_m is null or min_depth_m is null or max_depth_m >= min_depth_m)
```

**The volume stays stored and overridable, not generated.** A generated column would never
disagree with the dimensions, and would be wrong: an L-shaped municipal tank, a free-form
hotel pool or anything with a beach entry has a real volume no `length × width × depth` will
produce, and the column would overwrite the builder's figure with a worse one. The form
computes `length × width × (min + max) / 2 × 1000`, shows its working, fills the field in
while it is empty or still holds the previous suggestion, and stops touching it the moment
an operator types their own number.

`numeric`, not integer: the offered figure is very rarely whole, and the old `integer`
column would have truncated it silently.

### Medical leave

```
student_medical_leave
  id, organization_id, student_id,
  starts_on date not null, ends_on date,                 -- null: open-ended
  reason text, justification_reference text, recorded_by uuid,
  created_at, updated_at, archived_at
  unique (organization_id, id)
  foreign key (organization_id, student_id) references student (organization_id, id)
  foreign key (organization_id, recorded_by) references membership (organization_id, id)
  exclude using gist (student_id with =,
                      daterange(starts_on, coalesce(ends_on + 1, 'infinity'), '[)') with &&)
    where (archived_at is null)
  check (ends_on is null or ends_on >= starts_on)
```

**It defaults the register; it never writes attendance.** The tempting shape is a job that
inserts `excused` rows for every future session in the range, and it is wrong twice over:
sessions are generated a month at a time so half the range has nothing to write to, and rows
written by nobody for a class that had not happened are a register somebody must trust
without an instructor having looked at the pool. A live leave makes *falta justificada* the
mark the register offers, flagged and visible, saved by the instructor like any other.

This is also what makes the round-5 decision hold: future sessions only, nothing already
marked ever moves, and removing a leave simply stops the offer — so no reposição credit can
be created or destroyed by editing one.

**Overlaps are refused by the database.** Two live leaves over the same week is a duplicate
somebody made by editing the wrong row, and it gives "why is this student excused" two
answers. `[)` and `ends_on + 1` make a leave ending on the 14th and one starting on the 15th
adjacent rather than overlapping, which is what a club means by "back on the 15th".

**`ends_on` is nullable because nobody knows.** On the day a child breaks a wrist there is
no return date, and a required field would put a guess in the record that everybody then
treats as a fact.

**Neither text column is medical detail.** `reason` is the short line an instructor needs to
understand an empty lane; `justification_reference` says where the atestado is filed —
"atestado 2026/114", "pasta A" — because object storage is deferred and a medical
certificate is not the file to bring it forward for. Diagnoses belong in `student_sensitive`,
behind its cipher and its audit-on-read. The audit log records *whether* a justification
exists, never what it says.

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

### Parcerias — POOLSE-47

A municipal pool sells most of its water in blocks to organisations rather than to families.
The reference club's whole morning is a secondary school booked per class, a Misericórdia
doing hydrotherapy, a nursery and an under-16 handball squad — none of whom has a single
student record, and none of whom Poolse could represent before this.

```
partner
  id, organization_id, facility_id, name, type, nif, address, notes,
  status ('ativa'|'inativa'), color, archived_at
  unique (organization_id, id)                       -- what the children key to
  partial unique (organization_id, facility_id, lower(strip_accents(name)))

partner_contact
  id, organization_id, partner_id, name, role, email, phone, archived_at
  check: email or phone present

partner_agreement
  id, organization_id, partner_id, season_id?, start_date, end_date?,
  billing_model ('por_hora_pista'|'por_bloco'|'por_participante'|'mensal_fixo'),
  unit_price numeric(12,6), vat_rate numeric(5,4)?, payment_period, notes,
  document_key?, archived_at

partner_group
  id, organization_id, partner_id, name, participant_count, level_id?,
  brings_own_instructor, own_instructor_name?, tag?, notes, archived_at
  partial unique (organization_id, partner_id, lower(strip_accents(name)))

partner_group_member
  id, organization_id, partner_group_id, full_name, notes, archived_at
```

**The group is the bookable thing, not the partner.** `class_schedule.partner_group_id`
references `partner_group`, so `6A` goes on the lane grid and `ES D. Dinis` never does. A
school books thirty class-groups across a week, each with its own size, level and instructor
arrangement; booking "the school" would be one cell meaning thirty different things.

**A partner belongs to one facility.** A school using two of the club's pools is two partner
rows — considered and accepted, because the agreement, the price and the contact are all per
building, and one partner spanning sites would turn every one of those into a list.

**`unit_price` is `numeric(12,6)`, not cents, and this is the case the rule exists for.** A
lane-hour at €14.375 stored as 1437 cents is wrong by half a cent an hour — nothing, until it
is multiplied by six lanes by thirty weeks and becomes real money in the figure whose whole
job is to be the number the club invoices. The contracted *total* is money and is rounded to
integer cents once, in SQL, at the end.

**`vat_rate` is null for isento, and `fee_plan` still has no rate column.** That is not an
inconsistency. A family's mensalidade is advertised gross, Art. 9.º CIVA exempts most sports
tuition, and a rate nobody maintains is a rate something eventually trusts — so `fee_plan`
deliberately has none. A partnership is the case that reasoning does not cover: it invoices an
*organisation* against a NIF (`empresa` is one of the eight types), where the exemption often
does not apply, and the rate is a negotiated term on a signed contract, so somebody does
maintain it. Stored as a fraction — 0.2300 is 23%.

**`status` and `archived_at` are two different retirements.** `inativa` means "not currently
selling them water": it hides the partner from the pickers and keeps every booking it ever
had, because a partnership that lapsed in June still explains last season's grid.
`archived_at` means the row was a mistake, and it is refused while any group is still booked.

**`document_key` is modelled and written by nothing.** The signed-contract control is present,
styled and visibly disabled with the reason named, exactly as the logo, the pool photo and the
student photograph are. One storage decision unblocks all four.

`partner_group_member` is the nominal roster — names only, no accounts. Modelled so that
turning it on later is a UI change rather than a migration during a support call, and shipped
with the control disabled because a club may simply not hold the list.

### Reading the lane grid — POOLSE-49

No new tables. The grid is a read over what POOLSE-43 to 47 already built, and it is
documented here because the *shape* of that read is load-bearing for POOLSE-50 to 54.

`GET /facilities/:facilityId/grid?seasonId=` returns, in one request: the facility's slots
(by day group), its pools and lanes, every booking in the season with the lanes it occupies,
and the categories, instructors and partners that fill the filters.

**One request, not five.** The screen cannot paint a single cell until it has slots, lanes,
bookings and lane assignments together. Splitting them would be four round trips before first
paint and four chances to be looking at three-quarters of a week.

**Every list in it is bounded** — a facility's slots, its pools' lanes, one season's bookings
— which is why the grid is exempt from pagination and why the exemption is about the data
rather than about the work. It still *asks* for a fixed window: `seasonId`.

**`laneIds` is an array, and that is the whole point of the ticket.** A booking across lanes
2–4 is one row with three lane ids, drawn as one block spanning three lane rows. Returning
one lane per row would draw Cadetes three times and leave two lanes looking free.

**A booking whose time matches no slot comes back with `slotId: null`**, not filtered out.
The screen renders it under the grid as "fora da grelha", named and timed. This replaces the
old rule where a 06:30 class silently widened the grid — the class stays visible, and the
grid stays the club's own grid rather than one stretched by an exception.

**The instructor is `coalesce(booking.instructor_membership_id, class_group.instructor_membership_id)`.**
The override wins, because a substitute on a Tuesday must read as the substitute rather than
as the person they are covering for.

**The filter lists are built from what is on the grid, not from the catalogue.** A filter
offering an instructor who teaches nothing this season returns an empty grid and reads as a
fault. The legend goes one step further and is built from what is *in view* after filtering.

### Which season a booking belongs to — POOLSE-47

A gap POOLSE-46 left, closed by the same migration.

A turma booking's season is its turma's — `class_group.season_id`, NOT NULL since POOLSE-07. A
parceria booking has no turma, so until this it had no season at all, and "hours a week in the
published season" had nothing to compute against.

```
class_schedule.season_id uuid?     -- null for a turma; required for a parceria
```

> the season of a booking := `coalesce(class_schedule.season_id, class_group.season_id)`

**Null for a turma and required for a parceria**, enforced by a CHECK. That is the one
arrangement that does not create a second answer to a question which already has one: a turma
booking carrying its own season could disagree with its class_group's, and nothing could say
which one occupancy should believe.

**An evento or a manutenção may carry one, or may not.** A maintenance window in the August
gap between two seasons belongs to neither, and demanding a season would make the club attach
a shutdown to a year it does not fall in. A gala inside the year is free to name its own.

Deriving the season from `slot_id` was the alternative and does not work: a booking matching no
slot renders "fora da grelha" with a null slot, and those are exactly the bookings a club
improvises mid-season.

### Writing from the lane grid — POOLSE-50

Again no new tables — the gestures write `class_schedule` and `booking_lane`.

`POST /bookings/:scheduleId/move` and `POST /bookings/:scheduleId/duplicate`, both taking the
same target: `{ weekday, slotId, startTime, laneIds }`.

**One target shape for every gesture.** Move, lane-span, and the keyboard versions of both are
the same write — the client sends where the block ended up. Three endpoints for one outcome
would be three places for the rules to drift, and the web layer mirrors this with a single
`propose()` that the pointer and the keyboard both call.

**A block takes the length of the row it lands in.** `slotId` wins over `startTime`; the slot's
own `end_time - start_time` becomes the booking's duration. That is what makes the grid the
club's grid rather than a backdrop. `startTime` is only accepted when `slotId` is null, which
is the "fora da grelha" case — accepting both would be two answers to "when".

**Lane spans are contiguous, within one pool.** Lanes 2 and 4 with 3 free between them is not
a booking a pool can honour. Checked on `lane.position`, refused with `lanesNotContiguous`,
and refused again at the gesture so the confirm dialog never asks about it.

**Lane collisions are detected by time overlap, not by equal start times.** A 60-minute class
at 09:00 and a 45-minute one at 09:30 share half an hour of the same lane while agreeing on no
column at all. The check uses `OVERLAPS`; an equality test would sell the pool twice. The
refusal names the lane *and* what holds it, because "there is a conflict" sends an operator
hunting across six lanes.

**A duplicate is one transaction, and copies column by column.** The row and its `booking_lane`
rows commit together — a copy existing with no lanes looks, on the grid, exactly like a booking
somebody forgot to place. Columns are listed explicitly rather than `select *`, so a column
added later is a deliberate decision about whether a copy should carry it. **`notes` is
deliberately absent**: a note almost always names a date or a reason, and carrying it onto a
different day restates something no longer true.

A duplicate onto a slot the same turma already occupies hits `class_schedule_slot_uq` and comes
back as `alreadyThere` — in words, never as a constraint name.

### Conflict rules — POOLSE-51

**This ticket loosened a constraint.** `class_session_instructor_free` had no pool term, so one
instructor could not run two groups at the same time *anywhere* — and the reference club's
ordinary Tuesday is Sandra running Cadetes, Infantis and Absolutos at 19:15 on lanes 2, 3 and 4
of one tank. That was correct before POOLSE-43, when a turma had one lane and concurrency
genuinely was a double-booking. Lanes made the old reading wrong.

```
class_session.resolved_instructor_id
    GENERATED ALWAYS AS (coalesce(substitute_instructor_membership_id,
                                  instructor_membership_id)) STORED

class_session_instructor_free
    EXCLUDE USING gist (organization_id =, resolved_instructor_id =,
                        pool_id <>, tstzrange(starts_at, ends_at) &&)
    WHERE status <> 'cancelled' AND resolved_instructor_id IS NOT NULL
                                AND pool_id IS NOT NULL
```

**The spike's answer: `btree_gist` does supply `<>` for uuid.** BUILD-ORDER flagged this as the
riskiest unknown in the feature — whether an exclusion constraint could express "same
instructor, *different* pool". It can, verified against Postgres 16 before anything was designed
around it, so the trigger fallback the ticket allowed for is not needed.

**Generated, not copied.** The ticket suggested copying the resolved instructor at generation
time; a stored generated column cannot drift, because no code path can write a session whose
resolved instructor disagrees with the two columns behind it.

**Two facilities are covered without a facility term**, because two facilities means two pools.

**`organization_id WITH =` is not redundant beside RLS.** An exclusion constraint is enforced
over the whole table by its index with no policy applied, so without it, tenant A booking
somebody could be refused because of a row in tenant B — leaking B's existence and refusing a
booking A is entitled to make. This is also how criterion 11 is made structural: a cross-tenant
instructor conflict is **explicitly not detected**, and that is a decision, not a gap.

```
facility.max_concurrent_groups_per_instructor  integer?   -- null = no opinion
lane_level_capacity (lane_id, level_id) -> capacity       -- overrides lane.default_capacity
```

Both are soft: above them is a warning that names the numbers, never a block. A default of 3
would be the schema inventing a club's staffing policy.

### One rule module, two callers — `@poolse/rules`

Criterion 10 asks that client and server evaluate conflicts through the same pure module. The
ticket said to share it "the way `lib/sheet.ts` is shared" — but `sheet.ts` lives in the web app
and the API cannot import it. There is no sharing mechanism between the two apps except a
workspace package, so `packages/rules` is one.

`evaluate(subject, placement, context)` returns every reason, not the first, each with a
`verdict` of `ok | warn | block` and a `detail` carrying what makes the message actionable — the
lane, the booking in the way, the two numbers. The browser runs it per cell while the pointer is
still moving; the API runs it at the drop. One implementation is the only way they cannot
disagree, and *a client that thinks a drop is fine and a server that refuses it is the worst
version of this feature*.

Two rules inside it are worth naming because they are easy to get backwards:

- **Concurrency counts bookings, not lanes.** An instructor on one three-lane booking is running
  one group. Badging that `×3` would tell a club its best-staffed hour is its worst.
- **Capacity is judged per lane, spreading the headcount across a span.** 24 swimmers on three
  lanes is 8 a lane. Comparing the whole headcount against one lane would warn about every
  multi-lane booking a club ever makes.

### Occupancy — POOLSE-52

No new tables: `GET /facilities/:id/occupancy?seasonId=` is a read over the dated sessions
POOLSE-46 already generates for every subject.

**Lane-hours is the unit, because it is what a club sells.** A booking over three lanes for 45
minutes is 2.25 lane-hours — `duration_minutes / 60.0 * lane_count`, `numeric` and never float,
since it is a quantity that gets multiplied by a price.

**Every figure is computed by Postgres**, and the web app formats without calculating. Two
implementations of "lane-hours" is two answers, and the one on screen would be the one nobody
could reproduce when a manager queried it.

**Headcount resolves override → active enrolments → partner group size → 0**, and the ordering
carries a trap that bit once and is now tested:

> `count(*)` over an empty set is **0, not null**. A bare enrolment subquery therefore matched
> nothing for a parceria (whose `class_group_id` is null), produced 0, and `coalesce` stopped
> there rather than reaching `partner_group.participant_count`. Every partnership reported zero
> swimmers while its lane-hours were perfectly correct — half the numbers right, which is the
> worst shape a reporting bug can take. The fix is a `CASE` that yields null for a non-turma.

**Lanes multiply lane-hours and never multiply headcount.** Thirty swimmers on a three-lane
booking is thirty people and 2.25 lane-hours. `class_session_lane` is joined for the lanes and
deliberately not for the headcount.

**The denominator comes from the same dated calendar as the numerator** — the season's dates
crossed with the day group's slots and the site's lanes, minus closures and weekdays disabled in
`facility_hours`. `slots × lanes × 7` makes every club look under-booked, which is the version
of this number that gets quoted at a manager and then disbelieved.

**Two percentages, and only one needs capacity.**

- *Utilisation* is sold ÷ available lane-hours. A lane-hour is available whether or not anybody
  has said how many swimmers fit in it.
- *Fullness* is swimmers ÷ places, over the booked lanes that **have** a capacity.
  `lane.default_capacity` is nullable by design (POOLSE-43), and treating unknown capacity as
  zero or as infinite would both be inventions. Such lanes contribute lane-hours, are excluded
  from this fraction, and are counted in `lanesWithoutCapacity` so the screen can print the
  asterisk instead of implying there isn't one.

Both are null rather than 0 when there is nothing to divide by: a club with no slot grid has no
occupancy, which is not the same as 0%.

**Time bands are fixed**: `manha` before 12:00, `tarde` to 17:59, `noite` from 18:00, judged on
the session's local start time. Three bands nobody has asked to change, and a setting would be a
screen to build and a value to translate.

**A draft season is refused, and that answers QA 52.12.** Occupancy is computed over dated
sessions and POOLSE-45 made the generator refuse a draft on purpose — a draft is a plan and has
none. Computing it from the weekly pattern would be a second definition of every figure here,
and answering 0% for a fully-planned season would be worse than refusing. The refusal names the
season.

**Contracted partnership value is exposed and rendered nowhere.** Owner/admin only; null for
everybody else, so an instructor can still read occupancy. It is there for the dashboards module,
and POOLSE-47's decision that partnership billing is its own flow stands.

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
2. ~~**Does a student belong to one facility or to the organization?**~~ **Settled:
   organization-wide.** Backlog story 4 proposed narrowing Poolse to one facility per
   tenant, which would have dissolved the question. It was rejected: a municipality with
   pools in two buildings would then need two Poolse organizations, with separate staff
   lists and separate billing, and that is a worse product than a slightly loose model.
   Multi-facility stays. A student therefore belongs to the organization, and a class
   group is what ties them to a pool at a site. Adding `facility_id` to `student` remains
   cheap if a customer ever needs it.

   **How many a tenant may have is a separate, commercial question, and it is now
   answered.** `organization.max_facilities` defaults to 1 and is enforced by the
   `facility_licence` trigger — see `1788022800000_facility-licence.sql`. Archived
   sites do not count, so replacing a pool is free; a second live one is a plan
   change. That is not a retreat from this decision: it is what the decision makes
   possible, because under B4 there would be no second site to sell.
3. **Waiting-list ordering** — `waiting_position` supports manual reordering, defaulting
   to enrollment order. Confirm operators actually want to reorder before building UI for it.
4. **Retention periods** per entity for GDPR, especially `student_sensitive` and
   `audit_log`. The audit trail must exist from day one; how long it is kept can be decided
   later.
