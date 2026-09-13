# POOLSE-60 · One plan, two billing intervals

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Billing / Subscription · **Priority:** High — it reverses a decision that shipped yesterday, and the longer it stands the more copies it grows · **Slice A** of the single-plan and trial-lifecycle ticket

### PO — why this exists

Slice 2.4 shipped three plans — Início, Clube, Rede — on 13 September 2026. **That is reversed.**

There is one plan. An organization either pays for Poolse and gets everything, or it does not
pay and is on a trial. **No feature is ever gated by plan.** The only axis left is how often
they pay: monthly or yearly.

This is cheap because 2.4 already decided the expensive half: `plan` is *descriptive*, and the
ceilings — `max_facilities`, `max_management_users` — are a hand-set operator decision in
`/admin`. That stays exactly as it is. **Nothing in this ticket lets Stripe widen a licence.**

**Not in scope:** prices. The numbers go into the Stripe dashboard before the pilot and never
into a deploy. Also not in scope: any change to what the ceilings mean, and any second payment
provider — though the interval work must not assume Stripe is the only one forever.

### BA — rules and data

**One `plan_key` value.** Everything that reads a plan name today — the pricing page, the
subscription screen, the `/admin` column — reads the one value or the interval instead.

**`billing_interval` is `monthly | yearly`, nullable, and descriptive.** Null until they
subscribe; written only by the Stripe webhook, alongside `plan`; enforced by nothing. A club
on the yearly interval has exactly the same product as a club on the monthly one.

**Yearly is the default selection on the pricing page**, and the page says what it saves.
The saving is computed once, on the API, from the two prices Stripe reports — `poupa X%` is a
sentence the view renders rather than a sum it does.

**An unpriced interval still appears**, with nulls, exactly as an unpriced plan did. Both
intervals are the product; showing one because the dashboard was half-finished is the lie the
three-plan version already refused to tell.

**Switching interval goes through the Stripe customer portal.** Proration is a solved problem
on somebody else's screen, and building our own path to it would be a second way to do
something that already has a better one.

### Dev — implementation notes

**Migration.** `plan_key` is retyped rather than backfilled, and the header says why:
**nobody is on Stripe yet**, so there is no live subscription to migrate. The `ALTER TYPE …
RENAME` + create + swap dance is the one `platform-admin.sql` used for `comped`; existing rows
map to the single value. `billing_interval` is a new enum and a new nullable column, and joins
the `GRANT UPDATE (…)` list for `poolse_platform` — descriptive, like `plan`.

**`apps/api/src/billing/stripe.ts`.** `PlanKey` collapses; the price map becomes
interval-keyed (`STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`). `planForPrice` becomes
`intervalForPrice` and keeps its shape — a reverse lookup from a price id, with **no Stripe
round trip in the webhook path**, which is what makes the webhook fast and offline-testable.
`anyPlanPriced()` becomes `anyPriceConfigured()`.

**The "Stripe is not configured" behaviour is unchanged and must stay.** No key, no crash; the
screens say *a subscrição ainda não está configurada*. That is the state of every development
machine and of the free pilot.

**`POST /subscription/checkout` takes `interval`**, with the same refusal shape
(`{ code: 'invalid_interval', field: 'interval' }`). `GET /subscription` returns two offers and
`yearlySavingPercent` when both prices are known.

**The most likely thing to get wrong** is leaving a third place that still believes in plans:
the `/admin` column, the subscription screen's badge and the marketing page each read a plan
name today. Grep for `marketing.pricing.` before calling this done — `check-messages.mjs` will
catch a dead key but not a live one that nobody should still be reading.

**Open:** what the single `plan_key` value is called. `poolse`, `standard` and `full` are all
defensible; it appears in the database, in `/admin` and nowhere a customer reads. Ask before
writing the migration — renaming an enum value later is the same dance again.

### QA — test scenarios

1. **Given** an organization on the old `club` value, **when** the migration runs, **then** it
   holds the single value and no row is left with an unmapped plan.
2. **Given** the Down migration, **when** it runs, **then** the three-value enum is back and
   `pnpm db:migrate` re-applies cleanly.
3. **Given** no `STRIPE_SECRET_KEY`, **when** the subscription screen loads, **then** both
   intervals come back unpriced, nothing crashes, and the page says billing is not configured.
4. **Given** only `STRIPE_PRICE_MONTHLY` is set, **then** the yearly offer comes back with
   nulls and is not buyable, and the monthly one is.
5. **Given** both prices, **then** `yearlySavingPercent` is computed on the API and the page
   renders it without arithmetic.
6. **Given** `checkout({ interval: 'weekly' })`, **then** 400 with `invalid_interval`.
7. **Given** a `customer.subscription.updated` event carrying the yearly price, **then**
   `billing_interval` becomes `yearly` and the ceilings do not move.
8. **Given** a price id nobody configured, **then** `billing_interval` is null rather than
   guessed, and the rest of the event still applies.
9. **Given** an admin or an instructor, **then** every subscription endpoint is 403 —
   POOLSE-58's rule, unchanged by this ticket.
10. **Given** pt-PT and en, light and dark, **then** the pricing page shows one card, a
    Mensal/Anual toggle defaulting to Anual, and no comparison table.

### Acceptance criteria

1. `plan_key` holds one value; the migration header states that no live subscription exists to
   migrate and that this is why it is a retype.
2. `billing_interval` exists, is nullable, is written only by the webhook, and is on the
   `poolse_platform` UPDATE grant.
3. No ceiling, limit or feature is decided by plan or interval anywhere in the product.
4. Prices are read from Stripe; no amount is hardcoded in the repo.
5. Both intervals are offered, an unpriced one with nulls, and `yearlySavingPercent` comes from
   the API.
6. Checkout takes an interval and refuses anything else with a named field.
7. The pricing page shows one plan, a Mensal/Anual toggle with Anual selected, and the full
   feature list.
8. The subscription screen shows the current interval and period end, and sends a switch
   through the customer portal.
9. Dead plan-name keys are removed from both catalogues and `pnpm i18n:check` passes.
10. `docs/features/subscription.md`, `docs/data-model.md` and `docs/decisions.md` are updated in
    the same commit.
