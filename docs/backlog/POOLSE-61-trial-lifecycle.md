# POOLSE-61 · The trial lifecycle

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Billing / Tenancy · **Priority:** High · **Depends on** POOLSE-60 (one plan) · **Slice B**

### PO — why this exists

`trial_ends_at` has been on `organization` since slice 0.5 and **nothing has ever read it**.
The date passes and the club carries on. This is day 16.

The shape of the answer is the product decision, and it is not "lock them out":

- **15 days, from signup.** Not from the first facility.
- **The trial is the full product, uncapped.** No volume limits, no feature gates.
- **No card at signup**, which the public site already promises. Payment is collected at
  conversion, through the checkout that exists.
- **Day 15 is read-only, not a locked door.** A club whose trial ran out can still sign in,
  see everything they built, **export it**, and pay.
- **Their data is never migrated anywhere.** A trial tenant is an ordinary organization row
  with a different status. Converting is a status change and nothing else — no trial database,
  no copy step, no import. That goes in the migration header so nobody invents one later.

**Not in scope:** the hard purge. The state machine and the destructive path do not belong in
one commit; purge is its own ticket with its own argument.

### BA — the ladder

| Day | `subscription_status` | Access | What they see |
|---|---|---|---|
| 0–15 | `trialing` | Full | A countdown in the app from day 10 |
| 15 | `expired` | Read-only | Banner: data kept until {date}, Pay now, Export |
| 15–45 | `expired` | Read-only | The same, counting down |
| 45 | `expired`, `pending_delete_at` set | Login refused | Email only |
| 75 | row archived, then purged | — | A deletion confirmation |

**Paying at any point before day 75 restores everything**: `active`, `read_only_at` and
`pending_delete_at` cleared. That is one status change, because nothing was ever moved.

**`read_only_at` is a third access state, not a rename of `suspended_at`.** The platform slice
separated billing state from access state deliberately; this adds a *degree* to access state
and does not merge the two back. The precedence is explicit and tested:

> `suspended_at` beats `read_only_at` beats open.

### Dev — implementation notes

**Schema.** `subscription_status` gains `expired` (the `ADD VALUE` + rebuild-on-down pattern
`comped` used). `organization` gains `read_only_at` and `pending_delete_at`, both on the
`poolse_platform` UPDATE grant and both on the `changeTenant` write path — an operator must be
able to lift a read-only state and to pull a tenant back from pending-delete, and every such
move must land in `platform_audit_log` like any other.

**Enforcement in `tenant.middleware.ts`**, where suspension already lives:

- `suspended_at` set → 403 on everything, as today.
- `read_only_at` set and `suspended_at` null → `GET`, `HEAD` and `OPTIONS` pass; everything
  else is refused with `{ code: 'tenant_read_only', trialEndedAt, dataKeptUntil }`, so the web
  app renders the banner and its call to action **from the error itself** rather than from a
  second request.
- **Three routes stay open to writes, by path, with a comment saying why**: the billing
  checkout, the billing portal and the Stripe webhook. They are the conversion path; a
  read-only tenant that cannot pay is a read-only tenant for ever.
- Export endpoints are GETs and already pass. **Assert it** — a club that cannot get its own
  data out is the failure that turns a paused customer into an angry one.

**The scheduler.** An hourly Nest cron in the API, wrapped in a Postgres **advisory lock** so a
second Railway instance is a no-op rather than a double send. One transaction per tenant:

1. `trialing` and `trial_ends_at < now()` → `expired`, `read_only_at = now()`,
   `pending_delete_at = now() + 30 days`.
2. `expired` and `pending_delete_at < now()` → close login, using the existing suspension
   mechanism with a machine-set reason.
3. Thirty days later → archive the row. **Purge is a separate ticket.**

**Locking a tenant out does not touch Clerk** — decided 13 September 2026. `TenantMiddleware`
already refuses the request, so a user who cannot get past the door never counts as a monthly
active user, and deactivating the Clerk account would lock somebody out of a *second* club they
still pay for. One person, several organizations, is a shape this schema has always had.

**The machine actor.** `platform_audit_log.clerk_user_id` is `NOT NULL` and a cron has no
person behind it. Writing `'system'` into a column named for a Clerk user would be a lie in the
one place that exists to be believed, so — following the precedent `stripe_event` set — these
transitions get their own book, `trial_event`, written in the same transaction as the
change. **Settled 13 September 2026** — Rui took the proposal. The alternative, making that
column nullable and adding an `actor_kind`, changes a shipped audit table to accommodate a
writer it was never about; a second book costs one migration and keeps
`platform_audit_log.clerk_user_id` meaning exactly what its name says.

`trial_event` is platform-scoped, like `stripe_event` and for the same reasons: a row is about a
tenant rather than belonging to one, it is invisible to the tenant connection, and it is
insert-only. It records the transition, the tenant, the dates it set and the reason — never an
amount and never a person's name.

**Emails are recorded, not sent** — decided 13 September 2026. There is no provider wired and
phase 0 deferred the choice. Each due notice (days 10, 14, 15, 38, 45, 68) writes a row saying
it was owed, to whom and why, the shape `pool_analysis_alert` uses; the screens say plainly
that nothing has been delivered. Choosing a provider becomes a small slice that writes into the
same history, exactly as 2.3's chase list waited for 3.0. Every notice carries an export link
when it is eventually sent, and the export pipeline already exists — do not build a second one.

**RGPD.** This data includes minors, guardians, health and mobility notes and payment records.
The ladder above is the stated retention policy: write it into `docs/` in the same commit, in
the words the privacy policy will use.

**The pilot club keeps its 14 days.** The change applies to signups from here on: one club, one
day, and a migration that rewrites a live trial date touches billing state for no benefit.

**A `comped` tenant is never expired by the job.** The free pilot is live and unbilled and does
not run out — that is what the word has meant since the platform slice, and the job's first
filter is `subscription_status = 'trialing'`, which a comped club is not.

### QA — test scenarios

1. **Given** a tenant whose `trial_ends_at` passed an hour ago, **when** the job runs, **then**
   it is `expired`, `read_only_at` is set and `pending_delete_at` is thirty days out.
2. **Given** the job runs twice in the same hour, **then** the second pass changes nothing —
   the advisory lock, asserted by running two passes concurrently.
3. **Given** a read-only tenant, **when** it issues a `GET`, **then** 200; **when** it issues a
   `POST`, `PATCH` or `DELETE`, **then** 403 with `tenant_read_only`, `trialEndedAt` and
   `dataKeptUntil` on the body.
4. **Given** a read-only tenant, **then** every export route answers with the file.
5. **Given** a read-only tenant, **then** the billing checkout, the portal and the webhook all
   still write.
6. **Given** a read-only tenant that pays, **then** it is `active`, both timestamps are null,
   and a write succeeds on the next request.
7. **Given** a tenant that is both suspended and read-only, **then** the suspension wins and
   the refusal says `tenant_suspended`.
8. **Given** `pending_delete_at` in the past, **then** login is refused with the machine reason
   and **no Clerk account is touched**.
9. **Given** any transition, **then** a `trial_event` row exists naming the tenant, the
   transition and the time, and `platform_audit_log` is untouched by the cron.
10. **Given** a tenant on day 10, **then** a notice row exists marked undelivered and the
    screen says so.
11. **Given** the tenant-isolation suite, **then** `trial_event` is invisible and unwritable
    from the tenant connection.
12. **Given** the Down migration, **then** it reverses cleanly, including the enum rebuild.

### Acceptance criteria

1. The trial is 15 days from signup, set in the provisioning function.
2. `expired`, `read_only_at` and `pending_delete_at` exist, are on the platform grant and go
   through `changeTenant`.
3. Read-only allows every safe method and refuses every unsafe one with a body the banner can
   be built from.
4. Checkout, portal and webhook are allowlisted by path, with the reason in a comment.
5. A read-only tenant can export everything it owns, proven by test.
6. Paying restores full access in one status change; nothing is copied or migrated, and the
   migration header says so.
7. `suspended_at` beats `read_only_at` beats open, proven by test.
8. The hourly job is idempotent under a Postgres advisory lock.
9. Locking a tenant out touches no Clerk account.
10. Every transition is recorded with a non-human actor that does not lie about being a person.
11. Due notices are recorded and the screens say nothing has been delivered.
12. The retention ladder is in `docs/` in the same commit, in privacy-policy words.
13. Purge is **not** in this commit.
14. An organization already mid-trial on 14 days is untouched by the migration.
15. A `comped` tenant is never moved by the job, whatever its dates say.
