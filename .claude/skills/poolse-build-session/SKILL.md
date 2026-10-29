---
name: poolse-build-session
description: Run a focused build session on Poolse, the multi-sport club SaaS that ships for pools first — carrying the fixed stack, conventions and product decisions so they never have to be re-explained. Use whenever the user mentions Poolse, pool management, gestão de piscinas, recintos or playing areas, the students/classes module, maintenance, energy, AI dashboards, the family or student app, the backoffice, sport modules, or says "let's continue the project" or "tonight I want to build". Applies to schema design, API endpoints, UI work, i18n, Excel import/export, and sprint planning for it.
---

# Poolse build session

This runs on evenings after a full day of other work, so the scarce resource is momentum,
not skill. Every minute spent re-establishing the stack or re-deciding something decided is
a minute the session does not get back. Hold the context so the session starts at the work.

The repo's own `CLAUDE.md` is the standing brief and wins over this file where they differ;
`docs/product.md`, `docs/data-model.md`, `docs/roadmap.md`, `docs/decisions.md` and
`docs/backlog/` hold the detail. This skill is what to know before opening them.

## The stack (settled — do not relitigate)

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui; the student and
  family **app is a PWA inside the same Next.js app** (`/app` routes, "app mode"), native decided after the pilot
- **Backend**: NestJS, REST · **Database**: PostgreSQL (TimescaleDB-shaped energy tables, not yet a hypertable)
- **Auth**: Clerk, multi-tenant · **Billing**: Stripe for Poolse's subscription; a club's own payments by débito direto, MB WAY and manual records
- **Notifications**: transactional email (Resend) + web push; SMS deferred
- **Deploy**: Vercel + Railway/Fly.io; staging and production separate; nightly backups with a monthly restore drill on Rui's machine
- Monorepo: `apps/web`, `apps/api`, `packages/db` (migrations + SQL tests), `packages/rules` (`@poolse/rules`, shared pure logic)

If a genuinely better option appears, say so in one line and move on unless picked up.

## Product shape (as of 28 October 2026)

**Scope: pool management first, structured for other sports.** A site (`facility`) holds
typed **recintos** (`playing_area`: pool, tennis, padel, basketball, football, handball,
volleyball, gym); `pool` is a 1:1 child of one. Each sport is a **paid add-on module**
switched on per club from `/admin` (`enabled_sports`, `pool` always on), with its own
main-menu group that reuses the same calendar, bookings, fees and energy engines filtered
by recinto — never a copy per sport. Energy costs and AI dashboards **roll up at site
level**. The pool is **untouched for first go-live**, and no non-pool metric or screen is
built until a paying club asks. Tickets POOLSE-122 to 128; the reversal of the earlier
pool-only scope is dated in `docs/decisions.md`. Support rooms are `space` (Espaços), not recintos.

**Modules a club switches on and off** (POOLSE-87): messages, incidents, reception (needs
invoicing), competition, water_quality, invoicing, maintenance, energy, salaries, vacations,
qualifications.

**First go-live (pilot club, free for about a year)**: classes, calendar with lanes, students
and families, fees and invoicing, messages, incidents, reception/free swim, competition times
and meets, water quality, the PWA for students/families/instructors (read-mostly calendar,
*Vou / Não vou*, feedback). Maintenance, energy, AI dashboards, salaries and vacations are
built but not the pilot's first month. Pre-production gate: backups, security review, GDPR.

**Deferred with a trigger**: wearables (watch notifications → health import → plans pushed →
native watch apps), PT and nutritionist individual plans (paid add-on, club's own staff),
in-app payments, in-app RAG assistant (after the Ctrl+K palette), certified invoicing via a
provider, sanitary register, POS.

## Non-negotiable conventions

- **i18n from the first string**, pt-PT source, en alongside; `pnpm i18n:check`. European
  Portuguese only — reviewers hunt Brazilian forms.
- **Every date is `dd-MM-yyyy` from `lib/date-format.ts`**; never `Intl` options at a call site.
- **Light and dark**, contrast-checked; colour never carries meaning alone. Palette: desktop
  primary `rgb(103 166 182)` with **dark ink** on primary buttons; app mode primary
  `rgb(14 116 144)` with soft-orange accent `rgb(251 146 60)`; sport tints are a translucent
  wash behind a sport's pages, never a new primary.
- **Tenant isolation lives in the schema**: composite keys, RLS, SQL tests. Use the
  `write-migration` skill for any SQL.
- **Server-side enforcement**; hiding a control is never the control.
- **Soft delete, audit, pagination at 15, tooltips explain and never inform** — see
  `docs/backlog/CONVENTIONS.md`.
- **Excel import is the primary data-entry path**: upload → parse → mapping → validate →
  commit, mapping swappable for an AI matcher later; a dropzone over the whole page.
- **Minimal intervention**: when editing or migrating, touch the least that achieves the
  slice; Rui prefers a bounded change over a tidy rewrite.

## How a session runs

1. **Open with one line** on where things stand and tonight's slice. Restate a story as a
   vertical slice — schema → API → UI → check — because a slice that ends working beats
   three half-built layers.
2. **Load one ticket** from `docs/backlog/` plus `CONVENTIONS.md`, never the folder.
3. **Role sequence**, briefly: PM framing, backend, frontend, QA pass.
4. **Write code, not plans**, once the slice is agreed.
5. **Record the calls** taken in the build as one dated line in `docs/decisions.md`, and
   the feature in `docs/features/<name>.md` (that corpus is also the future assistant's).
6. **Close with two lines**: what now works, and the single obvious next slice.

## Judgement calls

Boring, well-documented patterns over clever ones — maintained by one tired person six
months from now. When two options are close, pick the one cheaper to reverse and say why
in one line. When something genuinely needs Rui's decision, ask once, tightly, with a
recommended default — not a list of open questions. Rui answers "default" often; make the
default the one you would build.
