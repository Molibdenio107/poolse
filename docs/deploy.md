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

## The two roles, and why this step is not optional

Railway hands you one connection string. It belongs to the database owner.

If you point `DATABASE_APP_URL` at it, everything appears to work — the app boots, queries
return rows, the tests pass. And every row-level security policy in the schema is silently
inert, because in Postgres a table's owner bypasses RLS. There is no error. There is no
symptom. The first symptom is a customer seeing another customer's data.

So each environment gets two roles:

| Role | Connection string | Used by |
|---|---|---|
| owner (Railway's default, usually `postgres`) | `DATABASE_URL` | migrations, and only migrations |
| `poolse_app` | `DATABASE_APP_URL` | the API, always |

`pnpm db:bootstrap` creates the second one from `DATABASE_APP_URL` and then proves it can
log in, is not a superuser, has no `BYPASSRLS`, and owns no tables. The API also refuses to
start if it detects otherwise (`assertRlsApplies`), so this is checked twice on purpose.

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
   to the API, which is the only thing holding credentials.

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

## When something is wrong

| Symptom | Almost always |
|---|---|
| API will not boot, complains about RLS | `DATABASE_APP_URL` points at the owner role. Run `pnpm db:bootstrap` |
| Every API call returns 401 | `CLERK_AUTHORIZED_PARTIES` does not list the exact web origin, scheme included |
| API boots, every list is empty | Something bypassed `withOrg` and the GUC is unset. RLS is doing its job; the query is the bug |
| Deploy fails at pre-deploy | A migration failed. Previous version is still serving. Read the log, fix, redeploy |
| Webhook 400s in Clerk's dashboard | `CLERK_WEBHOOK_SIGNING_SECRET` does not match that endpoint's secret |
