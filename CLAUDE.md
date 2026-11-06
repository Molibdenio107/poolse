# Poolse — operating brief

Read this before doing anything in this repo. It is the standing briefing: what is
settled, how we work, and what not to re-decide. Product detail lives in `docs/product.md`,
schema in `docs/data-model.md`, sequencing in `docs/roadmap.md`, and the full conventions in
`docs/conventions/`.

## What Poolse is

A multi-tenant SaaS for managing swimming pools — the businesses that run them (schools,
municipal pools, hotels, condominiums) and, in a smaller way, individuals who own one.

Scope is pool management first, structured for other sports second. A site holds typed
*recintos* (playing areas): a pool is one kind, a tennis or padel court, a pitch or a gym are
others, each sold as a paid add-on module (POOLSE-122 to 128, decided 28 October 2026 —
this reverses the earlier narrowing to pools only, and the reversal is recorded in
`docs/decisions.md`). Two rules come with it: **the pool is untouched for first go-live**, and
sports share one calendar, bookings, fees and energy engine filtered by recinto — never a copy
per sport. Energy costs and the AI dashboards roll up at site level. No non-pool metric or
screen is built until a paying club asks.

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

**These lines are the rules; `docs/conventions/` holds the reasons, the traps and the names.** Before changing an area, read its file, because the one line here is not enough to build from. A new convention is one line here and its full text in that file.

### True of every change

**i18n from the first string.** Every user-facing string goes through the translation
layer as it is written. Default locale `pt-PT`, with `en` maintained alongside. Retrofitting
i18n is the kind of task that eats an entire weekend, so it is never deferred "just for
this component".

**European Portuguese, not Brazilian.** `pt-PT` is the source language and `en` is the
translation, not the other way round. Reviewers check for Brazilian forms — *usuário*
(utilizador), *seção* (secção), *arquivo* (ficheiro), *salvar* (guardar), *tela* (ecrã),
*cadastro* (registo), *senha* (palavra-passe) — and for the Brazilian present continuous
(*está processando* rather than *está a processar*). They also check for English left
untranslated in the interface. `pnpm i18n:check` proves every key exists in both files; it
cannot tell you the Portuguese is the right Portuguese, so that part is read by a person.

**Tooltips explain, they never inform.** A tooltip may clarify what a control does. It may
never be the only place a piece of information appears — anything the operator needs is
visible text. Tooltips open on keyboard focus as well as hover, because a control whose
meaning is only available to a mouse is a control half the users cannot understand.

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

**Money and readings are never floats.** Amounts in integer minor units. Sensor readings
in `numeric` with an explicit unit column — pH, °C, ppm and kWh do not share a type.

**Times are stored UTC, displayed in the facility's timezone.** Class schedules are the
place this bites; get it right once in the scheduling layer.

**Enum values are English snake_case; the Portuguese is an i18n key.** `fault` / `restock`
render as "Avaria" / "Reposição". Check a candidate word against the words the schema already
uses — `reposicao` was taken by the make-up-lesson module, and one word meaning two things in
one schema is how somebody joins the wrong table at midnight.

**A new tenant table goes in `TENANT_TABLES` in `apps/api/src/test/harness.ts`**, child-first,
in the same commit as its migration. A forgotten one fails every integration test at teardown
with a foreign-key violation that looks nothing like the change that caused it.

**Cost per tenant is a design constraint, not a later optimisation.** The first production
tenant is a free pilot, so prefer designs that keep one tenant inside free tiers and keep
every metered or pay-per-use call — the Claude API lab-report parsers above — behind its
own feature flag, off by default.

### Language, dates and time

Read [`docs/conventions/language-and-dates.md`](docs/conventions/language-and-dates.md) before touching any user-facing string, date, time or long cell.

- Every date in Poolse is `dd-MM-yyyy` — prose, tables and `/admin` alike — and it comes from `formatDate` / `formatStamp` in `lib/date-format.ts`.
- A long cell keeps its start and ends in "…"
- A typed moment is the facility's wall clock, and "today" is `club_today()`.
- An elapsed time is `timeAgo` from `lib/relative-time.ts`
- Today in TypeScript is `clubToday()` from `apps/api/src/common/club-day.ts`

### Database, roles and security

Read [`docs/conventions/database-and-security.md`](docs/conventions/database-and-security.md) before touching a migration, a role check, a public route, personal data or a file.

- Clerk owns the name and the email; `app_user` holds a cache.
- A partial unique index cannot join, which is why a snapshot sometimes carries a foreign row's column.
- A workspace package the API imports is copied into `apps/api/Dockerfile`
- A backup is proved by restoring it, and the key that opens one is never in GitHub.
- A departed student's data expires, and `apply_retention()` is the only thing that expires it.
- Every handler refuses by role in its first line; there is no global role guard.
- An instructor reads only their sports' students
- A menu entry is shown only to the roles its page's API answers, and maintenance outranks instructor.
- A permission about a *row* is a repository answer, not `requireRole`.
- A site's page configures the club; the Instalações list is everybody's.
- A person's photograph is `IdPhoto`, and it has three homes
- A health-data file is sealed: its own key, wrapped, on its row, and the bucket holds ciphertext.
- An incident's facts are columns and its words are ciphertext the database refuses to hold as prose.
- A public page reads through one `SECURITY DEFINER` function keyed on a token, and nothing else.
- Every public page carries the complaints book and the operating regulation in force.
- A public write goes through one `SECURITY DEFINER` function keyed on the slug, and answers the same whatever happened.
- `class_session` has no `archived_at`; it has `status`.
- A column of a custom enum array is read `::text[]`, never bare.
- `cs` means `class_schedule` in most of this codebase, and a join to `class_group` is the place partnerships get silently dropped.
- An invitation is read with no account, and accepted only with one.
- A family is invited from the student, never from Pessoas
- A person merge never takes the Owner, two logins or support.
- A staff member's ID document is encrypted, behind its own route, and read aloud to the audit log.
- A login's name is the person's own.
- A read that shows a student selects `FROM student_person s`, never `student`

### Platform, licence and observability

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
- Platform administration is not a tenant role, and it has its own database login.
- A personal tenant is `organization.kind`, read in exactly two places.
- A sport is switched on per club by Rui; the pool always is.
- A subscription covers one facility; the schema allows many.
- Management seats are capped per tenant by a soft quota
- A model call from a server action is guarded first: `guardAiCall(AI_ROLES.<importer>)` from `lib/ai-guard.ts`.
- A platform-wide feature switch is a `platform_switch` row, flipped on `/admin` → Plataforma
- Speed is judged on a production build and the club seed, never on `pnpm dev`
- The layout reads `/me` and `GET /shell`, and nothing else
- A hydration mismatch costs `<html>` its attributes

### Money

Read [`docs/conventions/money.md`](docs/conventions/money.md) before touching anything that stores, sums or shows a monetary value: fees, invoices, costs, salaries, passes.

- Every module that touches money obeys `docs/financials.md`, and `staff_compensation` is its reference implementation.
- A fee line's discount is `line_discount_percent` / `line_discount_cents`, whoever authored it.
- A fee category authors the discount, and the line snapshots the figure.
- One price list, four `fee_kind`s — never a table per fee type.
- Amounts are gross and `vat_rate` says what is already inside them; `vat_exempt` is its own flag.
- An invoice is written once, and its number comes from the database.
- "Already billed" means "on a document not since credited", so it is a constraint trigger and not a partial index.
- An invoice is addressed to a payer — the guardian, or the student on the adult path — so siblings land on one document.
- A document line stores the club's own words, never a translated enum.
- A document's state is `total − paid` and never a column.
- Where families pay is one account per club, and an IBAN change is told to every owner.
- A fee line with no `fee_period_id` is charged once
- A fee line owes every unpaid period from the month it was entered, not only the current one (`olderUnpaid`, POOLSE-187).
- An Admin sees every staff member's pay except the Owner's, and the card says so.
- A free-swim sale is an invoice line, and who is in the water is `pool_occupancy()`.
- A cost is an amount with a period, and a window is a sum of `cost_month`.

### Energy

Read [`docs/conventions/energy.md`](docs/conventions/energy.md) before touching meters, bills, tariffs or their comparisons.

- `energy_meter.reads` says what a value means, and consumption is derived from it once, in SQL.
- The Energia page opens on a folded *Importar fatura* card and the club's dashboard (`GET /energy/summary`), and a meter says what it measures.
- Outside air temperature is stored context, and it never corrects a figure.
- A comparison compares only the months that have both years, and consumption and cost are never one sentence.
- What a tank costs per hour taught in it is a month divided by a month, and the screen says so.
- A meter with no fatura is costed by a tariff, and what comes out is an estimate that never touches a billed euro.
- A bill is filed whole and never edited; its two ways in share one form and one check.

### Water quality and maintenance

Read [`docs/conventions/water-and-maintenance.md`](docs/conventions/water-and-maintenance.md) before touching readings, bands, alerts, tasks or spaces.

- A derived answer is derived once, on the server.
- A breach is derived; being told about it is a record.
- The published band is NP 4542:2017, and a lab result's grade is derived, never stored.
- A pool's band is the published one until a club says otherwise, and `resolveBands` is where the two meet.
- Only a recent sample alerts, and the screen says whether anything was sent.
- A recurring job is a `maintenance_task`; a one-off is a `maintenance_request`, and `interval_days` is the boundary.
- Assignment is a person here and a role in 4.2's alerts, and the difference is the point.
- A null ceiling, interval or limit means "not measured" and enforces nothing.
- Out of service is not deleted.

### Interface

Read [`docs/conventions/interface.md`](docs/conventions/interface.md) before touching any screen: look, forms, dialogs, navigation, the phone, the app shell, the dashboard.

- The dashboard is a union of role bands, and a widget is one declaration in a registry.
- A save says so, and it says so once.
- A section that opens and closes moves smoothly
- Something slow says so in the corner, and the signal comes from where the work starts.
- The look is tokens, from the design handoff
- Every button and every form control is one size: `h-control` (36px) and `text-control` (15px).
- On a phone the same tokens take a second value, and the shell clears the notch.
- Form fields are controlled, never `defaultValue`.
- A circle means something needs doing, and it clears when it is done
- The menu's entries live in `lib/nav-entries.ts`
- A document on paper is a route with print styles; the one PDF library is `lib/form-pdf.ts`, for a club's forms on the phone
- A decision asks first
- A question asked in the middle of the page uses `components/ui/dialog.tsx`.
- A refusal that needs numbers carries them as structure, never as prose.
- Light and dark mode in every app
- Palette: desktop primary `rgb(103, 166, 182)`, complementary `rgb(179, 212, 157)`; text reads an ink, fills read the token.
- Voltar goes back to where you came from, and every in-app link is a `FromLink`.
- A record's page uses `DetailPage`; one card is one tab, and the first is General.
- A page or tab that stacks independent sections shows one at a time, behind `SectionPills`.
- One content width, and the calendar is the single exception.
- A fetch that answers `null` for both "not yet" and "it failed" produces a control that is disabled with no explanation.
- A side sheet fits the window; the one growable thing inside it takes the slack.
- Eight level tints, measured in both themes, and always shown at full strength somewhere.
- A page that fails unexpectedly lands in `dashboard/error.tsx`
- A message in the family app on a phone is a solid full-width bar above the tab bar (`.toast-card`); the backoffice keeps its quiet toast (Rui, 06-11-2026).
- A typed cost or purchase is *Faturado* only with a document number; without one it is *Estimado* (Rui, 06-11-2026).
- A time a family types is `self_reported`: it may be a best, never official or for mínimos. Distance swum is added up from the times, never typed (Rui, 06-11-2026).
- The family app says the least it can (Rui, 06-11-2026): short labels, *Voltar* with the destination for screen readers only, icons with names for a screen reader, no sentence that repeats a control.
- The family app is soft on a phone

### Calendar, classes and recintos

Read [`docs/conventions/calendar-and-classes.md`](docs/conventions/calendar-and-classes.md) before touching the calendar, turmas, sessions, lanes, closures, seasons or partnerships.

- A series move re-times the weeks that still sit where the pattern put them.
- A guard that reads the pattern and a screen that draws the week will disagree, so a refusal must say which one it is defending.
- A partnership's contract comes before its terms and keeps its versions.
- The season is organization-scoped and already built; a screen picks from it, never keeps its own.
- A pool is a recinto of sport `pool`, and the pool's own trigger makes it.
- A closure is one site or some of its tanks, and what it reaches is `closure_reaches` / `session_reach`.
- A partnership group's days are written by one path, all or nothing
- A turma is chosen in `TurmaPicker` (`components/turma-picker.tsx`), never a `<select>` of joined strings.
- Turmas opens on *Cartões
- Capacity rules compose, they do not override.
- A calendar block's state is words first
- One student, one hour: an enrolment that overlaps another of the student's turmas is refused; a move that creates one is warned
- A dated grid is drawn from minutes, not from rows.
- A week's class can differ from its pattern, lanes included.
- A parceria takes no register, ever — but it may take a plan.
- A draggable block carries no click.
- The calendar draws the pattern, overlaid with the week's own sessions.
- A week's occurrence is found by its booking's id, never by turma-weekday-hour.
- A turma's lessons follow its pattern on their own.
- A taught class is a record, not a plan.
- A class with no pista is drawn in a Sem pista column, which is a drop target both ways.
- Both axes of a drag are travel, never pointer position.
- A drag costs a transform, never a reflow, and one droppable per column.

### Students, families and messages

Read [`docs/conventions/students-and-families.md`](docs/conventions/students-and-families.md) before touching a student record, levels, competition, what a family sees, messages or an archive.

- Every email is sent once after its commit, rendered from its row, and retried hourly if it did not leave.
- A NIF is checksum-validated, and `isValidNif` in `@poolse/rules` is the one definition.
- A family asks for a place from the app, and it is a pedido in the same queue.
- An adult is the absence of a guardian edge, never a flag.
- A warning about a person never gates what a club does with them.
- A student holds one level per sport
- An archive is undone through the bin, and an archive that takes children lists them.
- An edit records what it changed, and a revert goes through the edit's own path.
- A time states its pool, and a best is per stroke, distance and course.
- A meet's results come from a LENEX file read on a server by `@poolse/rules/lenex` (its own subpath: `node:zlib` stays out of client bundles), and only the chosen club's swimmers reach the API.
- A results file can also arrive by email, and the inbox is the import's door, never a second import.
- A gap to qualify is `qualifying_gaps()` in SQL, and an FPN age group is never a `student_level`.
- A child advances by skills or by age, through one queue, and a job that writes as the club runs `asSystem`.
- A family reads its own child's record through the staff page in `familyView`.
- A cancelled lesson tells its families, and push is a second channel on a recorded notice.
- Who answers for a child is `family_may_answer()`, and *Vou / Não vou* is a notice, never a mark.
- What a family says after a lesson is `lesson_feedback`, admitted by its trigger and read by who taught it.
- A qualification's colour is `qualification_status()` in SQL, read through `qualification_current`.
- A family may stop a club's general messages, and nothing else.
- An aviso is a `message` with `channel = 'app'` and a window, never mail
- A scheduled exam is `medical_exam_schedule`, office only, and `insertExamIn` closes it.
- A message to one student is `audience = 'student'`, and WhatsApp is a record of a link opened, never a send.
- A message to families is a record first and an email second.
- A student's identity, documents and exam are the student's own record
- What a family sends is a `family_submission`, and it changes nothing until the office accepts.
- A date a person gave is declared until the office confirms it.
- The family's calendar is `GET /app/agenda?from=&to=`, and its reach is `agendaWindowAllowed` in `@poolse/rules`

### Importers and exports

Read [`docs/conventions/importers-and-exports.md`](docs/conventions/importers-and-exports.md) before touching an importer, an export or a file a club uploads.

- A column-mapping importer uses `useImportWizard`.
- A document importer is an `AnalysisReportParser`.
- A list importer takes a PDF by `readSheet(file, { pdf: true })`, and the PDF becomes a spreadsheet.
- An importer is a `MatchSpec`, never a new pipeline.
- What an export writes, its importer reads back — and a test proves it against the real catalogue.
- A round trip changes nothing.
- A file of money is the one importer that commits whole or not at all, and its export carries the contract rather than the derived figures.

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

## Settled by backlog rounds

Decisions taken in review that are not obvious from the code, so they are not re-opened:

- **There is no `manager` role.** `member_role` is `owner, admin, instructor, maintenance,
  student, guardian`. Backlog stories written for a "manager" mean `admin`.
- **Holidays live in `closure`, not a second table.** `source` distinguishes
  `national_holiday` from `manual`; municipal holidays join it as another `source`. The
  vacation calendar filters on that column — a shutdown for building works is not a public
  holiday and must not make a vacation day free.
- **Scheduling-grid slots are configurable per organization** (15, 30 or 60 minutes).
- **File storage is R2 (S3Mock in dev), and a file is read only through the app.** 12 October
  2026. `stored_file` is the registry; `POST /files` takes raw bytes (purpose and name in the
  query), judges the type by its first bytes, 10 MB; a feature attaches the returned id with its
  own route, which re-checks the purpose in its transaction. `GET /files/:id` applies
  `RULES[purpose]` in `files/files.repository.ts` and streams; the web serves it at `/files/<id>`.
  Never a public bucket or a pre-signed link. Student photos (consent rule) and incident
  attachments (encrypted) are named in the enum and not switched on. Upload controls:
  `FileUpload` / `AttachedDocument` in `components/file-upload.tsx`. `docs/features/files.md`.
- **Vacation carry-over to 30 April is not tracked in v1**, and the balance summary says so
  rather than being quietly wrong.

## Asking for decisions

When something genuinely needs a call, ask once, tightly, with a recommended default.
Not a list of open questions — that moves the work back onto the one person who has the
least time.

## Housekeeping

Four rules that keep the repo's own memory usable. They apply to every ticket.

- **Docs follow behaviour.** When a change alters behaviour, roles or schema, update the
  docs in the *same commit*: `docs/data-model.md` for schema, `docs/features/<area>.md` for
  behaviour. Create the feature page if it does not exist. Short and factual — what it does,
  who can do it, what rules apply. The argument belongs in `docs/decisions.md`.
- **CLAUDE.md stays short.** A new convention, shared component, validation approach or
  role guard earns **one line** here, so the next session uses it instead of reinventing it, and
  its reasons and traps go in `docs/conventions/<topic>.md`. A paragraph never goes in `CLAUDE.md`.
- **Refactor by proposal, not by reflex.** Code that is clearly duplicated or has outgrown
  what it was built for is *proposed* in one line and left alone until Rui says yes. Collect
  the proposals in the session summary.
- **Decisions log.** `docs/decisions.md`, one dated line per product decision taken in
  conversation — especially one that reverses an earlier decision.

## Backlog

The backlog lives in `docs/backlog/`, one file per ticket (`POOLSE-01…36`).

- `docs/backlog/README.md` — index of all tickets with area, priority and dependencies.
- `docs/backlog/CONVENTIONS.md` — standing rules that apply to every ticket, and the definition of done.
- `docs/backlog/CONFLICTS.md` — known contradictions between tickets and their resolutions.
- `docs/backlog/BUILD-ORDER.md` — dependency order and how a build session runs.

**When working on a ticket, read that ticket's file and `CONVENTIONS.md`. Do not read the whole
backlog folder** — it is ~2,300 lines and loading it wastes the session's context on tickets that
are not being built.

Each ticket file contains four sections plus the acceptance criteria:

- **PO** — why it exists and what is explicitly out of scope. Respect the out-of-scope line; do not helpfully build the adjacent thing.
- **BA** — the business rules and data. Anything marked `**Open:**` is genuinely undecided: ask rather than picking an answer.
- **Dev** — schema and migration impact, API surface, where the logic belongs, and the thing most likely to be got wrong.
- **QA** — numbered `Given / When / Then` scenarios. These are the tests to write, including the permission-denial and negative ones.
- **Acceptance criteria** — the contract. A ticket is not done until every numbered criterion is met.

### Non-negotiables for every ticket

- Permissions are enforced server-side; hiding a control is never the control.
- Every tenant table carries the tenant key; every query is scoped.
- Every user-facing string goes through i18n (pt-PT + en) as it is written.
- Light and dark mode, contrast-checked; colour never carries meaning alone.
- History is soft-deleted, never destroyed.

## How to work with Rui

- **Disagree out loud.** If the slice, ticket or approach is a bad plan, say so before building — one line, with the better option. Don't build the thing you think is wrong.
- **Ask when it matters.** One tight question with a recommended default (see *Asking for decisions*). Never guess on a schema, a permission or a money rule.
- **Every change gets a security read.** Before calling a slice done, check it for injection (SQL, prompt, XSS), tenant leaks, exposed keys or secrets, form validation, and personal-data exposure. Use `/poolse-security-review` for a new endpoint, webhook, upload, server action or `/admin` change.
