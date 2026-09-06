# Decisions

Product decisions taken in conversation, one line each, newest last. They live here
because the reasoning otherwise survives only in a chat log nobody reads again — and
several of these reverse an earlier decision, which is exactly the kind of thing that gets
quietly re-reversed six months later by somebody reading the older comment.

Schema decisions live in `docs/data-model.md`; standing conventions live in `CLAUDE.md`.
This file is for the calls themselves.

Most entries are one line. A sizing or pricing call that sets numbers other decisions will
be measured against gets a dated section of its own instead, because the numbers are the
decision and a line that omits them is not usable later.

## Round 5 — September 2026

- **2026-09-05** — Round 5 branches from `refinements-round-4`, not `main`. `main` is 86 commits behind and lacks the calendar, partnerships, fees and inventory screens every round-5 ticket edits.
- **2026-09-05** — The dashboard is the home route and the first menu item. Reverses POOLSE-37 and POOLSE-38, which put Instalações first on the argument that the dashboard was about *you*; round 4 moved every account question to "O meu perfil" and put occupancy there instead, so it is now about the operation.
- **2026-09-05** — POOLSE-37's per-role landing chain is deleted rather than kept. There is nothing to resolve once every role lands on the same page, and a caller-less resolver is how the old behaviour returns by accident.
- **2026-09-05** — The periodicity discount is applied on **display only**. Prices stay stored gross, and `student_fee` goes on snapshotting the amount and the discount when a family agrees a price.
- **2026-09-05** — The three capacity rules compose rather than override: an enrolment must fit its turma, the turmas sharing a slot must fit the tank, and `lane_level_capacity` goes on meaning what it meant.
- **2026-09-05** — A tank with no `max_capacity` is unlimited and enforces nothing. Null is "not measured", never zero.
- **2026-09-05** — Partnership bookings count as zero against a tank ceiling, because they carry no headcount. Revisit if partner groups ever gain one.
- **2026-09-05** — The per-session restore endpoint is reinstated, owner/admin only, so ticket 9.6's Undo can work. This reverses backlog round 3, story 5, which removed the operator-facing restore deliberately — reversed on request, not by drift.
- **2026-09-05** — Lost and found records that a student was told with a `student_notified_at` stamp on the item, not a new `student_notification` table. The notifications subsystem is phase 3.0 and is meant to be built once; a second store would be something for it to migrate away from.
- **2026-09-05** — The water-quality importer makes no model call. The mapping step stays a `MatchSpec` like the other three, so an assisted matcher slots in at one call site if it is ever wanted.
- **2026-09-05** — The water import is per tank, from the tank's own page. A row whose tank column names a different tank is refused rather than imported into whichever tank was open.
- **2026-09-05** — An out-of-range reading imports with no warning of its own; only unreadable values refuse a row. Losing the day a pool was unsafe is the worst thing an importer of safety records could do.
- **2026-09-05** — Ticket 5's wizard is built as its own leaner file; the extraction of a shared import wizard waits until there are four examples to generalise from rather than three.
- **2026-09-05** — An inventory item's location is free text with suggestions, not a rooms entity. The words the club types are the data that would tell us what rooms to model, if rooms ever earn a table.
- **2026-09-05** — The place words (local, localização, onde, location, where) moved from the inventory importer's `pools` field to the new `location` field. They were always place words; matching them against tank names failed every column they claimed.
- **2026-09-05** — Naming a student on a lost item stamps that they were told, as part of recording it rather than as a second button. An item that names a student and is not marked as notified is a state nobody would mean.
- **2026-09-05** — Invitations expire after 24 hours, not 7 days. Existing pending ones were recomputed from their creation date, so one sent an hour before the deploy keeps the rest of its day and one from last week is expired.
- **2026-09-05** — Resend keeps `requireCanInvite` + `requireOwnKind` rather than being narrowed to owner/admin. The staff screen it lives on is already owner/admin server-side, and narrowing the endpoint would break POOLSE-01's instructor-invites-a-student flow on another screen.
- **2026-09-05** — An expired invitation is rendered as information, never as an error. With a 24-hour window it is the ordinary outcome, and error styling on the ordinary outcome teaches people to ignore error styling.
- **2026-09-05** — A turma requires a tank and a lane count; an instructor stays optional. Refusing an unstaffed turma would make the product unusable in September, which is the month a club sets its timetable up.
- **2026-09-05** — POOLSE-QA-07's "an empty save is still a save" is superseded for turmas. Its point was that an empty form must not 500; the answer is now a 400 naming the two fields, which is the same courtesy by a better route.
- **2026-09-05** — The weekly timetable hides weekdays the site is shut on, except where a class already runs on one. The existing "a disabled weekday keeps its classes" rule wins over the new filter.
- **2026-09-05** — Restoring a cancelled occurrence is owner/admin, narrower than cancelling it. An instructor may call off their own class; putting one back undoes somebody else's decision as often as your own.
- **2026-09-05** — A class cancelled *by a closure* cannot be restored from the toast. Those come back when the closure is lifted, in SQL; the pool being shut is not a fact for one operator to overrule.
- **2026-09-05** — Past days on the calendar are faded and undraggable, not hidden. The register of a class that happened is still worth opening.
- **2026-09-05** — G1 applies to withdrawing a swim time: it is now owner/admin, where it used to allow instructors. The code carried a written argument for the exception and asked for it to be decided rather than swept; this is that decision. The cost is real — an instructor who mistypes a time waits for an admin to withdraw it — and reversing it is one line.
- **2026-09-05** — Medical leave dates are cast to text in SQL. A `date` column parsed into a JS Date at local midnight left the API a day early in UTC, so this was an off-by-one-day bug rather than only a stray time.
- **2026-09-05** — The student fees screen splits into three sibling cards — Plans, Membership, Period total — with the total last, because a total above its parts cannot be checked against them.
- **2026-09-05** — The fee period switcher offers only periods that exist: the current one, plus those already settled. It is hidden entirely where there is no history, since a select with one option is a question with a single answer.
- **2026-09-05** — `shapeOf` gains a `decimal` shape reading both separators, and `looksNumeric` replaces the `/^\d+ digits$/` predicate four importers each wrote. A Portuguese decimal used to shape identically to a word, which made a numeric column check unusable on the default locale.
- **2026-09-05** — `sql:check` runs its own fixtures before every scan. It had silently stopped catching a whole shape of the bug it exists for, and a guard that has never been shown to fail is one nobody should trust.
- **2026-09-05** — The import wizard's state machine is extracted as a hook, not a component. The machine is identical between the register and the store room; the previews are not, and a shared component would have grown a flag for each difference. Calendar and water stay out on purpose.
- **2026-09-05** — The water import moves out of the pool page header and into the Water quality card, under "Record an analysis". Round 5 was right that a text link nobody scrolled to was wrong, and wrong about where it belonged: a page header is about the page, and this is about the readings.
- **2026-09-05** — A water-analysis report (PDF or photograph) is read by a Claude-backed import agent behind `WATER_REPORT_AI_ENABLED` plus `ANTHROPIC_API_KEY`, off by default. Only the document is sent, and every extracted value goes through the spreadsheet importer's own validation and preview before anything is written.
- **2026-09-05** — The report's original file is not stored. File storage stays the deferred decision it was; this would be its fourth caller, and one decision still unblocks all of them.
- **2026-09-05** — The calendar's register and cancel controls move out of the grid block and into the foot of the turma hover card, which is extended rather than duplicated. A block on the lane grid is a rectangle whose height means a duration; there is no room in it for two buttons.
- **2026-09-05** — The app gets one `Dialog`, built on `createPortal` rather than a fifth Radix package. A centred modal is a portal, an Escape key, a backdrop and a focus round trip; the hard parts Radix earns its place for — edge placement, hover intent — are not in it.
- **2026-09-05** — The cancel confirmation is owned once by the board and asked about a session by id, instead of one form mounted per session. Round 5's rendered in place of its own trigger, inside a cell with `overflow-hidden`.
- **2026-09-05** — "Adjust the slot grid" confirms on the calendar before navigating, with the sentence the slot editor already used. The grid and the facility's schedule grid are one table and therefore always in sync; the opening hours are deliberately not rewritten, because the grid is validated to sit inside them.
- **2026-09-05** — A lesson plan is keyed on `(class_group_id, on_date)` rather than on the session row, because sessions are regenerated when a turma moves and a plan must not vanish when somebody changes the pool.
- **2026-09-05** — Writing a lesson plan is owner, admin, the turma's instructor, or a substitute covering that lesson. A substitute counts because they are the person teaching it; with no instructor assigned, only owner and admin, since there is nobody else to name.
- **2026-09-05** — An empty lesson plan is deleted rather than stored blank, and the schema refuses a body of whitespace. A plan that exists and says nothing is worse than none, because a colleague stops looking.
- **2026-09-05** — The plan sheet saves on an explicit button, not on a timer. A plan is prose being composed, and an autosave writes half a sentence to a colleague's screen.
- **2026-09-05** — The Paid control moves down beside "How they pay" and is drawn as a checkbox, while staying a form submit so it works before JavaScript. The two belong together: what the family agreed to, and whether this period of it has arrived.
- **2026-09-05** — `student_fee_payment` gains `source` (`manual` / `mbway` / `sepa`), and `setOccurrencePaid` becomes `markFeePaid` taking it. A webhook settling a month must be distinguishable from a clerk settling it, or a bank reconciliation cannot be done.
- **2026-09-05** — The Period total card shows Total paid and Total remaining as two lines, with the live one in bold. Weight rather than colour, and both always present so nothing is inferred from an absence.
- **2026-09-05** — No disabled Paid control for non-managers: `GET /students/:id/fees` is already owner/admin, so a disabled state would be code no user can reach.

## 2026-09-06 — Management user sizing per tenant

**Decision.** Poolse targets 10–30 management logins per tenant (Owner, Admin,
Instructor, Maintenance). Nothing may degrade up to ~150. Students and
Encarregados de Educação are excluded from this count and scale independently.

**Rules.**
- Exactly one Owner per tenant, enforced. Transfer ownership is the only way to
  change it.
- Seat cap is a soft quota: `organization.max_management_users` (nullable =
  unlimited), checked when an invitation is *created*, not when accepted.
- Pending, unexpired invitations count toward the quota — the 24h expiry window
  would otherwise let a tenant overshoot.
- Staff list needs search + pagination beyond ~30 rows.

**Plan tiers (indicative, not final).** Starter 5 seats / 1 facility · Pro 25 ·
Business 100 · above that, custom.

**Rationale.** A single municipal pool or swim school runs ~1 owner, 1–2 admins,
6–15 instructors, 2–4 maintenance staff. A multi-facility câmara group reaches
40–60. Every management user is a billed Clerk MAU. The quota exists so the
pricing model is enforceable before the second, paying tenant — the first
production tenant is a free pilot and will not test the limit.

**Open.** Whether students and guardians become Clerk users at all when the
mobile app ships, or get a lighter auth path.

**Not built in this pass.** `max_management_users` is not in the schema yet; it
goes in with the next migration that already touches `organization`.

## Round 6 — Espaços, cleaning and maintenance requests

- **2026-09-06** — A facility's non-pool areas are `space`, not `room`. The concept has to hold the car park and the plant room as comfortably as it holds a balneário, and "room" quietly excludes both.
- **2026-09-06** — `maintenance_request` is built as the seed of Módulo 2 rather than as a spaces-only feature: keyed on a facility, with nullable `space_id`, `pool_id` and `inventory_item_id`. Equipment and tank faults will extend this table instead of arriving with one of their own, because two places to look for "what is broken at this site" is the failure the module exists to prevent.
- **2026-09-06** — Overdue is derived at query time, in SQL, in one place. No `is_overdue` column, no cron job, no worker — a stored flag needs a process to keep it true, and per-tenant running cost is a design constraint. The API ships the boolean and the client renders it rather than re-deriving it.
- **2026-09-06** — An archived cleaning log did not happen: every last-cleaned read filters it out, so deleting a mistaken entry puts the space back to overdue. The alternative leaves a dirty room looking clean because somebody corrected a mistake.
- **2026-09-06** — A space with a cleaning interval and no cleaning at all is overdue, not blank. An absence of history is not evidence of cleanliness, and it is exactly the state the feature exists to surface.
- **2026-09-06** — `space.active = false` means out of service and is exempt from the overdue rule; `archived_at` remains deletion. Two flags earn their place only by meaning different things, and the exemption is what gives `active` a job — nobody cleans a balneário shut for building works.
- **2026-09-06** — Enum values stay English snake_case and the Portuguese is an i18n key. `restock`, not `reposicao`: that word is already the make-up-lesson module's, and one word meaning two unrelated things in one schema is how somebody joins the wrong table at midnight.
- **2026-09-06** — Logging a cleaning and reporting an issue are open to every management login, including instructors; resolving is owner, admin or maintenance. Reporting is noticing, resolving is a judgement that the work was done — and a feature that made an instructor find an admin to record that they mopped the balneário would simply not be used.
- **2026-09-06** — A cleaning log has no edit control at all. An entry is a claim about a moment; correcting one means archiving it, which is owner/admin.
- **2026-09-06** — Resolving an already-resolved issue is a 409, not a silent second write. Two people closing the same fault from two phones must not quietly rewrite who fixed it and when.
- **2026-09-06** — A space's type is optional and defaults to `other`, matching the column default; only a *stated* invalid type is refused. A club naming a room the six categories do not cover must not be stopped by the classification.
- **2026-09-06** — The free-text inventory locations became spaces, matched case- and accent-insensitively per facility, named with the spelling on the earliest-created item. Only non-archived items mint a space; archived ones are linked where one already exists. `inventory_item.location` stays in place — dropping it is a separate change so the result can be eyeballed first.
- **2026-09-06** — The API answers `canManage`, `canLog` and `canResolve` on the read, from the same helper the guards use. The screen shows a control only where pressing it would work, and the client never derives a permission from a role list.
- **2026-09-06** — Espaços appears on both Instalações (inside each site's card, under that site's tanks) and the site's own page, from one component with a `variant`. Asked for on the list screen first and then on both; a second copy of the panel is how two screens start disagreeing about what a space is.
- **2026-09-06** — Instalações fetches one space list per site in parallel rather than folding them into `/facilities`. A loop over an endpoint is usually wrong; a licence bounds a club to one or two sites, and the alternative puts every site's cleaning state behind the request that draws the page and loses the property that a failed block costs only itself.

## Round 6 — the calendar's week grid

- **2026-09-06** — The calendar gets its own grid; the Turmas screen keeps `schedule-board.tsx`. They were one 4,166-line component told apart by whether a `weekStart` was passed, so every change to the dated view was a change to the recurring one. Two grids overlap for now; folding Turmas onto the new one is proposed, not done.
- **2026-09-06** — The axis stays a week: seven days, each subdivided by pista, with time down the left on a pixel scale. A single-day view with lanes as columns was the other candidate and would have been closer to Google Calendar; keeping the week is what the screen is for.
- **2026-09-06** — Blocks are placed from their minutes at one pixel per minute, replacing slot-as-table-row. A 45-minute class in a 60-minute slot used to fill the row and read as an hour, which is a lie the operator had to know to discount.
- **2026-09-06** — A drop asks *this week / every week* in a popover at the cursor rather than a centred modal, and the block has already moved by the time it asks. Round 5's decision that the board must ask rather than guess stands; only the staging changed.
- **2026-09-06** — Snapping is to the facility's own slot rows, not to a fixed increment, falling back to the greatest common divisor of the grid's own times where no row covers the moment. There is no stored increment, and a real timetable is a list of rows rather than a number.
- **2026-09-06** — One droppable per day-and-lane column instead of one per cell. Measured on the reference club: 2,256 droppables became 168, a 13.4× cut, and that count — each cell running a rules evaluation on drag start — was the clunkiness, not the drag library.
- **2026-09-06** — Event colour is the level, in the club's own level order, over eight solid tints. Washed tints at 15% measured ΔE 4.5 apart, close enough that the colour carried no information; solid ones are ΔE 26.7 apart with white text at 4.6:1 or better in both themes.
- **2026-09-06** — A parceria keeps its partner's colour, and a turma with no level takes the neutral rather than the first tint. "Not said" must not look like "Iniciados".
- **2026-09-06** — The hover card is removed from the tree during a drag rather than given `pointer-events: none`. The ticket asked for the latter; it would have disabled Take the register and Cancel class, which are buttons inside the card that round 6 deliberately moved there.
- **2026-09-06** — Clicking an empty cell places an existing unscheduled turma rather than opening the new-turma form. That form has no day or time fields on purpose — a turma with no days is a valid half-finished thing — so the day and time a click carries would have gone nowhere. The lane is still not set by the click, because `placeSlotAction` returns no schedule id; dragging the block one column is the answer until it does.
- **2026-09-06** — The calendar gets a wider content column (`max-w-page-wide`, 104rem) and is the only page allowed one. AC5's rejection of per-page widths holds for pages made of text; it was never about a screen whose content is a grid, where the cap protects nobody and costs half the monitor.
- **2026-09-06** — The calendar draws only the weekdays the site opens on, from the facility's opening hours — keeping round 5's exception that a closed day still carrying a class is drawn anyway, shaded. A class that is invisible is a class nobody can move.
- **2026-09-06** — Classes on a holiday, on a day the pool is shut, or on a day already past are all faded, and **all three stay draggable**. This reverses the round-5 rule that past classes are undraggable: in use it read as a broken grid, since the block looks like every other block and does not move. Rearranging last Monday from Wednesday is ordinary planning, and the server already refuses what is genuinely impossible.
- **2026-09-06** — The lane header names the row "Pistas" once and numbers the columns by each lane's position in its pool, rather than repeating the lane's name on every column. Position rather than digits parsed out of the name: a club with "Raia A" and "Central" has no digits to parse, and a mix would put a column headed 4 in third place. The name stays on hover and in the hover card.
