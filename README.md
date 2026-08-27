# Poolse

Multi-tenant SaaS for pool management. See `CLAUDE.md` for the operating brief and
`docs/` for product scope, data model and roadmap.

## Status

Phase 0 is complete except the deploys, and phase 1 has started.

There is now a front door: public landing and pricing pages at `/` and `/en`,
statically prerendered, with no authentication and no database call. Signing up
creates the organization on a 14-day trial with its first facility already there,
and drops you into the app. From there an operator sets up sites and pools,
invites their staff with roles that mean something, and keeps a student register
with their own progression of levels — searchable the way a Portuguese operator
types, accents optional. Medical notes and consent live behind their own screen,
encrypted before they reach the database, with every read written to the audit
log.

The interface speaks Portuguese and English from a preference that follows the
person across devices, light and dark are chosen before first paint, tenant
isolation is enforced by the database and proven by 80 assertions, and every
mutation records who did it.

Nothing sends the invitation email yet — the inviter copies the link, and can
reissue it if they lose it. Pricing amounts on `/pricing` are marked placeholders,
not invented figures.

Still open: 0.10, staging and production deploys, which needs hosting accounts.
See `docs/deploy.md`.

## Requirements

- Node 22+
- pnpm 10+
- Docker (for the local Postgres 16 — or your own Postgres 16+, see below)
- A Clerk application (development instance is fine)

## Setup

```bash
pnpm install
cp .env.example .env          # then fill in
```

One `.env` at the repo root serves all three: the API reads it through
`apps/api/src/load-env.ts`, the web app through `next.config.mjs`, and the
database scripts through Node's `--env-file-if-exists`. Nothing to keep in sync,
and nothing to read in staging or production, where the platform injects real
environment variables and an absent file is expected.

From the Clerk dashboard, fill in `CLERK_SECRET_KEY` and
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. For the webhook, add an endpoint pointing at
`<api-url>/webhooks/clerk` subscribed to `user.created`, `user.updated` and
`user.deleted`, and copy its signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`.
The API refuses to start without all three: an unverified webhook endpoint is an
unauthenticated write path into `app_user`.

Locally, Clerk cannot reach `localhost` without a tunnel. You do not need one to
get started — `GET /me` provisions from the Clerk API when the webhook has not
arrived, using the same upsert, so sign-up works either way. Set the tunnel up
before trusting `user.updated` and `user.deleted`.

Start the database. `docker-compose.yml` brings up Postgres 16 already holding
the two roles the app needs — the owner (`postgres`) that migrations run as, and
the unprivileged `poolse_app` that the API connects as. **They must be different
roles**: the app connecting as the table owner silently disables every RLS policy
in the schema, so tenant isolation stops working with no visible symptom. The API
refuses to start if it detects this.

```bash
pnpm db:up          # docker compose up -d --wait
```

The defaults in `.env.example` already match the container, so nothing to fill in
for the database. Bringing your own Postgres instead means creating `poolse_dev`
and the `poolse_app` role by hand — `docker/postgres/init/01-app-role.sql` is the
whole of it — and pointing the two URLs at it.

Then migrate and prove isolation works:

```bash
pnpm db:migrate
pnpm db:test
```

On a hosted database — anywhere the connection string you are given belongs to the
owner — run `pnpm db:bootstrap` first. It creates `poolse_app` from
`DATABASE_APP_URL` and then proves it can log in, is not a superuser, has no
`BYPASSRLS` and owns no tables. Skipping it is the one mistake that disables
tenant isolation with no visible symptom. See `docs/deploy.md`.

`pnpm db:seed` fills the organization you already have with a club-shaped set of
demo data: named staff, forty-odd students with realistic Portuguese names and
ages matched to their levels, enrollments with a waiting list, six weeks of
marked registers, and leave in each state the screens can show. It exists because
none of those screens can be *judged* against one student and an empty register.

It is additive and re-runnable — a second run adds only what is missing, and the
choices are deterministic, so "the register that is still unmarked" is the same
one tomorrow. It seeds into the existing organization rather than creating a
second one, because there is no organization switcher and a second org would
either be invisible or hide the first. It refuses to run against a database whose
URL does not look local.

Other database commands: `pnpm db:down` stops the container and keeps the data,
`pnpm db:reset` throws the volume away and migrates a fresh one, `pnpm db:psql`
opens a shell on it.

`pnpm db:test` runs eleven SQL suites, all of them written in SQL on purpose:
what they prove is a property of the database, and asserting it through the query
layer would only prove the query layer behaves.

`tenant-isolation.sql` seeds two organizations and then attacks them: an unscoped
`SELECT` with no `WHERE` clause, a write aimed at another tenant, and a row
referencing another tenant's parent. `clerk-provisioning.sql` covers webhook
redelivery, out-of-order events and account deletion. `invitations.sql` covers the
join flow — single use, expiry, revocation, and re-inviting someone who is already
a member. `preferences.sql` covers the locale and theme constraints.
`audit-log.sql` covers append-only enforcement and that no invitation token ever
reaches the log. `facilities.sql` covers the name constraints and that a pool
cannot be placed at another organization's site. `students.sql` covers
accent-insensitive search and that a student cannot be put in another
organization's level. `consent.sql` covers the write-once consent trail, that the
database never holds readable medical notes, and that a student's photograph is
readable only while a photo consent is granted and live. `ownership.sql` covers
the single-owner rule and that ownership can still be transferred.

Three of those tests are the ones to keep forever: `clerk-provisioning` test 6 and
`invitations` test 8, which both hold the line that the `SECURITY DEFINER`
functions are the *only* way to read across tenants with the ordinary path still
blind, and `invitations` test 3, which is the whole invitation flow end to end.
Keep all eleven suites running in CI: they are what stands between a mistake in a
repository method and a customer seeing another customer's data.

## Running

```bash
pnpm dev        # web on :3000, api on :3001
pnpm typecheck
pnpm i18n:check # every t('…') key resolves, in every locale
pnpm api:test   # unit tests: the sensitive-data cipher, national holidays
pnpm web:test   # unit tests: calendar arithmetic and level age ranges
pnpm build
```

`web:test` runs `node --test` over `src/**/*.test.ts` with Node's own type
stripping — no test framework and no extra dependency. It exists because the two
modules it covers are pure functions whose bugs are invisible: a season that ends
in four days, a week that starts on Sunday, an age that is a year out on
somebody's birthday. It found one of those the day it was written.

`i18n:check` exists because TypeScript cannot help here: `t('facilities.title')`
is just a string, so a typo compiles, builds, deploys and then renders the key
itself in front of a customer. It also catches the usual failure — a string added
to `pt-PT` and forgotten in `en`.

## Layout

```
apps/
  web/          Next.js App Router — backoffice. Theme tokens and i18n wired from the start.
  api/          NestJS REST API. TenantMiddleware resolves the org for every request.
packages/
  db/           Migrations, the tenant-scoped connection helper, the isolation test.
docs/           Product spec, data model, roadmap, deploy runbook.
CLAUDE.md       Operating brief — read first.
```

## The one rule

Tenant data is reached through `withOrg(organizationId, fn)` from `@poolse/db`.
Nothing else. If a request path calls `pool.query` directly, that is the bug —
RLS will return zero rows rather than leak, so the symptom is "no data" rather
than a breach, but it is still the bug.

`withoutTenantScope` does **not** lift RLS — it only skips setting the GUC, so a
plain query inside it reads zero rows. It exists to call the seven `SECURITY
DEFINER` functions that own the cross-tenant reads:

| Function | Answers |
|---|---|
| `provision_app_user` | the Clerk webhook writing the identity cache |
| `deactivate_app_user` | Clerk deleted this account |
| `find_app_user` | who am I, before any organization is known |
| `resolve_memberships` | which organizations may I be scoped to |
| `create_organization` | make one, when I belong to none |
| `find_invitation_by_token` | what is this link offering |
| `accept_invitation` | redeem it |
| `set_app_user_preferences` | change my own language or theme |

That last one looks out of place and is not: `app_user` carries no
`organization_id`, so its policy scopes it *through membership*. An account
belonging to no organization cannot see its own row — the state every account
starts in — which makes "change my language" a cross-tenant write.

Every one of them answers a question asked *before* a tenant exists, which is why
RLS would (correctly) answer "no rows". A new cross-tenant read gets a new reviewed
function; there is no general escape hatch. See `docs/data-model.md`, decision 2.

## Deploying

`docs/deploy.md` is the runbook: Vercel for the web app, Railway for the API and
Postgres, staging and production separate from day one. The repository side is
done — `Dockerfile`, `railway.json`, `vercel.json`, migrations as a pre-deploy
step, and a `/health` that returns 503 when the database is unreachable so a
broken release rolls back instead of going live.

## A trap worth knowing

`pnpm build` and `pnpm dev` share `apps/web/.next`. Building while the dev server is up
replaces the chunks it is serving and every request then 500s with
`Cannot find module './NNNN.js'` — which looks exactly like a defect in whatever you just
edited. Stop the dev server first, and note that killing it can leave the child `node`
processes holding 3000 and 3001.

`pnpm typecheck`, `pnpm i18n:check`, `pnpm db:test` and `pnpm api:test` all touch nothing
in `.next` and are safe to run while it is up.

## Next slice

**1.8 — attendance marking.** The last thing between phase 1 and an operator
running real classes on Poolse, and the slice that unblocks backlog round 3's
remaining rule: a class with attendance recorded cannot be removed.

Backlog rounds 2 to 4 are otherwise done; see `docs/roadmap.md` for what is left
and why.
