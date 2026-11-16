---
paths:
  - "apps/api/src/{platform,support,billing,webhooks,ai,app-view,tenant,organizations,shell}/**"
  - "apps/web/src/app/**/admin/**"
  - "apps/web/src/lib/ai-*.ts"
  - "apps/web/src/app/**/layout.tsx"
  - "apps/web/src/components/keep-fresh.tsx"
  - "apps/web/src/instrumentation*.ts"
  - "apps/api/src/instrument.ts"
  - "apps/web/src/**/*-agent.ts"
  - "apps/web/src/lib/{timetable-reader-prompt,modules,subscription-alert,shell}.ts"
  - "apps/web/src/components/module-gate.tsx"
  - "packages/rules/src/{ai,modules}.ts"
---

# Platform, licence and observability

Read [`docs/conventions/platform-and-licence.md`](docs/conventions/platform-and-licence.md) before touching `/admin`, a module or sport switch, the subscription, a trial, support access, an AI reader or telemetry.

- The platform writes through column grants, and a platform write records itself.
- A module is switched off per club by Rui, and every tenant route says which module it is.
- An irreversible platform act asks for the club's name, and every platform write and refusal raises an alert.
- Telemetry is aggregated, never one row per request; and Sentry is off unless a DSN says otherwise.
- A subscription is Stripe's to know and the webhook's to write; a licence is the operator's.
- One person, one trial, blocked at the door rather than inside the trial.
- A club may pay outside Stripe, and a manual subscription cannot be forgotten.
- A trial ends in read-only, which is a third access state.
- Poolse support enters a club only through a grant the Owner opened, and is never one of the club's people.
- Poolse support never reads health data or an ID document: a route that opens one calls `refuseSupport()` after `requireRole`.
- A view of a person's app is an `app_view` row read on every request, and what it opens is the list in `tenant/app-view.ts`.
- Platform administration is not a tenant role, and it has its own database login.
- A personal tenant is `organization.kind`, read in exactly two places.
- A sport is switched on per club by Rui; the pool always is.
- A subscription covers one facility; the schema allows many.
- Management seats are capped per tenant by a soft quota
- A model call from a server action is guarded first: `guardAiCall(AI_ROLES.<importer>)` from `lib/ai-guard.ts`.
- A model read that fails says why: `classifyAiError` / `stopFailure` in `lib/ai-failure.ts`, shown as `ai.failure.<code>` (`aiNoteKey`), never a catch-all "could not read".
- A model's reply format goes through `checkedSchema` (`lib/ai-schema.ts`): every property required (`""` when absent), a nullable enum is `anyOf`; a document reader streams with 64000 tokens and 300 s.
- A model's instructions end with `UNTRUSTED_INPUT` (`lib/ai-untrusted.ts`): what it reads is data, never instructions; a reader has no acting tools and returns only a draft a person saves.
- A platform-wide feature switch is a `platform_switch` row, flipped on `/admin` → Plataforma
- Speed is judged on a production build and the club seed, never on `pnpm dev`
- The layout reads `/me` and `GET /shell`, and nothing else
- A page left open re-reads itself: `KeepFresh` (`components/keep-fresh.tsx`) refreshes every 2 min while visible and on return after 30 s away, never mid-typing or with a dialog open; no live connection.
- A hydration mismatch costs `<html>` its attributes
