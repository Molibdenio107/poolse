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
  volume_litres, lane_count, archived_at
  unique (organization_id, facility_id, lower(name)) where archived_at is null
  check lane_count > 0, check volume_litres > 0
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
  contact_email, contact_phone, archived_at

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
  id, organization_id, name, sort_order, min_age_months, max_age_months, archived_at

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
  id, organization_id, name, starts_on, ends_on, archived_at
  unique (organization_id) where archived_at is null

class_group                     -- a turma
  id, organization_id, season_id, pool_id, name, level_id,
  instructor_membership_id, capacity, lane, starts_on, ends_on, archived_at

class_schedule                  -- the recurring weekly pattern
  id, organization_id, class_group_id, weekday smallint, start_time time,
  duration_minutes int, archived_at

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
class_session_lane_free       EXCLUDE USING gist (pool_id =, lane =, tstzrange(starts_at, ends_at) &&)
                              WHERE status <> 'cancelled' AND lane IS NOT NULL AND pool_id IS NOT NULL

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
2. ~~**Does a student belong to one facility or to the organization?**~~ **Settled:
   organization-wide.** Backlog story 4 proposed narrowing Poolse to one facility per
   tenant, which would have dissolved the question. It was rejected: a municipality with
   pools in two buildings would then need two Poolse organizations, with separate staff
   lists and separate billing, and that is a worse product than a slightly loose model.
   Multi-facility stays. A student therefore belongs to the organization, and a class
   group is what ties them to a pool at a site. Adding `facility_id` to `student` remains
   cheap if a customer ever needs it.
3. **Waiting-list ordering** — `waiting_position` supports manual reordering, defaulting
   to enrollment order. Confirm operators actually want to reorder before building UI for it.
4. **Retention periods** per entity for GDPR, especially `student_sensitive` and
   `audit_log`. The audit trail must exist from day one; how long it is kept can be decided
   later.
