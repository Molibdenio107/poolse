# POOLSE-46 · Bookings: subject types, lanes and instructor status

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Data model · **Area:** Scheduling · **Priority:** High — blocks POOLSE-49, 51, 52, 53

### PO — why this exists
Three facts about a real schedule that Poolse currently cannot record:

1. **A booking can occupy several lanes.** Competition squads take two or three; hidroginástica takes
   the whole tank.
2. **Most of the morning is not turmas.** `ES D. Dinis 10G 11B`, `EPA`, `Teresianas`, `Misericórdia
   (Hidroterapia)`, `JI Vinha`, `CAID`, `Andebol Sub 16` — external entities with no student records
   behind them. They consume most of the pool's daytime and Poolse has nowhere to put them.
3. **A missing instructor is a state, not a blank.** The sheet distinguishes `???` (to be defined)
   from `Sem professor` (uncovered) from `x`/`DE` (the entity brings its own). All three are frequent,
   and the club calls the uncovered ones its main problem.

This ticket widens the weekly pattern to hold all three. It is the hinge of the whole feature: the
grid (POOLSE-49), the conflict rules (POOLSE-51), occupancy (POOLSE-52) and the alerts (POOLSE-53)
all read what this defines.

**Not in scope:** the partner tables themselves (POOLSE-47) — this ticket references
`partner_group` and can be built against it or ahead of it with the FK added last. And the grid
(POOLSE-49): nothing here is drawn.

### BA — rules and data
- **`class_schedule` is extended, not replaced.** It is already the weekly pattern, and
  `class_session`, attendance, reposições, closures and the fees engine all hang off it. A new
  `booking` table would mean rewriting every one of those before anything new became visible.
  Decision taken this round; do not re-open it.
- A booking gains:
  - `subject_type`: `turma | parceria | evento | manutencao`
  - `class_group_id` — now nullable, required exactly when `subject_type = 'turma'`
  - `partner_group_id` — required exactly when `subject_type = 'parceria'`
  - `slot_id` — nullable; set when the booking's time matches a slot (POOLSE-44)
  - `instructor_membership_id` — an override; absent means the turma's own instructor
  - `instructor_status`: `assigned | to_define | external | uncovered`
  - `headcount_override` — nullable
  - `category_id` → `booking_category`
  - `notes`
- `booking_lane` joins a booking to **one or more** lanes. Every booking has at least one; there is
  no "whole pool" shorthand, because a pool without lanes has exactly one lane row (POOLSE-43) and
  hidroginástica across six lanes is six rows that the conflict rules can actually reason about.
- **A parceria booking has no students.** Its headcount is the partner group's `participant_count`,
  overridable per booking.
- **Parceria bookings generate dated sessions.** Decision taken this round: a closure must visibly
  cancel `ES D. Dinis` the same way it cancels a turma, occupancy must be actual rather than
  theoretical, and the printed grid must match what happens. What they do **not** get is a register —
  no attendance, no absences, no reposições. `participant_count` is the headcount and that is enough.
- `instructor_status` is derived where it can be and set where it cannot:
  - `assigned` — an instructor is resolved, from the booking or the turma;
  - `to_define` — the club knows it needs one and has not chosen (`???` on the sheet);
  - `external` — the partner brings their own; the name comes from
    `partner_group.own_instructor_name`;
  - `uncovered` — the slot has no instructor and that is a problem.
  `to_define` and `uncovered` are the operator's call; the system must not guess which of the two a
  blank means.
- `booking_category` is per facility, with a name and a colour, editable by the club: competition
  squads, hidroginástica, school groups, external partners, manutenção. Colour drives the cell
  (POOLSE-49) and never carries meaning alone.
- **Answered — Open question 4 (per-date exceptions).** Already solved and not part of this ticket:
  `class_session` is materialised precisely so "the 14th was cancelled" is expressible, and closures
  cancel sessions reversibly via `closure_id`. Parceria sessions join that mechanism unchanged.
- **Open:** does `evento` (a gala, a swim meet) need fields the others do not — a name of its own,
  say, since it has neither a turma nor a partner to take one from? *Recommendation:* give the
  booking a nullable `title` used only when there is no turma or partner behind it, rather than a
  fifth table.

### Dev — implementation notes
- ```
  booking_subject   enum ('turma','parceria','evento','manutencao')
  instructor_status enum ('assigned','to_define','external','uncovered')

  alter table class_schedule
    alter column class_group_id drop not null,
    add column subject_type booking_subject not null default 'turma',
    add column partner_group_id uuid,
    add column slot_id uuid,
    add column instructor_membership_id uuid,
    add column instructor_status instructor_status not null default 'assigned',
    add column headcount_override integer,
    add column category_id uuid,
    add column title text,
    add column notes text;

  booking_lane (organization_id, schedule_id, lane_id)
    primary key (schedule_id, lane_id)
    foreign key (organization_id, schedule_id) references class_schedule (organization_id, id)
    foreign key (organization_id, lane_id)    references lane (organization_id, id)
  ```
  `class_schedule` needs `unique (organization_id, id)` first — check whether it has one; the table
  was created with a bare `PRIMARY KEY (id)` and only `organization_id` beside it.
- **The subject invariant is a CHECK, not a convention:**
  ```
  check (
    (subject_type = 'turma'    and class_group_id is not null and partner_group_id is null) or
    (subject_type = 'parceria' and partner_group_id is not null and class_group_id is null) or
    (subject_type in ('evento','manutencao') and class_group_id is null and partner_group_id is null)
  )
  ```
  Without it, a parceria row carrying a stale `class_group_id` would be counted twice by occupancy
  and once by the register, and nothing would object.
- **Most likely to be got wrong:** `class_session`. It currently FKs to `class_group` and carries a
  single `lane_id` (after POOLSE-43). Both have to change:
  - `class_session.class_group_id` becomes nullable with the same CHECK, plus `schedule_id` so a
    session knows which booking produced it;
  - the single lane becomes `class_session_lane (session_id, lane_id)`, and
    **`class_session_lane_free` moves onto that table**. The exclusion becomes
    `exclude using gist (lane_id with =, tstzrange(starts_at, ends_at) with &&)` over a join column —
    which means `class_session_lane` must carry `starts_at`/`ends_at` copied from its session, kept
    honest by a trigger. An exclusion constraint cannot reach into another table; this is the same
    reason `class_session` already copies `pool_id` and `lane`.
  That trigger is the single highest-risk piece of this ticket. Test that shortening a session
  updates every one of its lane rows, and that a lane clash across a multi-lane booking is refused.
- Second most likely: `generate_sessions` iterating `class_group` rather than `class_schedule`. It
  has to iterate bookings now, because a parceria booking has no turma to be found through.
- Third: the fees engine and the register must both learn to ignore non-`turma` bookings. Grep every
  query that joins `class_session` to `class_group` and check what a null does to it.
- `booking_category` is small and per facility; it travels with the facility.

### QA — test scenarios
- **46.1** Given a booking with `subject_type = 'turma'` and no `class_group_id` / When inserted / Then the CHECK refuses it.
- **46.2** Given a booking with `subject_type = 'parceria'` carrying both a partner group and a turma / When inserted / Then it is refused.
- **46.3** Given a hidroginástica booking over six lanes / When saved / Then six `booking_lane` rows exist and the booking reads back with all six.
- **46.4** Given that booking / When another booking is placed on lane 3 in the same slot / Then it is refused by the lane exclusion.
- **46.5** Given that booking cancelled for one date / When another booking is placed on lane 3 that date / Then it is accepted.
- **46.6** Given a parceria booking / When the season is generated / Then dated sessions exist for it.
- **46.7** Given a closure covering one of those dates / When it is applied / Then the parceria session is cancelled and carries the `closure_id`.
- **46.8** Given the closure is deleted / When sessions are re-read / Then the parceria session is scheduled again.
- **46.9** Given a parceria session / When the register is opened for it / Then there is no register — the API refuses attendance against a non-turma session.
- **46.10** Given a parceria booking / When occupancy is computed / Then its headcount is the partner group's `participant_count`, or the booking's override where set.
- **46.11** Given a booking whose session is shortened by ten minutes / When its lane rows are read / Then every one carries the new end time.
- **46.12** Given a turma booking with `instructor_status = 'uncovered'` / When read / Then no instructor is resolved and the status is preserved rather than recomputed to `assigned`.
- **46.13** Given a booking with a lane in another organization's pool / When inserted / Then the composite key refuses it.
- **46.14** Given the fees engine / When it runs over a season containing parceria bookings / Then no mensalidade is produced for them.
- **46.15** Given the existing turmas after migration / When each is read / Then it has exactly one `booking_lane` row and its old lane.

### Built — decisions taken while building

- **A booking gained its own `facility_id`**, which the ticket did not call for. It reached its
  site through its turma, and that stops working the moment a booking has no turma — worse,
  the opening-hours trigger reads that site, so a `NOT FOUND` would have read as "this site
  has no hours" and waved every parceria and evento straight through. A trigger fills it in
  from the turma so a NOT NULL column did not become forty edited call sites.
- **Trigger *names* turned out to be load-bearing.** Postgres fires BEFORE triggers in
  alphabetical order, so the site default must sort ahead of `class_schedule_hours`. Named
  `class_schedule_site` it sorted after, and a class landed on a day the site is shut.
  `facility-hours.sql` test 2a caught it. It is `class_schedule_default_site` now, with the
  reason written above it.
- **The sync trigger fires on every update, not a column list** — and this is the bug the
  ticket predicted. `AFTER UPDATE OF ends_at` names the columns the *statement* sets, and
  `ends_at` is written by a BEFORE trigger from `duration_minutes`. Shortening a class never
  listed it, so the lane rows kept the old window and the lane looked busy while it was free.
  `bookings.sql` test 4 is what caught it.
- **I got the refusal message wrong and a test caught that too.** The rewritten hours trigger
  said `outside_facility_hours` for the runs-past-closing branch, where the original said
  `class_ends_after_closing` — and `scheduleRefusal` reads that prefix to tell "starts too
  early" from "runs past closing". The two say different things to an operator.
- **The lane guarantee is asserted in one place.** `bookings.sql` tests 3 to 5 now own it;
  the copies in `lanes.sql`, `sessions.sql` and `classes.sql` were removed with a pointer,
  because two files asserting one guarantee is two places to update the next time it moves.
- **`class_group.lane_id` stayed**, as the turma's default rather than a second truth —
  one lane, on the turma's form, the way `capacity` is. `syncBookingLanes` pushes it down onto
  the turma's bookings and is the single place that changes when the grid can place a booking
  on lanes of its own.
- **`class_session.lane` on the API became `lanes: number[]`.** `laneLabel` in
  `apps/web/src/lib/lanes.ts` renders it, and refuses to smooth `[1,4]` into "pistas 1–4" —
  that would claim two lanes somebody else is swimming in, on a sheet pinned to a wall.
- **Not built here:** the register and the fees engine ignore non-turma bookings by
  construction today, because nothing can create one yet — `subject_type` only leaves 'turma'
  reachable until POOLSE-47 adds `partner_group`. The explicit guards land with that ticket.

### Acceptance criteria

1. `class_schedule` carries `subject_type`, and a database CHECK makes the turma/partner/neither invariant impossible to violate.
2. `booking_lane` lets one booking occupy several lanes; every booking has at least one lane row and there is no "whole pool" special case.
3. Parceria bookings generate dated sessions, are cancelled and restored by closures like any other, and carry no register.
4. Attendance against a non-turma session is refused by the API, not merely hidden.
5. `instructor_status` distinguishes assigned, to-define, external and uncovered, and is never inferred from a blank.
6. `booking_category` exists per facility with a name and a colour, editable by owner/admin.
7. The lane exclusion constraint moves to `class_session_lane` with times kept honest by a trigger, and a multi-lane clash is refused by the database.
8. Shortening or moving a session updates every one of its lane rows, proven by a test.
9. `generate_sessions` iterates bookings rather than turmas, so a booking with no turma still produces sessions.
10. The fees engine and the register both ignore non-turma bookings, proven by a test over a season containing both.
11. Existing turmas migrate to exactly one lane row each, losing nothing.
