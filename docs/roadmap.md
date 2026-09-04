# Poolse — roadmap

Sequenced as vertical slices. Each one ends with something that works end to end, because
a slice that ends working is worth more than three layers half-built — and because on an
evening schedule, "done" is the only reliable stopping point.

Slices are sized to roughly one or two evenings. If one is running long, it was too big:
split it rather than leaving it open across a week.

## Phase 0 — foundations

The only horizontal phase. Everything after this is vertical.

| # | Slice | Done when |
|---|---|---|
| 0.1 | Monorepo, both apps booting, shared TS config and lint | ✅ `pnpm dev` runs web and API locally |
| 0.2 | Postgres + migrations toolchain, `organization` / `app_user` / `membership` / `membership_role` | ✅ Migration runs clean on an empty DB |
| 0.3 | **Tenant isolation in the database** — composite FKs, RLS on every tenant table, request middleware setting the org GUC from the Clerk session | ✅ A repository method with its `where` clause deleted returns zero rows, proven by test |
| 0.4 | Clerk wired both sides; webhook provisions `app_user` and maintains the name/email cache | ✅ A new Clerk signup appears as an `app_user` with cached fields populated |
| 0.5 | **Organization signup** — public landing and pricing pages, sign up, 14-day trial, first facility | ✅ A stranger reaches the site, signs up, and lands in a working organization |
| 0.6 | Invitations — invite by email, roles, acceptance binds membership to `app_user` | ✅ A second person joins an organization as an instructor |
| 0.7 | i18n scaffolding, `pt-PT` + `en`, locale switch | ✅ No user-facing literal strings exist anywhere; `pnpm i18n:check` proves it |
| 0.8 | Theme tokens, light and dark, palette applied | ✅ Toggle works; no hex literals in components |
| 0.9 | `audit_log` table and the write helper | ✅ Any mutation can record who and what in one call |
| 0.10 | Staging + production deploys, both environments green | Repo side done — Dockerfile, `railway.json`, `vercel.json`, migrations as a pre-deploy step. Waiting on hosting accounts; see `docs/deploy.md` |

**0.3 is the slice to get right, and it is not the same slice as 0.4.** Auth answers "who
are you"; isolation answers "and what can this query possibly see". The cross-tenant test
lives here and keeps running forever.

**0.5 was added after the fact, and it should have been obvious from the start.** The
original plan went straight from "Clerk works" to "invite people into an organization" —
with nothing that ever created the first organization. It is numbered before invitations
because you cannot invite anybody into something that does not exist. It was in fact built
second, which is why the migration files read in the other order.

**Signup is the one place row-level security has to be stepped around**, and it is worth
knowing why before reading the code. The policy on `organization` is
`WITH CHECK (id = current_organization_id())`; a brand-new organization has no current
organization, so the check fails and the INSERT is refused. That is the policy working
correctly. The fix is `provision_organization` — a `SECURITY DEFINER` function with a fixed
body, granted to one role — and explicitly *not* a looser policy or an owner connection,
either of which would undo slice 0.3 everywhere at once.

**0.6 exists because nothing else works without it.** Class groups need an instructor,
attendance needs a recorder, the student app needs student accounts, guardian links need
guardian accounts.

**No live demo tenant yet.** It becomes a read-only seeded organization once module 1
exists and there is something worth demonstrating. Nothing is built for it now, and the
landing page carries marked placeholder slots rather than invented screenshots.

**Pricing amounts are placeholders.** The plan shapes on `/pricing` come from the modules
below; the figures are marked as undecided rather than invented, and they are a business
decision, not an engineering one.

Two decisions to settle during this phase so they are not discovered mid-slice later:
confirm the chosen Railway or Fly Postgres can enable **TimescaleDB** (needed in phase 5,
and migrating production to find out is not an option), and pick the **notification
providers** — push and transactional email at minimum.

## Phase 1 — module 1, usable

The goal of this phase is an operator running real classes on Poolse instead of a
spreadsheet. That is the milestone that makes everything after it worth doing.

| # | Slice | Done when |
|---|---|---|
| 1.1 | Facility + pool CRUD | ✅ An operator can set up their site |
| 1.2 | Student CRUD, levels, search and list | ✅ 50 students manageable without pain; search ignores accents and case |
| 1.3 | Consent records and separated sensitive fields, with audit | ✅ Medical notes and photo consent are recorded with who and when; notes are encrypted before they reach the database, and every read is logged |
| 1.4 | Class groups + weekly schedule | ✅ A turma exists with a recurring pattern, in wall-clock time on ISO weekdays |
| 1.5 | Closure calendar (holidays, August, shutdowns) | ✅ Closures scope to organization, site or pool and may repeat annually. The 13 Portuguese national holidays are computed (Easter included) and seeded when the season is generated — each one a visible, deletable row, so a pool that opens on the 5th of October can remove it |
| 1.6 | Session generation honouring closures; cancel; substitute instructor | ✅ **A year** of sessions, not the 90-day window; August empty; closures reversible; a cancellation made by a person is never overwritten. One button builds the season, idempotently. Substitution has its endpoint; no screen yet — 1.12 is where an instructor's own view arrives |
| 1.7 | Enrollment + waiting list | ✅ **Pulled forward to sit beside 1.4** — it attaches students to a turma, not to a session. Capacity enforced by a locking trigger |
| 1.8 | Attendance marking, per session | ✅ One screen, one save. Present first, "todos presentes" for the common case. A marked class can no longer be cancelled — by any path |
| 1.9 | Weekly / monthly schedule view | ✅ **Weekly, dated.** `/dashboard/calendar` shows real days with real cancellations and their reasons; each student's page shows their own dated week. The turma screen keeps the recurring *pattern*, which is a different question and says so. No month grid, deliberately — a pool runs five to fifteen classes a day and a month cell that fits three is unreadable |
| 1.9a | Seasons, and ending one | ✅ **POOLSE-07.** A turma belongs to a `season`; the lists show the one that is running. Ending a season archives it and opens the next behind a typed confirmation that names what it is retiring — nothing is deleted, and the old year keeps every session, enrolment and register. One current season per organization, enforced by a partial unique index rather than by the code that resets |
| 1.9b | One person, many roles | ✅ **POOLSE-17, POOLSE-04.** `membership` is the person: tenant-scoped, nullable `app_user_id` so an encarregado de educação needs no login, and `membership_role` for several roles at once. Guardianship is a link between two people carrying the relationship and one primary contact. A senior student who is also a grandchild's guardian is one record with two badges. Duplicates are refused on NIF or email rather than created |
| 1.9c | Encerramentos as a year, and Pessoas/Alunos | ✅ **POOLSE-31, 35, 34, 36, 22.** Closures are picked as a range on the same twelve-month grid as Férias, cannot overlap, take effect without a generation, and say what they will cancel — naming how many registers are already taken. Pessoas is staff; students and encarregados live under Alunos, two filtered views over one Person. Maioridade is a tenant setting rather than a hardcoded 18 |
| 1.9d | Skills in four states | ✅ **POOLSE-20.** A level has skills; a student has a state on each — Não iniciado, Iniciado, Avaliado, Adquirido, each with its own icon as well as colour. The instructor grid is students down and skills across: tapping a column marks the whole turma in one pass, tapping a row marks one student across everything, and every tap paints before it saves so a dropped connection loses nothing. Optional dias/aulas mínimos gate the sign-off only, with an override that records who and why |
| 1.9e | Duplicates, merging and the role union | ✅ **POOLSE-17 in full.** Dedup on NIF-else-email, enforced by partial unique indexes so the check does not depend on timing; a guardian must carry one of the two, a student need not. A phased merge — a read-only report naming every disagreement, then one pair at a time — that discovers what to repoint from the catalogue and archives the absorbed record with `merged_into`. `strongestRole()` and the badge order are now one written seniority rule rather than two lists that disagreed |
| 1.10 | Excel import — mapping step, validation preview, commit | ✅ Four steps — file, column mapping, validation preview, commit. `guessMapping` recognises a club's own headings in both languages and says how sure it is; a minor with no guardian is a row error named on the preview, not a surprise at commit. A guardian must carry a NIF or an email, which is the rule the database enforces and the reason the preview refuses the row instead of 500ing |
| 1.11 | Excel export | ✅ `.xlsx` and `.csv`, from a route handler so the button is an ordinary link. **The header row is the import's own field labels**, so an exported file re-imports with no column mapped by hand — asserted against the real catalogues in both locales. Medical notes and photographs are deliberately absent: consent can be withdrawn and a downloaded file cannot hear about it |
| 1.12 | Role restrictions across module 1 | ✅ `tenant/assignment.ts` answers "is this mine", reading the turma's instructor, a booking's override and a session's `resolved_instructor_id` — so **the substitute is the assigned instructor of the night they cover**. Marking a register, confirming an advancement and approving a reposição are narrowed to the assigned instructor; owner and admin are never refused. The turma list gets a point of view — an instructor opens on their own, an owner who also teaches gets both. The student register, the medical notes and the lane grid stay open on purpose: what is narrowed is the acting, not the looking |

**1.5 comes before 1.6 deliberately.** Generating sessions first and adding closures later
means cancelling August by hand, then doing it again every time the rolling window extends.

**1.10 deserves more time than it looks like it needs.** It is the onboarding path — a
customer who cannot get their spreadsheet in never becomes a customer. Build the mapping
correction UI properly the first time.

### Backlog, folded in

Items from the operator backlog that are not part of the original phase plan.
Numbered as they arrived, so they can be referred to in conversation.

| # | Item | State |
|---|---|---|
| B1 | Pool length, width and maximum depth | ✅ `numeric`, so 12.5 m stays 12.5 m |
| B2 | Pool detail view and photo upload surface | ✅ Surface built, upload deliberately inert. `pool_photo` and `facility_photo` exist and stay empty until Cloudflare R2 is configured |
| B3 | Entity icons and consent-gated avatars | ✅ Instructors live; student photographs wait on storage, consent rule built and tested |
| B4 | One facility per client | ❌ Rejected **as a schema rule** — a municipality with pools in two buildings would need two organizations. See `docs/data-model.md`, open question 2. ✅ Adopted **as a licence rule**: `organization.max_facilities` defaults to 1 and is enforced by a trigger, so the plan bounds what the model allows. The two are not in conflict — without the schema there would be nothing to sell |
| B5 | Invite students to the mobile app | Waits on phase 3 |
| B6 | Student progression | ✅ Times in integer milliseconds, personal bests, chart |
| B7 | Instructor availability grid | Waits on 1.4 — the "outside their hours" warning needs class groups to validate against |
| B8 | Unified dashboard with pool temperatures | Waits on 4.1 — there are no readings to plot |
| B9 | Single owner, owner-only invitations | ✅ Enforced by a unique index, with ownership transfer so it is not a trap |
| B10 | Two concurrent devices for the owner | ⚠️ Partly — session list and manual revocation built; the automatic cap is **recommended against**, see below |

**On B10 and the device cap.** Checked against the live Clerk API before
designing anything, as the story asked. What Clerk supports: listing a user's
sessions (yes), revoking one (yes), a built-in concurrent-device limit (**no such
setting exists**), and device/browser/IP per session (**not exposed** — only
timestamps).

So a cap would have to be enforced by us, and the recommendation is not to. Three
reasons, in order of weight:

1. **Story 9 already protects the licence, and better.** The realistic sharing
   risk was an owner inviting colleagues as owners. That is now impossible — one
   owner per organization, enforced by a unique index. A device cap addresses a
   much narrower case: one person handing out one password.
2. **It cannot be made airtight.** Session tokens are short-lived JWTs refreshed
   against Clerk, so revocation is eventually consistent — roughly a minute of
   overlap. And two people can simply sign in alternately, revoking each other,
   and still both use the product.
3. **It would lock the owner out at the worst moments.** Phone, laptop, and one
   new browser is three devices without anybody sharing anything. Every one of
   those becomes a support message to the vendor.

What is built instead is the half with value and no downside: **the owner can see
where their account is signed in and end any session they do not recognise.**
That answers the actual worry — "is my licence being used by someone else?" — and
gives them the means to stop it, without the product deciding they are a
suspect. Sessions carry no device name because Clerk exposes none; inventing
"Chrome on Windows" would undermine the one screen that has to be trustworthy.

Revisit if a real customer is caught sharing. The enforcement point would be a
`session.created` webhook, which needs the tunnel or staging to exist first.

**On B6 and "best stroke".** The story asked for a derived best stroke. What is
built is `fastestStroke`, and the difference is deliberate: a genuine best stroke
compares a swimmer against reference times for their age, and Poolse holds none.
Without them, comparing a swimmer's own butterfly to their own freestyle answers
"freestyle" for nearly everybody. Adding federation reference times would turn it
into the real thing and is a slice of its own; inventing a formula now would
produce a number that looks like insight and is not.

### Backlog, round 2

Two bugs and ten stories, arriving after 1.9. Numbered as they came.

| # | Item | State |
|---|---|---|
| BUG-1 | Native controls render in the OS's theme, not the app's | ✅ `color-scheme` named per theme in `globals.css`. See below |
| BUG-2 | Calendar page renders nothing | ✅ The grid is drawn whether or not the week has classes. See below |
| R2-1 | Collapse the invite form behind a button | ✅ Inline panel, remounted per opening, Escape closes, focus returns to the trigger |
| R2-2 | People split into sub-menus per staff role | Not started |
| R2-3 | Guardians sub-menu under Alunos | Not started — **needs a schema slice first**, `guardian_link` does not exist |
| R2-4 | Turmas scheduling grid | Not started. Granularity decided: **configurable per organization** |
| R2-5 | Organization logo and tenant branding | Not started — control stays inert, as pool photos do |
| R2-6 | Per-tenant accent colour | Deferred by the story itself, after module 1 |
| R2-7 | Organization branding after sign-in | Not started. Header brand slot exists and is empty, waiting for it |
| R2-8 | People restricted to owner and admin | ✅ Nav filtered, API refuses, direct URL explains itself |
| R2-9 | Sign-in activity list | Not started — `audit_log` already has the shape; needs an `auth` action and a UI |
| R2-10 | Sign-out control to the top right | ✅ Header added; the avatar menu carries it |

**There is no `manager` role, and there will not be one for now.** Stories R2-4 and
R2-8 are written for one, but `member_role` is `owner, admin, instructor,
maintenance, student, guardian` — and `docs/product.md` never described a manager
either. The story's manager is this product's `admin`, and R2-8 was built that way.
Adding the role later is an enum value and a pass over the permission checks; adding
it now would have meant designing permissions for a role nobody has asked for by
name.

**On BUG-1, and why the ticket's hypothesis was wrong.** The suspicion was a token
rename — `--primary-foreground` becoming `--on-primary`, leaving components pointing
at a variable that does not exist. That rename never happened here: every shadcn
alias is defined, on bare `:root` and again in `.dark`. The real cause was
`html { color-scheme: light dark }`, which tells the browser to style *native*
controls — checkboxes, radios, selects, date pickers, scrollbars — from the
operating system's preference. The operating system knows nothing about the `.dark`
class this app toggles, so an OS set to dark with the app set to light rendered a
black checkbox on a white page. Naming the scheme inside each theme block fixes
every native control at once, which is what the ticket asked for even though the
mechanism was a different one.

**On BUG-2, and the part that is not fixed.** `class_session` held zero rows: the
season had never been generated, so an empty calendar was the correct answer, badly
presented. `WeekGrid` collapsed to one line of grey text, which reads as a page that
failed to load. It now draws its days either way.

**The other half is fixed too.** `seasonOf` returned the season *containing
today*, so through August it offered a season ending within days — every one of
them inside the August closure. Pressing "Gerar a época" on the 27th of August
generated a year that was already over, and the calendar still looked empty.

August is now the pivot rather than September, and it is the right one precisely
because August is the month the pool is shut: there is never anything left to
generate in it, so nothing is lost by moving on and the operator is offered the
season they are about to run. `apps/web/src/lib/dates.test.ts` pins every
boundary, July included — July still means the season under way, because classes
run in July.

### Backlog, round 3

Ten stories, arriving after round 2. Decisions taken with them are in `CLAUDE.md`,
under "Settled by backlog rounds".

| # | Item | State |
|---|---|---|
| R3-1 | Edit my own profile | ✅ `birth_date` and `contact_phone` on `app_user`, `PUT /me/profile`, page under the user menu |
| R3-2 | Installation details screen with counts | ✅ `/dashboard/facilities/<id>`, one grouped count query, each count links to a filtered list |
| R3-3 | Weather on the installation details screen | ✅ Open-Meteo, server-side, cached 45 min by rounded coordinates. **Municipal holidays for R3-6 are now unblocked** |
| R3-4 | Calendar readability and navigation | ✅ Taller cells, two-line names, arrows either side of a dated label, "Hoje" |
| R3-5 | Removing classes from the calendar | ⚠️ Restore gone, confirmation names the class and date. Attendance rule **waits on 1.8** |
| R3-6 | Vacations — my own | ✅ 4×3 year grid, drag and keyboard, balance with the carry-over caveat on screen |
| R3-7 | Vacations — approval | ✅ Queue with who-else-is-off, rejection needs a reason, requester emailed |
| R3-8 | Vacations — team map | ✅ Nobody shown until picked; shared days marked, never one colour hiding another |
| R3-9 | Progression and medical as icon buttons | ✅ Icon buttons in their own action area; medical hidden for roles that may not open it |
| R3-10 | One shared back control | ✅ `BackLink`, 13 call sites, one pass |

**R3-9's access control was already right.** `SensitiveController.read` has
`requireRole('owner', 'admin', 'instructor')` and every read is written to `audit_log` by
`readSensitive`. Only the presentation was missing. The new `canViewSensitive` flag on the
single-student read hides a control the caller may not use — courtesy, not access control,
and the endpoint still refuses independently.

**R3-10 uses an explicit `href`, not `history.back()`.** Every one of the thirteen call
sites already knew its parent. History is not "the previous screen in context": after a
redirect it returns to the form just submitted, and from an emailed link it leaves the app.
The visible label is always "Voltar"; the old contextual phrase survives as the accessible
name, so screen-reader users keep the information that sighted users get from the page
around them.

**Round 3 is complete except R3-5's attendance rule**, which waits on slice 1.8.

**The vacation schema is in `docs/data-model.md` under "Staff leave".** Three decisions
there are worth knowing before touching it: days are rows rather than a range, a refused
request archives its days by trigger so the day can be asked for again, and a rejection
cannot be stored without a reason.

**Entitlement is `membership.vacation_days_per_year`, defaulting to 22** — Portugal's
statutory minimum — set per person by an owner or admin through
`PUT /vacations/entitlement/:membershipId`. The gap story 6 flagged before it could be
built.

**Carry-over to 30 April is not tracked, and the balance says so on screen.**

**R3-5 cannot be finished until 1.8 exists.** "A class with attendance already recorded
cannot be removed" needs attendance, and there is no attendance table. Removing the
"Repor aula" control and adding the confirmation are buildable now; the rule goes in with
the slice that creates the data it depends on.

**R3-6's `public_holiday` table was rejected in favour of `closure`.** The closure table
already stores per-organization holidays with `source = 'national_holiday'`, a partial
unique on `(organization_id, starts_on)`, and the Easter computus in
`apps/api/src/classes/holidays.ts`. A municipal holiday is another `source`, not another
table. The vacation calendar reads holidays by `source`, so an ordinary closure for
building works never becomes a free vacation day.

**R3-3 is done, so R3-6's municipal holidays are unblocked.** `holidays.ts` excluded them
because "Poolse does not know which town a pool is in". `facility` now carries a city, a
country and coordinates, chosen from the geocoder by a person who could see which Aveiro
they were picking.

**Counts are organization-wide, and the screen says so.** Neither a student nor a
membership carries a facility, so "how many instructors at this site" is a question the
schema cannot answer — deriving it through enrollment → class_group → pool → facility is a
larger, different question. The panel shows the organization's numbers with a line saying
that is what they are, so a club with two buildings is not misled by seeing the same
figures on both. The tally includes `owner`, which story 2's five groups omit: a headcount
that loses the person who runs the club is one nobody can reconcile against the room.

**Open-Meteo's free tier is non-commercial only.** Fine now, not fine on the first paying
customer. `OPEN_METEO_FORECAST_URL`, `OPEN_METEO_GEOCODING_URL` and `OPEN_METEO_API_KEY`
exist from this first commit precisely so that day is a config change, and they are read in
one file. The cache is in-process — it resets on deploy and is not shared between
instances, which at 45 minutes per city is still nothing and avoids running Redis for a
cache whose worst failure is one extra call to a free API.

**R3-1's save path is the interesting part**, and it is written into `CLAUDE.md` as a
convention because it will recur for every field Clerk also holds: the name goes to Clerk
and comes back through the cache, never straight into `cached_first_name`. Clerk cannot
reach localhost, so the API re-reads from Clerk immediately after writing rather than
waiting for a webhook that will not arrive on a laptop.

### Backlog, round 4

Four scheduling and level items on the core path, one blocker, one for phase 5.

| # | Item | State |
|---|---|---|
| R4-1 | Classes must not overlap, by real duration | ✅ Instructor exclusion added; lane exclusion already existed. Clashes named, not raised as constraint errors |
| R4-2 | Age limits on student levels | ✅ `min_age_years` / `max_age_years`, both optional |
| R4-3 | Age checked when assigning a level | ✅ Warning with one confirmation — never a block, never on a missing birth date |
| R4-4 | Levels are editable | ✅ Rename and age range added to the create/reorder/archive that already existed, with the narrowing count |
| R4-5 | Invitations send no email | ⚠️ **Not a code gap.** See below |
| R4-6 | Energy bill import | Phase 5, deliberately. Storage decision first |

**R4-1 was half-built, and the ticket's own SQL was already in the schema.**
`class_session_lane_free` has guarded pool-and-lane overlap since slice 1.6,
`ends_at` is a stored column maintained by a trigger, and `btree_gist` was already
installed. What was missing was the instructor — and it was missing because the
instructor lives on `class_group` while only the substitute lives on the session,
so there was nothing for a constraint to compare. See `docs/data-model.md`,
"Nobody is in two places at once".

**R4-5 is a configuration gap, not a missing subsystem.** The email path is
complete: `InvitationsController` composes the message, calls `sendEmail`, and
returns `emailed` to the client, which already renders "convite enviado" or the
copyable link. Nothing arrives because `.env` has `EMAIL_PROVIDER=console`.
Setting it to `resend` with a key from resend.com is the whole fix, and no code
changes.

What *was* missing is the acceptance criterion "a failed send is visible in the
interface": `emailed` lived only in the response that created the invitation, so
the pending list could not tell you afterwards. `invitation.delivery` now records
`pending | sent | failed | not_configured` and the list shows it —
`not_configured` deliberately not as a failure, because it means "copy the link"
rather than "something went wrong".

**Clerk's own invitation emails were considered and rejected.** They would mean
carrying roles in Clerk's public metadata and a second acceptance path beside the
one that exists and is covered by `invitations.sql` test 3 — real work to replace
something already working, and it would not help the cancellations and overdue
invoices that need a channel later.

**R4-6 stays in phase 5**, and the note in the ticket is worth keeping: once
storage exists, let managers upload bills *without* parsing them. A year of real
documents accumulates from day one, and a parser built later has a corpus to test
against instead of guesswork. Its output belongs in the same `energy_reading` and
`tariff` tables as manual entry, with `source = 'bill'` beside `'manual'` and
`'sensor'`.

**The scheduling grid (R2-4) is still not built**, and R4-1 answered its open
question: no fixed slots. Render each class at its real duration over 15-minute
guide lines, and let the database's exclusion constraints supply the conflicts
rather than reimplementing them.

## Phase 2 — money

Split deliberately, because the two flows are different problems and merging them is the
expensive mistake.

| # | Slice | Done when |
|---|---|---|
| 2.1 | Fee plans + student subscriptions (records only, no charging) | Who owes what is visible and correct |
| 2.2 | Invoice generation with series, sequential numbering, lines and VAT | A sibling pair on one document, numbered correctly |
| 2.3 | Invoice statuses, overdue view, chase action | The operator can chase payments |
| 2.4 | Operator pays Poolse — Stripe subscription on the organization | Poolse can take money |

Do 2.1–2.3 before touching Stripe. Most of the value of billing is knowing who owes what;
automated collection is an optimisation on top of that, and it is where the regulatory and
integration cost lives.

**Student→operator automated collection is not in this phase.** A SEPA mandate and an
MB WAY authorisation both require the payer to act, and the payer has no account and no
app until phase 3. It is slice 3.5, below. Chasing in 2.3 needs notifications (phase 3.0)
or falls back to exporting a list — decide which when you get there.

## Phase 3 — student app and notifications

| # | Slice | Done when |
|---|---|---|
| 3.0 | Notification subsystem — records, preferences, push + email delivery | A cancellation reaches a phone |
| 3.1 | Mobile shell, auth, sportier theme | Login works on a real device |
| 3.2 | Student and guardian accounts via invitation | A parent logs in and sees their child |
| 3.3 | My classes, schedule, cancellations | A student sees whether there is class today |
| 3.4 | Payment status and invoice view | A student sees what they owe |
| 3.5 | Student pays operator — mandate capture, SEPA DD / MB WAY | Automated collection works for one real turma |
| 3.6 | Water temperature for their pool | Requires module 2 readings — see note |

**3.5 is where open question 1 gets answered** — Stripe Connect or direct. Answer it before
starting the slice, not during.

**3.6 depends on phase 4.** Either ship 3.0–3.5 and add it after phase 4, or accept the
reorder. Flagged so it is a choice, not a surprise.

## Phase 4 — maintenance

| # | Slice | Done when |
|---|---|---|
| 4.1 | Readings: record, list, chart per pool | A technician logs pH and temperature. **Surfaces on the pool's own page** — see the note below |
| 4.2 | Safe ranges + alerts through the notification subsystem | Out-of-range reading reaches someone |
| 4.3 | Maintenance tasks, recurrence, assignment | A task appears for the right person |
| 4.4 | Completion log and history | Who did what, when |
| 4.5 | Personal app on the same reading model | An individual tracks their own pool |

**Maintenance data belongs on the pool's own page, not on a separate maintenance
screen.** Backlog note from the operator: a pool already has a page carrying its
dimensions, its gallery and its details, and readings are one more thing that is
true about that pool. Splitting them across two places would mean a technician
who wants to know "when was this tank last tested" has to know which of two
screens to look at. The `pool_photo` gallery and the readings list sit in the
same layout, on the same page, added in 4.1.

4.5 should be small. If it is not small, the "personal user is their own organization"
decision was not honoured somewhere upstream — that is the signal to go and fix it.

## Phase 5 — energy

| # | Slice | Done when |
|---|---|---|
| 5.1 | TimescaleDB hypertable, meters with explicit `reads` semantics | Schema in place and migrating cleanly |
| 5.2 | Manual reading entry, consumption charts | A month of data is visible |
| 5.3 | Tariffs and cost per period | Cost, not just kWh |
| 5.4 | Period comparison, correlation with temperature | The insight the module exists for |

## Phase 6 — AI dashboards

Deliberately last. Every part of it needs real data in the other modules to be anything
other than a demo — an anomaly detector with three weeks of synthetic readings tells you
nothing, and a dropout-risk model with no dropouts is a straight line.

| # | Slice |
|---|---|
| 6.1 | Occupancy and attendance trends |
| 6.2 | Reading anomaly detection — drift before breach |
| 6.3 | Energy forecasting and "what changed" |
| 6.4 | Natural-language questions over the operator's own data |

## Deferred, with their trigger

| Item | Build it when |
|---|---|
| Parent communication and swim stats | An operator asks for it, or phase 1 is in real use |
| Apple Health / Fitbit / Garmin | Parent communication exists — the stats have to come from somewhere first |
| AI-assisted column mapping | The manual mapping step has been used enough to know where it is wrong |
| Automated meter feeds | Manual energy entry is in real use and is the bottleneck |
| SMS as a notification channel | Push and email have proven insufficient — it costs real money per message |
| n8n automations | There is a repeated operational task worth automating — not before |

## The honest risk

Phases 4–6 are where solo side projects die: module 1 gets to "good enough", the novelty
runs out, and the remaining modules stay perpetually next. The mitigation is that
**phase 1 is designed to be independently valuable** — if Poolse never gets past phase 2,
an operator running their classes on it is still a real product. Build in that order and
the project survives losing momentum, which over a long enough evening schedule it will.
