# Decisions

Product decisions taken in conversation, one line each, newest last. They live here
because the reasoning otherwise survives only in a chat log nobody reads again — and
several of these reverse an earlier decision, which is exactly the kind of thing that gets
quietly re-reversed six months later by somebody reading the older comment.

Schema decisions live in `docs/data-model.md`; standing conventions live in `CLAUDE.md`.
This file is for the calls themselves.

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
