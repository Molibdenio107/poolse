# Observability

What Poolse records about itself: whether the server is up, and whether each tenant's API is
behaving. Read at `/admin`, by a platform administrator only — see
[platform.md](platform.md) for who that is and how it is enforced.

## What is collected

| Where | What | Retention |
|---|---|---|
| `GET /health` | Nothing. Computed per request, stored nowhere. | — |
| `tenant_request_stats` | One row per tenant per hour: counts, p95 latency, the last error's time, route and message. | 30 days |
| `platform_audit_log` | Every platform request, reads included. | Kept |
| Sentry | Unhandled 5xx exceptions, tagged `tenant_id`. Off unless a DSN is set. | Sentry's own |

**No request bodies, no query values, no names, no IP addresses.** An error's *message* is
stored, cut to 500 characters by the code and refused past that by a CHECK; its *route* is the
Express pattern (`GET /students/:id`), never the URL, so an identifier cannot arrive that way.
Sentry's `sendDefaultPii` is off for the same reason — with it on the SDK attaches bodies,
headers and cookies, which in this product means a student's name, a NIF or a medical note
leaving the database for a third party.

## Server health — `GET /health`

Public, unauthenticated, outside every tenant, and deliberately not audit-logged: a platform
probe hitting it every ten seconds would otherwise be the only thing in the trail.

Three dependencies, checked in parallel so the endpoint's own latency is not the sum of
theirs:

| Check | Asks |
|---|---|
| `postgres` | `SELECT 1` on the application pool. |
| `timescale` | The extension's version. Not `SELECT 1`, which would only re-test Postgres. |
| `clerk` | An authenticated call to Clerk's API — the question is whether *our* credentials still work against *theirs*, and a rotated secret nobody updated is the failure that actually happens. |

Each answers `ok`, `slow` (over 500 ms), `failing`, or `not_installed`.

**Only Postgres can make the whole thing `down`, and that is load-bearing.** Railway and every
other host read the status code and nothing else, so `down` → 503 and everything else → 200. A
product whose deploy rolls back because its sign-in provider had a bad minute is a product that
rolls back during every one of its provider's bad minutes.

`not_installed` is neither degraded nor down. TimescaleDB is deliberately absent until the
hosting question in `docs/decisions.md` (2026-09-11) is settled, and a red dot for a considered
absence is how an operator learns to stop reading the strip.

## Per-tenant request health

A NestJS interceptor registered globally. It aggregates in memory and flushes once a minute.

**Never one row per request.** That is the shape of the feature rather than a tuning decision:
a club at a hundred requests a minute would write 144,000 rows a day — more storage than
everything the club actually does, for data whose entire purpose is a coloured dot. Aggregated,
the write rate is one statement per *active tenant* per minute whatever the traffic is.

**A request with no tenant context records nothing.** The landing page, `/health`, the Clerk
webhook, `/me`, `/organizations`, `/join` and every `/platform` route run outside
`tenantStorage`, so they are skipped by construction rather than by a list that would go stale.

**It costs a request nothing.** Everything in the request path is a `Map` mutation; the database
is touched by a timer. The buffer is also flushed on `SIGTERM` and `SIGINT`, so the last minute
before a deploy is recorded rather than dropped.

### p95 is an approximation, on the record

Each flush computes p95 over the samples it saw in that minute and merges into the row by
taking the larger of the two. A true hourly p95 needs every sample kept for the hour, which is
the per-request storage this design exists to avoid. What the number answers is "did anything
get slow in this hour", and it reads high rather than low — the safe direction for a health
signal.

### Retention

30 days, by one of two mechanisms depending on the database:

- **With TimescaleDB** the table is a hypertable with `add_retention_policy(… '30 days')`, and
  the chunk is dropped for us.
- **Without it** — the development image is `postgres:16-alpine` — the API's own flush deletes
  rows past 30 days, at most once an hour, on a connection it was opening anyway. No scheduled
  job and no per-tenant running cost, which is the constraint that ruled a worker out.

The migration decides at apply time and the same file is correct on both. The table is
hypertable-*shaped* either way: the natural key `(organization_id, bucket)` with no surrogate
id is the one thing Timescale requires and the one thing that cannot be retrofitted. The day
the host is confirmed, the conversion is one statement.

### Who can read it

Only `poolse_platform`. This is telemetry *about* a tenant, not a tenant's data, and a club has
no more business reading its own error rate here than another club's. `poolse_app` **writes**
it — the interceptor runs in the request path and has no business borrowing the platform's
login — under a policy that admits only its own tenant's row, and an unscoped read from that
connection returns nothing. Asserted in `packages/db/test/platform-admin.sql`, tests 8–12.

## The health verdict

Derived at read time from the last **24 hours**, never stored — the same reasoning as overdue
cleaning: a stored verdict needs a job to keep it true, and the thresholds are a guess about a
product with one tenant in it that must be tunable without a backfill. `tenant-health.ts` holds
the window, the rate and the rule; `tenant-health.test.ts` asserts all four states and the
boundary.

| Verdict | Means |
|---|---|
| `green` | No 5xx in 24 h. |
| `amber` | At least one 5xx, under 2% of requests. |
| `red` | 5xx on ≥ 2% of requests, **or** the most recent request was itself an error. |
| `unknown` | No requests recorded in 24 h. |

**`unknown` is not `green`.** A tenant nobody used is a different fact from one that worked
perfectly, and collapsing them would make a club that stopped logging in look healthy.

**The newest-request rule is what makes this useful in the first minute.** A tenant whose API
started failing a minute ago has one 5xx against a thousand good requests — 0.1%, comfortably
green — and is on fire. It is answered exactly rather than inferred: the row carries
`last_request_at` alongside `last_error_at`, so the rule is a comparison.

**4xx never colours anything.** A client sending a bad page number or meeting a 403 is the API
working; counting it as ill-health would make the strictest tenant look the sickest. The count
is reported next to the others and decides nothing.

## Sentry

Optional and off by default. Set `SENTRY_DSN` (API and Next server) and
`NEXT_PUBLIC_SENTRY_DSN` (browser); with neither, the SDKs never initialise and everything
behaves identically. Create the Sentry project by hand — only the wiring is in the repo.

- **API**: `apps/api/src/instrument.ts`, imported second in `main.ts` — after `load-env`,
  because the DSN comes out of the repo-root `.env`, and before `AppModule`, which is what
  imports everything Sentry patches.
- **Next**: `instrumentation.ts` (server, plus `onRequestError` for server components and
  actions) and `instrumentation-client.ts` (browser).
- **`tenant_id` tag**: set in `TenantMiddleware` on the API and in the dashboard layout on the
  web, at the one moment each side learns which organization it is serving. The **id**, never
  the name — a Sentry issue titled with a club's name is the club's data in a third-party
  service, and the operator can look an id up in `/admin`.
- **Capture point on the API is `BadInputFilter`**, not `SentryGlobalFilter`. That filter is
  `@Catch()` and terminates the response, so registering Sentry's alongside it would mean one
  of the two never running. Capturing where the filter has already decided "this is a real
  fault" keeps both, and means a mapped 404 or a 403 never fills the inbox.
- **Tracing is off** (`tracesSampleRate: 0`). It is the expensive half, per event, and
  `tenant_request_stats` already answers "is this tenant slow" for a hundredth of the price.
- **The CSP knows.** `next.config.mjs` reads the DSN and adds its ingest origin to
  `connect-src`; without that the browser blocks the request and the SDK reports nothing while
  looking installed.

## The screens

**`/admin`** carries a status strip across the top — overall badge, a dot, a name and a latency
per dependency — refreshed every 60 s by polling `/admin/health`, a route handler on the Next
server (browser → Next → API, never browser → API). It requires a session but not the platform
flag: gating it would cost a second round trip per poll for something a signed-in person may
know, and `/admin` redirects a non-operator anyway. The tenants table gains a health column with
the 24-hour counts as **visible text** beside the chip — a tooltip explains what a verdict
means and never carries a fact that appears nowhere else — and a sort control that orders the
current page worst-first.

**`/admin/tenants/[id]`** draws requests per hour and 4xx/5xx per hour over 7 days, then lists
the recent errors. The charts are HTML and CSS, like `consumption-bars.tsx` — no client
JavaScript, about a kilobyte, colours from tokens so dark mode is free. An hour with no
requests is a **gap**, not a zero-height bar: "nobody used the app" and "the app answered
nothing" are different facts. The error list is **one line per route**, newest first — a route
failing every minute for an hour writes itself into sixty buckets, and sixty identical lines
would describe one problem while hiding every other.

## Not in this slice

Alerting when a tenant goes red, uptime history beyond 30 days, per-route breakdowns, the Clerk
MAU pull, and every platform action (extend trial, suspend, feature flags, view-as).
