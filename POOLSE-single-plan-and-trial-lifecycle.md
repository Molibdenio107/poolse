# POOLSE — Single plan, two billing intervals, and the trial lifecycle

Paste into Claude Code in the Poolse repo. Branch: `feat/single-plan-trial-lifecycle`.

Read `CLAUDE.md`, `docs/decisions.md` and the last three migrations
(`1788602400000_platform-admin.sql`, `1788775200000_platform-actions.sql`,
`1788948000000_stripe-subscription.sql`) before writing anything.

**Show me the user stories with acceptance criteria for every slice below, and wait
for my OK, before writing a single line of code.**

---

## Standing housekeeping block

- Update `docs/` in the same commit as any behaviour or schema change.
- Keep `CLAUDE.md` current with new conventions introduced here.
- Refactors are proposed in one line and gated on my OK — never inlined.
- Append every confirmed decision to `docs/decisions.md`.
- Consult the `write-migration` skill before any SQL. Tenant isolation lives in
  the schema; the tenant-isolation test must still pass.

---

## Context — what changed in the product decision

Slice 2.4 shipped three plans (`starter` / `club` / `network`) yesterday. That
is reversed.

**There is now one plan.** An organization either pays for Poolse and gets
everything, or it does not pay and gets a trial. No feature is gated by plan,
ever. The only axis left is *how often they pay*: monthly or yearly.

This is cheap to do because `1788948000000_stripe-subscription.sql` already
decided that `plan` is descriptive and the ceilings (`max_facilities`,
`max_management_users`) are a hand-set operator decision in `/admin`. That
stays exactly as it is. Nothing about this ticket lets Stripe widen a licence.

The second half of the ticket is the part that does not exist yet: **what
happens on day 16.** Today `trial_ends_at` passes and nothing reads it.

---

## Slice A — one plan, two intervals

### Schema

- Retype `plan_key` to a single value. `ALTER TYPE ... RENAME` + create + swap,
  the pattern `platform-admin.sql` used for `comped`; existing rows map to the
  one value.
- New enum `billing_interval AS ENUM ('monthly', 'yearly')`, new nullable column
  `organization.billing_interval`, written only by the Stripe webhook alongside
  `plan`. Null until they subscribe. Add it to the `GRANT UPDATE (...)` list for
  `poolse_platform` in the Stripe migration's column set — descriptive, like
  `plan`, and enforced by nothing.

### `apps/api/src/billing/stripe.ts`

- `PlanKey` collapses; the price map becomes interval-keyed:
  `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`.
- `planForPrice` becomes `intervalForPrice`. Keep the same shape — a reverse
  lookup from price id, no Stripe round-trip in the webhook path.
- `anyPlanPriced()` → `anyPriceConfigured()`. The "Stripe is not configured"
  behaviour is unchanged and must stay: no key, no crash, screens say
  *a subscrição ainda não está configurada*.
- Prices still live in Stripe and are read back for display. Do not hardcode an
  amount anywhere. I have not set the numbers yet.

### `subscription.controller.ts`

- `POST /billing/checkout` takes `interval` instead of `plan`; same
  invalid-input shape (`{ code: 'invalid_interval', field: 'interval' }`).
- `GET` offers returns two entries, monthly and yearly, each with
  `amountCents | null`. An unpriced interval comes back with nulls rather than
  being omitted — same rule the three plans had.
- Compute and return `yearlySavingPercent` when both prices are known, so the
  page can say *poupa X%* without doing arithmetic in the view.

### Pages

- `apps/web/src/marketing/pricing.tsx` and the `en` variant: one plan card, a
  Mensal / Anual toggle, the full feature list, no comparison table. Yearly is
  the default selection.
- `dashboard/subscription`: shows current interval, period end, and a "switch to
  yearly" action that goes through the Stripe customer portal (do not build a
  proration path ourselves).
- Drop the plan-name i18n keys that die with the three plans; add the interval
  ones. PT and EN both.

### Migration note to write down

Nobody is on Stripe yet, so there is no live subscription to migrate. Say so in
the migration header — it is the reason this is a retype and not a backfill.

---

## Slice B — the trial lifecycle

### The decisions this implements

- **Trial is 15 days, starting at signup.** Not at facility creation. Change
  `interval '14 days'` in the signup function.
- **The trial is the full product, uncapped.** No volume limits, no feature
  gates. `max_facilities` / `max_management_users` keep their existing operator
  defaults and are untouched by this ticket.
- **No card at signup.** Payment is collected at conversion, through the
  existing checkout. This is unchanged — trial-first stays.
- **Day 15 is read-only, not a locked door.** This is the important one. A
  tenant whose trial ran out can still log in, see everything they built, export
  it, and pay. They cannot create or edit.
- **Their data is never migrated anywhere.** A trial tenant is an ordinary
  organization row with a different status; converting is a status change and
  nothing else. There is no trial database, no copy step, and no import on
  conversion. Write that into the migration header so nobody invents one later.

### Lifecycle table

| Day | `subscription_status` | Access | What they see |
|---|---|---|---|
| 0–15 | `trialing` | Full | Countdown in the app from day 10 |
| 15 | `expired` | Read-only | Banner: data kept until {date}, Pay now, Export |
| 15–45 | `expired` | Read-only | Same, with the date counting down |
| 45 | `expired`, `pending_delete_at` set | Login refused | Email only |
| 75 | row archived, then purged | — | Deletion confirmation email |

Paying at any point before 75 restores everything: status `active`,
`read_only_at` / `pending_delete_at` cleared.

### Schema

- `subscription_status` gains `expired`. Same `ALTER TYPE ... ADD VALUE` +
  rebuild-on-down pattern as `comped`.
- `organization.read_only_at timestamptz` and `organization.pending_delete_at
  timestamptz`.
- Both join the `GRANT UPDATE (...)` list for `poolse_platform` — an operator
  must be able to lift a read-only state and to pull a tenant back from
  pending-delete. Add them to the platform screens' write path
  (`changeTenant`), so both land in `platform_audit_log` like every other
  operator change.

**`read_only_at` is a third access state, not a rename of `suspended_at`.**
`platform-actions.sql` separated billing state from access state on purpose;
this adds a *degree* to access state, it does not merge the two back. Keep the
precedence explicit and test it: `suspended_at` beats `read_only_at` beats open.

### Enforcement — `apps/api/src/tenant/tenant.middleware.ts`

- `suspended_at` set → 403 on everything, as today.
- `read_only_at` set and `suspended_at` null → GET, HEAD and OPTIONS pass; every
  other method is refused with `{ code: 'tenant_read_only', trialEndedAt,
  dataKeptUntil }` so the web app can render the banner and the CTA from the
  error itself.
- **Three routes stay open to writes while read-only**, and this is not
  negotiable because it is the whole conversion path: the billing checkout, the
  billing portal, and the Stripe webhook. Allowlist them explicitly, by path,
  with a comment saying why.
- Export endpoints are GETs and therefore already pass. Add a test that asserts
  it — a read-only tenant that cannot get its own data out is the failure mode
  that turns a paused customer into an angry one.

### The scheduler

A Nest cron in the API, hourly, wrapped in a Postgres advisory lock so a second
Railway instance is a no-op rather than a double send. Each pass, in one
transaction per tenant:

1. `trialing` and `trial_ends_at < now()` → `expired`, `read_only_at = now()`,
   `pending_delete_at = now() + 30 days`.
2. `expired` and `pending_delete_at < now()` → close login (the existing
   suspension mechanism with a machine-set reason), deactivate the tenant's
   Clerk users — they are billed per MAU and a dormant tenant should not cost.
3. 30 days after that → archive the row, then hard-purge on the schedule
   `docs/` will describe. Purge is its own commit; do not write a destructive
   path in the same PR as the state machine.

Every transition writes to `platform_audit_log` with a machine actor
convention — do **not** write a fake `clerk_user_id`. If the table cannot take a
non-human actor, say so and propose the smallest change rather than lying in the
column; `stripe_event` already set the precedent of a second book for a
non-human writer.

### Emails

Day 10, 14, 15 (with export link), 38, 45, 68. Every one carries a one-click
Excel export of the tenant's data — the export pipeline already exists, reuse
it, do not build a second one. PT and EN.

### RGPD

This data includes minors, guardians, health and mobility notes and payment
records. The retention ladder above is the stated policy: write it into
`docs/` in the same commit, in the words the privacy policy will use. Purge must
be genuinely irreversible and must be logged.

---

## Slice C — trial abuse

The trial is uncapped and takes no card, so nothing currently stops one person
running a club on a new organization every 15 days. Fix it at signup, not by
crippling the trial.

### `trial_claim` — a platform-scoped ledger

Not tenant-scoped, same reasoning as `platform_audit_log` and `stripe_event`: a
row is *about* a tenant rather than belonging to one, and the whole point is
cross-tenant lookup.

```
trial_claim (
  id, organization_id,
  normalized_email      text not null,   -- lowercased, gmail dots/+tags stripped
  email_domain          text not null,
  tax_number            text,            -- NIPC, normalized, null until known
  signup_ip_hash        text,            -- hashed, never the raw IP
  created_at            timestamptz
)
```

Unique index on `normalized_email`. Partial unique index on `tax_number` where
not null.

### Rules

- **Hard block at signup** on a repeated `normalized_email`. The message points
  at sign-in and at contacting us — never at "you already used your trial", which
  tells an abuser exactly which lever to pull.
- **Hard block on a repeated NIPC.** The NIPC is not on the signup form and
  should not be; capture it at facility creation, where it is already needed for
  invoicing, and refuse there if it belongs to a previous trial.
- **Soft flag only** on IP hash and email domain, surfaced as a badge on the
  `/admin` tenant list and detail. Clubs share offices and NAT; a hard block
  here would catch real customers.
- **Every block is reversible by me in one click.** `/admin` gets a "grant a
  fresh trial" action that clears the claim and sets `trial_ends_at` — the
  extend-trial action is already there, extend it rather than adding a second
  one. A false positive must cost one click, not a support thread.
- Reject known disposable-email domains at signup. Keep the list in a data file,
  not in code.

### `/admin` additions

- Filters for `trialing`, `expired`, `pending_delete_at` set.
- On the tenant detail: the trial claim, the flags that fired, the lifecycle
  dates, and the ability to move any of them.
- A count of trials started vs converted, so the 15-day figure can be argued
  with evidence rather than instinct.

---

## Slice D — subscriptions paid outside Stripe

I will have clients I know personally who pay me directly — cash, transfer, a
handshake. `/admin` has to be able to turn a subscription on for them without a
Stripe customer existing at all.

**Do not reuse `comped` for this.** `platform-admin.sql` reasoned explicitly
that a free pilot must not look like revenue and must not look like a trial;
a paying client who hands me cash is a third thing again, and folding it into
`comped` would understate revenue in my own numbers — the one place they need
to be right.

### Schema

- New enum `billing_mode AS ENUM ('stripe', 'manual', 'comped')`, column on
  `organization`, default `'stripe'`, NOT NULL.
- `organization.paid_through timestamptz`.
- **A manual subscription must have an end date.** Enforce it:

  ```
  CHECK (billing_mode <> 'manual'
         OR subscription_status <> 'active'
         OR paid_through IS NOT NULL)
  ```

  This is the important constraint in the slice. Without it I flip a tenant to
  active, forget, and they run free for two years. A manual subscription that
  cannot be forgotten is the whole requirement.
- Both columns join the `GRANT UPDATE (...)` list for `poolse_platform` and the
  `changeTenant` write path, so every flip lands in `platform_audit_log`.
- The Stripe webhook must **refuse to touch** a tenant whose `billing_mode` is
  not `'stripe'`, and record the refusal in `stripe_event` with an `outcome`
  saying so. A stray webhook must never silently take over a hand-managed club.

### `manual_payment` — what was actually received

Platform-scoped table, same shape argument as `trial_claim`:

```
manual_payment (
  id, organization_id not null,
  amount_cents int not null, currency text not null,
  received_on date not null,
  method text not null,              -- cash / transferência / other
  covers_from date, covers_to date,
  note text,
  recorded_by_clerk_user_id text not null,
  created_at timestamptz
)
```

Insert-only from `/admin`, never editable, never deleted — same reasoning as
every other book in this schema. Recording a payment is what sets
`paid_through`; it is not a second field I type by hand.

Portugal: cash still needs a receipt. This table is the record that a receipt was
owed and for what — actual invoicing of Poolse's own revenue is a later ticket,
but the data has to exist from the first payment or it never will.

### Lifecycle

The same hourly job from slice B handles it: `billing_mode = 'manual'`,
`subscription_status = 'active'`, `paid_through < now()` → `past_due`, and
read-only after a configurable grace (default 15 days). A club that pays me in
cash gets the same courtesy as a card that bounced, not a locked door.

### `/admin`

- On the tenant detail: billing mode, `paid_through`, the payment history, and a
  "record a payment" form that extends `paid_through`.
- A **renewals due** list on the `/admin` index — manual subscriptions expiring
  in the next 30 days. This is the screen that stops me forgetting.
- The revenue figures separate Stripe, manual and comped rather than summing
  them blind.

---

## Slice E — hardening `/admin`

The current shape is already better than most: a separate `poolse_platform`
login role with its own connection string and **no** `BYPASSRLS`, per-table
`FOR SELECT TO poolse_platform` policies rather than a blanket grant,
column-level `GRANT UPDATE` on six named columns, a module-level guard with no
opt-out decorator, no cache so revocation is immediate, and refusals written to
`platform_audit_log` from inside the guard's own transaction.

The realistic risk is therefore **not** someone breaking the guard. It is
someone becoming me. Five changes, in the order they are worth doing:

1. **Require MFA for platform admins, enforced server-side.** Read the MFA claim
   from the Clerk session in `PlatformAdminGuard` and refuse without it — a
   Clerk dashboard setting is a setting, and settings drift. Own code, own
   refusal (`platform_mfa_required`), audited like every other denial.

2. **Step-up re-authentication before any mutating platform action.** Clerk
   reverification, scoped to writes only. Reads stay as they are. Irreversible
   actions — suspend, pending-delete, purge — additionally require typing the
   tenant's name, the way GitHub does it.

3. **`/admin` shares an origin and a cookie with the tenant app today.** That
   means one XSS anywhere in Poolse is an admin compromise. Move it to its own
   subdomain and its own Vercel project when convenient; until then add a strict
   CSP and keep step-up auth as the thing standing in the way. Note it in
   `docs/` as a known limitation with a date, do not leave it implicit.

4. **The platform role must never gain DELETE or `archived_at`.** The purge job
   from slice B runs offline, as its own role, unreachable from HTTP. If purge
   ever needs a button, that is a separate ticket with its own argument — not a
   grant quietly added to this role.

5. **Alert me.** Every `platform.denied` and every platform write sends a
   notification. A trail nobody reads is not a control. Rate-limit the
   `/platform` routes too.

Secret hygiene, while we are here: `DATABASE_PLATFORM_URL` reads every tenant in
the product. It belongs only in the API's environment, never in the web app's,
never `NEXT_PUBLIC_`, and it wants a rotation procedure written down in `docs/`.
Add a test that fails if any `NEXT_PUBLIC_` variable ever matches a database URL
pattern.

---

## Out of scope

- Prices. The plan table and Stripe stay unpriced; I set the numbers in the
  Stripe dashboard before the pilot.
- MB WAY / SEPA débito direto. Cards via Stripe only for now; the interval work
  here must not assume Stripe is the only provider forever.
- Any change to `max_facilities` / `max_management_users` semantics.
