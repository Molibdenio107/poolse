# Deploying Poolse

Slice 0.9. Two environments, **staging** and **production**, separate from day one —
because the first time you need somewhere safe to break something is the first time you
have customer data, and by then it is too late to introduce the idea.

Web on Vercel, API and Postgres on Railway. What follows is the order to do it in. The
repository side is already done; everything below is dashboard clicks and environment
variables, which is why it is written as a checklist rather than a script.

## The shape of it

```
Vercel project  poolse-web         → apps/web        (staging + production)
Railway project poolse             → apps/api        (staging + production environments)
Railway Postgres                   → one per environment, never shared
Clerk                              → development instance for staging,
                                     production instance for production
```

Two rules that are not negotiable, both for the same reason — they are the ones with no
visible symptom when broken:

1. **Staging and production never share a database.** Not "different schemas", not
   "a prefix". A separate instance.
2. **The API never connects as the database owner.** See "the two roles" below.

## The roles, and why this step is not optional

Railway hands you one connection string. It belongs to the database owner.

If you point `DATABASE_APP_URL` at it, everything appears to work — the app boots, queries
return rows, the tests pass. And every row-level security policy in the schema is silently
inert, because in Postgres a table's owner bypasses RLS. There is no error. There is no
symptom. The first symptom is a customer seeing another customer's data.

So each environment gets three roles:

| Role | Connection string | Used by |
|---|---|---|
| owner (Railway's default, usually `postgres`) | `DATABASE_URL` | migrations, and only migrations |
| `poolse_app` | `DATABASE_APP_URL` | the API, always |
| `poolse_platform` | `DATABASE_PLATFORM_URL` | `PlatformModule` (`/admin`) and nothing else |

`pnpm db:bootstrap` creates the second and third from their connection strings and then
proves each can log in, is not a superuser, has no `BYPASSRLS`, and owns no tables. The API
refuses to start if it detects otherwise — `assertRlsApplies` for the app role and
`assertPlatformRoleIsNarrow` for the platform one — so this is checked twice on purpose.

**The third role is optional and narrow.** Leave `DATABASE_PLATFORM_URL` unset and the whole
product runs normally; `/admin` says it is not configured rather than failing in a way that
looks like a permission problem. Set it and the role can read eight named tables — one of
them, `app_user`, only two columns of — write a named list of columns on `organization`
(never `name`, and no `DELETE` anywhere), and write its own two books. Not the schema. It does **not** carry `BYPASSRLS`, so
pointing it at Railway's default connection string is the mirror-image of the mistake above
and the boot check refuses it. See `docs/features/platform.md`.

**Order matters on a fresh environment**: `db:bootstrap` (creates the roles) → `db:migrate`
(creates the tables, policies and grants) → `db:platform-admin grant <clerk_user_id>`. The
last one is a one-off per environment, because a Clerk user id differs between the
development, staging and production instances.

## 1. Railway — the database and the API

1. Create a project called **poolse**. Railway gives you a `production` environment; add a
   second one called **staging**.
2. In each environment, add a **Postgres** database.
3. In each environment, add a **service from your GitHub repo**. Railway reads
   [`railway.json`](../railway.json) at the repo root, so the Dockerfile, the start command,
   the health check and the pre-deploy migration are already configured. Leave the service
   root directory as the repository root — the Dockerfile expects that as its build context.
4. Set the service variables in **each** environment:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — Railway's reference syntax |
   | `DATABASE_APP_URL` | the same string with the user and password replaced by `poolse_app` and a password you generate. Keep the host, port and database name |
   | `CLERK_SECRET_KEY` | from the matching Clerk instance |
   | `CLERK_WEBHOOK_SIGNING_SECRET` | from step 3 below — set a placeholder first, the API will not boot without one |
   | `CLERK_AUTHORIZED_PARTIES` | the Vercel URL for this environment |
   | `WEB_ORIGIN` | the same URL |
   | `APP_ENV` | `staging` or `production` |

   `PORT` is injected by Railway; the API reads it. Do not set `API_PORT`.

5. **Bootstrap the application role, once per environment.** Easiest from your machine
   against the public database URL Railway exposes:

   ```bash
   DATABASE_URL='<owner url from Railway>' \
   DATABASE_APP_URL='<the poolse_app url you composed>' \
   pnpm db:bootstrap
   ```

   Read what it prints. It tells you which of the four checks passed, and if the two URLs
   name the same role it refuses outright rather than leaving you unprotected.

6. Deploy. The pre-deploy step runs the migrations; if they fail, the release stops and the
   previous version keeps serving. Health check is `/health`, which returns 503 when the
   database is unreachable, so a deploy with wrong credentials rolls back instead of going
   live broken.

7. Generate a public domain for the service and note it — the web app needs it.

## 2. Vercel — the web app

1. Import the repository. Framework preset **Next.js**;
   [`vercel.json`](../vercel.json) sets the build to the workspace filter, so pnpm resolves
   the monorepo correctly.
2. Environment variables, per environment (Vercel's Preview maps to staging, Production to
   production):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | the Railway service URL for that environment |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | from the matching Clerk instance |
   | `CLERK_SECRET_KEY` | from the matching Clerk instance |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` |

   No `DATABASE_*` variables here, ever. The web app never talks to the database; it talks
   to the API, which is the only thing holding credentials. A `NEXT_PUBLIC_` variable is
   **inlined into the browser bundle**, so a connection string pasted into one is published
   rather than configured — `security-headers.test.ts` fails the build's test run if any
   `NEXT_PUBLIC_*` value ever looks like a database URL, and if anything under `apps/web/src`
   reads a `DATABASE_*` variable at all (POOLSE-64).

3. Deploy, and go back and fill `CLERK_AUTHORIZED_PARTIES` and `WEB_ORIGIN` on Railway with
   the URL Vercel gave you. Without it the API rejects every session token, because a token
   minted for another application on the same Clerk instance would otherwise authenticate
   here.

## 3. Clerk — and the webhook that has never yet fired

Use the **development** instance for staging and create a **production** instance for
production. They have separate keys and separate users, which is the point.

For each, add a webhook endpoint at `https://<api-url>/webhooks/clerk`, subscribed to
`user.created`, `user.updated` and `user.deleted`. Copy the signing secret into
`CLERK_WEBHOOK_SIGNING_SECRET` for that environment and redeploy.

This is the first time these webhooks will actually be delivered. Locally Clerk cannot
reach your machine, so `user.updated` and `user.deleted` have never run outside their SQL
tests. Watch the first few in Clerk's dashboard — it shows the response the endpoint gave.

## 4. Prove it, in this order

```
1. GET  https://<api-url>/health          → {"status":"ok","database":"ok"}
2. Open the Vercel URL                    → landing page, both status rows green
3. Sign up                                → lands on /dashboard
4. Check Clerk's webhook log              → user.created delivered, 2xx
5. Create an organization                 → you are its owner
6. Add a facility and a pool              → /dashboard/facilities
7. Invite a second address                → copy the link
8. Accept it in a private window          → the second account appears as a member
```

Then confirm the thing that matters most, which no amount of clicking will show you:

```bash
DATABASE_URL='<staging owner url>' pnpm --filter @poolse/db test
```

Six suites, forty-two assertions. They roll back everything they create, so they are safe
against staging. Do not point them at production — they are safe, not free of side effects
on sequences, and production is not somewhere to find out you were wrong about that.

## Two decisions to settle while you are in here

- **Confirm TimescaleDB.** Phase 5 stores energy and sensor readings as time-series and
  needs the extension. Check `CREATE EXTENSION IF NOT EXISTS timescaledb;` works on the
  staging database *now*. If it does not, the fallback is running the
  `timescale/timescaledb` image as a separate service — a decision worth making while the
  database is empty rather than after migrating production to find out.
- **Pick the notification providers.** Push and transactional email. Invitation delivery
  (currently a copied link), overdue-invoice chasing in slice 2.3 and the whole of phase 3
  are waiting on this one.

## The go-live checklist

Things that are deliberately **not** done on a development instance and must be done before a
real club depends on Poolse. Each one is here because doing it early breaks something today.

- [ ] **A production Clerk instance**, separate from the development one. Everything below hangs
      off it, and it is the reason none of them are done yet — noted 13 September 2026.
- [ ] **MFA on the operator's own Clerk account**, then ship the `PlatformAdminGuard` MFA check
      from [POOLSE-64](./backlog/POOLSE-64-hardening-admin.md). **Order matters**: enforcing it
      first locks the only operator out of `/admin`, and there is no second operator to let them
      back in. **Deferred for the free pilot** (16 October 2026): MFA needs Clerk Pro, so it ships
      the day a club pays. Until then, use a long unique password and sign in from your own
      machine only.
- [ ] **Stripe**: a live account, one price per interval, the webhook endpoint pointing at
      `POST /webhooks/stripe`, and `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` /
      `STRIPE_PRICE_*` set on the API only. Until then the product runs unsold, by design —
      `docs/features/subscription.md`.
- [ ] **A transactional email provider.** `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a
      verified sending domain in `EMAIL_FROM` — without the domain Resend only reaches the account's
      own address. Every alert, message, trial notice and support notice is recorded either way;
      with email on console nothing leaves and the hourly retry does nothing.
- [ ] **`DATABASE_PLATFORM_URL` audited**: API environment only, never the web app's, never
      `NEXT_PUBLIC_`. The rotation procedure is below; a test now fails if a `NEXT_PUBLIC_`
      variable ever looks like a database URL — POOLSE-64.
- [ ] **`PLATFORM_ALERT_EMAIL` set on the API**, to a mailbox that is **not** reachable by
      taking over the operator's Clerk account. Without it every platform write and refusal is
      recorded and nothing is sent, which is honest and useless — POOLSE-64.
- [ ] **Step-up reverification before a mutating platform action** (POOLSE-64 AC 2), which
      needs the production Clerk instance for the same reason MFA does. Until both ship, the
      typed club name is what stands in the way of an irreversible act. Deferred with MFA, for
      the same reason.

- [ ] **`WEB_PROXY_SECRET` set on both the API and the web app**, to the same long random
      string (server-side only, never `NEXT_PUBLIC_`). Without it the public sign-up form's
      per-visitor limit believes a header any direct caller can set, and the API warns at boot
      in production — `apps/api/src/leads/visitor.ts`, POOLSE-69 sweep.
- [ ] **Enforce the full Content-Security-Policy.** Today only `frame-ancestors`, `object-src`,
      `base-uri` and `form-action` are enforced; `default-src` and `script-src` are report-only, with
      no `report-uri`. Add a report endpoint, read a week of reports on staging (Clerk and Next's
      inline scripts are the usual offenders), then promote it. Until then an XSS bug has no CSP
      behind it — 16-10-2026 security sweep.
- [ ] **A Sentry DSN**, if errors are to be seen at all. Off without one, by design.
- [ ] **Open-Meteo moved to the commercial endpoint, or the weather history left off.** The
      free tier is **non-commercial use only**, which is fine while Poolse has no paying
      customers and is not fine the day it does. Two features depend on it and they are not
      equally exposed: the forecast panel on a site's page *displays* a response, while
      `WEATHER_HISTORY_ENABLED` (roadmap 5.4b) **stores** one, so the obligation outlives the
      request. Both read `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_ARCHIVE_URL` and
      `OPEN_METEO_API_KEY` from the environment, so switching is configuration rather than a
      refactor — that is why those variables exist. Attribution is rendered wherever the data
      is shown. The safe default is what ships today: the history flag **off**, and no archive
      call at all.
- [ ] **The pilot club's modules set on `/admin`** (POOLSE-87), once it has signed up on
  production: off are invoicing, reception, maintenance, energy, salaries, vacations and
  qualifications (Rui, 20-10-2026). Reception needs invoicing, so it waits for POOLSE-76.
- [ ] **TimescaleDB confirmed** on the production database, or the fallback taken — see below.
- [ ] **A Cloudflare R2 bucket per environment**, private, with an API token scoped to that one
      bucket, and `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` /
      `S3_REGION=auto` on the **API only**. Without them every upload control says storage is not
      configured — `docs/features/files.md`. Never make the bucket public: files are served
      through the app after a permission check.
- [ ] **The dependency advisories that need a major upgrade are cleared**, or accepted again
      on the day. On 15 October 2026 `pnpm audit` went from 34 to 11 (critical 2 → 0) with
      overrides in the root `package.json`. What is left needs a major version:
      `@nestjs/*` 10 → 11, `next-intl` 3 → 4 (its open redirect is in middleware this app does
      not use), `file-type` 21 (only Nest's file pipes reach it, and none is used), and
      `fast-xml-parser` 5 / `uuid` 11 inside the AWS SDK. `braces` (GHSA-vfj7-8cjw-p6xm) has no
      fixed release and is in the Nest CLI's watcher, a dev tool, so it is in
      `pnpm.auditConfig.ignoreGhsas` — take it out the day a fix exists. Run `pnpm audit:check`.

## Paid services: what launch costs, and who pays

Rui pays every service himself, as a private person, so **23% IVA is added on top of these
prices**. Euro figures use about €0.89 to the dollar (October 2026). The amounts move with the
exchange rate and the providers' price lists, so check each pricing page on the day. Estimated
12 October 2026.

Rui enters the card and presses pay on each service. Claude can open the pages, fill in
everything except payment, set the variables and run *Prove it* afterwards.

| Service | Plan at launch | €/month with IVA | Start paying | Fills |
|---|---|---|---|---|
| Vercel | Pro (Hobby is non-commercial) | ~22 | Go-live | — (Vercel project) |
| Railway | Hobby, then Pro once clubs pay | ~22–33 | Go-live | `DATABASE_*` |
| Clerk | Pro: MFA for `/admin` needs it | ~27 (~22 yearly) | Production instance | `CLERK_*`, `NEXT_PUBLIC_CLERK_*` |
| Resend | Free (3,000/month, 100/day), then Pro ~22 | 0 | Go-live | `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` |
| Sentry | Free (Developer) | 0 | Go-live | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Cloudflare R2 | Free up to 10 GB | 0 | Go-live | `S3_*` |
| Anthropic API | Pay as you go, per-feature flags | ~1–5 | When a parser flag is turned on | `ANTHROPIC_API_KEY` |
| Stripe | No monthly fee; ~1.5% + €0.25 per EU card payment | 0 fixed | First paying club | `STRIPE_*` |
| Apple Developer | €99/year | ~8 | Mobile app (phase 3) | — |
| Google Play | ~€27 once | 0 | Mobile app (phase 3) | — |
| Expo (EAS) | Free, then Starter ~21 if builds run short | 0 | Mobile app (phase 3) | — |
| Domain | — | ~1–6 | Before go-live | DNS, `EMAIL_FROM` domain |
| **Full launch total** | | **~€80–100** | | |

**The free pilot pays only what is necessary** (Rui, 16 October 2026). While no club pays:

| Service | Pilot plan | €/month with IVA | Moves up when |
|---|---|---|---|
| Vercel | Hobby | 0 | The first club pays: Pro, because Hobby is non-commercial |
| Railway | Hobby, staging allowed to sleep, smallest database | ~6–15 | A paying club, or the database outgrows Hobby |
| Clerk | Free (the app uses its own memberships, not Clerk Organizations, so the member limit does not apply) | 0 | The first club pays: Pro, then MFA and step-up on `/admin` |
| Resend, Sentry, R2 | Free tiers | 0 | Their limits are reached |
| Anthropic | All parser flags off | 0 | A flag is switched on |
| Domain | Yearly | ~1–2 | — |
| **Pilot total** | | **~€7–17** | |

Staging and production stay separate databases, which is not negotiable; staging is what may
sleep.

**Open-Meteo is not paid for.** The commercial licence (~€32/month with IVA) was turned down on
12 October 2026. `WEATHER_HISTORY_ENABLED` stays **off**. The forecast panel on a site's page also
reads Open-Meteo, so before a paying club it must be switched off or moved to a free commercial
source (IPMA).

**What grows with paying clubs.** At 10–20 clubs with students on the mobile app, expect about
**€135–380/month** with IVA: Railway Pro with a larger database, Resend Pro, more Anthropic usage,
and possibly Expo Starter and Sentry Team. **Clerk is the largest step.** Free and Pro allow 20
members per organization, and the add-on that removes that limit is about €109/month with IVA.
It is only needed if students and guardians become members of the club's organization in Clerk,
which is the open question in `docs/decisions.md` (management-seat sizing).

## Known limitations, with dates

Things that are true today, were decided rather than overlooked, and have a plan.

- **`/admin` shares an origin and a cookie with the tenant app** — noted 22 September 2026,
  POOLSE-64 item 3. One cross-site scripting bug anywhere in Poolse is therefore an admin
  compromise, because the same session cookie reaches the platform area. *The plan:* its own
  subdomain and its own Vercel project, pointing at the same API, when that is convenient —
  the guard is already module-scoped and reads `currentAuth()`, so nothing about the split is
  blocked by the code. *Until then:* the enforced CSP (asserted in `security-headers.test.ts`),
  the typed club name on irreversible acts, an alert on every write and every refusal, and a
  ceiling five times tighter than the rest of the API. Step-up auth is the piece that would
  make it genuinely small, and it waits on the production Clerk instance.

- **Public pages are throttled per token or per slug, not per visitor** — noted 16 October 2026.
  One address rotating guessed tokens is never slowed, and each guess costs one database call.
  The tokens are 256-bit, so this is load, not guessing. *The plan:* a per-visitor ceiling across
  `public/*`, keyed on the forwarded address, which is trustworthy only once `WEB_PROXY_SECRET`
  is set in production.

## Rotating `DATABASE_PLATFORM_URL`

That credential reads every tenant in the product. Rotate it if it has been pasted anywhere
it should not have been, if a machine holding it is lost, or once a year on principle.

1. Generate a password and compose the new URL — same host, port and database, user
   `poolse_platform`.
2. `ALTER ROLE poolse_platform WITH PASSWORD '<new>';` as the owner, against that
   environment's database. The role itself is untouched, so no grant or policy changes.
3. Set `DATABASE_PLATFORM_URL` on the API service (Railway) for that environment **only**.
   It appears in no other service.
4. Redeploy the API. The pool is lazy, so in-flight requests finish on the old connection and
   the next one opens with the new password; `assertPlatformRoleIsNarrow()` re-runs at boot
   and refuses to start if the new URL points at the owner or a `BYPASSRLS` role.
5. Open `/admin`. A tenant list that loads is the whole verification — and it leaves a
   `platform_audit_log` row saying the rotation was tested and by whom.

There is no second consumer to coordinate with, which is the property worth keeping: if this
credential ever needs to be set in two places, that is the change to argue about.

## When something is wrong

| Symptom | Almost always |
|---|---|
| API will not boot, complains about RLS | `DATABASE_APP_URL` points at the owner role. Run `pnpm db:bootstrap` |
| Every API call returns 401 | `CLERK_AUTHORIZED_PARTIES` does not list the exact web origin, scheme included |
| API boots, every list is empty | Something bypassed `withOrg` and the GUC is unset. RLS is doing its job; the query is the bug |
| Deploy fails at pre-deploy | A migration failed. Previous version is still serving. Read the log, fix, redeploy |
| Webhook 400s in Clerk's dashboard | `CLERK_WEBHOOK_SIGNING_SECRET` does not match that endpoint's secret |
