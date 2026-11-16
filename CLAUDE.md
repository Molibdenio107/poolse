# Poolse

Multi-tenant SaaS for the clubs and businesses that run swimming pools (schools, municipal
pools, hotels, condominiums). Pools first; other sports are typed *recintos* sold as add-on
modules that share one calendar, bookings, fees and energy engine filtered by recinto — never
a copy per sport. The pool is untouched for first go-live, and no non-pool metric or screen is
built until a paying club asks.

Built solo, in evenings. Prefer vertical slices (schema → API → UI → check) that end with
something working, and boring, documented patterns over clever ones. When two options are
close, pick the one cheaper to reverse and say why in one line.

## Layout and commands

- `apps/web` — Next.js (App Router) + TypeScript + Tailwind + shadcn/ui; the family app is the `/app` routes
- `apps/api` — NestJS, REST
- `packages/db` — migrations, seeds, SQL tests
- `packages/rules` — `@poolse/rules`, shared pure logic
- `docs/` — `product.md`, `data-model.md`, `roadmap.md`, `decisions.md`, `features/<area>.md`, `conventions/<topic>.md`, `backlog/`

```
pnpm dev            pnpm db:up | db:migrate | db:seed | db:reset
pnpm typecheck      pnpm lint
pnpm api:test       pnpm db:test      pnpm web:test      pnpm e2e
pnpm i18n:check     pnpm pt:check     pnpm contrast:check
pnpm security:check
```

## Stack (settled — do not relitigate)

- Database: PostgreSQL; energy tables are TimescaleDB-shaped
- Auth: Clerk, multi-tenant
- Billing: Stripe for Poolse's subscription; a club's own payments by débito direto and MB WAY
- Notifications: transactional email (Resend) + web push; SMS deferred
- Charts: hand-rolled SVG and CSS; a library only when a dashboard needs zoom or dense time-series, loaded on that page alone
- Deploy: Vercel (web) + Railway (API); staging and production are separate


If a genuinely better option appears, say so in one line and move on unless it gets picked up.

## True of every change

- **i18n from the first string.** Every user-facing string goes through the translation layer as it is written. `pt-PT` is the source, `en` the translation. `pnpm i18n:check` proves the keys exist, not that the Portuguese is right.
- **European Portuguese, never Brazilian**: utilizador, secção, ficheiro, guardar, ecrã, registo, palavra-passe; *está a processar*, never *está processando*. No English left untranslated in the interface.
- **Tenancy is enforced by the database, not the repository layer**: `organization_id` on every tenant table, composite foreign keys `(organization_id, parent_id)`, and row-level security keyed on a per-request GUC. Use the `write-migration` skill for any SQL.
- **Permissions are enforced server-side.** Every handler refuses by role in its first line; hiding a control is never the control.
- **Money is integer minor units (`amount_cents`); unit prices are `numeric(12,6)`; nothing monetary or measured is ever a float.** Sensor readings are `numeric` with an explicit unit column.
- **Times are stored UTC and displayed in the facility's timezone.**
- **History is soft-deleted, never destroyed**, and every unique constraint on a soft-deletable table is partial (`where archived_at is null`).
- **Enum values are English snake_case; the Portuguese is an i18n key.** Check a new word against the ones the schema already uses.
- **A new tenant table goes in `TENANT_TABLES`** in `apps/api/src/test/harness.ts`, child-first, in the same commit as its migration.
- **Every metered call (the Claude API readers) sits behind its own feature flag, off by default**; prefer designs that keep one tenant inside free tiers.
- **Light and dark mode, contrast-checked**; colour never carries meaning alone.
- **Tooltips explain, they never inform.** Anything the operator needs is visible text; tooltips open on keyboard focus as well as hover.

## Conventions by area

The one-line rules for each area are in `.claude/rules/<topic>.md` and load by themselves when
a file of that area is opened. The reasons, traps and names are in `docs/conventions/<topic>.md`.
Read that file before changing the area — the one-liners are not enough to build from.

| Before touching | Read |
|---|---|
| a user-facing string, date or time | `docs/conventions/language-and-dates.md` |
| a migration, role check, public route, personal data or file | `docs/conventions/database-and-security.md` |
| `/admin`, a module or sport switch, subscription, trial, support access, an AI reader, telemetry | `docs/conventions/platform-and-licence.md` |
| fees, invoices, costs, salaries, passes | `docs/conventions/money.md` |
| meters, bills, tariffs | `docs/conventions/energy.md` |
| readings, bands, alerts, tasks, spaces | `docs/conventions/water-and-maintenance.md` |
| any screen, form, dialog, navigation, the phone shell | `docs/conventions/interface.md` |
| calendar, turmas, sessions, lanes, closures, seasons, partnerships | `docs/conventions/calendar-and-classes.md` |
| a student record, levels, competition, families, messages, an archive | `docs/conventions/students-and-families.md` |
| an importer, an export, an uploaded file | `docs/conventions/importers-and-exports.md` |

## Settled — do not re-open

- **There is no `manager` role.** `member_role` is `owner, admin, instructor, maintenance, student, guardian`. A backlog story written for a "manager" means `admin`.
- **Holidays live in `closure`**, told apart by `source` (`national_holiday`, `manual`). A shutdown for building works is not a public holiday and must not make a vacation day free.
- **Scheduling-grid slots are configurable per organization** (15, 30 or 60 minutes).
- **File storage is R2 (S3Mock in dev), and a file is read only through the app** — never a public bucket or a pre-signed link.
- **Vacation carry-over to 30 April is not tracked in v1**, and the balance summary says so.

## Working with Rui

- **Disagree out loud.** If the slice, ticket or approach is a bad plan, say so before building — one line, with the better option.
- **Ask once, tightly, with a recommended default** — never a list of open questions, and never a guess on a schema, a permission or a money rule.
- **Every change gets a security read** before it is called done: injection (SQL, prompt, XSS), tenant leaks, exposed keys or secrets, form validation, personal-data exposure. Run `pnpm security:check`, and the `poolse-security-review` skill for a new endpoint, webhook, upload, server action or `/admin` change.
- **Refactor by proposal, not by reflex.** Propose duplicated or outgrown code in one line and leave it until Rui says yes.
- **A session** opens with one line on where things stand and tonight's slice, sets acceptance criteria before code, and closes with two lines: what now works, and the single next slice.

## Keeping the repo's memory

- **Docs follow behaviour, in the same commit**: `docs/data-model.md` for schema, `docs/features/<area>.md` for behaviour, one dated line in `docs/decisions.md` for a product decision — especially one that reverses an earlier one.
- **A new convention is one line in `.claude/rules/<topic>.md`** and its reasons in `docs/conventions/<topic>.md`. It comes here only if it is true of every change. This file stays under 150 lines.

## Backlog

One file per ticket in `docs/backlog/`; `README.md` is the index. For a ticket, read **that
ticket's file and `docs/backlog/CONVENTIONS.md` — never the whole folder.** Respect the PO
section's out-of-scope line, ask about anything marked `**Open:**`, write the QA scenarios as
tests, and a ticket is done only when every numbered acceptance criterion is met.
