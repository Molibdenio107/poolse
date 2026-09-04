# POOLSE-56 · A full slot takes no more classes

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug / rule · **Area:** Scheduling / Data integrity · **Priority:** High — the rule is stated and half-enforced

### PO — why this exists

The club's rule, as stated:

> Two classes that start at the same time, or whose hours coincide, **may** occupy the slot as
> long as they are on different lanes. **When every lane is occupied, no further class may take
> that schedule.**

The first half is what POOLSE-51 built and is right: Sandra running three groups on three
adjacent lanes at 19:15 is the club's ordinary Tuesday, and a scheduler that refused it would be
turned off before lunch. The second half is the other side of the same rule, and it is what
stops the grid from quietly accepting more classes than there is water for.

Today a club can put eleven classes at 19:15 in a six-lane tank, and nothing objects.

**Not in scope:** capacity by *headcount* — how many swimmers fit in a lane is POOLSE-51's
`lane_level_capacity` and is a warning, not a refusal. This ticket is about lanes, not people.

### BA — rules and data

**What is already correct, and must stay correct:**

- Several classes at one time on **different** lanes — accepted.
- One instructor across several adjacent lanes of one tank — accepted (POOLSE-51).
- A second class on a lane already taken at an overlapping time — refused.

**The hole.** A booking may name **no lane at all**. `class_group.lane_id` has always been
optional, the grid draws a "Sem pista" row for it, and `class_session_lane_free` — the exclusion
constraint that refuses a shared lane — has nothing to say about a booking that occupies none.
So "no lane" is an escape hatch around the rule.

Probed against a real database rather than assumed:

| Case | Today |
|---|---|
| Two classes, two different lanes, same time | accepted — correct |
| Drag a class onto a lane already taken at that time | refused — correct |
| A third class with **no lane** when every lane is full | **accepted** |
| Drag a class into a full slot with **no lane** | **accepted** |

**Open — needs deciding before this is built.** A laneless booking names a *facility*, not a
pool, so "every lane is occupied" has two readings:

1. every lane of the **pool** the turma belongs to (`class_group.pool_id`) — but a laneless
   booking on a turma with no pool has no answer at all; or
2. every lane at the **site**, across all its tanks.

*Recommendation:* (2). It is the honest reading of "there is no water free", it answers for a
booking with no pool, and it degrades correctly for a one-tank club, which is most of them.

**Existing data must not be broken.** Clubs already have laneless bookings — turmas created
before lanes existed. The rule governs *new* bookings and *moves*; it must not make an existing
timetable unsavable, or the first thing a club sees is that it can no longer edit its own week.

### Dev — implementation notes

- Two write paths: `addSchedule` in `classes.repository.ts`, and `moveBooking` /
  `duplicateBooking` in `bookings.repository.ts`. `laneConflicts` is where the lane-level check
  already lives and is the natural place for its sibling.
- **Most likely to be got wrong:** counting lanes that are not free for a *different* reason. A
  lane occupied by a booking that is being moved must not count against the move — the same trap
  `laneConflicts` already handles by excluding the schedule being moved.
- Second: the overlap is by *time*, not by slot. A 90-minute class occupies the 19:15 and 20:00
  rows, so a class at 20:00 has fewer free lanes than the slot grid suggests. `slotsCovered` in
  `lib/grid-layout.ts` is the shared answer to which rows a booking touches.
- The refusal must be a **named cause** the grid turns into a sentence — `LaneTakenError` and
  `ClosedError` are the pattern. A constraint name in a toast tells an operator nothing.
- Whether this belongs in the schema as well as the repository is worth a thought. CLAUDE.md's
  rule is that structural guarantees live in the database, and the licence trigger is the recent
  precedent — but this one needs overlap arithmetic across a *facility's* lanes at the pattern
  level, which is a harder trigger than it looks. Repository-first is defensible if the reason is
  written down.

### QA — test scenarios

- **56.1** Given a two-lane tank with both lanes booked at 19:15 / When a third class is added at 19:15 with no lane / Then it is refused with a named cause.
- **56.2** Given the same / When a third class is added at 19:15 on a free lane of another tank / Then it is accepted.
- **56.3** Given a six-lane tank with three lanes booked / When a class spanning four lanes is added / Then it is refused, and the message says how many lanes are free.
- **56.4** Given a 90-minute class occupying 19:15 and 20:00 / When a class is added at 20:00 / Then the lanes it holds are counted as taken.
- **56.5** Given a booking already in a full slot / When it is moved within that slot / Then it is not refused by its own occupancy.
- **56.6** Given an existing laneless booking in a full slot / When it is edited without moving / Then it saves.
- **56.7** Given a cancelled session / When lanes are counted / Then it frees its lane, as it already does for the lane conflict.
- **56.8** Given an instructor / When they attempt the move through the API / Then the role check refuses it before the capacity check is reached.
- **56.9** Given tenant A's full slot / When tenant B books the same weekday and time / Then it is unaffected.

### Acceptance criteria

1. A booking cannot be created or moved into a time window where no lane at the site is free, whether or not it names a lane.
2. Several classes at coinciding times on different free lanes remain accepted, and one instructor across adjacent lanes of one tank remains accepted.
3. The refusal names the cause and says how many lanes are free, in both locales.
4. A booking being moved does not count its own lanes against itself.
5. Overlap is by time, so a class crossing two rows occupies its lanes in both.
6. Existing laneless bookings remain editable and savable; the rule governs new bookings and moves.
7. The **Open** above is answered in this ticket before the code is written.
8. A cancelled session frees its lanes for the count, as it already does for the lane conflict.

---

## Raised 2026-09-04

Stated by Rui as a standing rule, probed against the database the same evening, and written up
rather than built: the **Open** above genuinely changes the implementation, and adding a new
refusal the night before a testing day would risk a day spent hitting it. The probe table in the
BA section is measured, not assumed.
