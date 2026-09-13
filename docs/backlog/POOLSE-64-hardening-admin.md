# POOLSE-64 · Hardening `/admin`

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Hardening · **Area:** Platform / Security · **Priority:** Medium, rising with the second tenant · **Slice E**

### PO — why this exists

The platform area is already better shaped than most: its own database login with **no
`BYPASSRLS`**, per-table `FOR SELECT TO poolse_platform` policies rather than a blanket grant,
column-level `GRANT UPDATE` on named columns, a module-level guard with no opt-out decorator,
no cache so a revocation is immediate, and refusals written to `platform_audit_log` from inside
the guard's own transaction.

So the realistic risk is **not** somebody breaking the guard. It is somebody **becoming Rui**.

Five changes, in the order they are worth doing.

### BA — the five

**1. MFA, enforced server-side.** `PlatformAdminGuard` reads the MFA claim from the Clerk
session and refuses without it, with its own code (`platform_mfa_required`) audited like every
other denial. A Clerk dashboard setting is a setting, and settings drift; this is the product's
own refusal.

**2. Step-up re-authentication before any mutating platform action.** Clerk reverification,
scoped to writes — reads stay as they are. Irreversible actions (suspend, pending-delete,
purge) additionally require **typing the tenant's name**, the way GitHub does it.

**3. `/admin` shares an origin and a cookie with the tenant app today.** One XSS anywhere in
Poolse is therefore an admin compromise. Its own subdomain and its own Vercel project when
convenient; until then a strict CSP, with step-up auth as the thing standing in the way.
**Write it into `docs/` as a known limitation with a date** rather than leaving it implicit.

**4. The platform role must never gain `DELETE` or `archived_at`.** The purge job from
POOLSE-61 runs offline, as its own role, unreachable from HTTP. If purge ever needs a button
that is a separate ticket with its own argument — not a grant quietly added here.

**5. Alert on every `platform.denied` and every platform write.** A trail nobody reads is not a
control. Rate-limit the `/platform` routes while there.

**Secret hygiene.** `DATABASE_PLATFORM_URL` reads every tenant in the product. It belongs only
in the API's environment, never in the web app's, never `NEXT_PUBLIC_`, and it wants a rotation
procedure written down. **A test fails if any `NEXT_PUBLIC_` variable ever matches a database
URL pattern** — cheap, and it catches the one paste that would matter.

### Dev — implementation notes

**The alerting has the same problem POOLSE-61 has**: there is no email provider. Same answer —
record the alert, say it is undelivered, and let the provider slice deliver it. Do not build a
second notification path.

**The MFA claim's shape is Clerk's**, and reading the wrong field would produce a guard that
passes everybody. Read it from the verified session claims, assert against a session that has
it and one that does not, and do not infer it from anything the client sends.

**Rate limiting**: `UserThrottlerGuard` already exists and is registered globally. The
`/platform` routes want their own, tighter, ceiling rather than a second mechanism.

**Open:** whether MFA is enforced before Rui has it enabled on his own account. Turning this on
without setting up MFA first locks the only operator out of `/admin`. The order matters and it
is a five-minute job on Clerk's side — do it first, then ship the guard.

### QA — test scenarios

1. **Given** a platform admin whose session carries no MFA claim, **then** every `/platform`
   route is 403 with `platform_mfa_required`, and the refusal is in `platform_audit_log`.
2. **Given** the same person with MFA, **then** reads succeed.
3. **Given** a mutating action without a fresh reverification, **then** refused; **given** one
   with, **then** it proceeds.
4. **Given** suspend or pending-delete, **then** the tenant's name must be typed and a wrong
   name refuses.
5. **Given** the platform role, **then** `DELETE` on `organization` and an `UPDATE` of
   `archived_at` are both refused — the assertions `subscription.sql` already makes, kept.
6. **Given** a denial, **then** an alert row exists marked undelivered.
7. **Given** repeated `/platform` requests, **then** the tighter ceiling applies before the
   global one.
8. **Given** any `NEXT_PUBLIC_*` variable set to a `postgres://` URL, **then** the test fails.
9. **Given** the CSP, **then** it is asserted in a test rather than only in a config file.

### Acceptance criteria

1. `PlatformAdminGuard` refuses a session without MFA, with its own audited code.
2. Every mutating platform action requires step-up reverification; reads do not.
3. Irreversible actions require the tenant's name typed.
4. The platform role still holds no `DELETE` and no `archived_at`, proven by test.
5. Denials and writes raise an alert, recorded and marked undelivered until a provider exists.
6. `/platform` has its own rate limit.
7. The shared-origin limitation is in `docs/` with a date and a plan.
8. A test fails if a `NEXT_PUBLIC_` variable ever looks like a database URL.
9. A rotation procedure for `DATABASE_PLATFORM_URL` is written down.
10. MFA is enabled on the operator's own Clerk account **before** the guard ships.
