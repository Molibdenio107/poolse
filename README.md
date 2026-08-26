# Poolse

Multi-tenant SaaS for pool management. See `CLAUDE.md` for the operating brief and
`docs/` for product scope, data model and roadmap.

## Status

Phase 0 slices 0.1–0.3 (partial). The monorepo boots, the core tenancy schema
migrates, and tenant isolation is enforced and proven by test. Clerk verification
is stubbed and marked `TODO slice 0.4` — the API will not start until it is wired,
which is deliberate.

## Requirements

- Node 22+
- pnpm 10+
- PostgreSQL 16+

## Setup

```bash
pnpm install
cp .env.example .env          # then fill in
```

Create the database and the two roles. **They must be different roles** — the app
connecting as the table owner silently disables every RLS policy in the schema:

```bash
createdb poolse_dev
psql -d poolse_dev -c "CREATE ROLE poolse_app LOGIN PASSWORD 'change-me';"
```

Then migrate and prove isolation works:

```bash
pnpm db:migrate
pnpm db:test
```

`pnpm db:test` runs `packages/db/test/tenant-isolation.sql`, which seeds two
organizations and then attacks them: an unscoped `SELECT` with no `WHERE` clause,
a write aimed at another tenant, and a row referencing another tenant's parent.
All seven assertions must pass. Keep this running in CI forever — it is the only
thing standing between a mistake in a repository method and a customer seeing
another customer's data.

## Running

```bash
pnpm dev        # web on :3000, api on :3001
pnpm typecheck
pnpm build
```

## Layout

```
apps/
  web/          Next.js App Router — backoffice. Theme tokens and i18n wired from the start.
  api/          NestJS REST API. TenantMiddleware resolves the org for every request.
packages/
  db/           Migrations, the tenant-scoped connection helper, the isolation test.
docs/           Product spec, data model, roadmap.
CLAUDE.md       Operating brief — read first.
```

## The one rule

Tenant data is reached through `withOrg(organizationId, fn)` from `@poolse/db`.
Nothing else. If a request path calls `pool.query` directly, that is the bug —
RLS will return zero rows rather than leak, so the symptom is "no data" rather
than a breach, but it is still the bug.

`withoutTenantScope` exists for the handful of genuinely cross-tenant operations
(the Clerk webhook, invitation lookup by token). Anything using it should be able
to justify itself in one sentence.

## Next slice

**0.4 — Clerk wired both sides, webhook provisions `app_user` and maintains the
name/email cache.** Replace `getVerifiedClerkUserId` in
`apps/api/src/tenant/tenant.middleware.ts`. Then 0.5, invitations, without which
nobody but the signing-up owner can exist in the system.
