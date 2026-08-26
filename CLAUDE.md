# Poolse — operating brief

Read this before doing anything in this repo. It is the standing briefing: what is
settled, how we work, and what not to re-decide. Product detail lives in `docs/product.md`,
schema in `docs/data-model.md`, sequencing in `docs/roadmap.md`.

## What Poolse is

A multi-tenant SaaS for managing swimming pools — the businesses that run them (schools,
municipal pools, hotels, condominiums) and, in a smaller way, individuals who own one.

Scope is pool management specifically. This was briefly widened to a generic
facility-management product and deliberately narrowed back. Do not re-open it.

## Working context

Built solo, mostly in evenings after a full day of other work. Two consequences that
should shape every technical call:

- **Momentum is the scarce resource, not skill.** A session that ends with something
  working beats a session that ends with three layers half-built. Prefer vertical slices —
  schema → API → UI → check — over horizontal ones.
- **The maintainer six months from now is one tired person.** Prefer boring,
  well-documented patterns over clever ones. When two options are close, pick the one
  that is cheaper to reverse and say why in one line.

## Stack (settled — do not relitigate)

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui |
| Backend | NestJS, REST |
| Database | PostgreSQL; TimescaleDB for energy and sensor time-series |
| Auth | Clerk, multi-tenant |
| Billing | Stripe. Student-facing payments also need débito direto and MB WAY |
| Notifications | Push + transactional email (provider chosen in phase 0); SMS deferred |
| Charts | ECharts / Recharts |
| Deploy | Vercel (frontend) + Railway or Fly.io (backend + DB) |
| Environments | staging and production, separate from day one |

If a genuinely better option appears, say so in one line and move on unless it gets
picked up. Do not stop a session to relitigate a settled choice.

## Non-negotiable conventions

**i18n from the first string.** Every user-facing string goes through the translation
layer as it is written. Default locale `pt-PT`, with `en` maintained alongside. Retrofitting
i18n is the kind of task that eats an entire weekend, so it is never deferred "just for
this component".

**Multi-tenancy is enforced by the database, not by the repository layer.** Every table
holding tenant data carries `organization_id` — but that is only the raw material.
Isolation is two structural mechanisms, both in place before any tenant data exists:
composite foreign keys `(organization_id, parent_id)` so a row can never reference another
tenant's row, and row-level security keyed on a per-request GUC so a query that forgets
its `where` clause returns nothing instead of everything. Application-layer scoping alone
fails the night one method is written tired. See `docs/data-model.md`, decision 2.

**Money amounts are integer minor units; unit prices are not.** `amount_cents` for
invoices and fees. A per-kWh tariff in integer cents rounds €0.1548 to €0.15 and puts a
3% error on the module whose entire purpose is cost accuracy — unit prices are
`numeric(12,6)`.

**Every unique constraint on a soft-deletable table is partial** (`where archived_at is
null`). Otherwise archiving an instructor and re-adding them next season violates the
constraint against a dead row.

**Light and dark mode in every app**, from the first component. Colors come from tokens;
no literal hex in components.

**Palette.** Backoffice and desktop web: primary `rgb(103, 166, 182)`, complementary
`rgb(179, 212, 157)`. Mobile apps run sportier — soft orange with pool blue. Mobile
palette is explicitly allowed to move during development; the desktop one is not.

**Money and readings are never floats.** Amounts in integer minor units. Sensor readings
in `numeric` with an explicit unit column — pH, °C, ppm and kWh do not share a type.

**Times are stored UTC, displayed in the facility's timezone.** Class schedules are the
place this bites; get it right once in the scheduling layer.

## How a session runs

1. Open with one line on where things stand and what tonight's slice is.
2. Brief framing — what "done" looks like for this slice, as acceptance criteria.
3. Build: schema → API → UI → check. Write code, not plans; the planning conversation
   for the product as a whole already happened.
4. Close with two lines: what now works, and the single obvious next slice. The next
   session starts from that line.

The role sequence matters (framing before backend before frontend before a QA pass).
The role *personas* do not — skip the ceremony, keep the artifacts: acceptance criteria
before code, a test or a manual check before calling something done.

## Asking for decisions

When something genuinely needs a call, ask once, tightly, with a recommended default.
Not a list of open questions — that moves the work back onto the one person who has the
least time.
