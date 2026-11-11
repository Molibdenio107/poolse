# Platform, licence and observability

The full text of the conventions for `/admin`, a module or sport switch, the subscription, a trial, support access, an AI reader or telemetry. `CLAUDE.md` holds one line each; read this file before changing that area.

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

**A module is switched off per club by Rui, and every tenant route says which module it is.** POOLSE-87. `POOLSE_MODULES` in `@poolse/rules` is the one list (equal to the SQL enum `poolse_module` by test); everything else is core. `organization.disabled_modules` stores what is **off**, so empty is the full product and a trial needs nothing set. Only `poolse_platform` writes it, through `changeTenant` (`POST /platform/tenants/:id/modules`, one click, audited, alerted); a dependency left broken is a 409 `module_dependency` and a CHECK, never resolved for the operator — reception needs invoicing. **A new controller carries `@PoolseModule('x')` or `@CoreRoute()`** (`tenant/modules.ts`), with a handler tag overriding the class, or the API refuses to boot; `ModuleGuard` answers 403 `module_disabled` from the membership `resolve_memberships` already returned. Switching off hides and refuses and never deletes. **On the club's side, a module's thing says its module once**: a menu entry and a dashboard widget carry `module` (filtered before any resolver runs), a module's route segment mounts `ModuleGate` in its `layout.tsx`, a core read that carries a module's data drops it on the server with `moduleIsOn` (the pool's water log, a student's `qualifying` and meets), a `RESTORABLE` kind carries `module` so the bin neither lists nor restores it, a rule the club can no longer see stops applying (a `blocks_assignment` qualification type with qualifications off), and a background job skips the club. A `/me` with no `modules` field is every module on (`modulesOf`), never none. **`poolse_app` holds UPDATE on `organization` column by column since this change**, so a new `organization` column the club writes needs its own `GRANT UPDATE (col)` in its migration. `docs/features/platform.md`.

**An irreversible platform act asks for the club's name, and every platform write and
refusal raises an alert.** POOLSE-64 slice E1. **Which acts are irreversible is decided by
the columns a change writes** — `changeTenant` requires `confirmName` when a change *sets*
`suspended_at`, `pending_delete_at` or `archived_at` — so an endpoint added later inherits
the rule and a list nobody maintains does not decide it. Only *entering* those states asks for the
typed name; since 04-11-2026 (Rui) restoring, letting a club write again and lifting a deletion date
still ask a plain yes/no (`ConfirmButton`), as every decision does, but never the name. The name is matched case- and
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

**A view of a person's app is an `app_view` row read on every request, and what it opens is the list in `tenant/app-view.ts`.** POOLSE-188. The row decides, with no cookie or header, because `apiFetch` is not the only way out of the web app and a request that left a header off would run as the owner with every write open. `currentTenant()` carries the *person viewed* in `membershipId`, `appUserId`, `roles` and `mySports`, and the real person in `actor`, so a read that forgets the view answers as them and never as the owner; `recordAudit` is the one reader of `actor`. Only the chosen home's roles apply, so nobody viewed brings `admin` with them. A new route is closed to a view until somebody adds it to `READS`, exact path and GET only, and `app-view.integration.test.ts` fails if one opens by accident. A phone action reads `viewRefusal` from `lib/form-failure.ts` first, or its own sentence hides the refusal. `/me` runs outside `TenantMiddleware`, so `roles` on `/me` stay the reader's and `viewRoles` in `lib/app-hats.ts` draws the app. `docs/features/app-view.md`.

**Poolse support enters a club only through a grant the Owner opened, and is never one of the club's people.** POOLSE-79. `support_grant` is the window. An operator enters through `support_session`, a definer function that only `poolse_platform` may execute and that re-checks the platform admin and the live grant. They then work through the ordinary tenant path, so RLS, `requireRole` and `audit_log` name them. **The role is not a row**: a support membership holds no `membership_role` rows (a trigger refuses one), and `resolve_memberships` gives it `admin` only while the grant is live. Expiry and revocation therefore need no job, and every role-keyed list leaves support out with no edit. **A read over *every* membership (Pessoas, a people search, a picker, a team count) adds `support_grant_id IS NULL`**, because "no role" reads as staff there. A new one earns a line in `support.integration.test.ts` QA 5. **A support session grants no roles** (`currentTenant().support`; `grantableRoles()` is empty), so no access outlives the window, and entering raises a `platform_alert`. **Asking is a `support_request`** that opens nothing until the Owner approves it. **Forcing is an override**: a reason, the club's name typed back, exactly 4 h, an alert, and a recorded notice to the Owners. Those two are the only things `poolse_platform` inserts, and both tenant policies there are `TO poolse_app`. **The active club is the `poolse_org` cookie**, which every API call sends as `x-poolse-organization`. `/me` puts that club first, so `memberships[0]` is always the club being acted in; never pick a membership any other way. `docs/features/platform.md`.

**Poolse support never reads health data or an ID document** (Rui, 10-11-2026, go-live review). Support is an Admin for every rule *except* this one: `refuseSupport()` (`tenant/roles.ts`) answers 403 ’support_no_health_data` on the medical notes (read and write), the medical exams, a student’s full ID document and a staff member’s identity, and `openFile` refuses every `SEALED_PURPOSES` file to a support session before any role is weighed. A new route that opens health data or an ID number calls it on the line after `requireRole`, and earns a line in the ’support.integration.test.ts` test that names them. If a case needs one, the Owner shows the screen. Until this change the code let support read them as any Admin, which `docs/security.md` said it did not.

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

**A personal tenant is `organization.kind`, read in exactly two places.** `/me` carries
`organizationKind` on each membership; the sidebar prunes by it (`kinds: ['business']` on an
item, alongside `roles`) and the dashboard swaps occupancy for `MyPoolPanel`. Nothing else
branches on it — a personal tenant is an ordinary tenant with fewer screens, which is what
decision 1 promised and slice 4.5 proved by staying small. `provision_organization` takes the
kind and opens a pool for a personal tenant and a season for a club; every caller that omits
it gets a club. Absence from the menu is a shape, not a permission: the API answers those
routes, and hiding them is not the control. `docs/features/personal.md`.

**A sport is switched on per club by Rui; the pool always is.** POOLSE-124. `organization.enabled_sports` stores what is **on** (default `{pool}`, the pool kept by CHECK), the reverse of `disabled_modules`; `POOLSE_SPORTS` in `@poolse/rules` equals the `sport` table by test. Only `poolse_platform` writes it, through `changeTenant` (`POST /platform/tenants/:id/sports`); a sport with live recintos is a 409 `sport_in_use` naming them, never archived for the club. A recinto of another sport is `POST /facilities/:id/playing-areas`, 403 `sport_not_enabled` unless `mayCreateRecinto`, and the database refuses one made or restored while its sport is off. `/me.sports` is the list POOLSE-125's menu reads. `docs/features/platform.md`. **Whether a club is multi-sport is `isMultiSport` (`@poolse/rules`), never `sports.length`**, and a sport's name and icon are `sportNameKey` and `SPORT_ICON` (`components/sport-icon.tsx`), one glyph per sport, always beside its name (`docs/features/look.md`, *Sports*).

**A subscription covers one facility; the schema allows many.** These are two
different rules and both are settled. The *schema* keeps `organization 1 —— N
facility` — backlog story B4 proposed narrowing it and was rejected, because a
municipality with pools in two buildings would then need two organizations with
two staff lists and two invoices. The *licence* is what bounds it:
`organization.max_facilities` defaults to 1, is enforced by a trigger rather than
by the API, and a club with two sites buys a plan with two. Do not re-open either
half. The trigger exists because the application layer already forgot once — a
seed created a second site to keep demo data tidy and nothing objected.

**Management seats are capped per tenant by a soft quota**
(`organization.max_management_users`, nullable = unlimited), checked when an invitation is
*created* and counting pending, unexpired ones — a 24-hour window otherwise lets a tenant
overshoot. Exactly one Owner per tenant, enforced; transfer is the only way to change it.
`docs/decisions.md`, 2026-09-06.

**A model call from a server action is guarded first: `guardAiCall(AI_ROLES.<importer>)` from `lib/ai-guard.ts`.** Sweep of 15-10-2026. Every export of a `'use server'` file is a public endpoint, so the seven AI importers sent any signed-in account's file to Anthropic on Poolse's key before a role was checked. The guard asks `/me` for the importer's roles in the active club and caps 20 calls per person per 10 minutes. **Behind it, every model call goes through `metered(reader, …)` in `lib/ai-meter.ts`** (POOLSE-137): `POST /ai-reads/claim` checks the reader's platform switch, the club's tick (`organization.ai_readers`, none for a new club) and the club's monthly cap under a lock, then `finish` records the model and tokens in `ai_read`, read or not. No reader has an env flag; the gates and the per-club usage with an estimated cost (`AI_MODEL_PRICES` in `@poolse/rules`) are on /admin. A gate that closed is a sentence where the reader acts (`off` / `noKey` / `capReached`), and the manual path stays. A new reader is a value in `AI_READERS`, the `ai_reader` enum and `PLATFORM_SWITCHES`.

**A platform-wide feature switch is a `platform_switch` row, flipped on `/admin` → Plataforma** (Rui, 30-10-2026). `POST /platform/switches/:name` audits and alerts; clubs read `/me.switches`, unreadable meaning off. There is one per AI reader (`id_document_ai` first, four more since POOLSE-137, `boletim_template_ai` since POOLSE-142, `qualification_certificate_ai` since POOLSE-149); a new one is a value in the CHECK and in `PLATFORM_SWITCHES` (`platform/platform-switch.ts`). `docs/features/platform.md`.

**Speed is judged on a production build and the club seed, never on `pnpm dev`** (POOLSE-171). `docs/perf/README.md` is the method and the baseline: `pnpm --filter @poolse/db seed --size=club` (*Clube Medida*, the e2e owner as admin), `Server-Timing` on every API response (`common/server-timing.ts` + `@poolse/db`'s `query-timing.ts`; three numbers, nothing identifying), `perf:slow-queries` over `pg_stat_statements` (dev Docker only; reset before measuring), and the `perf` Playwright project, which asserts nothing. A local `next build` needs `NODE_ENV=production` — the root `.env` says development.

**The layout reads `/me` and `GET /shell`, and nothing else** (POOLSE-172). A new thing the shell draws is a part of `shell.controller.ts`, with its gate in a function its own route also calls, and `readShell` (`lib/shell.ts`) on the web, never another call in the layout. A part is `null` when it is not this reader's or it failed. Never cache memberships across requests: a suspension or a removed role takes effect on the next one.

**A hydration mismatch costs `<html>` its attributes** (05-11-2026): React rebuilds the document from the root and strips `class` (the dark theme) and `style`. A Clerk widget's first render depends on whether its script has loaded, so `UserMenu` draws `UserButton` only after hydration (`useSyncExternalStore`), with a placeholder holding its place.

**A page left open re-reads itself, lightly** (Rui, 11-11-2026). `KeepFresh` (`components/keep-fresh.tsx`), mounted once in the backoffice shell and once in the phone app, calls `router.refresh()` every 2 minutes while the tab is visible, and at once on coming back to a tab hidden for more than 30 seconds. It does nothing while the tab is hidden. It skips a tick while a field has focus, was typed in during the last minute, a dialog is open, or the app is already loading or saving, and simply tries again at the next one. A refresh re-reads the server's part (the layout's `/me` + `/shell`, the page's own reads) and keeps the client's state, so it is invisible unless something changed, and it raises no busy indicator. Cost: one shell read and the page's reads per open, visible tab every 2 minutes, inside the free tiers for the pilot. A live connection (WebSockets or SSE) is deliberately not built until a club needs seconds rather than minutes. `/admin` keeps its own status poll and does not mount it.

**A model read that fails says why** (Rui, 11-11-2026). Every AI reader (PDF tables for the list importers, water lab reports, energy bills, ID documents, boletim templates, qualification certificates) used to turn every failure into "could not read the file", so a rejected API key looked like a broken PDF. Each now classifies the failure in `lib/ai-failure.ts` from the SDK's typed errors, never by matching message text:

- `keyRejected`: 401 or 403, the server's key.
- `rateLimited`: 429.
- `unavailable`: 5xx, 529 or the network.
- `timeout`.
- `fileRejected`: 400 or 413, a password-protected, too long or too large file. A 400 whose message names the API key or a workspace is `keyRejected`: a key not scoped to a workspace answers 400, and it is not the file.
- `refused` and `tooLong`: from the stop reason.
- `unreadable`: anything else.

It logs `[ai:<reader>] <code> — HTTP <status> <message>` on the server, never the document. Screens show `ai.failure.<code>` through `aiNoteKey(namespace, code)` (`lib/ai-failure-codes.ts`, client-safe); `unreadable` keeps the screen's own sentence. The list importers share one map, `readFailureKey` in `lib/read-sheet.ts`, instead of seven copies. Column matching still falls back silently to the operator, but logs the cause.
