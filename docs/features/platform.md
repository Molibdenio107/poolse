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
what, when, and which tenant if the route names one. **Reads included**: logging a read costs
a single insert on a screen one person opens, and the habit had to exist before the actions
did.

The *mechanism* differs by direction, and the difference matters. `PlatformAuditInterceptor`
records reads, after the handler settles. A **write records itself, inside the transaction
that performed it** — see Actions below — because an entry written on a separate connection
can commit while the change rolls back.

The row records the *request* — the search term, the page — and never the response. A copy
of every tenant's figures in a table nobody is watching is a second copy to protect.

A 403 from the guard is written by the guard itself, because a guard runs before every
interceptor in Nest and that refusal is precisely the request worth having a record of.

The table is append-only even to the operator: `poolse_platform` holds `SELECT` and `INSERT`
and nothing else, and `poolse_app` is refused it outright.

## Actions — slice 3

Four things an operator can change, on `/admin/tenants/[id]`. Each is its own endpoint and
its own small form: they are four unrelated decisions taken at different moments, and one
Save across all of them would mean adjusting a seat count and silently rewriting a trial
date at the same time.

| Action | Endpoint | Writes |
|---|---|---|
| Set the trial end date | `POST /platform/tenants/:id/trial` | `trial_ends_at` |
| Set the subscription state | `POST /platform/tenants/:id/subscription` | `subscription_status` |
| Set the plan ceilings | `POST /platform/tenants/:id/plan` | `max_facilities`, `max_management_users` |
| Suspend or restore | `POST /platform/tenants/:id/suspension` | `suspended_at`, `suspension_reason` |

### How the platform is allowed to write at all

`poolse_platform` holds **column-level `UPDATE` on exactly six columns** of `organization`,
plus a `FOR UPDATE` policy. Not a `SECURITY DEFINER` function — the migration checklist says
to stop and reconsider before writing a second one, and a column grant turned out to be both
simpler and narrower. What it cannot do is unchanged and still asserted:

```
UPDATE organization SET name = …         → permission denied
UPDATE organization SET archived_at = …  → permission denied
DELETE FROM organization                 → permission denied
INSERT INTO organization                 → permission denied  (signup is the only way in)
```

`packages/db/test/platform-admin.sql` test 5a — "the platform role cannot write to
organization", written in slice 1 against the tenant's *name* — passes unchanged. The reach
widened by six columns and the assertion guarding the rest never moved.

### A write records itself

`PlatformAuditInterceptor` logs **reads only**. A write is recorded by `changeTenant` inside
the transaction that performed it, because an audit entry written on a separate connection
can commit while the change rolls back — leaving a trail that says a tenant was suspended
when it was not. The entry carries the **before and after of every column that actually
moved**; a change that changes nothing records `{}` rather than a phantom edit.

The consequence worth stating: a non-GET platform endpoint that does not go through
`changeTenant` is not audited at all. There is one write path and it cannot skip its own
entry, which is what makes that safe rather than merely true today.

### Suspension

**`suspended_at` is not `subscription_status = 'past_due'`.** A club whose card expired on
Tuesday is past due; it is also mid-lesson with thirty children in the water. Billing state
and access state move at different times and for different reasons, and only the second one
shuts a door. It is also not `archived_at`, which is deletion and is not an operator action.

A suspension **always carries a reason** — the schema refuses one without the other — because
the person who meets it is a club owner at 08:00 being told their account is closed, and
"suspended" with no sentence beneath it is a support call starting from nothing. The reason
is shown to them verbatim, trimmed and capped at 500 characters.

Enforced in `TenantMiddleware`, which throws 403 with `code: 'tenant_suspended'` and the
reason on the body. Three things stay open on purpose:

- **`/me` keeps answering.** It is identity-only, so the middleware never runs for it. Had
  suspension been enforced inside `resolve_memberships` instead, a suspended club would be
  indistinguishable from somebody who belongs to no organization — sent to create a second
  club rather than told why the first is shut.
- **The web app draws a screen, not an error.** `dashboard/layout.tsx` renders
  `SuspendedNotice` *instead of* the shell, so nothing underneath fires a request that is
  going to be refused. It quotes the reason, says when, says plainly that nothing was
  deleted, and gives an address.
- **`/platform` is unaffected**, so an operator who suspends the tenant they happen to belong
  to can still reach the screen that undoes it.

Suspending is behind a confirmation dialog that spells out what it does. Restoring is one
click: nothing is made safer by slowing down the safe direction.

### Validation

At the edge, in `platform-actions.ts`, and every refusal names its field so the web app can
put it beside the box that caused it.

- A trial date **more than two years out is refused** — `2027` typed for `2026` is one
  keystroke and silently gives somebody two years free. A date in the **past is allowed**:
  ending a trial today is something an operator means to do.
- `max_facilities` is at least 1. Lowering it below what a club already has does not
  retroactively refuse anything — the licence trigger is on `facility` — so the existing sites
  stay and the next one is refused. The list marks a tenant over its ceiling in red.
- `max_management_users` is null-means-unlimited; **`0` is refused** rather than read as
  unlimited, because a quota of nought is a tenant nobody can log into.
- A suspension reason is required, trimmed, and at most 500 characters.

## Not in this slice

Per-tenant feature flags, support "view as", the Clerk MAU pull and cross-tenant analytics.
Deleting a tenant is deliberately still impossible from here.
