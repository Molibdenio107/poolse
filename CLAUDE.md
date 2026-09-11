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

**European Portuguese, not Brazilian.** `pt-PT` is the source language and `en` is the
translation, not the other way round. Reviewers check for Brazilian forms — *usuário*
(utilizador), *seção* (secção), *arquivo* (ficheiro), *salvar* (guardar), *tela* (ecrã),
*cadastro* (registo), *senha* (palavra-passe) — and for the Brazilian present continuous
(*está processando* rather than *está a processar*). They also check for English left
untranslated in the interface. `pnpm i18n:check` proves every key exists in both files; it
cannot tell you the Portuguese is the right Portuguese, so that part is read by a person.

**A date's shape is a named format in `i18n.ts`, never an options object at the call site.**
`long`, `short` and `stamp` are defined once and passed to *both* `getRequestConfig` and
`NextIntlClientProvider` — a client provider inherits the locale and timezone from the server
but neither the messages nor the formats. next-intl has no built-in names, so asking for one
that was never configured is a `MISSING_FORMAT` throw at render time, on whichever screen
renders it first. `pnpm i18n:check` proves every named format resolves; `tsc` cannot, because
the name is a string.

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

**Clerk owns the name and the email; `app_user` holds a cache.** `cached_first_name`,
`cached_last_name`, `cached_email` and `cached_avatar_url` are a copy of Clerk's data,
refreshed by the webhook and stamped with `synced_at` so a late event cannot revert a
newer one. **Never write those columns to save a user's input.** It appears to work and is
silently overwritten the next time Clerk syncs — a bug that reproduces only sometimes.
The save path is: write to Clerk, then re-read from Clerk (`refreshFromClerk`). Locale,
theme, birth date and phone are Poolse's and are written directly. `docs/data-model.md`,
decision 2, and `packages/db/test/profile.sql`, test 6.

**A series move re-times the weeks that still sit where the pattern put them.** The calendar
draws each booking at its `class_session` for that week, so a move that rewrites only
`class_schedule` is written and then invisible — the block springs back, and nothing reports a
failure because there was none. `retimeSessions` in `bookings.repository.ts` is the other half
of round 7's overlay. It skips a week moved by hand (`moved_at`), a week in the past and a
week whose register is taken — **except the week that was dragged**, named by `fromDate`,
which follows and loses its exception, because the operator just moved that block and said
"every week". **`fromDate` names the day the block was drawn on, not the week the pattern
files it under**: the two differ for a class moved across a week boundary, and matching by week
both missed the block on screen and claimed its neighbour instead. Where a week *lands*, and
whether it is behind us, stay derived from `occurs_on` — one session per pattern week is the
invariant the unique index rests on. A week left behind is counted and reported either way (`weeksKept`,
`weeksBlocked`): "kept by design" and "failed" look identical on screen, and silence is what
made this read as a feature that did nothing; a week whose new hour is occupied is left alone and **counted**,
one savepoint each, because failing a whole series change over one November Wednesday makes
the feature unusable. Re-stamp `class_session_lane` with it — the exclusion constraint is on
those rows and they carry their own copy of the window.

**A guard that reads the pattern and a screen that draws the week will disagree, so a refusal
must say which one it is defending.** A series move is checked against `class_schedule`,
because that is what it rewrites; the calendar draws `class_session`. A turma whose sessions
have all been moved elsewhere one week at a time still holds its pattern slot — so it blocks a
move while being drawn on another day, and "Pista 2 already has X" names a class the operator
can see somewhere else entirely. The fix is never to weaken the guard: it is to carry the
blocker's own weekday and hour on the 409 and say them. Same family as the trigger refusals
that carry their numbers.

**A save says so, and it says so once.** `useSavedAction` raises the toast — one place, every
form — so no screen has to remember to report an outcome and none of them can word it
differently. Field errors still render beside their field, because a message at the top of the
page cannot say which of a dozen boxes it meant; the top-of-form banner and the inline
"Guardado" are the toast's job now. `components/ui/toast.tsx`: muted tones on the surface
colour, an icon per tone so colour never carries the meaning alone, 4s for a success and 8s
for a refusal, and `w-auto` up to `max-w-md` so the box hugs its words. A saturated fill was
offered and declined twice — these appear dozens of times an afternoon. **The calendar's move
refusals go here too**, rather than into a bar above a grid that is taller than the window.

**Form fields are controlled, never `defaultValue`.** React 19 resets a form as soon
as a function `action` returns — *including when it returns a validation error*. An
uncontrolled input therefore wipes what somebody just typed at the exact moment they are
being asked to correct it, and an uncontrolled `<select>` reverts to its mount-time value
after a save that worked. Both shipped as separate-looking bugs (POOLSE-09, POOLSE-10) from
one cause. Use `TextField` / `SelectField` / `TextAreaField` from
`apps/web/src/components/ui/field.tsx`; they are controlled, re-seed only when the server's
value actually changes, and carry their own label, hint and field-level error.

**A NIF is checksum-validated, and `isValidNif` in `@poolse/rules` is the one definition.**
Nine digits with a mod-11 check digit; empty stays allowed everywhere it already was. It lives
in the shared package for the reason the conflict rules do — a form that accepts a number the
API refuses is the failure that package exists to prevent. This **reverses** the "never
validated as a real NIF" comment that `students.controller.ts` and `membership.tax_number`
used to carry: the duplicate-person guard is *keyed* on the NIF, so a number that cannot exist
silently defeats it. **One NIF is one person**: a student and their guardian may not share one
in a submit, nor may two guardians — checked in the controller, which is the only place the
whole request is visible. An inline guardian whose NIF matches an existing person is still
*attached* to them, because that is what stops a second sibling producing a second mother.

**Money amounts are integer minor units; unit prices are not.** `amount_cents` for
invoices and fees. A per-kWh tariff in integer cents rounds €0.1548 to €0.15 and puts a
3% error on the module whose entire purpose is cost accuracy — unit prices are
`numeric(12,6)`.

**One price list, four `fee_kind`s — never a table per fee type.** `mensalidade`,
`inscricao`, `seguro`, `quota`, all on `fee_plan`, each with its shape held by a CHECK: only
a mensalidade is priced by a level and a frequency, only a quota is banded by age, and
inscrição and seguro belong to a season. The **recurrence is the plan's, not the kind's** —
the default per kind is an API opinion, and the schema enforces only that a `fee_period` may
be named by a plan that recurs by the facility's periodicity list. A new kind is a value and
a row in that table; if it seems to want its own table, that is four read paths and four
copies of every bug. `docs/decisions.md`, 2026-09-08.

**Amounts are gross and `vat_rate` says what is already inside them; `vat_exempt` is its own
flag.** Never a rate of zero standing in for isento — on a Portuguese invoice an exemption and
a zero rate are two different statements, and a schema that cannot tell them apart discovers
it while invoicing. This reverses the "no VAT rate anywhere" comment that `fee_plan.amount_cents`
used to carry; the exemption *reason* is invoicing's to add.

**An invoice is written once, and its number comes from the database.** `poolse_app` holds
SELECT and INSERT on `invoice` and `invoice_line` and nothing else — a revoke rather than a
trigger, because a missing privilege cannot be forgotten by application code. So there is no
`updated_at`, no `archived_at`, and no edit: a correction is a credit note in its own book,
and settlement in 2.3 arrives as a child table the way `student_fee_payment` did. `number` is
allocated by a BEFORE INSERT trigger from `invoice_series.next_number` — **a column and not a
Postgres sequence**, because a sequence is not transactional and a rolled-back document would
leave a gap the series may not have. An INSERT that supplies a number is refused. The row lock
that allocation takes also serialises every insert into one series, which is what makes the
double-billing trigger sound; a refactor to a sequence passes most tests and breaks both
properties. These are **internal records, not legal faturas** — `atcud` and
`at_validation_code` are reserved and null until certification, and the screens say so.

**"Already billed" means "on a document not since credited", so it is a constraint trigger
and not a partial index.** After a credit note the occurrence is chargeable again — that is
how a club fixes a document it got wrong — and "live" needs a join an index cannot do.
`invoice_charged_on` is the one definition, read by that trigger *and* by the monthly run, so
a preview cannot offer a line the commit then refuses. The run itself is `runInvoices(…,
commit)`: preview and write are one path with a flag, like every importer here, and the
per-student action is the same call with `studentIds` set.

**An invoice is addressed to a payer — the guardian, or the student on the adult path — so
siblings land on one document.** `invoice_payer_membership_id` says it once; null means the
student is their own payer. Everything the document says about a person is a **snapshot**,
including each line's `student_tax_number`, which is not the payer's: a parent deducting
lessons on their IRS does it against the child's number.

**A document line stores the club's own words, never a translated enum.** `fee_plan` has no
`name` in this schema — a plan's label is its kind, its level and its frequency — so
`invoice_line.description` holds the level's or season's name, `lessons_per_week` the
frequency, and the sentence is composed by `LineLabel` where the catalogue is. Storing
"Mensalidade" would freeze a document at the language of whoever pressed the button.

**A document's state is `total − paid` and never a column.** `invoice_status` is the one
definition — credited beats paid beats overdue, and a partly paid document past its due date
is still overdue. A payment is a **child row** (`invoice_payment`), soft-deleted, summed on
every read, so recording one moves a badge without writing to the invoice; an overpayment
settles and `outstandingCents` floors at zero. A credit note is never paid, refused by a
trigger because a bank feed will be a second way in. **`due_on` may precede `issued_on`** — a
club billing October in December is ordinary, and 2.2's CHECK to the contrary was dropped
rather than replaced. **Chasing records what a person did**, not what Poolse sent: nothing is
delivered until the notifications phase, the channel is on the row so that phase writes into
the same history, and the screens say so plainly.

**A fee line with no `fee_period_id` is charged once**, and only an inscrição or a seguro may
be one. The period is how a recurring line knows what an occurrence is worth and when the next
falls due; a fee paid once has neither, and forcing it to name one makes the arithmetic wrong
rather than redundant — the total is `amount × months`. Null means `amount_cents` is the whole
amount, months coalesce to 1, and the occurrence is `starts_on` itself. Every join to
`fee_period` from `student_fee` is therefore a LEFT JOIN: an inner one silently drops those
lines, which is how the register's "pago" tick nearly left a joining fee outstanding.

**An adult is the absence of a guardian edge, never a flag.** A student at or above the club's
`age_of_majority` with no live `guardian_link` is on the adult path; `student_is_adult_path`
is the one definition and every screen reads it rather than deriving it. An `is_adult` column
would drift the first time a birth date is corrected. A student with **no** birth date is on
the guardian path — guessing adult for missing data is the guess that cannot be recovered from.
The server also chooses the consent form and **validates it on the way back** with a 422: a
client cannot record a self-signed consent against a minor who has a guardian.

**A warning about a person never gates what a club does with them.** A student with no valid
seguro is flagged on their page and in the register and is enrolled, taught and marked exactly
as before. An instructor at the poolside cannot fix a seguro, and a register that would not
open over a piece of paperwork is a register somebody keeps on paper instead. Where the fact
has three states — insured, lapsed, never — say three sentences: a renewal and a family who
never bought one are different things to do.

**A partial unique index cannot join, which is why a snapshot sometimes carries a foreign
row's column.** `student_fee.kind` is the case: "one inscrição per student per season" is only
sayable with the kind on that row. Where that happens, a BEFORE trigger fills the copy from
its source when a caller does not send it — every existing caller predates the column, as with
`class_session.occurs_on` — and a constraint trigger refuses one that disagrees. A copy with
neither is a copy that drifts.

**The season is organization-scoped and already built; a screen picks from it, never keeps its
own.** `season` has the name, both dates, one `published` at a time and its own page under
Turmas, and it is wired into `generate_sessions`, `class_group`, `class_schedule` and
`facility_time_slot`. Anything that needs a season reads that list — the price list filters out
`archived`, because a year that has ended cannot be priced afresh.

**A personal tenant is `organization.kind`, read in exactly two places.** `/me` carries
`organizationKind` on each membership; the sidebar prunes by it (`kinds: ['business']` on an
item, alongside `roles`) and the dashboard swaps occupancy for `MyPoolPanel`. Nothing else
branches on it — a personal tenant is an ordinary tenant with fewer screens, which is what
decision 1 promised and slice 4.5 proved by staying small. `provision_organization` takes the
kind and opens a pool for a personal tenant and a season for a club; every caller that omits
it gets a club. Absence from the menu is a shape, not a permission: the API answers those
routes, and hiding them is not the control. `docs/features/personal.md`.

**`energy_meter.reads` says what a value means, and consumption is derived from it once, in
SQL.** `cumulative_index` is the dial and consumption is `value − lag(value)` over *live*
rows (falling back to `initial_index`); `interval_consumption` is the value itself. The one
definition is `CONSUMED` in `energy.repository.ts`, read by the list and the monthly rollup;
never subtract in TypeScript. `reads` is never edited — a wrong meter is retired and made
again, and a swapped dial is a new meter with `replaced_meter_id`. `energy_reading` has **no
surrogate id** — its key is `(organization_id, meter_id, taken_at)`, hypertable-shaped for
the day feeds arrive, and deliberately not a hypertable until then (decisions, 2026-09-11).
A dial running backwards is a trigger refusal carrying the neighbour in DETAIL, like
`pool_capacity`. `docs/features/energy.md`.

**A subscription covers one facility; the schema allows many.** These are two
different rules and both are settled. The *schema* keeps `organization 1 —— N
facility` — backlog story B4 proposed narrowing it and was rejected, because a
municipality with pools in two buildings would then need two organizations with
two staff lists and two invoices. The *licence* is what bounds it:
`organization.max_facilities` defaults to 1, is enforced by a trigger rather than
by the API, and a club with two sites buys a plan with two. Do not re-open either
half. The trigger exists because the application layer already forgot once — a
seed created a second site to keep demo data tidy and nothing objected.

**Every unique constraint on a soft-deletable table is partial** (`where archived_at is
null`). Otherwise archiving an instructor and re-adding them next season violates the
constraint against a dead row.

**A permission about a *row* is a repository answer, not `requireRole`.** "The instructor
responsible for this turma" cannot be written as a role, so the repository resolves the row,
decides, and the controller turns a refusal into a 403 — while the read endpoint returns the
same answer as `canEdit` so the screen and the guard cannot disagree. See `lesson-plans.repository.ts`.

**A question asked in the middle of the page uses `components/ui/dialog.tsx`.** It portals
to the body, so no ancestor's `overflow`, `transform` or `z-index` can clip it; it closes on
Escape and on the backdrop, moves focus in and gives it back, and keeps Tab inside itself.
Never render a confirmation in place of its own trigger — round 5's did, which put a form
inside a calendar cell one seventh of a column wide. Never `window.confirm` either: two
confirmations in two visual languages make an operator wonder whether they are being asked
the same thing.

**A refusal that needs numbers carries them as structure, never as prose.** A rule enforced
by a trigger raises with a machine-readable `DETAIL` (`pool_capacity|40|32|12`); the API
turns that into a 409 with the figures as fields, and `FormState.values` carries them to
`t(key, values)`. Do not re-derive the numbers in TypeScript to build the sentence — two
implementations of one sum agree until the day they do not. See `pool_capacity_respected`
and `poolCapacityRefusal`.

**A column-mapping importer uses `useImportWizard`.** The four-step machine —
upload, map, preview, commit — lives in `lib/use-import-wizard.ts`, generic over the field
type. A new importer supplies its own preview rendering and nothing else. The calendar's
(a grid layout, no columns) and the water log's (matches in the browser, no model call) are
deliberately not callers.

**A document importer is an `AnalysisReportParser`.** A file with no columns — a
laboratory's PDF, a photograph of a log — cannot have a mapping step, so it is read by a
parser that answers in the *same field names* the mapping step produces and joins the
ordinary validate–preview–commit path. Two ways in, one pipeline. Every such parser is
optional and off unless its own flag and `ANTHROPIC_API_KEY` are both set, sends the
document and nothing else about the tenant, and has everything it extracts confirmed by a
person on the preview. `lib/analysis-report.ts` is the contract; `-agent.ts` is the model.

**An importer is a `MatchSpec`, never a new pipeline.** There are five — the register, the
store room, the wall timetable, the water log and parcerias. A new one is a field list, a
synonym list and `matchFields` in `lib/<thing>-sheet.ts`, plus a preview/commit pair on one
API route with a `commit` flag. Never two routes: what the operator was shown and what gets
written have to come from one code path. The file is read on the Next server and never
leaves it.

**What an export writes, its importer reads back — and a test proves it against the real
catalogue.** The header row is `<thing>.field.*` from the translation catalogue, not prose
invented for the file, so a club exports, corrects and re-imports with no column mapped by
hand. Two rules fall out of it. **Any value that has to survive the journey is written in a
form that is the same in both languages** — the inventory's `all`, a partner type's own enum
spelling — because a file exported under `en` re-imports under `pt-PT`. And **a label chosen
for the export is a label the matcher must not hand to another field**: `partners.field.contactName`
is "Contacto" rather than the partner screens' "Nome", because a bare "Nome" is what claims
the entity's column. `tsc` has no opinion about either, so the guard is a round-trip test
reading `messages/*.json` from disk — `partner-sheet.test.ts` is the shape.

**A round trip changes nothing.** Exporting a list and importing it back must produce a
preview of stocktakes with nothing to update, and a commit that writes no rows. It is the
cheapest end-to-end assertion an importer has, and it fails on a dropped field, on a value
written in a shape the reader parses differently, and on the two sides disagreeing about
what one row is. `partner-export.integration.test.ts` caught one of those.

**Capacity rules compose, they do not override.** An enrolment must fit its turma
(`class_group.capacity`), the turmas sharing a slot must fit the tank (`pool.max_capacity`),
and `lane_level_capacity` is a separate teaching judgement. A null ceiling means "not
measured" and enforces nothing — never treat it as zero.

**Light and dark mode in every app**, from the first component. Colors come from tokens;
no literal hex in components.

**Palette.** Backoffice and desktop web: primary `rgb(103, 166, 182)`, complementary
`rgb(179, 212, 157)`. Mobile apps run sportier — soft orange with pool blue. Mobile
palette is explicitly allowed to move during development; the desktop one is not.

**Money and readings are never floats.** Amounts in integer minor units. Sensor readings
in `numeric` with an explicit unit column — pH, °C, ppm and kWh do not share a type.

**Times are stored UTC, displayed in the facility's timezone.** Class schedules are the
place this bites; get it right once in the scheduling layer.

**One content width, and the calendar is the single exception.** `PageShell` caps every page
at `max-w-page`; `width="wide"` exists for a screen whose content is a grid rather than prose,
and the calendar is meant to stay its only caller. A second caller is a decision to take out
loud, not a tidy-up — if a third appears, ask what those pages have in common instead of
widening them one at a time.

**A dated grid is drawn from minutes, not from rows.** The calendar places blocks at
`top = minutes × PX_PER_MINUTE` from `lib/calendar-scale.ts`; a slot-as-table-row makes a
45-minute class in a 60-minute slot read as an hour. One scale constant, shared by the
blocks, the now-line, the drag maths and the auto-scroll — a second one is how they stop
agreeing. `calendar/calendar-grid.tsx` is the dated week; `classes/schedule-board.tsx` is
still the recurring pattern, and they are deliberately two components.

**A week's class can differ from its pattern, lanes included.** `class_session` carries the
one-week answer — `moved_at`, its own `instructor_membership_id`, and its own rows in
`class_session_lane` — and `class_schedule` carries the pattern. So the calendar's scope
popover offers both answers for *every* change, sideways included; the earlier "a lane change
is always every week" was a limitation of the endpoint, not a rule. `moveOccurrence` takes
`laneIds`, where **absent means "I did not ask about pistas"** and an empty array means "in
no pista this week" — collapsing the two makes a plain time change silently unassign lanes.
It takes `durationMinutes` on the same contract, and for the same reason: without it a resize
answered "só esta semana" wrote the hour and dropped the length, so the block sprang back and
the gesture looked inert. Never write `ends_at` alongside it — a BEFORE trigger derives it
from the start and the duration, and the lane exclusion guards a window built from those two.

**`class_session` has no `archived_at`; it has `status`.** A session ends as `cancelled`,
which is what attendance and invoicing rest on. `cs` means `class_schedule` in most of this
codebase and `class_schedule` *does* have the column — so a query that means the session and
copies the habit raises `42703` at runtime and nothing catches it: `typecheck` does not read
SQL and `sql:check` only looks for backticks. **A repository function with no integration test
is untested SQL** — the whole stand-in feature shipped dead this way, and the browser's
`.catch(() => null)` presented it as a dropdown greyed for ever.

**A fetch that answers `null` for both "not yet" and "it failed" produces a control that is
disabled with no explanation.** Keep `loaded` as its own state, and say what went wrong with a
way to retry. `stand-in-picker.tsx` is the shape.

**A column of a custom enum array is read `::text[]`, never bare.** node-postgres has a parser
for `text[]` and none for `pool_metric[]`, so a bare select hands JavaScript the string
`'{ph}'` — `.map()` over it iterates characters and `new Set(…)` of it matches no metric name.
It typechecks perfectly, because the row type is whatever the query was told to claim, and it
is invisible on a screen that only counts the rows. Slice 4.2's alert email was built from
exactly that set and would have gone out with an empty list; the integration test is what
found it, which is the same lesson as the paragraph above.

**`cs` means `class_schedule` in most of this codebase, and a join to `class_group` is the
place partnerships get silently dropped.** It has happened three times — `listSessions`,
`occurrenceOf` and the stand-in candidate list all inner-joined it, so every parceria session
simply was not there. Nothing errors: a query returns fewer rows and a screen renders less.
A partnership session carries no `class_group_id`; its group, its instructor and its title
come through `class_schedule`. Reach for `LEFT JOIN` and a `coalesce` of both sides.

**A parceria takes no register, ever — but it may take a plan.** `partner.managed_lessons` is
one switch on the partnership, off by default, and it grants the training plan and Cancelar
aula on the calendar and nothing else. The register is not a UI choice: `partner_group` holds
a `participant_count` and no people, and `attendance` needs a real `student_id`. A `lesson_plan`
therefore hangs off a turma **or** a partner group, with a CHECK that exactly one is set and a
partial unique index each — one index over both columns enforces nothing, because two partner
plans on a day differ only by their null `class_group_id`s.

**A side sheet fits the window; the one growable thing inside it takes the slack.** Make the
panel a flex column and give the text box `flex-1 min-h-0` rather than a fixed `min-h-`. The
`min-h-0` is the half that is easy to miss — a flex item will not shrink below its content
without it, and the sheet scrolls anyway. A fixed floor pushes the buttons below the fold on a
laptop, which is how a Save nobody can see gets reported as a save that does not work.

**A draggable block carries no click.** Every drag and every resize ends with the browser
firing a click on whatever is underneath, so a block that both moves and opens something will
open it by accident. Timers that suppress the trailing click narrow the window without closing
it. Put the action on the hover card beside the others — which is also where a keyboard can
reach it, since the card opens on focus.

**The calendar draws the pattern, overlaid with the week's own sessions.** `readGrid` returns
`class_schedule`; the page re-times each booking to its `class_session` for that week before
handing them to the grid. Skip the overlay and a one-week move is written, refused and
reported correctly — and then invisible, because the block springs back to the pattern's slot.
A change the screen cannot show reads as a change that did not happen.

**A week's occurrence is found by its booking's id, never by turma-weekday-hour.**
`bookingKey` in `lib/slot-key.ts`; `slotKey` is the fallback for a session with no booking.
The composite was exact only while an occurrence could not leave its pattern's slot — it can
now, so the two halves stop agreeing the moment anybody moves one week, and every control on
the card silently vanishes from the classes that were rearranged. A lookup that returns
`undefined` renders nothing and reports nothing: prefer a key that cannot drift.

**A taught class is a record, not a plan.** One row in `attendance` for a session means it
happened, so it does not move and it is not cancelled. `Session.registerTaken` carries the
fact to the screen; the move endpoint asks the same question itself. The block stays
draggable — round 6 settled that a block which looks like every other block and silently
refuses reads as a broken grid — so the refusal is a sentence, not a disabled control.

**A class with no pista is drawn in a Sem pista column, which is a drop target both ways.**
`laneIds` may be empty — ordinary for a class nobody has placed yet — and the grid used to
draw none of them, so nine dev bookings existed and were invisible. The column is a synthetic
lane (`NO_LANE_ID`) prepended to *every* day, present only when the week has one, because
`columnX` is one uniform stride per day and a per-day column count would make the ruler depend
on the day. Out of it onto a pista assigns that pista; into it clears them — landing on the
column means no pista whatever the block's width, rather than slicing the span and filtering,
which would silently narrow a wide block. The id is never written to a booking; the column
takes no click (`creatable`, separate from `disabled`) and offers no sideways resize.

**Both axes of a drag are travel, never pointer position.** The calendar's scale lives whole
in `lib/calendar-scale.ts`: `PX_PER_MINUTE` down, `COL_WIDTH`/`GUTTER`/`DAY_RULE` and
`columnX`/`columnAt` across. Resolving one axis from `delta` and the other from whichever
droppable is under the pointer puts a multi-lane block's left edge under the pointer, so it
jumps sideways by however far along it was grabbed and collides in lanes nobody chose. The
blocks, the ghost and the drag measure with one ruler or they disagree.

**A drag costs a transform, never a reflow, and one droppable per column.** Measured on a
real club, the old board mounted 2,256 droppables — day × slot × lane, each running a rules
`evaluate()` on drag start — and `pointerWithin` walked all of them per pointer move. The
calendar mounts one per day-and-lane (168) and derives the minute from the pointer's travel.
Drag state changes on the *snapped* value, so a render happens once per step rather than
once per frame, and every transition is off while a drag is live.

**Eight level tints, solid, measured in both themes.** `--level-1…8` plus `--level-none` in
`globals.css`. Solid blocks with white text rather than a wash of the surface: the same eight
hues washed at 15% sit ΔE 4.5 apart, which is about one just-noticeable difference and means
the colour is doing no work. Solid they are ΔE 26.7 apart, white text is ≥4.6:1, and the dark
set is solved against the dark card rather than being the light set at another opacity.

**A derived answer is derived once, on the server.** Overdue cleaning is
`now() - last cleaning > interval`, computed in SQL in `spaces.repository.ts` and shipped as a
boolean; the client renders it and never recomputes it. The same reasoning as the trigger
refusals that carry their numbers: two implementations of one rule agree until the day they do
not. It is also why there is no `is_overdue` column — a stored flag needs a worker to keep it
true, and that is a per-tenant cost.

**A breach is derived; being told about it is a record.** `excursions()` and the published
bands live in `@poolse/rules` — with `POOL_METRICS` and `METRIC_UNITS`, which the API and the
web app each used to declare by hand — so the pool's page and the alert email cannot disagree
about whether a reading is bad. What `pool_analysis_alert` stores is the part that cannot be
derived twice: that on this date, these people were told. **An email is not idempotent**, so
the row is written inside the transaction that wrote the reading, one per analysis by unique
index, and the *sending* happens after the commit where it can never roll a reading back.
`metrics` is a snapshot even so, because a measurement is corrected in place and a compliance
record that rewrote itself when somebody fixed a typo would not be one.

**A pool's band is the published one until a club says otherwise, and `resolveBands` is where
the two meet.** `pool_metric_range` holds only exceptions — no row is the answer for almost
every pool, which is what lets a later correction to a published band reach everybody who never
overrode it. Three states and the third is why both bounds are nullable: no row is the
reference, a row is its bounds *on the sides that carry one*, and a row with **neither** bound
means the metric is not judged here at all. Never collapse the first and the third — a hotel
tank kept at 30 °C is outside the published temperature band every day of its life, and that
distinction is the difference between one alert and one a day forever. `Excursion.limit` is the
bound actually crossed, so every sentence about an excursion is sayable without a null check,
and the API ships the *resolved* map: no client merges bands.

**Only a recent sample alerts, and the screen says whether anything was sent.**
`ALERT_WINDOW_HOURS` is 48, compared against `taken_at` in SQL; a club's first act is to
import its history, and forty emails about water dosed last winter teach it to filter the
channel before it ever carries something urgent. The reading is still recorded either way.
Recipients resolve **by role** at send time — owner, admin, maintenance, deduplicated, over
`coalesce(app_user.cached_email, membership.email)` so the staff member with no login is
included — and the addresses are then written onto the row, because "who was told" is not
recoverable from the roles once that person has left. `delivered_at` null means recorded and
not sent, said in words: the same honesty the chase list owes about what Poolse has and has
not delivered.

**A recurring job is a `maintenance_task`; a one-off is a `maintenance_request`, and
`interval_days` is the boundary.** Round 6 built the unplanned half — somebody notices a shower
is broken — and 4.3 built the planned one. The interval is NOT NULL precisely so the two cannot
be confused: a job with no cadence *is* a request, and a nullable interval would give one fact
two homes. Pausing is `active`, as it is on a space. **Due-ness is derived in SQL, in the same
four ordered branches as overdue cleaning** — paused is never due, never-done *is* due, else
time since the last completion — and there is no `next_due_at` column, because a completion
backdated to when the work actually happened has to move the next due date with it. A deleted
completion did not happen, so removing one puts its task straight back to due.

**Assignment is a person here and a role in 4.2's alerts, and the difference is the point.** An
alert has to *reach* somebody who can act, so a role is right and turnover must not orphan it. A
task is a to-do list, and a job assigned to three people is a job none of them does. Unassigned
means everybody sees it, so nothing is invisible; a task whose person has left says so rather
than being reassigned by Poolse.

**A null ceiling, interval or limit means "not measured" and enforces nothing.**
`pool.max_capacity`, `space.expected_cleaning_interval_hours`,
`organization.max_management_users`. Never read one as zero. Its counterpart is that an
*absence of history* is not evidence: a space with a schedule and no cleaning at all is
overdue, not fine.

**Out of service is not deleted.** `space.active = false` means shut for works — still listed,
still openable, and exempt from the overdue rule; `archived_at` is deletion. Where a table
carries both, they must mean different things and the difference belongs in a column comment.

**An elapsed time is `timeAgo` from `lib/relative-time.ts`**, which returns the phrase and lets
`t('…', { ago })` own the word order. Never build "há 2 dias" in a component: it is a
Portuguese string hard-coded into an interface that ships in two languages.

**Enum values are English snake_case; the Portuguese is an i18n key.** `fault` / `restock`
render as "Avaria" / "Reposição". Check a candidate word against the words the schema already
uses — `reposicao` was taken by the make-up-lesson module, and one word meaning two things in
one schema is how somebody joins the wrong table at midnight.

**A new tenant table goes in `TENANT_TABLES` in `apps/api/src/test/harness.ts`**, child-first,
in the same commit as its migration. A forgotten one fails every integration test at teardown
with a foreign-key violation that looks nothing like the change that caused it.

**Management seats are capped per tenant by a soft quota**
(`organization.max_management_users`, nullable = unlimited), checked when an invitation is
*created* and counting pending, unexpired ones — a 24-hour window otherwise lets a tenant
overshoot. Exactly one Owner per tenant, enforced; transfer is the only way to change it.
`docs/decisions.md`, 2026-09-06.

**Cost per tenant is a design constraint, not a later optimisation.** The first production
tenant is a free pilot, so prefer designs that keep one tenant inside free tiers and keep
every metered or pay-per-use call — the Claude API lab-report parsers above — behind its
own feature flag, off by default.

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
- **File storage stays deferred.** Logo, pool photo and student photo controls are present,
  styled and visibly disabled until it lands. One decision unblocks all three.
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
- **CLAUDE.md stays current.** A new convention, shared component, validation approach or
  role guard earns one line here, so the next session uses it instead of reinventing it.
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
