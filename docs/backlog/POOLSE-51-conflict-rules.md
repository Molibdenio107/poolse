# POOLSE-51 · Conflict rules on the lane grid

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Data integrity · **Priority:** High

### PO — why this exists
The whole value of a planning grid is that it refuses to let you make the mistakes that cost money
and embarrassment — two groups sent to the same lane, an instructor booked at two sites at once — and
does **not** refuse the things that look like mistakes and are not. The reference sheet has Sandra
running Cadetes, Infantis and Absolutos at 19:15 simultaneously, on three adjacent lanes of one tank.
A scheduler that called that a conflict would be wrong about the club's actual practice on its first
screen, and would be turned off.

So this ticket is as much about what is *allowed* as about what is blocked.

**Not in scope:** the gestures (POOLSE-50) and the "sem professor" counter (POOLSE-53).

### BA — rules and data

**Hard blocks — refused by the database, not merely by the screen.**
- The same lane booked twice in one slot. Already enforced for turmas by `class_session_lane_free`;
  POOLSE-46 moves it to `class_session_lane` so it covers multi-lane and parceria bookings too.
- An instructor in two bookings in the same slot **in different pools or different facilities**. One
  person cannot be in two buildings. This is new and needs its own constraint.

**Allowed, and badged.**
- One instructor across **adjacent lanes of the same pool** in the same slot. This is normal
  practice. Show a small `×3` badge on each of that instructor's blocks so the load is visible, and
  let the facility set `max_concurrent_groups_per_instructor` — above which it becomes a soft
  warning, never a block. Default null, meaning no opinion: a default of 3 would be this code
  inventing a club's staffing policy.
- Adjacency is not required to be strict. Lanes 1 and 4 of one pool is unusual but physically
  possible and is not this ticket's business to forbid.

**Soft warnings — shown, never blocking.**
- Headcount above lane capacity. Capacity comes from `lane.default_capacity`, overridable per level
  in facility configuration. A club that puts 12 in a lane rated 10 for one term is making a
  decision, not an error.
- A booking on a weekday disabled in facility configuration, or overlapping a closure date. This
  matches the existing rule exactly: disabling a weekday keeps the classes already on it and blocks
  new ones — so an *existing* booking on a newly disabled day warns, and a *new* drop onto one is
  refused at the drop (POOLSE-50).
- A booking outside the facility's opening hours. `class_schedule_within_facility_hours()` already
  refuses these outright for turmas; this ticket does not weaken it.

**Live feedback during the drag.**
- While dragging, every cell shows its state before the pointer is released: valid, soft-warned
  (named), hard-blocked (named). "Named" is the requirement — "Pista 3 já tem Infantis A" is
  actionable; a red cell is not.
- Colour is never the only cue: a blocked cell carries an icon and, on hover or focus, the reason as
  text.

- **Answered — Open question 1 (cross-pool spanning).** A booking occupies lanes in **one** pool.
  The reference never spans two, hidroginástica overflowing into the learner tank is two bookings,
  and keeping a booking inside one pool is what lets the lane exclusion stay a single index.
- **Open:** should an instructor conflict across two *organizations* be detectable? A person who
  teaches at two clubs both using Poolse is invisible to both. *Recommendation:* no, and say so
  plainly — cross-tenant visibility is exactly what this schema exists to prevent.

### Dev — implementation notes
- The lane block is already structural after POOLSE-46. This ticket adds the instructor one:
  ```
  alter table class_session
    add constraint class_session_instructor_free
    exclude using gist (
      resolved_instructor_id with =,
      facility_id with <>,          -- see below
      tstzrange(starts_at, ends_at) with &&
    ) where (status <> 'cancelled' and resolved_instructor_id is not null);
  ```
  **`WITH <>` is not a thing an exclusion constraint can express against a GiST index** — the
  operator has to be a member of an operator class. The workable shape is an exclusion on
  `(instructor_id WITH =, pool_id WITH <>, range WITH &&)` using `btree_gist`, which **does** provide
  `<>` for the btree types it covers. Verify this against the actual Postgres version before
  designing the UI around it; if it will not hold, the fallback is a `BEFORE INSERT OR UPDATE`
  trigger doing the lookup, which is slower and equally correct. **Decide this first — it is the
  riskiest unknown in the ticket.**
- `resolved_instructor_id` has to be a real column on `class_session`, copied at generation time from
  the booking's override or the turma's instructor. An exclusion constraint cannot reach into another
  table — the same reason `pool_id` and the lanes are already copied.
- **Most likely to be got wrong:** the badge count. `×3` must count that instructor's *concurrent*
  bookings in that slot, which after POOLSE-46 means counting bookings and not lanes — an instructor
  on one three-lane booking is running one group, not three.
- Second: soft warnings must be computed for the whole visible grid in one query, not per cell. A
  14×5×6 grid is 420 cells; 420 round trips is a screen that never finishes painting.
- Third: the live drag feedback must use the same rule functions as the server. Put them in a pure
  module both halves import, the way `lib/sheet.ts` is shared — a client that thinks a drop is fine
  and a server that refuses it is the worst version of this feature.
- `max_concurrent_groups_per_instructor` goes on the facility, beside the hours. Nullable.

### QA — test scenarios
- **51.1** Given a booking on lane 3 at 19:15 / When another is placed on lane 3 at 19:15 / Then the database refuses it.
- **51.2** Given a booking on lanes 2–4 / When another is placed on lane 3 / Then the database refuses it.
- **51.3** Given the first booking cancelled for that date / When the second is placed / Then it is accepted.
- **51.4** Given Sandra on lane 2 at 19:15 / When she is placed on lanes 3 and 4 at 19:15 in the same pool / Then all three are accepted and each shows a `×3` badge.
- **51.5** Given Sandra on one three-lane booking / When the badge renders / Then it says `×1`, not `×3`.
- **51.6** Given Sandra at 19:15 in the main tank / When she is placed at 19:15 in the learner tank / Then it is refused.
- **51.7** Given Sandra at 19:15 at one facility / When she is placed at 19:15 at another / Then it is refused.
- **51.8** Given `max_concurrent_groups_per_instructor` of 3 / When a fourth concurrent group is added / Then it is accepted with a soft warning naming the instructor and the count.
- **51.9** Given that setting null / When any number is added / Then there is no warning.
- **51.10** Given a lane rated 10 / When a booking with 12 lands on it / Then it is accepted and warns, naming the lane and both numbers.
- **51.11** Given a weekday disabled after a booking exists on it / When the grid renders / Then the booking is present and warned, not deleted.
- **51.12** Given that disabled weekday / When a new drop is attempted on it / Then it is refused at the drop.
- **51.13** Given a drag in progress / When the pointer is over a lane already taken / Then that cell says which booking is in the way, before release.
- **51.14** Given a drag in progress / When the pointer is over a cell that only warns / Then it is visibly distinct from both valid and blocked, with an icon and text, in light and dark.
- **51.15** Given the client's rule module and the server's / When the same booking is evaluated by both / Then they agree, proven by a shared test fixture.
- **51.16** Given tenant A's instructor booked at 19:15 / When tenant B books its own instructor at 19:15 / Then nothing about A is consulted or revealed.

### Acceptance criteria

1. The same lane in the same slot cannot be booked twice, refused by the database, including across multi-lane and parceria bookings.
2. An instructor cannot be booked in two pools or two facilities in the same slot, refused by the database — or by a trigger, if the exclusion operator proves unavailable, with the reason recorded.
3. One instructor across several lanes of one pool in one slot is allowed, and each block shows a concurrency badge counting bookings, not lanes.
4. `max_concurrent_groups_per_instructor` is a nullable facility setting; above it, a soft warning, never a block.
5. Headcount above lane capacity warns and names the lane and both numbers.
6. An existing booking on a newly disabled weekday warns; a new drop onto one is refused.
7. Bookings outside opening hours remain refused by the existing trigger, unweakened.
8. During a drag, every cell shows valid, warned or blocked before release, with the reason as text and never colour alone.
9. Warnings for the whole visible grid are computed in one query.
10. Client and server evaluate conflicts through the same shared pure module, proven by a test fixture both run.
11. Cross-tenant instructor conflicts are explicitly not detected, and this is recorded as a decision rather than left as a gap.
