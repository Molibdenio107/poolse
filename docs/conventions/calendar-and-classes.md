# Calendar, classes and recintos

The full text of the conventions for the calendar, turmas, sessions, lanes, closures, seasons or partnerships. `CLAUDE.md` holds one line each; read this file before changing that area.

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

**A partnership's contract comes before its terms and keeps its versions.** POOLSE-105. Attaching one with no agreement makes a *termos por preencher* agreement: start date, model and price all null, by CHECK, and filled in place by *Registar os termos*. `partner_contract_version` is the history (insert-only bar closing one), and `document_key` stays the current pointer. Staff download it through `PartnerDetail.contract`, outside the withheld `agreement`. Word is a contract-only type, sniffed by content, served as an attachment; `acceptFor(purpose)` in `lib/files.ts` is the picker's list and `DocumentLink` the link. `docs/features/parcerias.md`.

**The season is organization-scoped and already built; a screen picks from it, never keeps its
own.** `season` has the name, both dates, one `published` at a time and its own page under
Turmas, and it is wired into `generate_sessions`, `class_group`, `class_schedule` and
`facility_time_slot`. Anything that needs a season reads that list — the price list filters out
`archived`, because a year that has ended cannot be priced afresh.

**A pool is a recinto of sport `pool`, and the pool's own trigger makes it.** POOLSE-122. `playing_area` sits between a site and its tanks; `sport` is a platform catalogue the app only reads. Insert a pool exactly as before — `pool_area_ensure` makes its recinto, `pool_area_sync` carries its name and archive both ways, and `class_group` / `closure` / `energy_meter` get `playing_area_id` by `*_area_from_pool`. Readers still read `pool_id`; never write a recinto by hand for a pool. `docs/data-model.md`, *Recintos*.

**A closure is one site or some of its tanks, and what it reaches is `closure_reaches` / `session_reach`.** POOLSE-84. Only a holiday leaves `facility_id` null; a manual closure without a site is refused by CHECK and by the API (422). Several tanks are one row each, sharing `batch_id` (the warning reads the batch). A session's tanks are its turma's pool **and its lanes' pools** — a parceria or free-swim block has no `pool_id`. Half days cut at `closure_half_day_cut()` (13:00, on a lesson's start), written nowhere else. Every reader goes through `apply_closures`, `release_closures`, `closure_impact`, `closure_day_shut` (day-level questions: every closure of the day together, so a morning and an afternoon shut it — sweep 19-10b; `closure_shuts_day` is one closure's own answer) or `pool_closure_at` / `pool_closures_on` (check-in refusal, "Encerrado até"); never a hand-written `c.pool_id = cs.pool_id`. They act **from the club's today on**, never on the past; generation skips a lesson with a register; lifting restores only a live slot's lessons, one at a time, then tops the season up; a one-week move into a closure is refused by the server (`occurrenceClosed`). A holiday shuts every tank, free swim included (Rui, 19-10-2026). `docs/data-model.md`, `docs/features/calendar.md`.

**A partnership group's days are written by one path, all or nothing** (POOLSE-117). `placePartnerDaysIn` (`facilities/partner-days.repository.ts`) backs the calendar's *Colocar aqui*, the Turmas card's *Adicionar dia* and the partnerships import. Any refused day writes nothing, and the 409 lists every day; `partnerClashSentence` (`lib/partner-days.ts`) says each one. A sheet's days are read by `partner-days-sheet.ts` in either language, and a range is refused, never guessed. `docs/features/parcerias.md`.

**A turma is chosen in `TurmaPicker` (`components/turma-picker.tsx`), never a `<select>` of joined strings.** POOLSE-110: grouped by level with the requested level first, searchable, a row per turma with slots, instructor and a fill bar with its figure, a full turma pickable only where `allowFull`. A caller with a better grouping than level gives every row `group: { key, label, order }`; the rows then keep their given order (POOLSE-113, the advancement queue's rank reasons). Used by Pedidos and the advancement queue; the app's enrolment swaps to it next. A control inside a dialog that closes itself on Escape marks itself `data-own-escape`, and `Dialog` leaves the key to it.

**Turmas opens on *Lista*** (called *Cartões* until 09-11-2026) (`turma-cards.tsx`, multi-sport Slice 4): a card per turma with a `Badge` of *Aberta / Completa / Sem professor*, the last outlined in amber; the weekly board is `?section=week`. `docs/features/classes.md`.

**Capacity rules compose, they do not override.** An enrolment must fit its turma
(`class_group.capacity`), the turmas sharing a slot must fit the tank (`pool.max_capacity`),
and `lane_level_capacity` is a separate teaching judgement. A null ceiling means "not
measured" and enforces nothing — never treat it as zero.

**A calendar block's state is words first** (multi-sport Slice 4): *Sem professor* (`uncovered`) is the amber wash (`.lesson-chip-uncovered`, .15) and a `lesson-line-warn` second line; *A definir* (`to_define`) is muted words and no wash; a full turma's fill line is `lesson-line-strong`; *Marcar aula* is a dashed hover ghost, never drawn in every free slot. A new block state is a class in globals.css plus its contrast pairs. `docs/features/calendar.md`.

**One student, one hour: an enrolment that overlaps another of the student's turmas is refused; a move that creates one is warned** (POOLSE-144). `enrollment_clashes()` is the one definition (pattern × pattern, same season, any sport or site), read by the `enrollment_time_clash` trigger, `readGrid`'s `clashStudents` and `GET /class-groups/clashes`. Its refusal is `check_violation` with DETAIL `enrollment_clash|<turma>|<weekday>|<HH:MM>`, the capacity trigger's code, so **a mapping reads `clashFrom` (`classes/enrollment-clash.ts`) before treating a 23514 as "full"**, and a new enrolment path answers `clashConflict`. `docs/features/classes.md`.

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

**A parceria takes no register, ever — but it may take a plan.** `partner.managed_lessons` is
one switch on the partnership, off by default, and it grants the training plan and Cancelar
aula on the calendar and nothing else. The register is not a UI choice: `partner_group` holds
a `participant_count` and no people, and `attendance` needs a real `student_id`. A `lesson_plan`
therefore hangs off a turma **or** a partner group, with a CHECK that exactly one is set and a
partial unique index each — one index over both columns enforces nothing, because two partner
plans on a day differ only by their null `class_group_id`s.

**A draggable block carries no click.** Every drag and every resize ends with the browser
firing a click on whatever is underneath, so a block that both moves and opens something will
open it by accident. Timers that suppress the trailing click narrow the window without closing
it. Put the action on the hover card beside the others. A hover card closes when focus leaves its
trigger and never opens for touch, so on the calendar a click or tap **pins** it open (`pinnable`,
closed by Escape or a click outside; a click that ends a drag or resize is ignored), and a keyboard
reaches it through `TurmaCardButton`, a ⋯ shown only on keyboard focus. A block has four resize
edges: the top moves the start and keeps the end.

**The calendar draws the pattern, overlaid with the week's own sessions.** `readGrid` returns
`class_schedule`; the page re-times each booking to its `class_session` for that week before
handing them to the grid. Skip the overlay and a one-week move is written, refused and
reported correctly — and then invisible, because the block springs back to the pattern's slot.
A change the screen cannot show reads as a change that did not happen.

**A week's occurrence is found by its booking's id, never by turma-weekday-hour.** **So a turma lesson with no `schedule_id` is invisible to the calendar** while the family app, which lists lessons as they are, still shows it: 169 such lessons, left in Rui's dev club by a timetable from before bookings (27-08-2026), put a Masters class on a student's phone that the calendar did not have (09-11-2026; deleted). `generate_sessions` always sets the link, and `sessions.sql` test 1e holds it there.
`bookingKey` in `lib/slot-key.ts`; `slotKey` is the fallback for a session with no booking.
The composite was exact only while an occurrence could not leave its pattern's slot — it can
now, so the two halves stop agreeing the moment anybody moves one week, and every control on
the card silently vanishes from the classes that were rearranged. A lookup that returns
`undefined` renders nothing and reports nothing: prefer a key that cannot drift.

**A turma's lessons follow its pattern on their own.** 11 October 2026, Rui's call. Every write that changes a weekly pattern — placing, a series move, duplicating, a timetable import, adding or removing a slot — tops up the season's lessons through `syncSeasonLessons` (`classes/lesson-sync.ts`), **from today to the end of the published season, never the past**, so a turma placed today owes no register for September. It is `generate_sessions`, idempotent, so the *Gerar a época* button stays for after a closure. **A clash (two turmas, one instructor, one hour) leaves out only the turmas in it** — `generate_sessions` takes a skip list — and the calendar names it (`grid.lessonsClash`); the *Gerar a época* button still refuses on a clash. Removing a slot cancels its future, untaught lessons — never deletes them, never touches one with a register.

**A taught class is a record, not a plan.** One row in `attendance` for a session means it
happened, so it does not move, and once it has ended it is not cancelled. **Until its end a lesson
can be called off, marks kept** (Rui, 02-11-2026); after it, only owner or admin and only unmarked —
`cancelState` / `mayCancel` in `sessions.repository.ts`, read by the endpoint and the register's `canCancel`. `Session.registerTaken` carries the
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
takes no click (`creatable`, separate from `disabled`) and offers no sideways resize. **A class in no pista keeps its pool** (POOLSE-223, 12-11-2026): `class_schedule.pool_id`, set by the import and by the `booking_lane_sets_pool` trigger whenever lanes are written, so the column of one tank shows that tank's classes, and a class with no pool known shows in every tank's.

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
