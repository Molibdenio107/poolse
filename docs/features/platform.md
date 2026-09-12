# Platform administration

The operator's side of Poolse: one place to see every tenant, what it is paying and how
much of its plan it is using. Lives at `/admin`.

**Platform admin is not a tenant role.** `member_role` says what somebody may do inside one
club — Owner, Admin, Instructor, Maintenance, Student, Encarregado. This says whether
somebody may look at *all* the clubs. The two are orthogonal: no `member_role` grants
platform access, and platform access grants nothing inside any tenant. Being owner of an
organization — including a demo one anybody can create in thirty seconds — means nothing
here.

## Who can reach it

A row in `platform_admin`, keyed on the Clerk user id. There are two or three of these for
the life of the company, and there is no screen to manage them. They are granted at a
terminal by somebody holding the owner database credentials:

```bash
pnpm db:platform-admin list
pnpm db:platform-admin grant  user_2abc…  "Rui"
pnpm db:platform-admin revoke user_2abc…
```

Find the Clerk user id in the Clerk dashboard under **Users**, or with `clerk users list`.
It differs between the development, staging and production Clerk instances, which is why
this is a script rather than a migration carrying a literal.

Revoking is a soft delete — the row stays, archived — and takes effect on the next request.
`PlatformAdminGuard` holds no cache.

## What enforces it

`PlatformAdminGuard`, applied to every controller in `PlatformModule`. There is no
decorator to opt out with, so an endpoint added to that module next month is guarded
because nobody had to remember.

The guard reads `currentAuth().clerkUserId`, never `currentTenant()`. `/platform/(.*)` is in
`IDENTITY_ONLY_ROUTES`, so the request is authenticated but has no tenant resolved — an
operator who belongs to no organization at all must be able to open this, and under
`TenantMiddleware` they would be refused with `no_organization` before the guard saw them.

Three answers, told apart by a stable `code` rather than by prose:

| Code | Status | Means |
|---|---|---|
| `not_platform_admin` | 403 | You are signed in and this is not for you. |
| `platform_not_configured` | 503 | `DATABASE_PLATFORM_URL` is unset. Nothing the caller does fixes it. |
| — | 200 | You are an operator. |

The web app hides `/admin` from every navigation and redirects a non-admin to `/dashboard`,
but hiding a control is never the control: the guard is.

## The database connection

Cross-tenant reads go through a **third** Postgres login, `poolse_platform`, on its own
small pool (`DATABASE_PLATFORM_URL`), used by `PlatformModule` and nothing else. The
tenant-facing connection stays exactly as it was.

It does **not** carry `BYPASSRLS`. Row-level security still applies to it; it is named in a
`FOR SELECT TO poolse_platform USING (true)` policy on each of seven tables and has no
privilege at all on the rest of the schema:

`organization`, `membership`, `membership_role`, `invitation`, `facility`, `pool`,
`audit_log`

Two things follow, and both are the point. A mistake here leaks those seven tables rather
than the whole database — there is no grant that would let the platform read a student
register, an invoice or a medical note. And widening its reach is a reviewed line of SQL
rather than something that happens by default.

`assertPlatformRoleIsNarrow()` refuses to boot the API if `DATABASE_PLATFORM_URL` points at
a superuser, a `BYPASSRLS` role, or the table owner — the mirror of `assertRlsApplies()`,
for the mirror-image mistake.

Proved in `packages/db/test/platform-admin.sql`: the tenant connection cannot see the
platform's tables at all; the platform connection reads across tenants but is refused
`student`, `student_sensitive` and `invoice`, cannot write to `organization`, and cannot
grant itself platform access.

## Setting it up

```bash
# .env
DATABASE_PLATFORM_URL=postgresql://poolse_platform:…@host:5432/poolse_dev

pnpm db:bootstrap        # creates the role and proves it is narrow
pnpm db:migrate          # creates the tables, policies and grants
pnpm db:platform-admin grant user_… "Your name"
```

Optional throughout. Leave `DATABASE_PLATFORM_URL` unset and the rest of the product runs
normally; `/admin` says it is not configured rather than failing in a way that looks like a
permission problem.

## The tenants table

`GET /platform/tenants?page=&limit=&search=` — the standard paginated envelope, the same
page size and the same two-character search floor as every list in the tenant app.

| Column | Definition |
|---|---|
| Organização | Name, slug, and an icon separating a `business` tenant from a `personal` one. An archived tenant is listed and marked, because churn is worth seeing. |
| Subscrição | `trialing`, `active`, `past_due`, `canceled` or `comped`, with the trial's end date under it. |
| Plano | Always empty for now. Plan tiers are indicative in `docs/decisions.md` and modelled nowhere; the cell says "sem plano" rather than leaving a blank that reads as a failed load. |
| Lugares de gestão | Active management memberships **plus** invitations still outstanding, against `max_management_users`. |
| Instalações | Live facilities against `max_facilities`. |
| Tanques | Live pools. |
| Criada | `organization.created_at`. |
| Última atividade | `max(audit_log.created_at)` for that tenant. |

**Seats count promised seats, not just taken ones.** An invitation already creates its
membership row at status `invited`, so the sum counts `active` memberships on one side and
live invitations on the other — each promised seat exactly once. "Live" means not accepted,
not revoked and not expired: without the expiry test the 24-hour window would let a tenant
overshoot by inviting, waiting a day and inviting again. Students and encarregados de
educação never count; they scale independently (`docs/decisions.md`, 2026-09-06).

**"Last activity" is the last *recorded write*, not the last login.** `audit_log` already
carries `(organization_id, created_at DESC)`, so it is one index lookup per tenant, and it
is the only table in the schema that moves on every mutation path — thirty-four call sites
across invitations, students, classes, billing and settings. A club whose staff spent an
afternoon reading registers without changing anything shows the morning's last edit. That
is the right trade for an overview; per-request health is a separate thing with its own
retention policy.

**A null ceiling is unlimited, never zero** — the same reading as `pool.max_capacity`. The
column simply is not drawn. A tenant *over* its ceiling is marked in red rather than hidden:
`max_management_users` is a soft quota that nothing enforces yet, so a club genuinely can
sit above it, and that is the row an operator opened this screen to find.

## The audit trail

Every request that reaches `PlatformModule` writes one line to `platform_audit_log` — who,
what, when, and which tenant if the route names one. **Reads included.** There is nothing to
*do* on this side of the product yet, and logging a read costs a single insert on a screen
one person opens; the habit has to exist before the actions do.

The row records the *request* — the search term, the page — and never the response. A copy
of every tenant's figures in a table nobody is watching is a second copy to protect.

A 403 from the guard is written by the guard itself, because a guard runs before every
interceptor in Nest and that refusal is precisely the request worth having a record of.

The table is append-only even to the operator: `poolse_platform` holds `SELECT` and `INSERT`
and nothing else, and `poolse_app` is refused it outright.

## Not in this slice

Extending a trial, changing a plan, suspending a tenant, per-tenant feature flags, support
"view as", the Clerk MAU pull and cross-tenant analytics. The screen is read-only on
purpose: half a set of actions is a screen whose disabled controls need explaining.
