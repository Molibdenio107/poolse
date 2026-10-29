# Poolse — operating brief

Read this before doing anything in this repo. It is the standing briefing: what is
settled, how we work, and what not to re-decide. Product detail lives in `docs/product.md`,
schema in `docs/data-model.md`, sequencing in `docs/roadmap.md`.

## What Poolse is

A multi-tenant SaaS for managing swimming pools — the businesses that run them (schools,
municipal pools, hotels, condominiums) and, in a smaller way, individuals who own one.

Scope is pool management first, structured for other sports second. A site holds typed
*recintos* (playing areas): a pool is one kind, a tennis or padel court, a pitch or a gym are
others, each sold as a paid add-on module (POOLSE-122 to 128, decided 28 October 2026 —
this reverses the earlier narrowing to pools only, and the reversal is recorded in
`docs/decisions.md`). Two rules come with it: **the pool is untouched for first go-live**, and
sports share one calendar, bookings, fees and energy engine filtered by recinto — never a copy
per sport. Energy costs and the AI dashboards roll up at site level. No non-pool metric or
screen is built until a paying club asks.

## Working context

Built solo, mostly in evenings after a full day of other work. Two consequences that
should shape every technical call:

- **Momentum is the scarce resource, not skill.** A session that ends with something
  working beats a session that ends with three layers half-built. Prefer vertical slices —
  schema → API → UI → check — over horizontal ones.
- **The maintainer six months from now is one tired person.** Prefer boring,
  well-documented patterns over clever ones. When two options are close, pick the one
  that is cheaper to reverse and say why in one line.

## Stack (settled — do not relitigate)

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui |
| Backend | NestJS, REST |
| Database | PostgreSQL; TimescaleDB for energy and sensor time-series |
| Auth | Clerk, multi-tenant |
| Billing | Stripe. Student-facing payments also need débito direto and MB WAY |
| Notifications | Push + transactional email (provider chosen in phase 0); SMS deferred |
| Charts | ECharts / Recharts |
| Deploy | Vercel (frontend) + Railway or Fly.io (backend + DB) |
| Environments | staging and production, separate from day one |

If a genuinely better option appears, say so in one line and move on unless it gets
picked up. Do not stop a session to relitigate a settled choice.

## Non-negotiable conventions

**i18n from the first string.** Every user-facing string goes through the translation
layer as it is written. Default locale `pt-PT`, with `en` maintained alongside. Retrofitting
i18n is the kind of task that eats an entire weekend, so it is never deferred "just for
this component".

**European Portuguese, not Brazilian.** `pt-PT` is the source language and `en` is the
translation, not the other way round. Reviewers check for Brazilian forms — *usuário*
(utilizador), *seção* (secção), *arquivo* (ficheiro), *salvar* (guardar), *tela* (ecrã),
*cadastro* (registo), *senha* (palavra-passe) — and for the Brazilian present continuous
(*está processando* rather than *está a processar*). They also check for English left
untranslated in the interface. `pnpm i18n:check` proves every key exists in both files; it
cannot tell you the Portuguese is the right Portuguese, so that part is read by a person.

**Every date in Poolse is `dd-MM-yyyy` — prose, tables and `/admin` alike — and it comes from
`formatDate` / `formatStamp` in `lib/date-format.ts`.** One shape, one definition, 13 September
2026. `Intl` cannot produce it: there is no separator option, `pt-PT` writes 13/09/2026 and
`en-US` writes 09/13/2026, so the named `long`, `short` and `stamp` were **removed** from
`i18n.ts` rather than left pointing at the old shape — asking for one now fails
`pnpm i18n:check` loudly. **An options object at a call site fails the same check**, which is
how twenty of them quietly rendered slashes for a year — but only where it is spelled
`dateStyle` or `timeStyle`: **the check sees neither `{ day, month, year }` nor a bare
`new Intl.DateTimeFormat`**, which is how four dates were still reading "13 de setembro de 2026"
a fortnight later. Grep for both before trusting it. A sentence that needs the time on its own
takes **`formatTime`** from the same file rather than asking next-intl for `{ hour, minute }`,
which renders 14:30 in Portuguese and 2:30 PM in English. What stays named in `i18n.ts` is
`month` and `monthShort`, which are month *names* and properly the reader's language; they are
still defined once and passed to *both* `getRequestConfig` and `NextIntlClientProvider`,
because a client provider inherits the locale and timezone from the server but neither the
messages nor the formats. The timezone is `APP_TIME_ZONE`, exported from the same file, so the
formatter and next-intl cannot disagree — and a `YYYY-MM-DD` string is parsed as a *day*, never
as a UTC instant, which is the off-by-one that made a rate effective on 1 October read as
30 September. `asDate` makes it noon UTC, so the browser's own zone cannot move it either, and
`lib/dates.ts` no longer writes a date at all — `shortDate`, `mediumDate` and `longDate` are gone,
day-column headers included. **One exception, for headings only** (POOLSE-96): `formatDateRange`, `formatDateLong`, `formatDayMonth` and `formatDayMonthShort` in the same file write a week or a day out in words through `Intl` (`en` as `en-GB`) — the lifeguard week's heading and columns, a student's *Semana* tab (POOLSE-108) and the calendar's week heading and day headers (POOLSE-107), and nothing else unless Rui asks. `formatDayMonthShort` composes day and abbreviated month, because `Intl` asked for both writes pt-PT as 16/11. A client-side week stepper changes only `?week=` through `withWeek` (`lib/week-url.ts`), never rebuilding the address from the path, which drops `?tab=` and `?from=`.

**Tooltips explain, they never inform.** A tooltip may clarify what a control does. It may
never be the only place a piece of information appears — anything the operator needs is
visible text. Tooltips open on keyboard focus as well as hover, because a control whose
meaning is only available to a mouse is a control half the users cannot understand.

**The platform writes through column grants, and a platform write records itself.**
`poolse_platform` holds `UPDATE` on six *named* columns of `organization` — `trial_ends_at`,
`subscription_status`, `max_facilities`, `max_management_users`, `suspended_at`,
`suspension_reason` — plus `read_only_at`, `pending_delete_at`, **since 14 September
2026, `archived_at`**, and since 20 October 2026 `disabled_modules` (POOLSE-87). No INSERT and **no DELETE**: signup stays the only way a tenant comes
into being, and *destroying* one is not an operator action. Archiving one now is — that rule
was reversed deliberately so the trial clock could close its ladder, it is a soft delete the
same login can undo, and `platform-admin.sql` asserts both halves (the archive allowed, the
delete refused). A column grant rather than a second `SECURITY DEFINER` function, which the
migration checklist tells you to stop and reconsider before writing. **`PlatformAuditInterceptor`
logs reads only**; a write is recorded by `changeTenant` inside the transaction that performed
it, carrying the before-and-after of every column that moved — so a non-GET platform endpoint
that bypasses that helper is not audited at all, and there is exactly one write path.
**`suspended_at` is access state and `subscription_status` is billing state**: a club whose card
expired is `past_due` and still teaching, and only the first shuts a door — enforced in
`TenantMiddleware` (code `tenant_suspended`), never inside `resolve_memberships`, because `/me`
has to keep answering so the club can be told why. A suspension always carries a reason, by
CHECK. `docs/features/platform.md`.

**The dashboard is a union of role bands, and a widget is one declaration in a registry.**
POOLSE-66. `BANDS` in `dashboard/widget-registry.ts` is the order — management, operational,
personal — and it is **one array constant**; a band the reader holds no role in is *absent*,
not empty. Ordering between roles is `MEMBER_ROLES`, which already existed: the ticket's
numeric ranks are not written down a second time, and seniority orders, never permits.
**`widgetsFor` applies `roles` before any resolver runs**, so a widget the reader may not see
is absent from the payload — asserted on the raw JSON, because a blank-but-present widget
passes a shape assertion and fails the promise. `kinds` is spelled as `app-sidebar.tsx` spells
it, so a personal tenant needs no second architecture. **A resolver answers `null` for "nothing
here" (→ `empty`) and throws for "that went wrong" (→ `error`)**; resolvers run in parallel with
a 2s ceiling each and one failure costs one card, never the page — and the error card carries
no message, because a resolver's text names columns. **Every allowed widget is resolved, then
escalated, then capped at four per band**: "boost this when the water is out of range" is a
predicate on resolved data, and a cap decided in advance would cut the thing that was about to
become urgent. A `trailing` widget is one line after the cap, never cut and never ranked above the pool;
none is trailing since the subscription left the dashboard (28-10-2026). **A club with no sites gets the onboarding checklist and nothing else; a club
with sites never gets it** — one branch, both directions. **Aggregates are one grouped query
each, never a loop over facilities**, and `assertRegistryIsSound` refuses the five registry
mistakes that would otherwise render nothing at all rather than fail. **On the web a band is a
heading and a grid, and a card is `WidgetCard` plus one case in `widgets.tsx`** — adding a
widget is a registry declaration and that case, never a new fetch or a client-side role check.
**The `empty` sentence is the widget's own and the `error` sentence is the card's**: "ainda não
há faturas" and "nada em atraso" are different facts, while a failure can only honestly say it
did not load — the resolver's words name columns and go to the log, and the error card is muted
rather than danger, because it is not a refusal. **Every card links to its page in all three
states.** A panel that predates the registry is a card no role check governs, which is what
`mgmt.energy.costs` was before slice 2a; `me.pool` is the one left, carrying a comment naming the
widget that replaces it. **The instructor band (slice 3) is `scope: 'self'` on
`class_session.resolved_instructor_id`** — the stand-in sees the class, the regular instructor does
not — and the next class holds on to one whose register is still owed; a card that copies a plan
sends the session id and never the text. **The maintenance band (slice 4) reads
`ResolverContext.ownFacilityIds`** — every site the reader works at, before the selector narrows
it — so an operational card never follows the management control; the selector is `SELECTOR_ROLES`.
Maintenance may record one water analysis and nothing else on a pool. **Slice 2b's aggregates are one statement each whatever the number of
sites** (`management.repository.ts`, proved by `countStatements` in the test harness), the
selector is remembered on `membership.dashboard_facility_id`, and **the cap ranks a card with
something to say before an empty one**. `docs/features/dashboard.md`.

**A module is switched off per club by Rui, and every tenant route says which module it is.** POOLSE-87. `POOLSE_MODULES` in `@poolse/rules` is the one list (equal to the SQL enum `poolse_module` by test); everything else is core. `organization.disabled_modules` stores what is **off**, so empty is the full product and a trial needs nothing set. Only `poolse_platform` writes it, through `changeTenant` (`POST /platform/tenants/:id/modules`, one click, audited, alerted); a dependency left broken is a 409 `module_dependency` and a CHECK, never resolved for the operator — reception needs invoicing. **A new controller carries `@PoolseModule('x')` or `@CoreRoute()`** (`tenant/modules.ts`), with a handler tag overriding the class, or the API refuses to boot; `ModuleGuard` answers 403 `module_disabled` from the membership `resolve_memberships` already returned. Switching off hides and refuses and never deletes. **On the club's side, a module's thing says its module once**: a menu entry and a dashboard widget carry `module` (filtered before any resolver runs), a module's route segment mounts `ModuleGate` in its `layout.tsx`, a core read that carries a module's data drops it on the server with `moduleIsOn` (the pool's water log, a student's `qualifying` and meets), a `RESTORABLE` kind carries `module` so the bin neither lists nor restores it, a rule the club can no longer see stops applying (a `blocks_assignment` qualification type with qualifications off), and a background job skips the club. A `/me` with no `modules` field is every module on (`modulesOf`), never none. **`poolse_app` holds UPDATE on `organization` column by column since this change**, so a new `organization` column the club writes needs its own `GRANT UPDATE (col)` in its migration. `docs/features/platform.md`.

**An irreversible platform act asks for the club's name, and every platform write and
refusal raises an alert.** POOLSE-64 slice E1. **Which acts are irreversible is decided by
the columns a change writes** — `changeTenant` requires `confirmName` when a change *sets*
`suspended_at`, `pending_delete_at` or `archived_at` — so an endpoint added later inherits
the rule and a list nobody maintains does not decide it. Only *entering* those states is
checked: restoring, letting a club write again and lifting a deletion date are one click,
because nothing is made safer by slowing down the direction that undoes harm, and a
confirmation on everything is one nobody reads. The name is matched case- and
accent-folded — the friction is reading it, not reproducing a circumflex — and an
unsupplied name never matches, so the check fails closed with `admin.error.nameMismatch`.
**Read-only on its own is one click; read-only with a deletion date is not.**
`platform_alert` is written *inside* the transaction that caused it and emailed *after* it
commits, the same division 4.2's water alert makes, to `PLATFORM_ALERT_EMAIL` — an ops
mailbox, because `platform_admin` is keyed on a Clerk id and the platform grant on
`app_user` carries no `clerk_user_id` to join on. **Every refusal is recorded; only the
sending is suppressed** (fifteen minutes per person, in memory), because a stranger must not
be able to thin the record of their own attempts by making more of them. `/platform` carries
its own ceiling, 60/min against the API's 300. **MFA and step-up reverification are not
built and are gated on a production Clerk instance**; the shared origin with the tenant app
is a dated known limitation in `docs/deploy.md`, which also holds the rotation procedure for
`DATABASE_PLATFORM_URL`. `docs/features/platform.md`.

**Telemetry is aggregated, never one row per request; and Sentry is off unless a DSN says
otherwise.** `RequestStatsInterceptor` buffers in memory and flushes one row per tenant per hour
into `tenant_request_stats` — a club at 100 req/min would otherwise write 144,000 rows a day for
data whose purpose is a coloured dot. It records nothing for a request with no tenant context, by
construction rather than by an exclusion list. The table is **hypertable-shaped** — natural key
`(organization_id, bucket)`, no surrogate id — and becomes a hypertable with a 30-day retention
policy only where the `timescaledb` extension exists; where it does not, the same flush prunes past
30 days. `poolse_app` writes it and cannot read across tenants; `poolse_platform` reads it and
cannot write. **Health is derived at read time** in `tenant-health.ts` (one config constant: 24h
window, 2% 5xx rate) — `unknown` is never `green`, and 4xx never colours anything. **`/health` is
public and only Postgres can make it `down`**: the status code is the deploy gate, so a slow Clerk
is `degraded` and HTTP 200. **Sentry no-ops without a DSN**, tags `tenant_id` (the id, never the
name), keeps `sendDefaultPii: false` and `tracesSampleRate: 0`, and captures from `BadInputFilter`
rather than `SentryGlobalFilter` — that filter is `@Catch()` and terminates, so two global filters
means one never runs. `docs/features/observability.md`.

**A subscription is Stripe's to know and the webhook's to write; a licence is the operator's.**
Slice 2.4, narrowed by POOLSE-60. **Owner only, under *O meu perfil*** — not a menu item, not on the dashboard, and
not an admin's business: the card, the renewal and the decision to cancel are the owner's own,
the same reasoning that keeps the owner's salary from an admin. **One plan (`poolse_full`) and
two intervals (`monthly | yearly`)**, both *descriptive*: no feature, limit or ceiling is ever
decided by either, which is exactly what made reversing three tiers into one cost a single
column rewrite. The price map is keyed on the interval and the webhook's reverse lookup reads
env vars rather than calling Stripe, so that path stays offline-testable; a price nobody
configured leaves the interval null rather than guessed. Switching interval goes through the
customer portal — proration is solved on Stripe's screen. `STRIPE_SECRET_KEY` absent means the Subscrição page says so, plans come back
unpriced and `/webhooks/stripe` answers 503 — nothing else changes shape, which is the state of
every dev machine and of the free pilot. **Prices live in Stripe** (an env var per plan names a
*price* id) and are read back for display, because the amounts are still undecided and a price
in a deploy belongs in a dashboard. **Paying changes no ceiling**: `plan` is descriptive and
`max_facilities` stays a hand-set `/admin` decision, so a limit has exactly one author.
**Checkout and the portal are Stripe's own pages** — Poolse never holds a card — and a club that
already pays is sent to the portal, never offered a second checkout. **The signature check is the
entire authentication** for the webhook, over the raw bytes, and a missing signing secret is a
503 rather than a skipped check. **`stripe_event` is the idempotency key and the trail in one
table**: Stripe's event id as the primary key, inserted in the same transaction as the change, so
a retry finds the row and stops and an out-of-order redelivery cannot undo a later event. It is
not `platform_audit_log` because that table's actor is `clerk_user_id NOT NULL` and a webhook has
no person — two write paths to the billing columns, each leaving its own entry. The webhook
answers **200 to almost everything** (unhandled type, unknown customer, redelivery): Stripe
disables an endpoint that keeps failing. A failed payment sets `past_due` and **never**
`suspended_at`, and nothing closes a club automatically — not even a trial running out.
`docs/features/subscription.md`.

**One person, one trial, blocked at the door rather than inside the trial.** POOLSE-62.
**`trial_claim` is platform-scoped and the unique index on the normalised address is the whole
enforcement** — written by `provision_organization` inside the transaction that makes the
tenant, so a refused signup leaves no organization, no membership and no claim, and two racing
signups end with exactly one club. Nothing asks first, because the API runs on the tenant login
and could not, and because a question asked before a write is a question whose answer changes
before it lands. **`normalize_signup_email()` is the one definition of "the same address"**:
lowercased, `+tags` stripped everywhere, dots stripped *for gmail only*, googlemail folded into
gmail. **A refusal never says which lever fired** — a used address and a disposable domain share
one code (`trial_not_available`) and one sentence, because the person reading it may be a club
coming back. **A claim outlives its organization, archiving included**, which is what makes the
one-click override load-bearing: *conceder novo período* rides on the trial-date action, frees
the address by writing `released_at` (a row, never a DELETE — both unique indexes are partial on
it) and records how many it freed. **The origin is a flag and never a record**: a salted digest,
and no `SIGNUP_IP_SALT` means no hash at all rather than an unsalted one. Soft flags — the
domain and the origin — are counts on `/admin` that block nothing, because a municipality has
several pools and clubs share offices. **The second block is the club's NIPC**, asked for under
Faturação (a fatura's issuer is the club) and claimed by a `SECURITY DEFINER` trigger so the
cross-tenant check happens inside the club's own transaction — the alternatives, and why an
index on `organization.vat_number` would have broken the override, are in that migration's
header. `isValidNif` is the checksum and the schema enforces the shape; **an empty box clears
the number and an unparseable one is refused**, because reading nonsense as "clear it" is how a
form silently discards what somebody typed. `docs/features/trial.md`.

**A club may pay outside Stripe, and a manual subscription cannot be forgotten.** POOLSE-63.
**`billing_mode` (`stripe | manual | comped`) says *how*, `subscription_status` says *whether*,
`suspended_at` says whether the door is open** — three columns, three questions, still none of
them merged. **`comped` moved onto the mode** on 18 September 2026 and is no longer a settable
status: one fact had two homes, and a club could read as "pays in cash" and "is not billed" at
once. The rule that makes the slice worth having is a CHECK — an *active manual* club must have
a `paid_through`, or an operator flips one to active, forgets, and they run free for two years.
**`paid_through` is a `date`** (cover runs to the end of a day, and a `timestamptz` invites the
UTC-instant off-by-one) **and only a payment moves it**, to the *greater* of the two dates, so a
receipt recorded late extends cover and never shortens it. **`manual_payment` is insert-only and
platform-scoped**: Poolse's own revenue, no tenant can read it, no UPDATE and no DELETE on the
grant, and a correction is another row. `docs/financials.md` applies except its tenant-scoped
conventions, which is written down there rather than left to be noticed. Recording one is a
single `changeTenant` transaction that also sets the mode, the status and lifts read-only — and
never `suspended_at`, which is somebody's decision with a reason attached. **The clock's manual
ladder stops at read-only**: `past_due`, then read-only after `manual_grace_period()` (15 days),
then nothing — no deletion date, no closed door, no archive, because a customer who is late is
not a trial that never paid. **A Stripe event naming a non-`stripe` tenant is refused** and
recorded as `not_stripe_billed`, still answering 200. **`/admin` reports counts per mode and
euros only for manual payments**, because nothing here stores what a Stripe subscription is
worth and a total over half the data looks exactly like a complete one.
`docs/features/subscription.md`.

**A trial ends in read-only, which is a third access state.** POOLSE-61 slice B1.
`suspended_at` **beats** `read_only_at` **beats open**, enforced in `TenantMiddleware` and
asserted for a `GET` as well — a club that is both is a club we closed, and "your trial ran
out, pay here" would be the wrong sentence. Read-only allows **every safe method** (`GET`,
`HEAD`, `OPTIONS`) rather than an allowlist of safe routes, because a list is a list somebody
forgets to add to — and it makes "you can still export everything" true for free, since every
export here is a GET. Exactly **two writes stay open**, the checkout and the customer portal:
*a read-only tenant that cannot pay is a read-only tenant for ever.* The Stripe webhook is
**not** on that list and must not be added — it is public and this middleware never runs for
it, so a line for it would look load-bearing and be dead. The refusal carries `trialEndedAt`
and `dataKeptUntil` so a form explains itself where it failed, and since 28-10-2026 (Rui) the owner and the admins are warned by the avatar's subscription icon (`subscriptionAlert`), which replaced the standing banner every
member saw. **Lifting read-only clears `pending_delete_at` with it** and neither control
touches `subscription_status` — billing state and access state stay separate. `trial_period()`
is the trial's one definition (15 days), replacing a literal copied into four provisioning
functions; existing trials are untouched. **Nothing is ever copied or migrated** — a trial
tenant is an ordinary `organization` row, so converting is a status change and restoring one
is a status change back. The clock that sets all this is B2 and is **not built**; an operator
sets it from `/admin` too. **The clock is B2 and is built**: an hourly Nest cron under
`pg_try_advisory_xact_lock`, so a second Railway instance is a no-op rather than a double
transition — idempotence is separate and comes from the state each step reads, not from a
constraint. **It archives on day 75, and only a club it closed itself** — `trial_event` is the proof it
requires, so a club an operator suspended for a reason of their own is never filed away by the
machine. That needed `archived_at` on the platform grant, which reversed a settled rule on
14 September 2026; `DELETE` is still refused everywhere, so the archive is soft and the purge
is still its own ticket.
Transitions go to **`trial_event`**, never `platform_audit_log` — that table's actor is
`clerk_user_id NOT NULL` and a machine is not a person — which is also what makes a
machine-set suspension distinguishable from an operator's. **Notices record the owners they were owed to and,
since POOLSE-86, are emailed to them after the pass commits** (`deliverTrialNotice`); reading the
address took `app_user` onto the platform grant — the eighth table, two columns of it, decided the
same day. `docs/features/trial.md`.

**Every email is sent once after its commit, rendered from its row, and retried hourly if it did
not leave.** POOLSE-86 slice 3.0a. A sender is a by-id function (`deliverWaterAlert`,
`deliverLabAlert`, `redeliverQualificationAlert`, `deliverMessage`, `deliverTrialNotice`,
`deliverSupportNotice`, `redeliverAlert`) that the request *and* `DeliveryRetryService` call, so a
retried email is the first one and no wording exists twice. The retry takes rows raised in the last
48 h, older than ten minutes, at most once an hour and five times (`delivery_attempts`,
`last_attempt_at`), and does nothing while `EMAIL_PROVIDER` is console. Invitations are not retried —
the link is a hash — and *Novo link* re-sends one. **A new email is a by-id sender and a line in
`TENANT_KINDS` or `PLATFORM_KINDS`.** `docs/features/messages.md`.

**Poolse support enters a club only through a grant the Owner opened, and is never one of the club's people.** POOLSE-79. `support_grant` is the window. An operator enters through `support_session`, a definer function that only `poolse_platform` may execute and that re-checks the platform admin and the live grant. They then work through the ordinary tenant path, so RLS, `requireRole` and `audit_log` name them. **The role is not a row**: a support membership holds no `membership_role` rows (a trigger refuses one), and `resolve_memberships` gives it `admin` only while the grant is live. Expiry and revocation therefore need no job, and every role-keyed list leaves support out with no edit. **A read over *every* membership (Pessoas, a people search, a picker, a team count) adds `support_grant_id IS NULL`**, because "no role" reads as staff there. A new one earns a line in `support.integration.test.ts` QA 5. **A support session grants no roles** (`currentTenant().support`; `grantableRoles()` is empty), so no access outlives the window, and entering raises a `platform_alert`. **Asking is a `support_request`** that opens nothing until the Owner approves it. **Forcing is an override**: a reason, the club's name typed back, exactly 4 h, an alert, and a recorded notice to the Owners. Those two are the only things `poolse_platform` inserts, and both tenant policies there are `TO poolse_app`. **The active club is the `poolse_org` cookie**, which every API call sends as `x-poolse-organization`. `/me` puts that club first, so `memberships[0]` is always the club being acted in; never pick a membership any other way. `docs/features/platform.md`.

**Platform administration is not a tenant role, and it has its own database login.** `member_role`
says what somebody may do inside one club; `platform_admin` — keyed on the Clerk user id, no
`organization_id` — says whether they may look at all of them. No role grants it, being owner of a
demo tenant grants nothing, and `PlatformAdminGuard` reads `currentAuth()` rather than
`currentTenant()` because an operator may belong to no organization at all (`platform/(.*)` is in
`IDENTITY_ONLY_ROUTES`). Cross-tenant reads go through **`poolse_platform`**, a third login on its
own pool (`DATABASE_PLATFORM_URL`), used by `PlatformModule` and nothing else. It does **not** carry
`BYPASSRLS`: it is named in a `FOR SELECT TO poolse_platform USING (true)` policy on eight tables of club data (plus `support_grant`, which holds only who consented and until when — POOLSE-79) and
holds no privilege on the rest of the schema, so a mistake leaks those eight rather than
`student_sensitive` — and reaching a ninth is a reviewed line of SQL. **The eighth is `app_user`,
added 14 September 2026** so a trial notice can record the address it was owed to, and it is a
*column* grant — `(id, cached_email)` and not the names or the avatar, because a notice needs an
address and a name in a log is a second copy of something Clerk owns. That widening cost the
guarantee that a mistake here leaks club data rather than every person's e-mail; it was taken
knowingly, and `docs/decisions.md` says so. `assertPlatformRoleIsNarrow`
refuses to boot if it points at the owner. **Every request to `PlatformModule` writes one line to
`platform_audit_log`, reads included** — the request, never the response; the guard writes its own
refusals, because a guard runs before every interceptor. `docs/features/platform.md`.

**Multi-tenancy is enforced by the database, not by the repository layer.** Every table
holding tenant data carries `organization_id` — but that is only the raw material.
Isolation is two structural mechanisms, both in place before any tenant data exists:
composite foreign keys `(organization_id, parent_id)` so a row can never reference another
tenant's row, and row-level security keyed on a per-request GUC so a query that forgets
its `where` clause returns nothing instead of everything. Application-layer scoping alone
fails the night one method is written tired. See `docs/data-model.md`, decision 2.

**Clerk owns the name and the email; `app_user` holds a cache.** `cached_first_name`,
`cached_last_name`, `cached_email` and `cached_avatar_url` are a copy of Clerk's data,
refreshed by the webhook and stamped with `synced_at` so a late event cannot revert a
newer one. **Never write those columns to save a user's input.** It appears to work and is
silently overwritten the next time Clerk syncs — a bug that reproduces only sometimes.
The save path is: write to Clerk, then re-read from Clerk (`refreshFromClerk`). Locale,
theme, birth date and phone are Poolse's and are written directly. `docs/data-model.md`,
decision 2, and `packages/db/test/profile.sql`, test 6.

**A series move re-times the weeks that still sit where the pattern put them.** The calendar
draws each booking at its `class_session` for that week, so a move that rewrites only
`class_schedule` is written and then invisible — the block springs back, and nothing reports a
failure because there was none. `retimeSessions` in `bookings.repository.ts` is the other half
of round 7's overlay. It skips a week moved by hand (`moved_at`), a week in the past and a
week whose register is taken — **except the week that was dragged**, named by `fromDate`,
which follows and loses its exception, because the operator just moved that block and said
"every week". **`fromDate` names the day the block was drawn on, not the week the pattern
files it under**: the two differ for a class moved across a week boundary, and matching by week
both missed the block on screen and claimed its neighbour instead. Where a week *lands*, and
whether it is behind us, stay derived from `occurs_on` — one session per pattern week is the
invariant the unique index rests on. A week left behind is counted and reported either way (`weeksKept`,
`weeksBlocked`): "kept by design" and "failed" look identical on screen, and silence is what
made this read as a feature that did nothing; a week whose new hour is occupied is left alone and **counted**,
one savepoint each, because failing a whole series change over one November Wednesday makes
the feature unusable. Re-stamp `class_session_lane` with it — the exclusion constraint is on
those rows and they carry their own copy of the window.

**A guard that reads the pattern and a screen that draws the week will disagree, so a refusal
must say which one it is defending.** A series move is checked against `class_schedule`,
because that is what it rewrites; the calendar draws `class_session`. A turma whose sessions
have all been moved elsewhere one week at a time still holds its pattern slot — so it blocks a
move while being drawn on another day, and "Pista 2 already has X" names a class the operator
can see somewhere else entirely. The fix is never to weaken the guard: it is to carry the
blocker's own weekday and hour on the 409 and say them. Same family as the trigger refusals
that carry their numbers.

**A save says so, and it says so once.** `useSavedAction` raises the toast — one place, every
form — so no screen has to remember to report an outcome and none of them can word it
differently. Where "Guardado" is the wrong word, an action returns `toastKey` (and `values`) — a
restore says "Restaurado: Piscina 1" through the same hook. Field errors still render beside their field, because a message at the top of the
page cannot say which of a dozen boxes it meant; the top-of-form banner and the inline
"Guardado" are the toast's job now. `components/ui/toast.tsx`: muted tones on the surface
colour, an icon per tone so colour never carries the meaning alone, 4s for a success and 8s
for a refusal, and `w-auto` up to `max-w-md` so the box hugs its words. A saturated fill was
offered and declined twice — these appear dozens of times an afternoon. **The calendar's move
refusals go here too**, rather than into a bar above a grid that is taller than the window.

**A section that opens and closes moves smoothly** (Rui, 28-10-2026). A native `<details>` is animated by `DetailsAnimator` (`components/details-animator.tsx`, mounted once per root layout; `data-instant` opts one out), because the CSS route moved only in Chromium; a hand-built toggle is `<Reveal open={…}>`, and both share `REVEAL_MS` / `REVEAL_EASING` (380 ms, decelerating — Rui, 29-10-2026) (`components/ui/reveal.tsx`) instead of `{open && …}` — closed still means unmounted, and a table edit row takes `<Reveal open appear>` inside its `<td>`. **A warning icon that needs attention carries `attention`** (globals.css): three gentle pulses as it appears, then still, and none under reduced motion. **A warning dot is `.attention-dot`, everywhere** (Rui, 28-10-2026, after first choosing three pulses). It is a 6 px ball in the primary colour that blinks gently for as long as it is there: one breath every 2.4 s, still and half-strong under reduced motion, never a number. Don't style a dot by hand.

**Something slow says so in the corner, and the signal comes from where the work starts.** POOLSE-98. `lib/busy.ts` is the store (`beginBusy`/`endBusy`, `useBusyWhile`, `trackBusy`) and `BusyIndicator` in the `(app)` layout is the one corner: past 400 ms, at least 300 ms. `useSavedAction` and `FromLink` (through `LinkBusy`) already report, so a new form or link needs nothing; a plain `Link` under `(app)` carries `<LinkBusy />`, a file the app serves is a `DownloadLink`, and a bar stuck to the bottom of the screen carries `data-bottom-bar`. `docs/features/loading.md`.

**Every button and every form control is one size: `h-control` (36px) and `text-control` (15px).** Rui's call, 11 October 2026 — inputs, selects, tab pills and every button, row actions included, `inline-flex h-control items-center justify-center px-4 text-control`; colour and border vary, size does not. Field labels stay `text-sm`. The only exceptions are icon-only buttons (a close X, the calendar block's ⋯), which are small squares because they sit inside tight spaces. A new button that invents `px-2 py-1 text-xs` is the drift this rule was written to undo.

**On a phone the same tokens take a second value, and the shell clears the notch.** POOLSE-88 slice 1. `h-control` / `text-control` read `--control-h` / `--control-text` (globals.css): 36px / 15px under a mouse, 44px / 16px under `@media (pointer: coarse)`, and a coarse-pointer floor keeps every text field at 16px so iOS never zooms on focus. **Coarse pointer is for sizing only; layout follows width (`md:`)**, because a touch laptop is wide. Insets are `--safe-top/right/bottom/left` (from `env(safe-area-inset-*)`, with `viewport-fit=cover`), read by the app bar (`h-app-bar` includes the notch, `pt-safe-top`), the content (`pb-safe-bottom`), dialogs and toasts — never `env()` in a component. **`dvh`, never `vh`**: iOS's moving toolbar makes `100vh` taller than the screen. Below `md` the sidebar is `MobileMenu`, a `Dialog` with `placement="start"` drawing the same `SidebarNav`, and a page's title and primary action stick under the app bar. Installable through `app/manifest.ts`, `public/icons/` and `appleWebApp` in the app root layout; no service worker. The `iphone` (WebKit) and `android` (Chromium) Playwright projects run `e2e/phone-*.spec.ts` against the sessions `auth.setup.ts` saves: the owner, and an instructor (`INSTRUCTOR_SESSION`). **A control that sits in one place on a desk and another on a phone is rendered once and moved by CSS** — `contents` below `md` plus `order-last` and `sticky bottom-0`, as the register's Save bar does — never rendered twice with one copy hidden. A bottom bar adds `var(--safe-bottom)` to its own padding. A control whose words may wrap on a phone takes `min-h-control` rather than `h-control`. A target that is not a control (a back link, a card's link) takes `coarse:-my-3 coarse:py-3`, so it is 44 px to a finger and moves nothing. **A lesson's page is the lesson on a phone** (POOLSE-88 slice 2): the register plus `SessionActions`, which mounts the calendar's own plan sheet, stand-in picker and cancel dialog, never copies of them. Cancel shows from the register read's `canCancel` (the cancel endpoint's own test), and `CancelSessionDialog`'s `management` decides the scope question and *Anular*. **Every screen has a phone tier** (`docs/features/navigation.md`, *Telemóvel*). Tier 1 is the poolside screens, which must be good one-handed; tier 2 must work plainly; tier 3 is the desk, readable only. A new tier-1 or tier-2 screen earns a line in `phone-poolside.spec.ts` or `phone-tier2.spec.ts`. A column beside a photo takes `basis-64`, so on a phone it wraps under the photo instead of shrinking to an unreadable strip. **A desk-shaped screen gets a phone view, never a squeezed desk view** (Rui, 21-10-2026). The calendar is `CalendarAgenda` below `md` and the grid from `md`. `WeekGrid` is one column below `md`. A wide table takes `.table-stack` plus a `data-label` per cell, and turns into cards below `md` with no second render. A header control that must survive on a phone (Em dívida's select-all, POOLSE-104) un-clips its own `thead` cell with `max-md:!…` utilities and hides the column titles. Each phone view is proved both ways in `phone-views.spec.ts`, desk width included. **App mode is the second front door** (POOLSE-90). `/app` routes by role through `lib/app-hats.ts`, the one definition of who lands where. Owner and admin go to the backoffice; a family goes to `/app/familia`, and a family-only reader never lands on `/dashboard`. Its shell is `(app)/app/layout.tsx`. The mobile palette is `--app-*` tokens, mapped onto `--primary` and its kin under `data-surface="app"`. A new app-mode screen is tier 1 and earns a line in `phone-app.spec.ts`. `docs/features/app.md`. `docs/features/navigation.md`.

**Form fields are controlled, never `defaultValue`.** React 19 resets a form as soon
as a function `action` returns — *including when it returns a validation error*. An
uncontrolled input therefore wipes what somebody just typed at the exact moment they are
being asked to correct it, and an uncontrolled `<select>` reverts to its mount-time value
after a save that worked. Both shipped as separate-looking bugs (POOLSE-09, POOLSE-10) from
one cause. Use `TextField` / `SelectField` / `TextAreaField` from
`apps/web/src/components/ui/field.tsx`; they are controlled, re-seed only when the server's
value actually changes, and carry their own label, hint and field-level error. **A hand-built control (a price row, an inventory line) takes `useSeeded` from the same file** instead of `defaultValue`, and a create form that stays on screen passes `useSuccessKey(state)` so its fields clear after a save that worked and never after one that failed. `pnpm forms:check` refuses `defaultValue` and `defaultChecked` anywhere but `field.tsx` — the form-debt sweep of 15 October 2026 took the count from 62 to 0. **Controlled is not enough for a checkbox, a radio or a select**: React 19's reset after an action (a refusal included) puts them back to their value at mount without a redraw, so a refused save showed a box unticked and a named select *submitted* its first option next time. `FormResetGuard` (`components/form-reset-guard.tsx`, mounted once in the app and public root layouts) copies their current values into their defaults on the `reset` event; a new root layout with forms mounts it too.

**A NIF is checksum-validated, and `isValidNif` in `@poolse/rules` is the one definition.**
Nine digits with a mod-11 check digit; empty stays allowed everywhere it already was. It lives
in the shared package for the reason the conflict rules do — a form that accepts a number the
API refuses is the failure that package exists to prevent. This **reverses** the "never
validated as a real NIF" comment that `students.controller.ts` and `membership.tax_number`
used to carry: the duplicate-person guard is *keyed* on the NIF, so a number that cannot exist
silently defeats it. **One NIF is one person**: a student and their guardian may not share one
in a submit, nor may two guardians — checked in the controller, which is the only place the
whole request is visible. An inline guardian whose NIF matches an existing person is still
*attached* to them, because that is what stops a second sibling producing a second mother.

**Every module that touches money obeys `docs/financials.md`, and `staff_compensation` is its
reference implementation.** Read it before a migration, an endpoint or a screen that stores,
sums or shows a monetary value; if a ticket conflicts with it, stop and ask rather than picking
one. Four rules bite immediately. **Every stored amount carries a `money_provenance`** — one
shared enum, `actual | contracted | estimated | assumed`, created once and reused — and a typed
or imported figure is `contracted`, because `assumed` would cast doubt on every rate a club has
entered and `actual` would claim it had been paid. **Never sum across provenances into one
unlabelled figure**: a total is broken down or labelled with its weakest component, which is
what `rollup()` returns as `provenance` and `byProvenance`. **Every aggregate reports its
coverage** — "com base em 11 de 14 pessoas" — because an unqualified total over partial data is
the same shape as a complete one and nothing on it says which. **An `estimated` or `assumed`
figure may carry `amount_low_cents` / `amount_high_cents`**, either bound standing alone,
stored from day one though nothing reads them yet: they are the input any later scenario needs
and adding them afterwards means touching every money table. `financial_entry`, the projection
surface, is **not built** — §10 says what exists and what does not, and the next money slice
builds it rather than retrofitting provenance module by module with no reader.

**A fee line's discount is `line_discount_percent` / `line_discount_cents`, whoever authored
it.** Renamed from `manual_discount_*` on 14 September 2026: the word was true when only a
person could type one and stopped being true when a fee category gained a value, and the
obvious reading — "a person decided this" — is wrong for every concession in the product.
`fee_category_id` beside them says which author it was; null with a figure present means a
person, and `discount_reason` then says why. The API fields, the form fields and the
`fees.typedDiscount` message key match, and the refusal code is `one_line_discount`.

**Money amounts are integer minor units; unit prices are not.** `amount_cents` for
invoices and fees. A per-kWh tariff in integer cents rounds €0.1548 to €0.15 and puts a
3% error on the module whose entire purpose is cost accuracy — unit prices are
`numeric(12,6)`.

**A fee category authors the discount, and the line snapshots the figure.** This
**reverses** POOLSE-23's "a reference, never a percentage", stated twice in that migration:
nothing consulted the reference, so a club giving seniors 20 % off typed it into
`discount_reason` once per family — one decision, forty authors, which is the failure that
rule existed to prevent. `fee_category` now carries `discount_percent` **or** `discount_cents`
(or **neither** — a label is still legitimate, and null is never 0 %), and the *figure* is
copied onto `student_fee` when a line is agreed while `fee_category_id` records who authored
it. Correcting a category reaches lines agreed afterwards and none agreed before, exactly as
`amount_cents` does; renaming still reaches everything, because the line holds the id. **One
author, never two**: a category or a person, refused rather than resolved by precedence, which
the form makes a shape — one control, three answers. **The client never sends the figure**, the
way it never sends the plan's amount. All four kinds. The list is **organization-scoped and
shown as a panel under Preços on each site's page** — an instructor reads the names and not the
values (`canSeeValues`), because the price list refuses them outright and a concession must not
be the way round it. `docs/features/students.md`.

**A family asks for a place from the app, and it is a pedido in the same queue.** POOLSE-121 (Rui, 29-10-2026). `POST /app/enrolment-requests` writes a `lead` naming `requested_class_group_id` and `requested_by_membership_id`; for a child the club has it carries `student_id` from the start (`existingStudent`), and `placeLead` then attaches the turma to that student instead of running the student form. A new child is an ordinary lead with the reader as guardian. `docs/features/registration.md`.

**A partnership's contract comes before its terms and keeps its versions.** POOLSE-105. Attaching one with no agreement makes a *termos por preencher* agreement: start date, model and price all null, by CHECK, and filled in place by *Registar os termos*. `partner_contract_version` is the history (insert-only bar closing one), and `document_key` stays the current pointer. Staff download it through `PartnerDetail.contract`, outside the withheld `agreement`. Word is a contract-only type, sniffed by content, served as an attachment; `acceptFor(purpose)` in `lib/files.ts` is the picker's list and `DocumentLink` the link. `docs/features/parcerias.md`.

**One price list, four `fee_kind`s — never a table per fee type.** `mensalidade`,
`inscricao`, `seguro`, `quota`, all on `fee_plan`, each with its shape held by a CHECK: only
a mensalidade is priced by a level and a frequency, only a quota is banded by age, and
inscrição and seguro belong to a season. The **recurrence is the plan's, not the kind's** —
the default per kind is an API opinion, and the schema enforces only that a `fee_period` may
be named by a plan that recurs by the facility's periodicity list. A new kind is a value and
a row in that table; if it seems to want its own table, that is four read paths and four
copies of every bug. `docs/decisions.md`, 2026-09-08.

**Amounts are gross and `vat_rate` says what is already inside them; `vat_exempt` is its own
flag.** Never a rate of zero standing in for isento — on a Portuguese invoice an exemption and
a zero rate are two different statements, and a schema that cannot tell them apart discovers
it while invoicing. This reverses the "no VAT rate anywhere" comment that `fee_plan.amount_cents`
used to carry; the exemption *reason* is invoicing's to add.

**An invoice is written once, and its number comes from the database.** `poolse_app` holds
SELECT and INSERT on `invoice` and `invoice_line` and nothing else — a revoke rather than a
trigger, because a missing privilege cannot be forgotten by application code. So there is no
`updated_at`, no `archived_at`, and no edit: a correction is a credit note in its own book,
and settlement in 2.3 arrives as a child table the way `student_fee_payment` did. `number` is
allocated by a BEFORE INSERT trigger from `invoice_series.next_number` — **a column and not a
Postgres sequence**, because a sequence is not transactional and a rolled-back document would
leave a gap the series may not have. An INSERT that supplies a number is refused. The row lock
that allocation takes also serialises every insert into one series, which is what makes the
double-billing trigger sound; a refactor to a sequence passes most tests and breaks both
properties. These are **internal records, not legal faturas** — `atcud` and
`at_validation_code` are reserved and null until certification, and the screens say so.

**"Already billed" means "on a document not since credited", so it is a constraint trigger
and not a partial index.** After a credit note the occurrence is chargeable again — that is
how a club fixes a document it got wrong — and "live" needs a join an index cannot do.
`invoice_charged_on` is the one definition, read by that trigger *and* by the monthly run, so
a preview cannot offer a line the commit then refuses. The run itself is `runInvoices(…,
commit)`: preview and write are one path with a flag, like every importer here, and the
per-student action is the same call with `studentIds` set.

**An invoice is addressed to a payer — the guardian, or the student on the adult path — so
siblings land on one document.** `invoice_payer_membership_id` says it once; null means the
student is their own payer. Everything the document says about a person is a **snapshot**,
including each line's `student_tax_number`, which is not the payer's: a parent deducting
lessons on their IRS does it against the child's number.

**A document line stores the club's own words, never a translated enum.** `fee_plan` has no
`name` in this schema — a plan's label is its kind, its level and its frequency — so
`invoice_line.description` holds the level's or season's name, `lessons_per_week` the
frequency, and the sentence is composed by `LineLabel` where the catalogue is. Storing
"Mensalidade" would freeze a document at the language of whoever pressed the button.

**A document's state is `total − paid` and never a column.** `invoice_status` is the one
definition — credited beats paid beats overdue, and a partly paid document past its due date
is still overdue. A payment is a **child row** (`invoice_payment`), soft-deleted, summed on
every read, so recording one moves a badge without writing to the invoice; an overpayment
settles and `outstandingCents` floors at zero. A credit note is never paid, refused by a
trigger because a bank feed will be a second way in. **`due_on` may precede `issued_on`** — a
club billing October in December is ordinary, and 2.2's CHECK to the contrary was dropped
rather than replaced. **Chasing records what a person did, and what Poolse emailed.** A person's chase names its
channel; a reminder sent from Em dívida (POOLSE-86) is an `invoice_reminder` — the overdue
documents snapshotted, retried like every email — plus a chase per document with channel
`poolse_email`, which a person cannot record by hand. The history says whether the email left.

**Where families pay is one account per club, and an IBAN change is told to every owner.** POOLSE-94. `organization.payment_iban` / `payment_account_holder` / `payment_mbway_phone`, judged by `normalizeIban` + `ibanChecksumOk` and `normalizeMbwayPhone` in `@poolse/rules`, written only through `savePaymentDetails` (`billing/payment-destinations.ts`), which audits the before and after and, when the IBAN moved, writes a `payment_change_notice` emailed to the owners by its last four digits. A family reads `payTo` — destinations plus the reference, its open document numbers else the child's name — on its fee read and `/app`; `PaymentDestinations` (`components/payment-destinations.tsx`) is the one web rendering and `paymentMethodLines` the email's, in the same order. `docs/features/invoicing.md`.

**A fee line with no `fee_period_id` is charged once**, and only an inscrição or a seguro may
be one. The period is how a recurring line knows what an occurrence is worth and when the next
falls due; a fee paid once has neither, and forcing it to name one makes the arithmetic wrong
rather than redundant — the total is `amount × months`. Null means `amount_cents` is the whole
amount, months coalesce to 1, and the occurrence is `starts_on` itself. Every join to
`fee_period` from `student_fee` is therefore a LEFT JOIN: an inner one silently drops those
lines, which is how the register's "pago" tick nearly left a joining fee outstanding.

**An adult is the absence of a guardian edge, never a flag.** A student at or above the club's
`age_of_majority` with no live `guardian_link` is on the adult path; `student_is_adult_path`
is the one definition and every screen reads it rather than deriving it. An `is_adult` column
would drift the first time a birth date is corrected. A student with **no** birth date is on
the guardian path — guessing adult for missing data is the guess that cannot be recovered from.
The server also chooses the consent form and **validates it on the way back** with a 422: a
client cannot record a self-signed consent against a minor who has a guardian.

**A warning about a person never gates what a club does with them.** A student with no valid
seguro is flagged on their page and in the register and is enrolled, taught and marked exactly
as before. An instructor at the poolside cannot fix a seguro, and a register that would not
open over a piece of paperwork is a register somebody keeps on paper instead. Where the fact
has three states — insured, lapsed, never — say three sentences: a renewal and a family who
never bought one are different things to do.

**A partial unique index cannot join, which is why a snapshot sometimes carries a foreign
row's column.** `student_fee.kind` is the case: "one inscrição per student per season" is only
sayable with the kind on that row. Where that happens, a BEFORE trigger fills the copy from
its source when a caller does not send it — every existing caller predates the column, as with
`class_session.occurs_on` — and a constraint trigger refuses one that disagrees. A copy with
neither is a copy that drifts.

**The season is organization-scoped and already built; a screen picks from it, never keeps its
own.** `season` has the name, both dates, one `published` at a time and its own page under
Turmas, and it is wired into `generate_sessions`, `class_group`, `class_schedule` and
`facility_time_slot`. Anything that needs a season reads that list — the price list filters out
`archived`, because a year that has ended cannot be priced afresh.

**A personal tenant is `organization.kind`, read in exactly two places.** `/me` carries
`organizationKind` on each membership; the sidebar prunes by it (`kinds: ['business']` on an
item, alongside `roles`) and the dashboard swaps occupancy for `MyPoolPanel`. Nothing else
branches on it — a personal tenant is an ordinary tenant with fewer screens, which is what
decision 1 promised and slice 4.5 proved by staying small. `provision_organization` takes the
kind and opens a pool for a personal tenant and a season for a club; every caller that omits
it gets a club. Absence from the menu is a shape, not a permission: the API answers those
routes, and hiding them is not the control. `docs/features/personal.md`.

**`energy_meter.reads` says what a value means, and consumption is derived from it once, in
SQL.** `cumulative_index` is the dial and consumption is `value − lag(value)` over *live*
rows (falling back to `initial_index`); `interval_consumption` is the value itself. The one
definition is `CONSUMED` in `energy.repository.ts`, read by the list and the monthly rollup;
never subtract in TypeScript. `reads` is never edited — a wrong meter is retired and made
again, and a swapped dial is a new meter with `replaced_meter_id`. `energy_reading` has **no
surrogate id** — its key is `(organization_id, meter_id, taken_at)`, hypertable-shaped for
the day feeds arrive, and deliberately not a hypertable until then (decisions, 2026-09-11).
A dial running backwards is a trigger refusal carrying the neighbour in DETAIL, like
`pool_capacity`. `docs/features/energy.md`.

**The Energia page opens on a folded *Importar fatura* card and the club's dashboard (`GET /energy/summary`), and a meter says what it measures.** POOLSE-106. `energy_meter.carrier` (electricity | gas | water) splits bills; *this month* is the month a billing period ends in; cost per lesson hour and per swimmer are POOLSE-28's per-tank reports summed, never re-derived, and never added to billed euros; maintenance gets the dashboard with every euro withheld by the API. A chart of a few series is `StackedMonthBars` (`--chart-1/2/3`, legend, tooltip on focus, table view). Every automatic bill read is a row in `energy_invoice_read`, counted per month on /admin. `docs/features/energy.md`.

**Outside air temperature is stored context, and it never corrects a figure.** Slice 5.4b,
which closes POOLSE-28 AC 7. `facility_climate_month` caches the monthly mean per *site* — air
and not the water in `pool_analysis`, which sits at a setpoint all year and would correlate
with nothing. It is shown as a column in the chart's record and a sentence in the comparison
panel; **nothing is weather-normalised**, because a normalised headline is a model with
opinions wearing the clothes of a measurement. `heating_degree_days` is stored beside the mean
**with the base it used** (15.5 °C), so changing that constant later cannot silently re-mean a
year of history — nothing reads it yet, and it is stored because backfilling would mean
refetching everything. **`WEATHER_HISTORY_ENABLED` gates every call and is off by default**:
Open-Meteo's free tier is non-commercial, the URLs and key are env vars so the commercial move
is configuration, and both are on `docs/deploy.md`'s go-live checklist. A **daily cron**, never
a fetch on page load, one request per site for the whole window, upserted — the archive revises
recent days and `days_counted` says when a month is short. **The sweep reads tenants from
`poolse_platform` and facilities inside each tenant's own policy**; putting `facility` on the
platform grant would have been one line and is the kind of widening taken out loud.
`docs/features/energy.md`.

**A comparison compares only the months that have both years, and consumption and cost are
never one sentence.** Slice 5.4a. `monthlyConsumption` queries twice its window and pairs each
month with the row exactly `months` earlier — by index, never by recomputing a date, so there
is one definition of "the same month last year". **`yearOnYear` is computed over months where
both years have a figure** (and, for cost, where both were *priced*): a club with eighteen
months of readings would otherwise be told it had halved its consumption, and a rate
introduced this year would compare euros against nothing and call it a rise. A month with no
counterpart draws nothing — a missing counterpart is not a saving. **Where the implied unit
price moved** — each period's euros over its own kWh — the screen names both rates, so a
higher bill on flat kWh reads as the tariff it is; no threshold, because either the rate moved
or it did not. `ConsumptionBars` takes an optional `previous` per column and draws it
**outlined behind the solid bar**, so the two series differ in shape and not only in colour.

**What a tank costs per hour taught in it is a month divided by a month, and the screen says
so.** POOLSE-28, narrowed on 20 September 2026 — the ticket's 15-minute buckets, tariff bands
and DST arithmetic all need interval readings, and a club types **one figure a meter a month**.
`poolCostReport` in `cost-report.repository.ts` gives cost per lesson hour, per bather and per
m³ over twelve months. **A tank's cost is the meters whose `pool_id` names it** — the site's
"Geral" dial is never apportioned, because its kWh light the car park too, and a tank nothing
meters says so rather than reporting a share. **Taught minutes exclude `cancelled`, and
`class_group` is LEFT joined** — a parceria's hour heated the same water, and an inner join is
how partnership hours have silently vanished three times here. **A bather is an `attendance`
row with status `present`**; `late` was dropped by POOLSE-13 and a first draft that named it
typechecked and failed at runtime. **A month with consumption and no lessons is `unallocated`**
— not divided by zero, not dropped, and not redistributed onto the turmas that did teach. **A
turma's share is pro rata by hours with the last share taking the rounding**, so the parts sum
exactly to the whole, and its page reads that row rather than recomputing it. Owner and admin
only: what the bomba cost is maintenance's business, whether a turma earns its heating is not.
`docs/features/energy.md`.

**A meter with no fatura is costed by a tariff, and what comes out is an estimate that never
touches a billed euro.** 5.3's second half. `energy_tariff` is a €/unit rate **on the meter**
— not a club-wide named rate, because a club on two contracts has two answers — effective-dated
with one live rate at a time by the same gist exclusion as `staff_compensation`, `effective_to`
being the last day *at* that rate. `unit_price` is `numeric(12,6)`: the tariff is the
documented exception to integer minor units, and €0.1548 in cents is a 3% error in the module
whose purpose is cost accuracy. **A tariff may never be `actual`, by CHECK** — a euro that
happened is a fatura — so the derived cost is `estimated`, or `assumed` when the rate was.
**It is gross with no `vat_rate` and no standing charge**: nothing is invoiced from this
figure, and a potência contratada billed once for the whole ponto de entrega would be counted
again on every sub-meter behind it. `liveTariffJoin` in `tariffs.repository.ts` is the one
definition of "the rate that applied that day" and the cost is derived in SQL beside
`CONSUMED`, never in TypeScript. **A month any reading went unpriced is null, not a partial
sum** — a short bar and an incomplete bar look identical — and every aggregate reports its
coverage. **The estimate stays out of `/energy/costs`**, which sums faturas and must go on
summing only faturas; the two have separate sections and separate totals. Reading a cost is
the whole module, as a fatura already is; *setting* a rate is owner and admin.
`docs/features/energy.md`.

**A bill is filed whole and never edited; its two ways in share one form and one check.**
`energy_invoice` + registers + typed lines (5.3). `draftToBody` in `lib/energy-invoice.ts` is
the one place a printed "15,41 €" becomes cents — the model's answer and a typed figure
both pass through it — and `checkInvoice` on the API is the one place a bill is judged, read
by preview and commit alike. The parser (`energy-invoice-agent.ts`) is flag-gated and
supplier-agnostic: its prompt names concepts, never a layout. **Real bills never enter the
repo** — `test-fixtures/**/private/` is gitignored. `docs/features/energy.md`.

**A pool is a recinto of sport `pool`, and the pool's own trigger makes it.** POOLSE-122. `playing_area` sits between a site and its tanks; `sport` is a platform catalogue the app only reads. Insert a pool exactly as before — `pool_area_ensure` makes its recinto, `pool_area_sync` carries its name and archive both ways, and `class_group` / `closure` / `energy_meter` get `playing_area_id` by `*_area_from_pool`. Readers still read `pool_id`; never write a recinto by hand for a pool. `docs/data-model.md`, *Recintos*.

**A sport is switched on per club by Rui; the pool always is.** POOLSE-124. `organization.enabled_sports` stores what is **on** (default `{pool}`, the pool kept by CHECK), the reverse of `disabled_modules`; `POOLSE_SPORTS` in `@poolse/rules` equals the `sport` table by test. Only `poolse_platform` writes it, through `changeTenant` (`POST /platform/tenants/:id/sports`); a sport with live recintos is a 409 `sport_in_use` naming them, never archived for the club. A recinto of another sport is `POST /facilities/:id/playing-areas`, 403 `sport_not_enabled` unless `mayCreateRecinto`, and the database refuses one made or restored while its sport is off. `/me.sports` is the list POOLSE-125's menu reads. `docs/features/platform.md`.

**A level is on one sport's ladder, and a turma's level and season share its recinto's sport.** POOLSE-126, schema half. `student_level.sport_id` defaults to `pool` and never changes; names, age bands, `next_level` and `age_fit_level` are per sport; `class_group_sport_matches` refuses a mismatch. `season.sport_id` null is the shared season, and a sport in `organization.own_season_sports` (*Época própria*, never the pool) may publish its own; `season_scope()` says what a season reaches. No API path writes a sport season yet, so "the published season" is still one row — the screens half must add `sport_id IS NULL` to every such lookup when it opens one. `docs/data-model.md`, *Recintos*.

**A subscription covers one facility; the schema allows many.** These are two
different rules and both are settled. The *schema* keeps `organization 1 —— N
facility` — backlog story B4 proposed narrowing it and was rejected, because a
municipality with pools in two buildings would then need two organizations with
two staff lists and two invoices. The *licence* is what bounds it:
`organization.max_facilities` defaults to 1, is enforced by a trigger rather than
by the API, and a club with two sites buys a plan with two. Do not re-open either
half. The trigger exists because the application layer already forgot once — a
seed created a second site to keep demo data tidy and nothing objected.

**An archive is undone through the bin, and an archive that takes children lists them.** POOLSE-78. `RESTORABLE` in `archive/restorable.ts` is the one list of what can come back (ten kinds — a meet joined with POOLSE-81; staff, seasons and invoices excluded), and the bin reads each kind's own action from it, never a `*.archived` pattern, because the names are not uniform. An archive path that cascades writes `data.cascade` on its audit entry, including what an ended enrolment *was*. A restore brings back exactly that list, or for an older entry the rows sharing its timestamp (`cascadeAt`). A new archive path for a listed kind keeps the cascade test green. **An archive answers with `archiveEntryId` and its action returns `undo`**, so `useSavedAction` raises the toast with *Anular* (`useArchiveUndo`), which calls the bin's own restore. An action whose success removes the page returns `redirectTo` rather than calling `redirect()`, which would swallow the toast. `docs/features/archive.md`.

**An edit records what it changed, and a revert goes through the edit's own path.** POOLSE-80. A write path for a student, a turma or a register mark builds `{ before, after, withheld }` with `describeChange` and a `ChangeSpec` (`audit/change.ts`): valued fields can be reverted, `shown` ones (money) never, and `withheld` ones (a person's name, phone, e-mail, NIF, notes) are named without their values, because the log is readable by every admin. Lock the row and read it before the UPDATE. `POST /activity/:entryId/revert` calls the entity's own `…In(tx, …)` function, never an UPDATE of its own, and that call writes an ordinary entry carrying `revertOf`. A field changed again since is a 409 `revert_conflict` with the three values. A new revertible entity needs a `ChangeSpec`, its `…In` function and a line in `REVERTIBLE`. `docs/features/archive.md`.

**A time states its pool, and a best is per stroke, distance and course.** POOLSE-81. `student_record.course` is `scm`/`lcm`, null meaning *não indicada* (never guessed, never counted as either); every bests query and chart groups by it. A result naming an official `swim_meet` is official, and the official best is shown beside the overall one. `student_level.competitive` marks the pathway inside the one ladder — the FPN's age groups are never `student_level` rows. `student.federation_licence` is identity (`withheld`, cleared on anonymisation). `docs/features/students.md`.

**A meet's results come from a LENEX file read on a server by `@poolse/rules/lenex` (its own subpath: `node:zlib` stays out of client bundles), and only the chosen club's swimmers reach the API.** POOLSE-81 slice 2. `POST /meets/import` is preview and commit on one path; the commit is one transaction. Matching is licence, else name + birth date proposed and confirmed — never name alone, never a student created; the re-import key is meet, student, event number and round. The parser refuses DOCTYPE/entities, nested or multi-`.lef` archives and an inflate past 40 MB. `docs/features/students.md`.

**A results file can also arrive by email, and the inbox is the import's door, never a second import.** POOLSE-114. `receiveResults` (`meets/meet-inbox.repository.ts`) is the one receiving path, called by `POST /webhooks/resend-inbound` (Svix-signed) and the staging-only `POST /webhooks/inbound-dev`. The club is `meet_inbox_organization(token)`, the sender a live owner, admin or instructor by `From`; anything else is dropped, logged, never answered and never written. *Importar* sends `inboxId` through the ordinary `/meets/import`, which marks the row in its own transaction. No notice is sent: the menu badge (`badge` on a sidebar item, counted by the layout) is the signal. `docs/features/students.md`.

**A backup is proved by restoring it, and the key that opens one is never in GitHub.** POOLSE-89. `packages/db/scripts/`: `backup` (one snapshot for the dump and its manifest, age-encrypted, 30 days), `check-backups` (keyless, daily in GitHub), `restore-drill` (on Rui's machine, with the age key and `SENSITIVE_DATA_KEY`), `restore` + `verify-restore` (the runbook in `docs/deploy.md`). **A function used by an index or a constraint calls our other functions as `public.<name>()`**: `pg_restore` rebuilds them with an empty `search_path`, and `test/restorable.sql` fails the one that forgets. `pnpm --filter @poolse/db backup:test` is the full drill against Docker and S3Mock.

**A departed student's data expires, and `apply_retention()` is the only thing that expires it.** 7b.8, Rui 16-10-2026: health data 1 year after `student_left_on()`, identity 5 years after. The function is `SECURITY DEFINER` because the data sits in tables closed to the app, takes no arguments and acts on `current_organization_id()` only. A new table holding a student's health data or identity earns a line in it and in `retention.integration.test.ts` — or, as the FPN licence, the opt-out list and invoice reminders do, a trigger on the anonymisation (a `SECURITY DEFINER` helper that acts only on `current_organization_id()`, granted to the app, because a staff edit fires it too). Invoices keep their snapshot for the ten years tax law asks. `docs/features/retention.md`.

**A closure is one site or some of its tanks, and what it reaches is `closure_reaches` / `session_reach`.** POOLSE-84. Only a holiday leaves `facility_id` null; a manual closure without a site is refused by CHECK and by the API (422). Several tanks are one row each, sharing `batch_id` (the warning reads the batch). A session's tanks are its turma's pool **and its lanes' pools** — a parceria or free-swim block has no `pool_id`. Half days cut at `closure_half_day_cut()` (13:00, on a lesson's start), written nowhere else. Every reader goes through `apply_closures`, `release_closures`, `closure_impact`, `closure_day_shut` (day-level questions: every closure of the day together, so a morning and an afternoon shut it — sweep 19-10b; `closure_shuts_day` is one closure's own answer) or `pool_closure_at` / `pool_closures_on` (check-in refusal, "Encerrado até"); never a hand-written `c.pool_id = cs.pool_id`. They act **from the club's today on**, never on the past; generation skips a lesson with a register; lifting restores only a live slot's lessons, one at a time, then tops the season up; a one-week move into a closure is refused by the server (`occurrenceClosed`). A holiday shuts every tank, free swim included (Rui, 19-10-2026). `docs/data-model.md`, `docs/features/calendar.md`.

**A gap to qualify is `qualifying_gaps()` in SQL, and an FPN age group is never a `student_level`.** POOLSE-85. **In Portuguese, *escalão* means only the FPN's age group**: the teaching ladder is *nível/níveis* and a sócio quota's age band is *faixa etária* (Rui, 20-10-2026). The FPN's groups, the meets and the mínimos live under Alunos → Competição, each its own route (`/students/provas`, `/provas/minimos`, `/provas/escaloes`). The club types each championship's entry times (`qualifying_standard`, `qualifying_time`). The FPN's bands (`federation_age_group`, per season, birth years and gender) are the one FPN table Poolse ships (POOLSE-111, Rui 23-10-2026, reversing 19-10): `fpnAgeGroups(seasonEndYear)` in `@poolse/rules`, created in one click (`POST /qualifying/age-groups/fpn`) and the club's own to edit after. A year is picked on `YearWheel` (`components/year-wheel.tsx`), never a four-digit text box. A valid time is the same course, an official live meet, inside the window — never converted — and a band is derived by `federation_age_group_admits()` from birth year, never stored. A typed swim time goes through `parseSwimTime` in `@poolse/rules`, which the grid and the API share. **Which swims count is `qualifying_attempts()`** (POOLSE-115), one row per entry time × valid swim; the gap is its fastest row, and a meet's *Mín.* is every attempt at or under the entry time — never a second WHERE clause. `docs/features/students.md`.

**A child advances by skills or by age, through one queue, and a job that writes as the club runs `asSystem`.** POOLSE-112. `transfer_proposal.reason` says which; `propose_age_advancements()` queues the age ones when a season is published (inside `publishSeason`) and from the queue's *Propor*, into `age_fit_level()` — the first level above whose band fits, never down. `organization.advancement_mode` (`propose` default, `apply`) is set on Níveis; `apply` is `AdvancementApplyService`, nightly, moving the level through `setStudentLevelIn` and leaving the proposal `pending` with `applied_at` set, so the turma is still picked by a person. **A tenant-level job that writes through request-path functions wraps the work in `asSystem(organizationId, …)`** (`tenant.context.ts`): no membership, no roles, and `recordAudit` writes a null actor (*Sistema*) — never a borrowed owner. The family is told by `level_change_notice`, the `payment_change_notice` shape. `docs/features/students.md`.

**Every unique constraint on a soft-deletable table is partial** (`where archived_at is
null`). Otherwise archiving an instructor and re-adding them next season violates the
constraint against a dead row.

**Every handler refuses by role in its first line; there is no global role guard.** Security
review, 12 October 2026. A guardian or a student holds a full tenant context (owners, admins and
instructors can invite them), and 31 handlers answered them: the whole register, every parent's
and every staff member's contacts, NIFs and addresses, a colleague's medical leave, partner
prices, and two writes. Staff routes start with `requireRole(...)`, and `hasRole` computes a flag
but refuses nothing. A child's own pages (record, timetable, calendar, progression) use
`requireActsForStudent` (`students/student-access.ts`): staff pass, a family only for its own
child, and anyone else gets a 404. A picker that non-office staff need gets a names-only endpoint
(`incidents/people`) rather than reopening the register. `security/role-probe.integration.test.ts`
calls every route as an unlinked guardian and as a student. **A new endpoint is added there in
the same change.**

**A circle means something needs doing, and it clears when it is done** (POOLSE-120). `GET /attention` is the one read: `readAttention` is cached per request and shared by the layout and the page. It counts only for roles that can act, in modules that are on, and reuses the existing verdicts. A new kind of circle is a branch in `attention.repository.ts` plus a `badge` key or an `AttentionDot`, never a second definition.

**The menu's entries live in `lib/nav-entries.ts`** (POOLSE-118). The sidebar, the phone's menu and the Ctrl+K palette all read it through one filter, so a new page is one entry there. A palette action is one line in `ACTIONS` (`lib/commands.ts`), and its synonyms sit beside it, never in the catalogue.

**A menu entry is shown only to the roles its page's API answers, and maintenance outranks instructor.** 15 October 2026, Rui's call. `app-sidebar.tsx` gives each entry the roles of the route its page loads (`STAFF`, `TEACHING`, `OFFICE`); `unlessRoles` hides a shortcut from a role that reaches the page another way. A list page says *not allowed* on a 403 and *no organization* only for the `no_organization` code. `MEMBER_ROLES` is owner, admin, maintenance, instructor, guardian, student. Permissions stay the union; the order only decides which role leads (badges, `leadRank` in a dashboard band). Maintenance writes the inventory (`INVENTORY_EDITORS`) but archives nothing. `docs/features/navigation.md`.

**A family reads its own child's record through the staff page in `familyView`.** 15 October 2026. `GET /family` lists a person's own records. `GET /students/:id` and `GET /students/:id/fees` answer the child's guardian or the student with the club's notes, a co-guardian's contacts, discount reasons and the office's offers left out. A family reads a lesson plan only for a class its child was enrolled in that day (`familyMayReadPlan`). **What a student owes is `balance` on the fee read, computed once in `billing/fee-balance.ts`**, and every screen reads it rather than adding lines up. **The dashboard's personal band (slice 5) is about one child**, chosen by `?child=` from the reader's own records (a stranger's id is a 404); with nobody, there is no band. Its water card is `me.water`, because `me.pool` names the personal tenant's own panel. `docs/features/students.md`, `docs/features/dashboard.md`.

**A permission about a *row* is a repository answer, not `requireRole`.** "The instructor
responsible for this turma" cannot be written as a role, so the repository resolves the row,
decides, and the controller turns a refusal into a 403 — while the read endpoint returns the
same answer as `canEdit` so the screen and the guard cannot disagree. See `lesson-plans.repository.ts`.

**A site's page configures the club; the Instalações list is everybody's.** 15 October 2026, Rui's call. `GET /facilities/:id` is `SITE_PAGE_ROLES` (owner, admin, maintenance; support is admin), and the page shows maintenance only Espaços, Manutenção and Energia. The list carries `canOpenSite` and `canOpenPools` so it never links to a page that will refuse. A new site-page tab is `visible: loaded.canManage` unless it is maintenance's daily work. `docs/features/facilities.md`.

**An Admin sees every staff member's pay except the Owner's, and the card says so.** Salaries
are the first table whose visibility differs *between* two management roles, and the rule is a
question about a row, so it lives in `compensation.repository.ts` — one predicate feeding the
list, the history, the roll-up and every write, never an RLS policy: RLS answers "which tenant"
and a role test hidden in one would leave the API unable to tell 403 from 404. The Owner is
**absent** from an Admin's list rather than blanked, and an Admin may not *write* that rate
either — a POST whose result you cannot read is a way to overwrite what you may not see. An
Admin's total is therefore a different number from the Owner's for the same club, which the
roll-up states in visible text whether or not a rate is set: an unexplained absence reads as a
zero. **Amounts stay out of paths, query strings, logs and the audit trail** — `audit_log`
records who changed whose rate, and the effective-dated table is the record of the figure.
**`effective_to` is the last day at that rate**, so the exclusion constraint ranges over
`effective_to + 1`; a bare `daterange(from, to)` admits two live rates on the closing day.
**Monthly ↔ hourly is derived at read time in `@poolse/rules`, never stored**, and unknown
`weekly_hours` is a dash that contributes nothing — a total that reads unknown hours as free is
one an owner would act on. `docs/features/salaries.md`.

**A partnership group's days are written by one path, all or nothing** (POOLSE-117). `placePartnerDaysIn` (`facilities/partner-days.repository.ts`) backs the calendar's *Colocar aqui*, the Turmas card's *Adicionar dia* and the partnerships import. Any refused day writes nothing, and the 409 lists every day; `partnerClashSentence` (`lib/partner-days.ts`) says each one. A sheet's days are read by `partner-days-sheet.ts` in either language, and a range is refused, never guessed. `docs/features/parcerias.md`.

**A turma is chosen in `TurmaPicker` (`components/turma-picker.tsx`), never a `<select>` of joined strings.** POOLSE-110: grouped by level with the requested level first, searchable, a row per turma with slots, instructor and a fill bar with its figure, a full turma pickable only where `allowFull`. A caller with a better grouping than level gives every row `group: { key, label, order }`; the rows then keep their given order (POOLSE-113, the advancement queue's rank reasons). Used by Pedidos and the advancement queue; the app's enrolment swaps to it next. A control inside a dialog that closes itself on Escape marks itself `data-own-escape`, and `Dialog` leaves the key to it.

**A document on paper is a route with print styles, never a PDF library** (POOLSE-54, -115): black on white, `@page` for A4 and its margin footer, `PrintButton` and `AutoPrint` from `components/`, its own components rather than the screen's with a print patch, and an entry in `check-layout.mjs`. A print page with options opens the dialog only on `?print=1`, so changing an option does not reopen it.

**A cancelled lesson tells its families, and push is a second channel on a recorded notice.** POOLSE-90 slice 4.
- The cancel records a `session` message in its own transaction (`recordNoticeIn`) and delivers it after commit (`deliverNotice`).
- That message is exempt from the daily ceiling and the opt-out. *Anular* announces *a aula mantém-se*.
- Push (`push/push.ts`) is off unless the three `VAPID_*` variables are set. It goes once, to the people the message reached, and the email is what is retried.
- `public/sw.js` has no `fetch` handler, ever.
- The switch prompts only on a tap.
- The four pushed kinds (slice 4b) are: a cancelled lesson; a closure warning; a one-week move within the next 7 days (`moveIsNearIn`); and the stand-in, which is push only on its assignment.
- A new pushed kind is a recorded notice first, then `pushTo`. Tests route pushes through `usePushSenderForTests`.
`docs/features/app.md`, `docs/features/messages.md`.

**Who answers for a child is `family_may_answer()`, and *Vou / Não vou* is a notice, never a mark.** POOLSE-90 slice 2. The rule is a live guardian, or the student's own login from `self_answer_min_age()` (12) or on the adult path. With no birth date it is never a guess. Both `session_notice` and lesson feedback read it. A notice is one row per (session, student), audited. Its trigger refuses a lesson that has started, a cancelled one and one with no turma (409 with its code). The register shows a notice as a neutral chip and a count, and pre-marks nothing. The instructor home `/app/aulas` reads the dashboard band's `readMyWeek`. The maintenance home `/app/manutencao` (slice 3) reads the band's own queries whole (`limit: null`), and its one-tap actions call the backoffice's endpoints. **A one-tap action whose row leaves the list returns its toast and does not `revalidatePath`**: the re-render would unmount the button before its toast. `docs/features/app.md`.

**What a family says after a lesson is `lesson_feedback`, admitted by its trigger and read by who taught it.** POOLSE-116. The trigger refuses feedback on a lesson that was cancelled, has not ended, or where the student is not marked present, and refuses it after `lesson_feedback_window()` (7 days). Each refusal carries its code in DETAIL, which the API answers as a 409. It is keyed on `(session, student)`, never on `attendance.id`, so a register correction never fails over a comment. Staff read it under `resolved_instructor_id` (owner and admin read all), and the office archives it through the bin. A mood is `MoodFace` (`components/mood.tsx`): an outlined face plus its word, never a fifth colour system. `docs/features/app.md`, `docs/features/students.md`.

**A question asked in the middle of the page uses `components/ui/dialog.tsx`.** It portals
to the body, so no ancestor's `overflow`, `transform` or `z-index` can clip it; it closes on
Escape and on the backdrop, moves focus in and gives it back, and keeps Tab inside itself.
Never render a confirmation in place of its own trigger — round 5's did, which put a form
inside a calendar cell one seventh of a column wide. Never `window.confirm` either: two
confirmations in two visual languages make an operator wonder whether they are being asked
the same thing. `initialFocus` starts it on the primary answer where Enter should accept (a
dropped file's "read it"); the calendar's move-scope chooser is the one exception, a popover
anchored to the block it asks about.

**A refusal that needs numbers carries them as structure, never as prose.** A rule enforced
by a trigger raises with a machine-readable `DETAIL` (`pool_capacity|40|32|12`); the API
turns that into a 409 with the figures as fields, and `FormState.values` carries them to
`t(key, values)`. Do not re-derive the numbers in TypeScript to build the sentence — two
implementations of one sum agree until the day they do not. See `pool_capacity_respected`
and `poolCapacityRefusal`.

**A column-mapping importer uses `useImportWizard`.** The four-step machine —
upload, map, preview, commit — lives in `lib/use-import-wizard.ts`, generic over the field
type. A new importer supplies its own preview rendering and nothing else. The calendar's
(a grid layout, no columns) and the water log's (matches in the browser, no model call) are
deliberately not callers.

**A document importer is an `AnalysisReportParser`.** A file with no columns — a
laboratory's PDF, a photograph of a log — cannot have a mapping step, so it is read by a
parser that answers in the *same field names* the mapping step produces and joins the
ordinary validate–preview–commit path. Two ways in, one pipeline. Every such parser is
optional and off unless its own flag and `ANTHROPIC_API_KEY` are both set, sends the
document and nothing else about the tenant, and has everything it extracts confirmed by a
person on the preview. `lib/analysis-report.ts` is the contract; `-agent.ts` is the model. A water report's row is filed by what it holds (`reportDestination`, POOLSE-101): an organism count makes it a lab result through `/lab-results/import`, chemistry alone a reading. Since 29-10-2026 a lab result's chemistry is also a reading (`pool_analysis.lab_result_id`, written in `createLabResultIn`, archived with it by trigger), so a good report clears the warning; a file dropped on any water section is held in `lib/pending-file.ts` and read in Laboratório.

**A list importer takes a PDF by `readSheet(file, { pdf: true })`, and the PDF becomes a
spreadsheet.** 12 October 2026. `lib/pdf-table-agent.ts` transcribes the document's tables into
the same header and rows `readSheet` returns for a workbook, and the importer then maps and
previews them as it does any file. It transcribes and never interprets. It is behind
`PDF_TABLE_AI_ENABLED` plus `ANTHROPIC_API_KEY`, and with it off the importer says so
(`pdfDisabled`). It is opt-in per importer: alunos, horário, parcerias, salários, inventário and mínimos
take PDFs, while the water log keeps its own lab-report parser. It uses structured output, not a
forced tool call, because the current Opus refuses `tool_choice` `tool`.

**An importer is a `MatchSpec`, never a new pipeline.** There are seven — the register, the
store room, the wall timetable, the water log, parcerias, the pay list and mínimos (whose fields are
built at read time, one per FPN age group: `lib/qualifying-sheet.ts`). A new one is a field list, a
synonym list and `matchFields` in `lib/<thing>-sheet.ts`, plus a preview/commit pair on one
API route with a `commit` flag. Never two routes: what the operator was shown and what gets
written have to come from one code path. The file is read on the Next server and never
leaves it.

**What an export writes, its importer reads back — and a test proves it against the real
catalogue.** The header row is `<thing>.field.*` from the translation catalogue, not prose
invented for the file, so a club exports, corrects and re-imports with no column mapped by
hand. Two rules fall out of it. **Any value that has to survive the journey is written in a
form that is the same in both languages** — the inventory's `all`, a partner type's own enum
spelling — because a file exported under `en` re-imports under `pt-PT`. And **a label chosen
for the export is a label the matcher must not hand to another field**: `partners.field.contactName`
is "Contacto" rather than the partner screens' "Nome", because a bare "Nome" is what claims
the entity's column. `tsc` has no opinion about either, so the guard is a round-trip test
reading `messages/*.json` from disk — `partner-sheet.test.ts` is the shape.

**A round trip changes nothing.** Exporting a list and importing it back must produce a
preview of stocktakes with nothing to update, and a commit that writes no rows. It is the
cheapest end-to-end assertion an importer has, and it fails on a dropped field, on a value
written in a shape the reader parses differently, and on the two sides disagreeing about
what one row is. `partner-export.integration.test.ts` caught one of those.

**A file of money is the one importer that commits whole or not at all, and its export
carries the contract rather than the derived figures.** Salaries — POOLSE-59. The other five
commit what they can and report the rest; a pay run's half-applied import is somebody's wage
and nothing on screen says which half, so every included row goes in one transaction and a
line the constraint refuses at the last moment rolls the lot back and names the line. The
export writes what somebody *agreed* — type, gross amount, contracted hours, pay periods,
start date — and never the monthly/hourly pair the screen shows, because one of those is
always an estimate and re-importing an estimate as an amount turns a rounding into a pay
rise. **One person twice refuses the whole file**; which row is their pay is not a guess.
**Matching is by e-mail or checksum-valid NIF and a NIF column is claimed by its heading,
never by its shape** — nine digits is also a Portuguese phone number, and a phone read as a
NIF attaches a rate to the wrong person rather than to nobody. **`parseSheetCents` normalises
a cell (symbol, thousands separator, either decimal mark; the *last* separator is the decimal
one) and hands it to `parseCents`**, which is what the typed form uses — widening `parseCents`
itself would make every price field accept "35 €", a refusal pinned by a test. The write goes
through `applyNewRate`, the same function the form calls.

**A qualification's colour is `qualification_status()` in SQL, read through `qualification_current`.** POOLSE-27 (7b.2). Verde, âmbar, vermelho from the expiry, the window (club's, or the type's) and `club_today()`; *em falta* is the fourth state, an instructor with no record of a required type, derived from the absence. A person's standing is their latest live record; records are archived, never edited. **It warns; it blocks only where a club switches a type to `blocks_assignment`**, and then only a *new* turma or booking instructor, by trigger, never a stand-in and never on a missing record. Alerts are `qualification_alert` rows, once per crossing by unique index, emailed after commit by a daily job. `QualificationStatus` is the chip — outlined, a shield per state, words and date always. `docs/features/staff.md`.

**A person's photograph is `IdPhoto`, and it has three homes** (Rui, 28-10-2026). Your own is Clerk's (`own-photo` → `PUT /me/photo`, re-read with `refreshFromClerk`). A staff member with no login is `membership.photo_file_id`, and one with a login sets their own. A student is `student.photo_file_id`, filed and read only with a live photo consent, checked in `PHOTO_KEY` and again in `openFile`. `docs/features/files.md`.

**A health-data file is sealed: its own key, wrapped, on its row, and the bucket holds ciphertext.** POOLSE-109. `sealFile` / `openSealedFile` in `sensitive/envelope.ts`; `SEALED_PURPOSES` in `files.repository.ts` and the `stored_file_sealed` CHECK name the purposes (`medical_certificate`, and `incident_attachment` ready for POOLSE-70). `storeFile` seals, and `openFile` audits `file.read` and opens. Retention destroys the wrapped key (crypto-shredding), never the object. A family uploads health files only through the record's own one-step route, never `POST /files`. The atestado is `medical_leave_certificate` + `student_medical_leave.document_file_id`. A coach gets `certificate.file === null`. `docs/features/students.md`.

**An incident's facts are columns and its words are ciphertext the database refuses to hold as
prose.** POOLSE-70. `incident` (when, where, who, emergency, lifeguard on duty) is read by any
staff member. `incident_detail` and `incident_addendum` hold text encrypted by
`sensitive/cipher.ts`, and a CHECK refuses anything that is not that shape. Reading the words is
Owner/Admin or the author, decided per row, and every read writes `incident_detail.read` to the
audit log in the same transaction. All three tables are insert-only by grant, bar archiving, and
a correction is an addendum. `docs/features/incidents.md`.

**A public page reads through one `SECURITY DEFINER` function keyed on a token, and nothing else.** POOLSE-71. `public_water_page()` takes the token and returns a fixed key list — never "look the tenant up, then `withOrg`", which is a second cross-tenant read path, and never a looser RLS policy. The API route sits in `PUBLIC_ROUTES` (`public/(.*)`), is throttled **per token** (`publicWaterTracker`: the Next server is one address for every visitor), builds its response field by field, and answers every kind of miss with the same 404. The web page lives in the `(public)` root layout, outside Clerk and the app shell, translated with `createTranslator` and `?lang=en`. The token is stored retrievable — it is printed on a wall — and revocation is immediate. `docs/features/maintenance.md`.

**Every public page carries the complaints book and the operating regulation in force.** POOLSE-73. Use `PublicNotices` (`components/public-notices.tsx`) on any new public page. A private operator's link is `LIVRO_RECLAMACOES_URL` (DL 156/2005 art. 5.º-B), and a public service gives its own (`organization.complaints_url`, DL 135/99). A regulation is versioned by publication and never edited (`facility_regulation_current`, Portaria 454/2023 art. 46.º). **A column-level GRANT needs the table-wide privilege revoked first**, because the default privileges hand `poolse_app` a table-wide UPDATE that a column grant does not narrow. Pair every `GRANT UPDATE (col)` with a `REVOKE UPDATE` and a SQL test that tries the other columns. `docs/features/public-notices.md`.

**A public write goes through one `SECURITY DEFINER` function keyed on the slug, and answers the same whatever happened.** POOLSE-69. `submit_lead()` and `public_lead_form()` are the pre-registration form's whole boundary, the `public_water_page()` pattern applied to a write. The POST answers 202 to a honeypot, a stale stamp (`form-stamp.ts`), a noisy origin, an unknown or closed club and a database failure alike. Only a malformed body gets a 400, and that is decided before any club is looked at. A club opens its form (`public_registration_open`, Owner only, off by default), and its address is `organization.slug`. **A slug a club has used stays that club's for ever** (`slug_claim`, 13-10-2026 sweep), because a printed poster must never reach another club. A forwarded visitor address (`x-poolse-client-ip`) is believed only beside `WEB_PROXY_SECRET` (`leads/visitor.ts`). An aula experimental is `lead.trial_session_id`, counted by `session_free_seats()`; a new kind of guest in a session goes there too. Converting a lead calls `parseStudent`, `insertStudent` and `insertEnrollment` in one transaction, never a second insert path. `docs/features/registration.md`.

**A family may stop a club's general messages, and nothing else.** POOLSE-86 3.0c. `email_preference` is one row per (club, address): a random `token` (made by the send, in its own transaction — delivery only reads it) and `messages_opted_out_at`. `message_recipients()` now wraps `message_recipients_all()` and adds `opted_out`, true only for a non-`closure` audience, so preview and send leave the same addresses out and the preview counts them (`optedOutCount`). The way out is the footer link `/email/<token>` — no login, two definer functions keyed on the token, the `public_water_page()` pattern, throttled per token — or *O meu perfil*. Closure warnings, reminders, alerts and account mail never read it. `docs/features/messages.md`.

**A message to families is a record first and an email second.** POOLSE-67. `message_recipients()` is the one definition of who a message reaches — active enrolment in a live turma, live guardians else the student — read by the preview and the send alike, and the send is **one statement**, so the count confirmed and the rows written share a snapshot. Names and addresses are snapshots; `delivered_at` null is said in words; email leaves after the commit (`deliverMessage`, never awaited by the request). **20 messages / 2,000 addresses per club per Lisbon day**, a trigger under an advisory lock with its figures in DETAIL. A message is archived, never edited — column grants, as on `invoice`. An instructor writes to `myTurmaIds` only. `docs/features/messages.md`.

**A free-swim sale is an invoice line, and who is in the water is `pool_occupancy()`.** POOLSE-68
slice 1. `invoice_line.pass_id` sits beside `student_fee_id` (exactly one is set, by CHECK); a
credit on the sale line voids the pass, and `pass_current` derives entries left, expiry and void,
so there is no counter. An anonymous single entry is a document with **no payer**: `payer_name` is
null and the screen says *Consumidor final*. Anything that reads `invoice.payer_name` or a line's
`student_*`/`kind` must handle null. The payment is recorded with the sale. `pool_occupancy` counts
check-ins inside the site's `free_swim_stay_minutes`, plus classes running now by enrolment (never
by ceiling), with `class_group` LEFT joined. The check-in trigger reads it under the pool lock, and
it is the number reception, the refusal and the `mgmt.freeswim` card share. Owner and admin only.
**A free-swim block (`free_swim` subject) is water held for the public, not a class**: it has a
stored, editable title, no register or instructor, counts zero in occupancy and is left out of
the dashboard's classes and *sem professor*. A new reader of sessions or bookings must leave it
out the same way. Pass revenue is its own figure (sales not since credited) and is never summed
with mensalidades. `docs/features/reception.md`.

**Capacity rules compose, they do not override.** An enrolment must fit its turma
(`class_group.capacity`), the turmas sharing a slot must fit the tank (`pool.max_capacity`),
and `lane_level_capacity` is a separate teaching judgement. A null ceiling means "not
measured" and enforces nothing — never treat it as zero.

**Light and dark mode in every app**, from the first component. Colors come from tokens;
no literal hex in components. **The `dark` class on `<html>` has one owner** (POOLSE-99): the pre-paint `ThemeScript` on a load and `applyTheme` on a choice — never a root layout's `className`, which a stale render puts back. The header's theme control is a three-option menu (`theme-toggle.tsx`), and `setThemeAction` always revalidates. `docs/features/preferences.md`.

**Palette.** Backoffice and desktop web: primary `rgb(103, 166, 182)`, complementary
`rgb(179, 212, 157)`. Mobile apps run sportier — soft orange with pool blue. Mobile
palette is explicitly allowed to move during development; the desktop one is not. **Text reads an ink, fills read the token** (Rui, 15 October 2026): `--primary-ink`, `--success-ink`, `--warning-ink` and `--danger-ink` are each fill's own hue darkened past 4.6:1 on white, and `theme.extend.textColor` maps `text-primary` and friends to them, so links and warnings are AA while every button, chip and border keeps the settled fill. **Text on the primary fill is the dark foreground ink** (`--primary-foreground`, 6.6:1; Rui, 28-10-2026), in both themes — white on it was 2.7:1. A new status colour gets its ink in the same change.

**Money and readings are never floats.** Amounts in integer minor units. Sensor readings
in `numeric` with an explicit unit column — pH, °C, ppm and kWh do not share a type.

**Times are stored UTC, displayed in the facility's timezone.** Class schedules are the
place this bites; get it right once in the scheduling layer.

**A typed moment is the facility's wall clock, and "today" is `club_today()`.** A
`datetime-local` value goes to the API as typed and is resolved there in `facility.timezone`
(`facilities/sample-moment.ts`: `resolveSample` for a pool, `localInstant` for a meter or a
task) — never `new Date(raw)` on a UTC server. In SQL, a day is `club_today()`, never
`current_date`, including column defaults. 13-10-2026 sweep.

**Voltar goes back to where you came from, and every in-app link is a `FromLink`.** POOLSE-91 (Rui, 22-10-2026). `components/from-link.tsx` stamps the current path and query as `?from=` on a link to another page, and carries the page's own `from` on a link to itself (a tab, a page, a filter). A record or form page sets `back` with `backProp(backTarget(from, parent), t)`; a page the sidebar opens uses `originBack(from)` and has **no** Voltar when opened from the menu. A new destination earns a label in `LABELS` / `RECORDS` in `lib/back.ts`. A plain `Link` is left only where the link *is* a way back or a menu entry (`BackLink`, the sidebar, a wizard's closing button). `docs/features/navigation.md`.

**A record's page uses `DetailPage`; one card is one tab, and the first is General.** The tab
is `?tab=<slug>`; each tab's `content` is a function and only the active one is called, so a
tab nobody opens costs nothing — except a list whose null-on-refusal decides whether its tab
exists, which runs with the page. Hide a tab with `visible` from an existing `can*` flag or
refusal, never a new role list. Cards keep their own saves; `DetailTabs` notices typing in a
posting form and asks before it is lost. `docs/features/navigation.md`.

**A page or tab that stacks independent sections shows one at a time, behind `SectionPills`.**
Rui's standing call, 12 October 2026: the reader scrolls as little as possible. The pill row is
`components/section-pills.tsx` (`?section=`, a link per section, `pickSection` to fall back,
`sectionHref` to keep the other query params and drop `page`). A section the reader may not see
is not offered. One flow (a summary above the list it sums, a document, a form) stays whole, and
so does an overview meant to be read at a glance: the dashboard bands and the calendar are
deliberately not split. A page that already has a view switch (Faturação's `ViewTabs`) extends
it rather than adding a second row. **The pill row sticks under the page's header** (POOLSE-92): `StickyUnderHeader` measures whichever `PageShell` block is sticky (`data-page-sticky`) and parks beneath it, and below `md` the row is one scrolling line. A new sticky header block in `PageShell` carries `data-page-sticky` too.

**One content width, and the calendar is the single exception.** `PageShell` caps every page
at `max-w-page`; `width="wide"` exists for a screen whose content is a grid rather than prose,
and the calendar is meant to stay its only caller. A second caller is a decision to take out
loud, not a tidy-up — if a third appears, ask what those pages have in common instead of
widening them one at a time.

**A dated grid is drawn from minutes, not from rows.** The calendar places blocks at
`top = minutes × PX_PER_MINUTE` from `lib/calendar-scale.ts`; a slot-as-table-row makes a
45-minute class in a 60-minute slot read as an hour. One scale constant, shared by the
blocks, the now-line, the drag maths and the auto-scroll — a second one is how they stop
agreeing. `calendar/calendar-grid.tsx` is the dated week; `classes/schedule-board.tsx` is
still the recurring pattern, and they are deliberately two components.

**A week's class can differ from its pattern, lanes included.** `class_session` carries the
one-week answer — `moved_at`, its own `instructor_membership_id`, and its own rows in
`class_session_lane` — and `class_schedule` carries the pattern. So the calendar's scope
popover offers both answers for *every* change, sideways included; the earlier "a lane change
is always every week" was a limitation of the endpoint, not a rule. `moveOccurrence` takes
`laneIds`, where **absent means "I did not ask about pistas"** and an empty array means "in
no pista this week" — collapsing the two makes a plain time change silently unassign lanes.
It takes `durationMinutes` on the same contract, and for the same reason: without it a resize
answered "só esta semana" wrote the hour and dropped the length, so the block sprang back and
the gesture looked inert. Never write `ends_at` alongside it — a BEFORE trigger derives it
from the start and the duration, and the lane exclusion guards a window built from those two.

**`class_session` has no `archived_at`; it has `status`.** A session ends as `cancelled`,
which is what attendance and invoicing rest on. `cs` means `class_schedule` in most of this
codebase and `class_schedule` *does* have the column — so a query that means the session and
copies the habit raises `42703` at runtime and nothing catches it: `typecheck` does not read
SQL and `sql:check` only looks for backticks. **A repository function with no integration test
is untested SQL** — the whole stand-in feature shipped dead this way, and the browser's
`.catch(() => null)` presented it as a dropdown greyed for ever.

**A fetch that answers `null` for both "not yet" and "it failed" produces a control that is
disabled with no explanation.** Keep `loaded` as its own state, and say what went wrong with a
way to retry. `stand-in-picker.tsx` is the shape. **On a server page, a best-effort load returns `Outcome<T>`**
(`outcome()` in `lib/load-failure.ts`): `refused` (a 403) hides a tab, `failed` keeps it and shows
`PageError`, and a detail page 404s only on a refusal or a real 404 — never `.catch(() => null)`
driving `visible:`, which is how a 500 made an owner's tab vanish.

**A column of a custom enum array is read `::text[]`, never bare.** node-postgres has a parser
for `text[]` and none for `pool_metric[]`, so a bare select hands JavaScript the string
`'{ph}'` — `.map()` over it iterates characters and `new Set(…)` of it matches no metric name.
It typechecks perfectly, because the row type is whatever the query was told to claim, and it
is invisible on a screen that only counts the rows. Slice 4.2's alert email was built from
exactly that set and would have gone out with an empty list; the integration test is what
found it, which is the same lesson as the paragraph above.

**`cs` means `class_schedule` in most of this codebase, and a join to `class_group` is the
place partnerships get silently dropped.** It has happened three times — `listSessions`,
`occurrenceOf` and the stand-in candidate list all inner-joined it, so every parceria session
simply was not there. Nothing errors: a query returns fewer rows and a screen renders less.
A partnership session carries no `class_group_id`; its group, its instructor and its title
come through `class_schedule`. Reach for `LEFT JOIN` and a `coalesce` of both sides.

**A parceria takes no register, ever — but it may take a plan.** `partner.managed_lessons` is
one switch on the partnership, off by default, and it grants the training plan and Cancelar
aula on the calendar and nothing else. The register is not a UI choice: `partner_group` holds
a `participant_count` and no people, and `attendance` needs a real `student_id`. A `lesson_plan`
therefore hangs off a turma **or** a partner group, with a CHECK that exactly one is set and a
partial unique index each — one index over both columns enforces nothing, because two partner
plans on a day differ only by their null `class_group_id`s.

**A side sheet fits the window; the one growable thing inside it takes the slack.** Make the
panel a flex column and give the text box `flex-1 min-h-0` rather than a fixed `min-h-`. The
`min-h-0` is the half that is easy to miss — a flex item will not shrink below its content
without it, and the sheet scrolls anyway. A fixed floor pushes the buttons below the fold on a
laptop, which is how a Save nobody can see gets reported as a save that does not work.

**A draggable block carries no click.** Every drag and every resize ends with the browser
firing a click on whatever is underneath, so a block that both moves and opens something will
open it by accident. Timers that suppress the trailing click narrow the window without closing
it. Put the action on the hover card beside the others. A hover card closes when focus leaves its
trigger and never opens for touch, so on the calendar a click or tap **pins** it open (`pinnable`,
closed by Escape or a click outside; a click that ends a drag or resize is ignored), and a keyboard
reaches it through `TurmaCardButton`, a ⋯ shown only on keyboard focus. A block has four resize
edges: the top moves the start and keeps the end.

**The calendar draws the pattern, overlaid with the week's own sessions.** `readGrid` returns
`class_schedule`; the page re-times each booking to its `class_session` for that week before
handing them to the grid. Skip the overlay and a one-week move is written, refused and
reported correctly — and then invisible, because the block springs back to the pattern's slot.
A change the screen cannot show reads as a change that did not happen.

**A week's occurrence is found by its booking's id, never by turma-weekday-hour.**
`bookingKey` in `lib/slot-key.ts`; `slotKey` is the fallback for a session with no booking.
The composite was exact only while an occurrence could not leave its pattern's slot — it can
now, so the two halves stop agreeing the moment anybody moves one week, and every control on
the card silently vanishes from the classes that were rearranged. A lookup that returns
`undefined` renders nothing and reports nothing: prefer a key that cannot drift.

**A turma's lessons follow its pattern on their own.** 11 October 2026, Rui's call. Every write that changes a weekly pattern — placing, a series move, duplicating, a timetable import, adding or removing a slot — tops up the season's lessons through `syncSeasonLessons` (`classes/lesson-sync.ts`), **from today to the end of the published season, never the past**, so a turma placed today owes no register for September. It is `generate_sessions`, idempotent, so the *Gerar a época* button stays for after a closure. **A clash (two turmas, one instructor, one hour) leaves out only the turmas in it** — `generate_sessions` takes a skip list — and the calendar names it (`grid.lessonsClash`); the *Gerar a época* button still refuses on a clash. Removing a slot cancels its future, untaught lessons — never deletes them, never touches one with a register.

**A taught class is a record, not a plan.** One row in `attendance` for a session means it
happened, so it does not move and it is not cancelled. `Session.registerTaken` carries the
fact to the screen; the move endpoint asks the same question itself. The block stays
draggable — round 6 settled that a block which looks like every other block and silently
refuses reads as a broken grid — so the refusal is a sentence, not a disabled control.

**A class with no pista is drawn in a Sem pista column, which is a drop target both ways.**
`laneIds` may be empty — ordinary for a class nobody has placed yet — and the grid used to
draw none of them, so nine dev bookings existed and were invisible. The column is a synthetic
lane (`NO_LANE_ID`) prepended to *every* day, present only when the week has one, because
`columnX` is one uniform stride per day and a per-day column count would make the ruler depend
on the day. Out of it onto a pista assigns that pista; into it clears them — landing on the
column means no pista whatever the block's width, rather than slicing the span and filtering,
which would silently narrow a wide block. The id is never written to a booking; the column
takes no click (`creatable`, separate from `disabled`) and offers no sideways resize.

**Both axes of a drag are travel, never pointer position.** The calendar's scale lives whole
in `lib/calendar-scale.ts`: `PX_PER_MINUTE` down, `COL_WIDTH`/`GUTTER`/`DAY_RULE` and
`columnX`/`columnAt` across. Resolving one axis from `delta` and the other from whichever
droppable is under the pointer puts a multi-lane block's left edge under the pointer, so it
jumps sideways by however far along it was grabbed and collides in lanes nobody chose. The
blocks, the ghost and the drag measure with one ruler or they disagree.

**A drag costs a transform, never a reflow, and one droppable per column.** Measured on a
real club, the old board mounted 2,256 droppables — day × slot × lane, each running a rules
`evaluate()` on drag start — and `pointerWithin` walked all of them per pointer move. The
calendar mounts one per day-and-lane (168) and derives the minute from the pointer's travel.
Drag state changes on the *snapped* value, so a render happens once per step rather than
once per frame, and every transition is off while a drag is live.

**Eight level tints, solid, measured in both themes.** `--level-1…8` plus `--level-none` in
`globals.css`. Solid blocks with white text rather than a wash of the surface: the same eight
hues washed at 15% sit ΔE 4.5 apart, which is about one just-noticeable difference and means
the colour is doing no work. Solid they are ΔE 26.7 apart, white text is ≥4.6:1, and the dark
set is solved against the dark card rather than being the light set at another opacity.
**`--person-1…6` is the same idea for the vacation team map** and was six hex literals until
23-09-2026, three of them carrying white text below AA — a hex literal in a component is the one
thing `contrast:check` cannot see, because it reads the tokens. **A new fill earns a line in that
script's `PAIRS`** in the same change; the finding there was never the three colours, it was that
nothing was looking.

**A derived answer is derived once, on the server.** Overdue cleaning is
`now() - last cleaning > interval`, computed in SQL in `spaces.repository.ts` and shipped as a
boolean; the client renders it and never recomputes it. The same reasoning as the trigger
refusals that carry their numbers: two implementations of one rule agree until the day they do
not. It is also why there is no `is_overdue` column — a stored flag needs a worker to keep it
true, and that is a per-tenant cost.

**A breach is derived; being told about it is a record.** `excursions()` and the published
bands live in `@poolse/rules` — with `POOL_METRICS` and `METRIC_UNITS`, which the API and the
web app each used to declare by hand — so the pool's page and the alert email cannot disagree
about whether a reading is bad. What `pool_analysis_alert` stores is the part that cannot be
derived twice: that on this date, these people were told. **An email is not idempotent**, so
the row is written inside the transaction that wrote the reading, one per analysis by unique
index, and the *sending* happens after the commit where it can never roll a reading back.
`metrics` is a snapshot even so, because a measurement is corrected in place and a compliance
record that rewrote itself when somebody fixed a typo would not be one.

**The published band is NP 4542:2017, and a lab result's grade is derived, never stored.** POOLSE-72. `nationalBands({ kind, use })` in `@poolse/rules` holds the bands, each cited to its quadro (`docs/research/water-reference-2026-10.md`). Free chlorine is a `byPh` band, judged by the pH **in the same analysis**, which is why `excursions()` takes one analysis's values. Temperature comes from `pool.use`, and an unset use judges none. `resolveBands(overrides, pool)` needs the tank. `gradeLabResult()` grades a lab report under §4.4 against the national reference, never a club's own bands, and every reader calls it. A não conforme report alerts through `lab_result_alert` on the water alert's terms. `docs/features/water-quality.md`.

**A pool's band is the published one until a club says otherwise, and `resolveBands` is where
the two meet.** `pool_metric_range` holds only exceptions — no row is the answer for almost
every pool, which is what lets a later correction to a published band reach everybody who never
overrode it. Three states and the third is why both bounds are nullable: no row is the
reference, a row is its bounds *on the sides that carry one*, and a row with **neither** bound
means the metric is not judged here at all. Never collapse the first and the third — a hotel
tank kept at 30 °C is outside the published temperature band every day of its life, and that
distinction is the difference between one alert and one a day forever. `Excursion.limit` is the
bound actually crossed, so every sentence about an excursion is sayable without a null check,
and the API ships the *resolved* map: no client merges bands.

**Only a recent sample alerts, and the screen says whether anything was sent.**
`ALERT_WINDOW_HOURS` is 48, compared against `taken_at` in SQL; a club's first act is to
import its history, and forty emails about water dosed last winter teach it to filter the
channel before it ever carries something urgent. The reading is still recorded either way.
Recipients resolve **by role** at send time — owner, admin, maintenance, deduplicated, over
`coalesce(app_user.cached_email, membership.email)` so the staff member with no login is
included — and the addresses are then written onto the row, because "who was told" is not
recoverable from the roles once that person has left. `delivered_at` null means recorded and
not sent, said in words: the same honesty the chase list owes about what Poolse has and has
not delivered.

**A recurring job is a `maintenance_task`; a one-off is a `maintenance_request`, and
`interval_days` is the boundary.** Round 6 built the unplanned half — somebody notices a shower
is broken — and 4.3 built the planned one. The interval is NOT NULL precisely so the two cannot
be confused: a job with no cadence *is* a request, and a nullable interval would give one fact
two homes. Pausing is `active`, as it is on a space. **Due-ness is derived in SQL, in the same
four ordered branches as overdue cleaning** — paused is never due, never-done *is* due, else
time since the last completion — and there is no `next_due_at` column, because a completion
backdated to when the work actually happened has to move the next due date with it. A deleted
completion did not happen, so removing one puts its task straight back to due.

**Assignment is a person here and a role in 4.2's alerts, and the difference is the point.** An
alert has to *reach* somebody who can act, so a role is right and turnover must not orphan it. A
task is a to-do list, and a job assigned to three people is a job none of them does. Unassigned
means everybody sees it, so nothing is invisible; a task whose person has left says so rather
than being reassigned by Poolse.

**A null ceiling, interval or limit means "not measured" and enforces nothing.**
`pool.max_capacity`, `space.expected_cleaning_interval_hours`,
`organization.max_management_users`. Never read one as zero. Its counterpart is that an
*absence of history* is not evidence: a space with a schedule and no cleaning at all is
overdue, not fine.

**Out of service is not deleted.** `space.active = false` means shut for works — still listed,
still openable, and exempt from the overdue rule; `archived_at` is deletion. Where a table
carries both, they must mean different things and the difference belongs in a column comment.

**An elapsed time is `timeAgo` from `lib/relative-time.ts`**, which returns the phrase and lets
`t('…', { ago })` own the word order. Never build "há 2 dias" in a component: it is a
Portuguese string hard-coded into an interface that ships in two languages.

**Enum values are English snake_case; the Portuguese is an i18n key.** `fault` / `restock`
render as "Avaria" / "Reposição". Check a candidate word against the words the schema already
uses — `reposicao` was taken by the make-up-lesson module, and one word meaning two things in
one schema is how somebody joins the wrong table at midnight.

**A new tenant table goes in `TENANT_TABLES` in `apps/api/src/test/harness.ts`**, child-first,
in the same commit as its migration. A forgotten one fails every integration test at teardown
with a foreign-key violation that looks nothing like the change that caused it.

**Management seats are capped per tenant by a soft quota**
(`organization.max_management_users`, nullable = unlimited), checked when an invitation is
*created* and counting pending, unexpired ones — a 24-hour window otherwise lets a tenant
overshoot. Exactly one Owner per tenant, enforced; transfer is the only way to change it.
`docs/decisions.md`, 2026-09-06.

**A model call from a server action is guarded first: `guardAiCall(AI_ROLES.<importer>)` from `lib/ai-guard.ts`.** Sweep of 15-10-2026. Every export of a `'use server'` file is a public endpoint, so the seven AI importers sent any signed-in account's file to Anthropic on Poolse's key before a role was checked. The guard asks `/me` for the importer's roles in the active club and caps 20 calls per person per 10 minutes; each metered call keeps its own `*_ENABLED` flag, off by default (`COLUMN_MATCH_AI_ENABLED` included).

**A person merge never takes the Owner, two logins or support.** `merge_memberships` refuses all three (409 from `POST /people/merge`), because absorbing the Owner's record handed an Admin the club, and it repoints only columns the app may update — the insert-only history keeps the absorbed id, which `merged_into` resolves. `people-merge.integration.test.ts` runs it as `poolse_app`; a SQL test run as the owner proves nothing about a function the app calls.

**A staff member's ID document is encrypted, behind its own route, and read aloud to the audit log.** POOLSE-100.
- `GET/PATCH /staff/:id/identity` answers the Owner, an Admin or the person.
- A read by anybody else writes `membership.id_document_read`.
- The number is ciphertext by CHECK.
- A CC number is `isValidCcNumber` in `@poolse/rules`.
- `apply_retention()` erases the document 12 months after the person leaves.
- A login's date of birth is theirs (`birth_date_is_theirs`), like their name.

**A login's name is the person's own.** `PATCH /staff/:id` refuses (`name_is_theirs`) a rename by anybody but the person: Clerk holds one name for them across every club.

**Today in TypeScript is `clubToday()` from `apps/api/src/common/club-day.ts`**, the twin of `club_today()` — never `new Date().toISOString().slice(0, 10)`, which is yesterday between midnight and one in a Lisbon summer. In the web app it is `today()` from `lib/dates.ts`, which is the club's day wherever it runs (16-10-2026 sweep).

**A page that fails unexpectedly lands in `dashboard/error.tsx`**, which keeps the sidebar and says so in the reader's language with *Tentar de novo*. It is the net, not the answer: a page that expects a failure still renders `PageError` itself.

**Cost per tenant is a design constraint, not a later optimisation.** The first production
tenant is a free pilot, so prefer designs that keep one tenant inside free tiers and keep
every metered or pay-per-use call — the Claude API lab-report parsers above — behind its
own feature flag, off by default.

## How a session runs

1. Open with one line on where things stand and what tonight's slice is.
2. Brief framing — what "done" looks like for this slice, as acceptance criteria.
3. Build: schema → API → UI → check. Write code, not plans; the planning conversation
   for the product as a whole already happened.
4. Close with two lines: what now works, and the single obvious next slice. The next
   session starts from that line.

The role sequence matters (framing before backend before frontend before a QA pass).
The role *personas* do not — skip the ceremony, keep the artifacts: acceptance criteria
before code, a test or a manual check before calling something done.

## Settled by backlog rounds

Decisions taken in review that are not obvious from the code, so they are not re-opened:

- **There is no `manager` role.** `member_role` is `owner, admin, instructor, maintenance,
  student, guardian`. Backlog stories written for a "manager" mean `admin`.
- **Holidays live in `closure`, not a second table.** `source` distinguishes
  `national_holiday` from `manual`; municipal holidays join it as another `source`. The
  vacation calendar filters on that column — a shutdown for building works is not a public
  holiday and must not make a vacation day free.
- **Scheduling-grid slots are configurable per organization** (15, 30 or 60 minutes).
- **File storage is R2 (S3Mock in dev), and a file is read only through the app.** 12 October
  2026. `stored_file` is the registry; `POST /files` takes raw bytes (purpose and name in the
  query), judges the type by its first bytes, 10 MB; a feature attaches the returned id with its
  own route, which re-checks the purpose in its transaction. `GET /files/:id` applies
  `RULES[purpose]` in `files/files.repository.ts` and streams; the web serves it at `/files/<id>`.
  Never a public bucket or a pre-signed link. Student photos (consent rule) and incident
  attachments (encrypted) are named in the enum and not switched on. Upload controls:
  `FileUpload` / `AttachedDocument` in `components/file-upload.tsx`. `docs/features/files.md`.
- **Vacation carry-over to 30 April is not tracked in v1**, and the balance summary says so
  rather than being quietly wrong.

## Asking for decisions

When something genuinely needs a call, ask once, tightly, with a recommended default.
Not a list of open questions — that moves the work back onto the one person who has the
least time.

## Housekeeping

Four rules that keep the repo's own memory usable. They apply to every ticket.

- **Docs follow behaviour.** When a change alters behaviour, roles or schema, update the
  docs in the *same commit*: `docs/data-model.md` for schema, `docs/features/<area>.md` for
  behaviour. Create the feature page if it does not exist. Short and factual — what it does,
  who can do it, what rules apply. The argument belongs in `docs/decisions.md`.
- **CLAUDE.md stays current.** A new convention, shared component, validation approach or
  role guard earns one line here, so the next session uses it instead of reinventing it.
- **Refactor by proposal, not by reflex.** Code that is clearly duplicated or has outgrown
  what it was built for is *proposed* in one line and left alone until Rui says yes. Collect
  the proposals in the session summary.
- **Decisions log.** `docs/decisions.md`, one dated line per product decision taken in
  conversation — especially one that reverses an earlier decision.

## Backlog

The backlog lives in `docs/backlog/`, one file per ticket (`POOLSE-01…36`).

- `docs/backlog/README.md` — index of all tickets with area, priority and dependencies.
- `docs/backlog/CONVENTIONS.md` — standing rules that apply to every ticket, and the definition of done.
- `docs/backlog/CONFLICTS.md` — known contradictions between tickets and their resolutions.
- `docs/backlog/BUILD-ORDER.md` — dependency order and how a build session runs.

**When working on a ticket, read that ticket's file and `CONVENTIONS.md`. Do not read the whole
backlog folder** — it is ~2,300 lines and loading it wastes the session's context on tickets that
are not being built.

Each ticket file contains four sections plus the acceptance criteria:

- **PO** — why it exists and what is explicitly out of scope. Respect the out-of-scope line; do not helpfully build the adjacent thing.
- **BA** — the business rules and data. Anything marked `**Open:**` is genuinely undecided: ask rather than picking an answer.
- **Dev** — schema and migration impact, API surface, where the logic belongs, and the thing most likely to be got wrong.
- **QA** — numbered `Given / When / Then` scenarios. These are the tests to write, including the permission-denial and negative ones.
- **Acceptance criteria** — the contract. A ticket is not done until every numbered criterion is met.

### Non-negotiables for every ticket

- Permissions are enforced server-side; hiding a control is never the control.
- Every tenant table carries the tenant key; every query is scoped.
- Every user-facing string goes through i18n (pt-PT + en) as it is written.
- Light and dark mode, contrast-checked; colour never carries meaning alone.
- History is soft-deleted, never destroyed.
