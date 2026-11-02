# Go-live runbook — production, first pilot

Rui's order (29-10-2026, confirmed 02-11-2026): **re-test on dev → deploy production**, with no
staging deploy first. This page is the deploy, in the order to do it. The *why* behind each step
lives in [`deploy.md`](./deploy.md); this is the *what*, ticked off once.

The pilot is **unpaid** (02-11-2026), so Stripe, certified invoicing and Open-Meteo's commercial
licence are not part of it. Every paid service starts on its free or cheapest plan
(`deploy.md`, *Paid services*): about €7–17 a month.

**Who does what.** Rui creates the accounts and enters a card where one is needed. Claude
generates the secrets, composes every variable, runs the bootstrap and the checks, and fixes what
fails. A secret is pasted by Rui into the dashboard and into the password manager, and never into
a chat, a commit or a file in the repo.

---

## 0. Before starting

- [ ] Rui's walk of [`backlog/TEST-PLAN.md`](./backlog/TEST-PLAN.md) on dev is clean, and its fixes are on `main`.
- [ ] `main` is green: `pnpm typecheck`, `pnpm web:test`, `pnpm db:test`, `pnpm api:test`, the checks
      (`i18n`, `forms`, `pt`, `contrast`, `audit:check`), and the Playwright run against a production build.
- [ ] The API's production image builds **and starts**: `docker build -f apps/api/Dockerfile .`, then run it
      against the dev database and read `/health` (proved 02-11-2026, after `packages/rules` was added to the
      Dockerfile — it had been missing since that package was created, so no image had built since).
- [ ] The web app's production build passes: `pnpm --filter @poolse/web build`, **with the dev server stopped**
      (a build while `pnpm dev` runs breaks both). Vercel runs the same build.
- [ ] **The domain is chosen and bought** (e.g. `poolse.pt`). Clerk's production instance and Resend's
      sending domain both need DNS records on it, so this comes first.

## 1. Secrets to generate, once — and keep for ever

Claude generates these on Rui's machine. Rui puts each in the password manager **before** it goes
into a dashboard. The first three cannot be changed later without consequences.

| Secret | How | If it is lost |
|---|---|---|
| `SENSITIVE_DATA_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Every medical note, incident text, ID number and sealed file becomes unreadable. **Two copies, one offline.** |
| Backup age key pair | `pnpm --filter @poolse/db backup:keygen <file>` | Every backup becomes a file nobody can open. **Two copies, one offline.** |
| VAPID key pair | `npx web-push generate-vapid-keys` | Changing it silently unsubscribes every phone. |
| `poolse_app` password | `openssl rand -base64 32` (URL-safe) | Rotate: change the role's password and the variable together. |
| `poolse_platform` password | as above | Rotate: `deploy.md`, *Rotating `DATABASE_PLATFORM_URL`*. |
| `WEB_PROXY_SECRET` | as above | Rotate on both sides at once. |
| `SIGNUP_IP_SALT` | as above | Rotating it only resets the signup-origin counts. |

## 2. Accounts (Rui)

- [ ] **Railway**: Hobby plan, project `poolse`, environment `production`.
- [ ] **Vercel**: Hobby for the free pilot (Pro the day a club pays), project `poolse-web` from the GitHub repo.
- [ ] **Clerk**: a **production instance**, separate from the development one, on the domain; add its DNS records.
- [ ] **Resend**: free plan; verify the domain (its DNS records), and an inbound domain if results by email are wanted (POOLSE-114).
- [ ] **Cloudflare R2**: two private buckets, `poolse-production` (uploads) and `poolse-backups-production`, each with an API token scoped to that one bucket.
- [ ] **Anthropic**: an API key with a monthly spend limit set on console.anthropic.com.
- [ ] **Sentry** (optional): two DSNs, API and web.
- [ ] **Mailboxes**: `PLATFORM_ALERT_EMAIL`, a mailbox **not** reachable by taking over Rui's Clerk account; and the support address families and clubs see.

## 3. Railway — database and API

1. [ ] Add **Postgres** to `production`. Note its major version (for `PG_TOOLS_IMAGE`).
2. [ ] Check TimescaleDB: `CREATE EXTENSION IF NOT EXISTS timescaledb;`. If refused, nothing breaks
       (energy readings and request stats fall back to plain tables, `deploy.md`); write down which.
3. [ ] Add the **service from the GitHub repo**, root directory the repository root (`railway.json` does the rest:
       Dockerfile, migrations before each deploy, `/health`).
4. [ ] Set the API variables below, then **bootstrap the roles from Rui's machine** against the public database URL:
       `DATABASE_URL='<owner>' DATABASE_APP_URL='<poolse_app>' DATABASE_PLATFORM_URL='<poolse_platform>' pnpm db:bootstrap`.
       Read every line it prints.
5. [ ] Deploy. The pre-deploy step migrates; a failure keeps the previous version serving.
6. [ ] Generate the public domain (e.g. `api.<domain>`).

### API variables (Railway, `production`)

**Required — the API will not start without the first four**:

| Variable | Value |
|---|---|
| `DATABASE_APP_URL` | Railway's URL with user `poolse_app` and its password |
| `CLERK_SECRET_KEY` | Clerk **production** instance |
| `CLERK_WEBHOOK_SIGNING_SECRET` | from step 5 (a placeholder until then) |
| `SENSITIVE_DATA_KEY` | §1 |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — the owner, used by migrations only |
| `DATABASE_PLATFORM_URL` | Railway's URL with user `poolse_platform` (else `/admin` says it is not configured) |
| `CLERK_AUTHORIZED_PARTIES` | the web app's URL, e.g. `https://app.<domain>` |
| `WEB_ORIGIN` | the same URL |
| `APP_ENV` | `production` |
| `WEB_PROXY_SECRET` | §1, the same value as on Vercel |
| `SIGNUP_IP_SALT` | §1 |
| `PLATFORM_ALERT_EMAIL` | §2 |
| `SUPPORT_EMAIL` | the support address shown in owner notices |

**The services** — each is off, and says so, until set:

| Variable | Value |
|---|---|
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_FROM` | `resend`, the key, `Poolse <nao-responder@<domain>>` on the verified domain |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_REGION` | R2's endpoint, `poolse-production`, the scoped token, `auto`. **Not** `S3_FORCE_PATH_STYLE` (S3Mock only) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | §1, `mailto:` an address Rui reads |
| `ANTHROPIC_API_KEY` | §2; each reader is still off until switched on at `/admin` |
| `INBOUND_DOMAIN` / `RESEND_INBOUND_WEBHOOK_SECRET` | only for results by email (POOLSE-114) |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | optional; `production` |

**Never set in production**: `INBOUND_DEV_SECRET`, `S3_FORCE_PATH_STYLE`, `API_PORT` (Railway injects
`PORT`), `SEED_*`, `WEATHER_HISTORY_ENABLED` (Open-Meteo's archive is non-commercial). **Not for the
unpaid pilot**: `STRIPE_*` — absent, the Subscrição page says so and the webhook answers 503.

## 4. Vercel — the web app

1. [ ] Import the repo (Next.js; `vercel.json` sets the workspace build).
2. [ ] Set the variables below for **Production**, then deploy, then attach the domain (e.g. `app.<domain>`).
3. [ ] Read the build log for `Failed to download … Using fallback font` (POOLSE-138). Absent is correct.
4. [ ] Go back to Railway and make sure `CLERK_AUTHORIZED_PARTIES` and `WEB_ORIGIN` name this exact URL.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | the Railway API URL |
| `NEXT_PUBLIC_APP_URL` | the web app's own URL (the public water page's printed link uses it) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk **production** instance |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `…_SIGN_UP_URL` | `/sign-in`, `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` / `…_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | the support address (a suspended club is told to write to it) |
| `WEB_PROXY_SECRET` | §1, the same value as on Railway — **never** `NEXT_PUBLIC_` |
| `ANTHROPIC_API_KEY` | §2 (the readers run on the Next server) |
| `NEXT_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | optional; `production` |

**No `DATABASE_*` here, ever** — the build's tests fail if a `NEXT_PUBLIC_` value looks like one.
Delete any old `*_AI_ENABLED` flags: nothing reads them (POOLSE-137).

## 5. Clerk webhook, Resend, Sentry

- [ ] Clerk production → webhook `https://<api>/webhooks/clerk`, events `user.created`, `user.updated`,
      `user.deleted`; its signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`; redeploy the API.
- [ ] Resend inbound (if used) → `email.received` to `https://<api>/webhooks/resend-inbound`.
- [ ] `/health` answers `"status":"ok"` with `postgres` and `clerk` ok in `checks` (`timescale` may read
      `not_installed`); a slow Clerk is `degraded`, still 200.

## 6. Prove it (Claude runs, Rui watches)

1. [ ] `/health` → ok. The landing page → both status rows green.
2. [ ] Rui signs up on production → lands on `/dashboard`; Clerk's webhook log shows `user.created` 2xx.
3. [ ] `pnpm db:platform-admin grant <Rui's production clerk_user_id>` → `/admin` opens.
4. [ ] A throwaway club: a site, a tank, a turma, an invitation accepted in a private window, a photo
      uploaded and opened (R2), a message sent and received (Resend), a push to an installed phone (VAPID).
5. [ ] `/admin` → the throwaway club archived. Production keeps no test data.
6. [ ] The API refused to start with a wrong role, if anything was mistyped: `assertRlsApplies` and
      `assertPlatformRoleIsNarrow` are the proof the database login is right.

## 7. Backups — before the pilot club enters a single child

`deploy.md`, *Backups and restoring → Setting it up*: the GitHub `production` environment's secrets,
`PG_TOOLS_IMAGE=postgres:<major>`, then `BACKUPS_ENABLED=true`; run *Nightly backup* and *Backup check*
by hand, then one restore drill on Rui's machine. Write the drill's date in `deploy.md`.

## 8. The pilot club

- [ ] The club signs up itself (one person, one trial — POOLSE-62).
- [ ] `/admin` → its modules: off are invoicing, reception, maintenance, energy, salaries, vacations and
      qualifications (Rui, 20-10-2026); its sports; its AI readers ticked (the energy bill reader is on by
      decision, POOLSE-106) with a monthly cap.
- [ ] Its trial set to run for the pilot (`/admin` → trial date), so the clock does not move it to read-only.

## Left for the day a club pays

Stripe live (`STRIPE_*`, prices still undecided), Vercel Pro (Hobby is non-commercial), Clerk Pro with MFA
and step-up on `/admin`, certified invoicing (POOLSE-76), Open-Meteo off or on IPMA, the full
Content-Security-Policy, and the dependency majors — `deploy.md`, *The go-live checklist*.
